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

  await t.test("expanded registry: read tools across CRM / scheduling / reports / inventory run", async () => {
    const findClient = await executeTool(owner, "find_client", { search: "Money" });
    assertEqual(findClient.status, "ok", "find_client runs");
    assert(findClient.status === "ok" && Array.isArray(findClient.result), "find_client returns a list");

    const sales = await executeTool(owner, "sales_summary", {}); // defaults to current month
    assertEqual(sales.status, "ok", "sales_summary runs with default dates");

    const snap = await executeTool(owner, "inventory_snapshot", {});
    assertEqual(snap.status, "ok", "inventory_snapshot runs");

    const appts = await executeTool(owner, "list_appointments", {}); // defaults to today
    assertEqual(appts.status, "ok", "list_appointments runs with default range");
  });

  await t.test("expanded registry respects RBAC per tool", async () => {
    // front desk has clients.view + scheduling.view, but NOT reports.view.
    assertEqual((await executeTool(frontDesk, "find_client", { search: "x" })).status, "ok", "front desk may search clients");
    assertEqual((await executeTool(frontDesk, "list_appointments", {})).status, "ok", "front desk may list appointments");
    assertEqual((await executeTool(frontDesk, "sales_summary", {})).status, "denied", "front desk denied sales_summary (no reports.view)");
  });

  await t.test("bad date input is rejected", async () => {
    const out = await executeTool(owner, "sales_summary", { from: "06/01/2026" });
    assertEqual(out.status, "error", "non-ISO date rejected");
  });

  await t.test("every agent action landed on the tamper-evident audit chain (intact)", async () => {
    const chain = await db.verifyAuditChain(tenantId);
    assert(chain.intact, "audit chain intact after agent activity");
    assert(chain.count >= 10, "more than 10 audit entries (guards the sort-order regression)");
    const entries = await db.listAuditLog(tenantId, { limit: 500 });
    assert(
      entries.some((e) => e.resourceType === "agent_tool"),
      "agent_tool entries are recorded in the audit log"
    );
  });

  await t.test("tampering with an audit row is still detected with >10 entries", async () => {
    // Mutate an early row's detail in SQL — its hash no longer matches. (Runs last; the DB is ephemeral.)
    await db.query(
      `UPDATE audit_log SET detail = 'TAMPERED' WHERE tenant_id = $1 AND id = (SELECT min(id) FROM audit_log WHERE tenant_id = $1)`,
      [tenantId]
    );
    const chain = await db.verifyAuditChain(tenantId);
    assert(!chain.intact, "verification detects the tamper");
    assert(chain.brokenAtId !== undefined, "reports where the break is");
  });
}
