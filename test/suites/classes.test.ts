/**
 * Group-classes suite (BL-036) — capacity-enforced enrollment, roster + attendance, and the
 * full→waitlist boundary. Capacity is the key invariant: a class never enrolls past capacity, and
 * cancelling an enrollment frees a spot.
 */
import { assert, assertEqual, TestRunner } from "../harness";
import { executeTool, type AgentActor } from "@prodigy/agent";

type Db = typeof import("@prodigy/db");

export async function run(db: Db, t: TestRunner): Promise<void> {
  t.suite("Group classes — capacity, roster, attendance");

  const tenant = await db.getTenantBySlug("prodigy");
  assert(tenant, "tenant seeded");
  const tenantId = tenant!.id;

  const c1 = await db.createClient(tenantId, { displayName: "Class Client 1" });
  const c2 = await db.createClient(tenantId, { displayName: "Class Client 2" });
  const c3 = await db.createClient(tenantId, { displayName: "Class Client 3" });
  const start = new Date(Date.now() + 86400000).toISOString();
  const end = new Date(Date.now() + 86400000 + 3600000).toISOString();
  let classId = "";

  await t.test("create a class with a capacity", async () => {
    const cls = await db.createClassSession(tenantId, { name: "Restorative Yoga", startsAt: start, endsAt: end, capacity: 2 });
    assertEqual(cls.capacity, 2, "capacity stored");
    assertEqual(cls.enrolledCount, 0, "starts empty");
    assertEqual(cls.spotsLeft, 2, "two spots open");
    classId = cls.id;
  });

  await t.test("enroll up to capacity; the roster reflects it", async () => {
    let cls = await db.enrollClient(tenantId, classId, c1.id);
    assertEqual(cls.enrolledCount, 1, "one enrolled");
    cls = await db.enrollClient(tenantId, classId, c2.id);
    assertEqual(cls.enrolledCount, 2, "two enrolled");
    assertEqual(cls.spotsLeft, 0, "now full");
    const roster = await db.listRoster(tenantId, classId);
    assertEqual(roster.filter((r) => r.status === "enrolled").length, 2, "roster has both clients");
  });

  await t.test("enrolling past capacity is rejected (→ waitlist)", async () => {
    let threw = false;
    let msg = "";
    try {
      await db.enrollClient(tenantId, classId, c3.id);
    } catch (e) {
      threw = true;
      msg = (e as Error).message;
    }
    assert(threw, "full class rejects enrollment");
    assert(/full/i.test(msg), "error points to the class being full");
  });

  await t.test("enrolling the same client twice is idempotent (no double-count)", async () => {
    const cls = await db.enrollClient(tenantId, classId, c1.id);
    assertEqual(cls.enrolledCount, 2, "still two enrolled, not three");
  });

  await t.test("cancelling an enrollment frees a spot, allowing the next client in", async () => {
    const roster = await db.listRoster(tenantId, classId);
    const e1 = roster.find((r) => r.clientName === "Class Client 1");
    assert(e1, "found client 1's enrollment");
    await db.setEnrollmentStatus(tenantId, e1!.enrollmentId, "cancelled");
    let cls = await db.getClassSession(tenantId, classId);
    assertEqual(cls!.enrolledCount, 1, "one enrolled after cancel");
    assertEqual(cls!.spotsLeft, 1, "a spot opened up");
    cls = await db.enrollClient(tenantId, classId, c3.id);
    assertEqual(cls.enrolledCount, 2, "the waitlisted client can now enroll");
  });

  await t.test("attendance can be marked; an invalid status is rejected", async () => {
    const roster = await db.listRoster(tenantId, classId);
    const e = roster.find((r) => r.status === "enrolled");
    assert(e, "an enrolled client exists");
    await db.setEnrollmentStatus(tenantId, e!.enrollmentId, "attended");
    const after = await db.listRoster(tenantId, classId);
    assert(after.some((r) => r.enrollmentId === e!.enrollmentId && r.status === "attended"), "marked attended");
    let threw = false;
    try {
      await db.setEnrollmentStatus(tenantId, e!.enrollmentId, "bogus");
    } catch {
      threw = true;
    }
    assert(threw, "invalid enrollment status rejected");
  });

  await t.test("agent enroll_in_class is approval-gated; list_classes reads", async () => {
    const owner: AgentActor = { tenantId, userId: "1", displayName: "Owner", isOwner: true, permissions: [] };
    const out = await executeTool(owner, "enroll_in_class", { classId, clientId: c1.id });
    assertEqual(out.status, "requires_approval", "enroll pauses for approval");
    assertEqual((await executeTool(owner, "list_classes", {})).status, "ok", "owner may list classes");
  });
}
