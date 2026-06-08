/**
 * Waitlist suite (BL-035) — front-of-house: add clients waiting for a slot, list them, transition
 * status (placed/cancelled), and tenant isolation. Also checks the agent's add_to_waitlist is
 * approval-gated.
 */
import { assert, assertEqual, TestRunner } from "../harness";
import { executeTool, type AgentActor } from "@prodigy/agent";

type Db = typeof import("@prodigy/db");

export async function run(db: Db, t: TestRunner): Promise<void> {
  t.suite("Waitlist — front-of-house openings queue");

  const tenant = await db.getTenantBySlug("prodigy");
  assert(tenant, "tenant seeded");
  const tenantId = tenant!.id;
  const client = await db.createClient(tenantId, { displayName: "Waitlist Client" });

  let entryId = "";

  await t.test("add to waitlist + appears in the waiting list", async () => {
    const entry = await db.addToWaitlist(tenantId, { clientId: client.id, preferredWindow: "weekday mornings", notes: "prefers deep tissue" });
    assert(entry.id, "entry has an id");
    assertEqual(entry.status, "waiting", "new entries are waiting");
    assertEqual(entry.clientName, "Waitlist Client", "client name resolved");
    assertEqual(entry.preferredWindow, "weekday mornings", "preferred window round-trips");
    entryId = entry.id;
    const waiting = await db.listWaitlist(tenantId, { status: "waiting" });
    assert(waiting.some((e) => e.id === entryId), "entry shows in the waiting list");
  });

  await t.test("placing an entry removes it from the waiting list", async () => {
    await db.setWaitlistStatus(tenantId, entryId, "placed");
    const waiting = await db.listWaitlist(tenantId, { status: "waiting" });
    assert(!waiting.some((e) => e.id === entryId), "placed entry no longer waiting");
    const placed = await db.listWaitlist(tenantId, { status: "placed" });
    assert(placed.some((e) => e.id === entryId), "entry now shows as placed");
  });

  await t.test("an invalid status is rejected", async () => {
    let threw = false;
    try {
      await db.setWaitlistStatus(tenantId, entryId, "bogus");
    } catch {
      threw = true;
    }
    assert(threw, "invalid status rejected");
  });

  await t.test("adding a non-existent client is rejected", async () => {
    let threw = false;
    try {
      await db.addToWaitlist(tenantId, { clientId: "99999999" });
    } catch {
      threw = true;
    }
    assert(threw, "unknown client rejected");
  });

  await t.test("agent add_to_waitlist is approval-gated (no entry without sign-off)", async () => {
    const owner: AgentActor = { tenantId, userId: "1", displayName: "Owner", isOwner: true, permissions: [] };
    const before = (await db.listWaitlist(tenantId, {})).length;
    const out = await executeTool(owner, "add_to_waitlist", { clientId: client.id, preferredWindow: "Saturdays" });
    assertEqual(out.status, "requires_approval", "add_to_waitlist pauses for approval");
    const after = (await db.listWaitlist(tenantId, {})).length;
    assertEqual(after, before, "no waitlist entry created while pending");
    // Read tool works and is scheduling-gated.
    assertEqual((await executeTool(owner, "list_waitlist", {})).status, "ok", "owner may list the waitlist");
  });

  await t.test("tenant isolation: waitlist entries don't leak across tenants", async () => {
    const other = await db.query<{ id: string }>(
      `INSERT INTO tenants (slug, name, timezone) VALUES ('wl-iso', 'WL Iso', 'America/Los_Angeles')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id::text AS id`,
      []
    );
    const otherId = other[0].id;
    const oc = await db.createClient(otherId, { displayName: "Other WL Client" });
    await db.addToWaitlist(otherId, { clientId: oc.id });
    assert(!(await db.listWaitlist(tenantId, {})).some((e) => e.clientName === "Other WL Client"), "tenant #1 can't see the other tenant's entry");
    assert((await db.listWaitlist(otherId, {})).some((e) => e.clientName === "Other WL Client"), "the other tenant sees its own entry");
  });
}
