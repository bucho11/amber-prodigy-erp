/**
 * Approval-queue suite — the durable human-in-the-loop. Proves: a proposed write persists as
 * pending (no side effect); approve executes it once through the real db path and records the
 * outcome; reject closes it with no execution; an approver lacking the permission can't approve;
 * a decided approval can't be re-decided (no double-execute).
 */
import { assert, assertEqual, TestRunner } from "../harness";
import { requestApproval, listPendingApprovals, decideApproval, type AgentActor } from "@prodigy/agent";

type Db = typeof import("@prodigy/db");

export async function run(db: Db, t: TestRunner): Promise<void> {
  t.suite("Approval queue — durable human-in-the-loop");

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

  await t.test("requesting approval persists a pending action (no side effect)", async () => {
    const before = (await db.listGiftCards(tenantId, {})).length;
    const approval = await requestApproval(owner, "issue_gift_card", { amountCents: 4000, clientId: null, note: "queued" });
    assertEqual(approval.status, "pending", "stored as pending");
    const pending = await listPendingApprovals(tenantId);
    assert(pending.some((a) => a.id === approval.id), "shows in the pending queue");
    const after = (await db.listGiftCards(tenantId, {})).length;
    assertEqual(after, before, "no gift card created while pending");
  });

  await t.test("approving executes the action once and records the outcome", async () => {
    const approval = await requestApproval(owner, "issue_gift_card", { amountCents: 7000, clientId: null, note: null });
    const before = (await db.listGiftCards(tenantId, {})).length;
    const outcome = await decideApproval(owner, approval.id, "approve");
    assertEqual(outcome.status, "executed", "approve → executed");
    const after = await db.listGiftCards(tenantId, {});
    assertEqual(after.length, before + 1, "exactly one gift card created");
    const reloaded = await db.getAgentApproval(tenantId, approval.id);
    assertEqual(reloaded?.status, "executed", "row marked executed");
  });

  await t.test("rejecting closes the action with no execution", async () => {
    const approval = await requestApproval(owner, "issue_gift_card", { amountCents: 9000, clientId: null, note: null });
    const before = (await db.listGiftCards(tenantId, {})).length;
    const outcome = await decideApproval(owner, approval.id, "reject");
    assertEqual(outcome.status, "rejected", "reject → rejected");
    const after = (await db.listGiftCards(tenantId, {})).length;
    assertEqual(after, before, "nothing executed on reject");
  });

  await t.test("an approver lacking the permission cannot approve (stays pending)", async () => {
    const approval = await requestApproval(owner, "issue_gift_card", { amountCents: 3000, clientId: null, note: null });
    const outcome = await decideApproval(frontDesk, approval.id, "approve");
    assertEqual(outcome.status, "denied", "front desk denied (no sales.manage)");
    const reloaded = await db.getAgentApproval(tenantId, approval.id);
    assertEqual(reloaded?.status, "pending", "approval still pending after a denied attempt");
  });

  await t.test("a decided approval cannot be decided again (no double-execute)", async () => {
    const approval = await requestApproval(owner, "issue_gift_card", { amountCents: 1500, clientId: null, note: null });
    await decideApproval(owner, approval.id, "approve");
    const second = await decideApproval(owner, approval.id, "approve");
    assertEqual(second.status, "already_decided", "second decision is a no-op");
  });

  await t.test("decided-history filter returns only decided actions (excludes pending)", async () => {
    const stillPending = await requestApproval(owner, "issue_gift_card", { amountCents: 1234, clientId: null, note: null });
    const decided = await db.listAgentApprovals(tenantId, { decided: true });
    assert(decided.every((a) => a.status !== "pending"), "history has no pending items");
    assert(!decided.some((a) => a.id === stillPending.id), "the new pending item is excluded from history");
    assert(decided.some((a) => a.status === "executed") && decided.some((a) => a.status === "rejected"), "history includes executed + rejected outcomes");
  });
}
