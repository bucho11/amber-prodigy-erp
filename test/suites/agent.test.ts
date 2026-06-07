/**
 * Agentic-OS runtime suite — proves the security-load-bearing path against live SQL:
 * RBAC denial, pre-execution approval (NO side effect until approved), real execution via the
 * existing db modules, input validation, and a tamper-evident audit trail (P9).
 */
import { assert, assertEqual, TestRunner } from "../harness";
import { executeTool, toolDefinitions, type AgentActor } from "@prodigy/agent";

type Db = typeof import("@prodigy/db");

export async function run(db: Db, t: TestRunner): Promise<void> {
  t.suite("Agentic-OS runtime — RBAC, approval gates, audit");

  const tenant = await db.getTenantBySlug("prodigy");
  assert(tenant, "tenant #1 seeded");
  const tenantId = tenant.id;

  const owner: AgentActor = { tenantId, userId: "1", displayName: "Owner Bot", isOwner: true, permissions: [] };
  const frontDesk: AgentActor = {
    tenantId,
    userId: "2",
    displayName: "Front Desk Bot",
    isOwner: false,
    permissions: ["scheduling.view", "clients.view"],
  };

  await t.test("tool catalog flags allowed per the actor's permissions", () => {
    const ownerTools = toolDefinitions(owner);
    assert(ownerTools.every((d) => d.allowed), "owner may call every tool");
    const fdTools = toolDefinitions(frontDesk);
    const giftcard = fdTools.find((d) => d.name === "issue_gift_card");
    assert(giftcard && giftcard.allowed === false, "front desk may NOT issue gift cards (no sales.manage)");
  });

  await t.test("read tool (auto) executes for an authorized actor", async () => {
    const out = await executeTool(owner, "get_trial_balance", {});
    assertEqual(out.status, "ok", "trial balance returns ok");
    assert(out.status === "ok" && typeof (out.result as { totalDebitCents: number }).totalDebitCents === "number", "result is a trial balance");
  });

  await t.test("RBAC denies a tool the actor lacks permission for (server-side, P9)", async () => {
    const out = await executeTool(frontDesk, "get_trial_balance", {});
    assertEqual(out.status, "denied", "front desk denied financials.view tool");
  });

  await t.test("approval tool does NOT run until approved (no side effect)", async () => {
    const before = (await db.listGiftCards(tenantId, {})).length;
    const pending = await executeTool(owner, "issue_gift_card", { amountCents: 5000 });
    assertEqual(pending.status, "requires_approval", "unapproved issue pauses for approval");
    const after = (await db.listGiftCards(tenantId, {})).length;
    assertEqual(after, before, "NO gift card was created while pending approval");
  });

  await t.test("approval tool runs once approved, via the real db path", async () => {
    const before = (await db.listGiftCards(tenantId, {})).length;
    const out = await executeTool(owner, "issue_gift_card", { amountCents: 5000, note: "agent test" }, { approved: true });
    assertEqual(out.status, "ok", "approved issue executes");
    const after = await db.listGiftCards(tenantId, {});
    assertEqual(after.length, before + 1, "exactly one gift card created");
    assert(out.status === "ok" && (out.result as { balanceCents: number }).balanceCents === 5000, "card has the right balance");
  });

  await t.test("bad input is rejected before any side effect", async () => {
    const out = await executeTool(owner, "create_client", { email: "noname@test.local" }, { approved: true });
    assertEqual(out.status, "error", "missing displayName → error");
  });

  await t.test("unknown tool is rejected", async () => {
    const out = await executeTool(owner, "delete_everything", {}, { approved: true });
    assertEqual(out.status, "error", "unknown tool → error");
  });

  await t.test("every agent action landed on the tamper-evident audit chain (intact)", async () => {
    const chain = await db.verifyAuditChain(tenantId);
    assert(chain.intact, "audit chain intact after agent activity");
    const entries = await db.listAuditLog(tenantId, { limit: 500 });
    assert(
      entries.some((e) => e.resourceType === "agent_tool"),
      "agent_tool entries are recorded in the audit log"
    );
  });
}
