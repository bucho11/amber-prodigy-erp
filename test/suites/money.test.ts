/**
 * Money-path suite — the highest cost-of-error code (P4/P9), exercised against real Postgres:
 * POS totals + settlement, double-entry GL auto-posting, refund reversal, gift-card issuance +
 * redemption, package sale + redeem + restore, and tenant isolation. Asserts the invariant that
 * the trial balance is ALWAYS balanced at every checkpoint.
 */
import { assert, assertEqual, TestRunner } from "../harness";

type Db = typeof import("@prodigy/db");

/** Net debit/credit per account code for a source's (non-reversing) journal entry. */
async function linesBySource(
  db: Db,
  tenantId: string,
  sourceType: string,
  sourceId: string
): Promise<Record<string, { debit: number; credit: number }>> {
  const rows = await db.query<{ code: string; debit_cents: number; credit_cents: number }>(
    `SELECT a.code, l.debit_cents, l.credit_cents
       FROM journal_entries e
       JOIN journal_lines l ON l.entry_id = e.id
       JOIN accounts a ON a.id = l.account_id
      WHERE e.tenant_id = $1 AND e.source_type = $2 AND e.source_id = $3 AND e.reverses_entry_id IS NULL`,
    [tenantId, sourceType, sourceId]
  );
  const m: Record<string, { debit: number; credit: number }> = {};
  for (const r of rows) {
    const x = (m[r.code] ??= { debit: 0, credit: 0 });
    x.debit += r.debit_cents;
    x.credit += r.credit_cents;
  }
  return m;
}

async function assertBalanced(db: Db, tenantId: string, label: string): Promise<void> {
  const tb = await db.trialBalance(tenantId);
  assertEqual(tb.totalDebitCents, tb.totalCreditCents, `trial balance balanced (${label})`);
}

