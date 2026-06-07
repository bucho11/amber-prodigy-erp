/**
 * Accounts-payable suite (BL-028) — vendors, bills, and bill payment as an accrual money path.
 * Asserts the GL invariant holds at every step (trial balance balanced) and that A/P reconciles to
 * the Balance Sheet: entering a bill raises A/P + expense; paying it lowers A/P + cash.
 */
import { assert, assertEqual, TestRunner } from "../harness";
import { executeTool, approvalPreview, type AgentActor } from "@prodigy/agent";

type Db = typeof import("@prodigy/db");

/** Accounts Payable (2000) balance on the Balance Sheet right now (credit balance, ≥ 0). */
async function apBalance(db: Db, tenantId: string): Promise<number> {
  const bs = await db.balanceSheet(tenantId, new Date().toISOString().slice(0, 10));
  return bs.liabilities.find((l) => l.code === "2000")?.balanceCents ?? 0;
}

export async function run(db: Db, t: TestRunner): Promise<void> {
  t.suite("Accounts payable — vendors · bills · bill payment · GL accrual");

  const tenant = await db.getTenantBySlug("prodigy");
  assert(tenant, "tenant seeded");
  const tenantId = tenant!.id;

  async function balanced(label: string): Promise<void> {
    const tb = await db.trialBalance(tenantId);
    assertEqual(tb.totalDebitCents, tb.totalCreditCents, `trial balance balanced (${label})`);
  }

  let vendorId = "";
  let billId = "";

  await t.test("create a vendor", async () => {
    const v = await db.createVendor(tenantId, { name: "Pacific Linen Supply", email: "ar@pacificlinen.test" });
    assert(v.id, "vendor has an id");
    assertEqual(v.name, "Pacific Linen Supply", "name round-trips");
    assert(v.isActive, "vendor active by default");
    vendorId = v.id;
    const list = await db.listVendors(tenantId, { activeOnly: true });
    assert(list.some((x) => x.id === vendorId), "vendor appears in the active list");
  });

  await t.test("entering a bill accrues A/P and recognizes the expense (Dr expense / Cr A/P)", async () => {
    const apBefore = await apBalance(db, tenantId);
    const bill = await db.createBill(tenantId, {
      vendorId,
      expenseAccountCode: "6200", // Rent & Facilities
      amountCents: 150000,
      billDate: "2026-06-01",
      dueDate: "2026-06-15",
      memo: "June linen service",
    });
    assertEqual(bill.status, "open", "new bill is open");
    assertEqual(bill.amountCents, 150000, "amount round-trips");
    assertEqual(bill.expenseAccountCode, "6200", "expense account resolved");
    billId = bill.id;

    const apAfter = await apBalance(db, tenantId);
    assertEqual(apAfter - apBefore, 150000, "Accounts Payable rose by the bill amount");
    await balanced("after bill entry");
  });

  await t.test("payables summary counts the open bill and flags overdue correctly", async () => {
    const sNow = await db.payablesSummary(tenantId, "2026-06-10"); // before due date
    assert(sNow.openCount >= 1, "at least one open bill");
    assert(sNow.openCents >= 150000, "open total includes the bill");
    assertEqual(sNow.overdueCount, 0, "not overdue before the due date");

    const sLater = await db.payablesSummary(tenantId, "2026-07-01"); // after due date
    assert(sLater.overdueCents >= 150000, "bill is overdue after its due date");
  });

  await t.test("paying a bill clears A/P and reduces cash (Dr A/P / Cr Cash); books stay balanced", async () => {
    const apBefore = await apBalance(db, tenantId);
    const paid = await db.payBill(tenantId, billId);
    assertEqual(paid.status, "paid", "bill flips to paid");
    assert(paid.paidAt, "paidAt stamped");

    const apAfter = await apBalance(db, tenantId);
    assertEqual(apBefore - apAfter, 150000, "Accounts Payable fell by the bill amount");
    await balanced("after bill payment");

    const stillOpen = await db.listBills(tenantId, { status: "open" });
    assert(!stillOpen.some((b) => b.id === billId), "paid bill is no longer in the open list");
  });

  await t.test("cannot pay a bill twice", async () => {
    let threw = false;
    try {
      await db.payBill(tenantId, billId);
    } catch {
      threw = true;
    }
    assert(threw, "paying an already-paid bill is rejected");
  });

  await t.test("a bill with a non-expense account is rejected (guards the GL)", async () => {
    let threw = false;
    try {
      await db.createBill(tenantId, { vendorId, expenseAccountCode: "1010", amountCents: 1000 }); // Cash is not an expense
    } catch {
      threw = true;
    }
    assert(threw, "non-expense account rejected");
  });

  await t.test("agent A/P write tools are approval-gated (no bill created without sign-off)", async () => {
    const owner: AgentActor = { tenantId, userId: "1", displayName: "Owner", isOwner: true, permissions: [] };
    const before = (await db.listBills(tenantId, {})).length;
    const out = await executeTool(owner, "create_bill", { vendorId, expenseAccountCode: "6000", amountCents: 9900, memo: "agent test" });
    assertEqual(out.status, "requires_approval", "create_bill pauses for approval");
    const after = (await db.listBills(tenantId, {})).length;
    assertEqual(after, before, "no bill created while pending approval");
    // Impact previews describe the action in plain language (Rule 11).
    assertEqual(
      approvalPreview("create_bill", { vendorId: "7", expenseAccountCode: "6200", amountCents: 150000, memo: "rent" }),
      'Enter a $1500.00 bill from vendor #7 to account 6200 — "rent".'
    );
    assert(approvalPreview("pay_bill", { billId: "12" }).startsWith("Pay open bill #12"), "pay_bill preview names the bill");
  });
}
