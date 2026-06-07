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

  await t.test("booking tool: approval-gated, RBAC-gated, double-booking-guarded", async () => {
    const provider = (await db.query<{ id: string }>(`SELECT id::text AS id FROM staff_profiles WHERE tenant_id = $1 AND is_active LIMIT 1`, [tenantId]))[0];
    const variant = (await db.query<{ id: string }>(`SELECT id::text AS id FROM service_variants WHERE tenant_id = $1 ORDER BY id LIMIT 1`, [tenantId]))[0];
    assert(provider && variant, "seeded provider + variant exist");
    const c = await db.createClient(tenantId, { displayName: "Booking Subject" });
    const at = "2026-09-01T17:00:00.000Z";
    const args = { clientId: c.id, providerId: provider.id, serviceVariantId: variant.id, startsAt: at };

    const pending = await executeTool(owner, "book_appointment", args);
    assertEqual(pending.status, "requires_approval", "unapproved booking pauses");

    assertEqual((await executeTool(frontDesk, "book_appointment", args, { approved: true })).status, "denied", "front desk denied (no scheduling.manage)");

    const ok = await executeTool(owner, "book_appointment", args, { approved: true });
    assertEqual(ok.status, "ok", "approved booking executes");

    // Booking the same provider at the same time again must be blocked by the double-booking guard.
    const conflict = await executeTool(owner, "book_appointment", args, { approved: true });
    assertEqual(conflict.status, "error", "double-booking is rejected");
    assert(conflict.status === "error" && /conflict/i.test(conflict.reason), "error explains the conflict");

    const appts = await db.listAppointments(tenantId, { clientId: c.id });
    assertEqual(appts.length, 1, "exactly one appointment was booked (the conflict + pending never wrote)");
  });

  await t.test("clinical write tool: approval-gated, RBAC-gated, writes a real SOAP note", async () => {
    const c = await db.createClient(tenantId, { displayName: "SOAP Subject" });
    // No approval → pauses, no note written.
    const pending = await executeTool(owner, "add_soap_note", { clientId: c.id, date: "2026-06-07", subjective: "client reports tension" });
    assertEqual(pending.status, "requires_approval", "unapproved clinical write pauses");

    // RBAC: front desk lacks clinical.manage.
    const denied = await executeTool(frontDesk, "add_soap_note", { clientId: c.id, date: "2026-06-07" }, { approved: true });
    assertEqual(denied.status, "denied", "front desk denied clinical write");

    // Approved by an authorized actor → writes the note.
    const ok = await executeTool(owner, "add_soap_note", { clientId: c.id, date: "2026-06-07", assessment: "improving" }, { approved: true });
    assertEqual(ok.status, "ok", "approved clinical write executes");
    assert(ok.status === "ok" && (ok.result as { assessment: string | null }).assessment === "improving", "the note carries the assessment");
    const notes = await db.listSoapNotes(tenantId, c.id);
    assertEqual(notes.length, 1, "exactly one SOAP note persisted to the chart (the pending one never wrote)");
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