export async function run(db: Db, t: TestRunner): Promise<void> {
  t.suite("Money paths — POS · GL · gift cards · packages · tenant isolation");

  const tenant = await db.getTenantBySlug("prodigy");
  assert(tenant, "tenant #1 (prodigy) was seeded");
  const tenantId = tenant.id;
  await db.setTenantTaxRate(tenantId, 800); // 8%

  const variant = (
    await db.query<{ id: string }>(
      `SELECT id::text AS id FROM service_variants WHERE tenant_id = $1 ORDER BY id LIMIT 1`,
      [tenantId]
    )
  )[0];
  assert(variant, "a seeded service variant exists");

  const client = await db.createClient(tenantId, { displayName: "Money Test Client", email: "money@test.local" });

  await t.test("cash sale: totals correct + settlement posts a balanced entry", async () => {
    const created = await db.createOrder(tenantId, { clientId: client.id });
    await db.addLineItem(tenantId, created.id, {
      kind: "service",
      description: "Massage 60",
      quantity: 1,
      unitPriceCents: 10000,
      taxable: true,
      serviceVariantId: variant.id,
      appointmentId: null,
    });
    await db.addLineItem(tenantId, created.id, {
      kind: "custom",
      description: "Herbal tea",
      quantity: 1,
      unitPriceCents: 2000,
      taxable: false,
      serviceVariantId: null,
      appointmentId: null,
    });
    let order = await db.getOrder(tenantId, created.id);
    assert(order, "order loads");
    assertEqual(order.subtotalCents, 12000, "subtotal = 100 + 20");
    assertEqual(order.taxCents, 800, "tax = 8% of the taxable 10000 only");
    assertEqual(order.totalCents, 12800, "total = subtotal + tax");

    order = await db.addPayment(tenantId, created.id, { method: "cash", amountCents: 12800 });
    assertEqual(order.status, "paid", "order flips to paid once covered");

    const lines = await linesBySource(db, tenantId, "order", created.id);
    assertEqual(lines["1010"]?.debit, 12800, "Cash debited the full total");
    assertEqual(lines["4000"]?.credit, 12000, "Sales Revenue credited net of discount");
    assertEqual(lines["2100"]?.credit, 800, "Sales Tax Payable credited the tax");
    await assertBalanced(db, tenantId, "after cash sale");
  });

  await t.test("discount + tip: revenue net of discount, tip to gratuities payable", async () => {
    const created = await db.createOrder(tenantId, { clientId: client.id });
    await db.addLineItem(tenantId, created.id, {
      kind: "service",
      description: "Massage 90",
      quantity: 1,
      unitPriceCents: 18500,
      taxable: false,
      serviceVariantId: variant.id,
      appointmentId: null,
    });
    await db.updateAdjustments(tenantId, created.id, { discountCents: 2500, tipCents: 2000 });
    let order = await db.getOrder(tenantId, created.id);
    assert(order, "order loads");
    // subtotal 18500, no tax (non-taxable), -2500 discount + 2000 tip = 18000
    assertEqual(order.totalCents, 18000, "total = subtotal - discount + tip");

    order = await db.addPayment(tenantId, created.id, { method: "external_card", amountCents: 18000 });
    assertEqual(order.status, "paid", "order paid");
    const lines = await linesBySource(db, tenantId, "order", created.id);
    assertEqual(lines["1010"]?.debit, 18000, "Cash debited the total collected");
    assertEqual(lines["4000"]?.credit, 16000, "Revenue = subtotal - discount");
    assertEqual(lines["2150"]?.credit, 2000, "Gratuities Payable credited the tip");
    await assertBalanced(db, tenantId, "after discount+tip sale");
  });

  await t.test("refund reverses the settlement (mirror entry, books re-balanced)", async () => {
    const created = await db.createOrder(tenantId, { clientId: client.id });
    await db.addLineItem(tenantId, created.id, {
      kind: "service",
      description: "Massage 60",
      quantity: 1,
      unitPriceCents: 10000,
      taxable: false,
      serviceVariantId: variant.id,
      appointmentId: null,
    });
    await db.addPayment(tenantId, created.id, { method: "cash", amountCents: 10000 });
    const refunded = await db.refundOrder(tenantId, created.id);
    assert(refunded, "refund returns the order");
    assertEqual(refunded.status, "refunded", "order marked refunded");

    const reversals = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM journal_entries
        WHERE tenant_id = $1 AND source_type = 'order' AND source_id = $2 AND reverses_entry_id IS NOT NULL`,
      [tenantId, created.id]
    );
    assertEqual(Number(reversals[0].n), 1, "exactly one reversing entry was posted");
    await assertBalanced(db, tenantId, "after refund");
  });

  await t.test("gift card issuance posts Cash / Gift Card Liability", async () => {
    const card = await db.issueGiftCard(tenantId, { amountCents: 5000, clientId: client.id, note: null });
    assertEqual(card.balanceCents, 5000, "new card balance = initial");
    const lines = await linesBySource(db, tenantId, "gift_card", card.id);
    assertEqual(lines["1010"]?.debit, 5000, "Cash debited on sale of the card");
    assertEqual(lines["2200"]?.credit, 5000, "Gift Card Liability credited (we owe it)");
    await assertBalanced(db, tenantId, "after gift card issuance");
  });

  await t.test("gift card redemption draws down balance + settles the order", async () => {
    const card = await db.issueGiftCard(tenantId, { amountCents: 8000, clientId: client.id, note: null });
    const created = await db.createOrder(tenantId, { clientId: client.id });
    await db.addLineItem(tenantId, created.id, {
      kind: "service",
      description: "Massage 60",
      quantity: 1,
      unitPriceCents: 6000,
      taxable: false,
      serviceVariantId: variant.id,
      appointmentId: null,
    });
    const { order, giftCard } = await db.payOrderWithGiftCard(tenantId, created.id, card.code, 6000);
    assertEqual(order.status, "paid", "fully-covered order settles");
    assertEqual(giftCard.balanceCents, 2000, "card balance drawn down by redemption");
    const txns = await db.listGiftCardTxns(tenantId, card.id);
    assert(
      txns.some((x) => x.kind === "redeem" && x.amountCents === -6000),
      "a signed redeem txn was written"
    );
  });

  await t.test("package: sale posts revenue, redeem adds $0 line + decrements, void restores credit", async () => {
    const pkg = await db.sellPackage(tenantId, {
      clientId: client.id,
      serviceVariantId: variant.id,
      totalCredits: 5,
      priceCents: 50000,
      note: null,
    });
    assertEqual(pkg.remainingCredits, 5, "package starts with all credits");
    const saleLines = await linesBySource(db, tenantId, "package", pkg.id);
    assertEqual(saleLines["1010"]?.debit, 50000, "Cash debited on package sale");
    assertEqual(saleLines["4000"]?.credit, 50000, "Revenue recognized at sale (cash-basis)");

    const order = await db.createOrder(tenantId, { clientId: client.id });
    await db.redeemPackageToOrder(tenantId, order.id, pkg.id, null);
    const afterRedeem = await db.getPackage(tenantId, pkg.id);
    assertEqual(afterRedeem?.remainingCredits, 4, "redeem decrements one credit");
    const loaded = await db.getOrder(tenantId, order.id);
    assert(
      loaded?.lineItems.some((l) => l.packageId === pkg.id && l.amountCents === 0),
      "a $0 package line was added to the ticket"
    );

    await db.voidOrder(tenantId, order.id);
    const afterVoid = await db.getPackage(tenantId, pkg.id);
    assertEqual(afterVoid?.remainingCredits, 5, "voiding the order restores the credit");
    await assertBalanced(db, tenantId, "after package lifecycle");
  });

  await t.test("tenant isolation: one tenant's orders never leak into another's list (P9)", async () => {
    const other = await db.query<{ id: string }>(
      `INSERT INTO tenants (slug, name, timezone) VALUES ('isotest', 'Iso Test', 'America/Los_Angeles')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id::text AS id`,
      []
    );
    const otherId = other[0].id;
    const otherClient = await db.createClient(otherId, { displayName: "Other Tenant Client" });
    const otherOrder = await db.createOrder(otherId, { clientId: otherClient.id });

    const prodigyOrders = await db.listOrders(tenantId);
    assert(
      !prodigyOrders.some((o) => o.id === otherOrder.id),
      "tenant #1's order list excludes the other tenant's order"
    );
    const otherOrders = await db.listOrders(otherId);
    assert(
      otherOrders.some((o) => o.id === otherOrder.id),
      "the other tenant sees its own order"
    );
  });

  await t.test("balance sheet foots: Assets = Liabilities + Equity, with net income folded in", async () => {
    // After all the sales/refunds/gift-cards/packages above, the financial statement must balance.
    const asOf = new Date().toISOString().slice(0, 10);
    const bs = await db.balanceSheet(tenantId, asOf);
    assertEqual(
      bs.totalAssetsCents,
      bs.totalLiabilitiesCents + bs.totalEquityCents,
      "Assets equal Liabilities + Equity (the double-entry invariant)"
    );
    assertEqual(bs.outOfBalanceCents, 0, "out-of-balance is exactly zero");
    assert(bs.balanced, "balanced flag is true");
    // Net income to date on the sheet must equal the all-time income statement's net income.
    const inc = await db.incomeSummary(tenantId, "2000-01-01", asOf);
    assertEqual(bs.netIncomeToDateCents, inc.netIncomeCents, "equity's net income matches the P&L");
    assert(bs.totalAssetsCents > 0, "the sheet has real activity (assets posted from sales)");
  });
}
