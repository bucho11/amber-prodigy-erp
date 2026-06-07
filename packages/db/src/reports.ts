import { query } from "./index";
import type { AgingBucket, BalanceSheet, BalanceSheetLine, CashFlowLine, CashFlowStatement, IncomeLine, IncomeSummary, InventorySnapshot, LowStockItem, PaymentMethodTotal, ReceivableItem, ReceivablesAging, SalesSummary } from "@prodigy/contracts";

const n = (v: unknown): number => Number(v ?? 0);

/** Sales over [from, to] (inclusive), keyed on the order's closed date. */
export async function salesSummary(tenantId: string, from: string, to: string): Promise<SalesSummary> {
  const head = await query<{ cnt: number; subtotal: string; discount: string; tax: string; tip: string; total: string }>(
    `SELECT COUNT(*)::int AS cnt,
            COALESCE(SUM(subtotal_cents), 0)::bigint AS subtotal,
            COALESCE(SUM(discount_cents), 0)::bigint AS discount,
            COALESCE(SUM(tax_cents), 0)::bigint AS tax,
            COALESCE(SUM(tip_cents), 0)::bigint AS tip,
            COALESCE(SUM(total_cents), 0)::bigint AS total
     FROM orders
     WHERE tenant_id = $1 AND status = 'paid' AND closed_at::date BETWEEN $2 AND $3`,
    [tenantId, from, to]
  );
  const refunds = await query<{ cnt: number; total: string }>(
    `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(total_cents), 0)::bigint AS total
     FROM orders WHERE tenant_id = $1 AND status = 'refunded' AND closed_at::date BETWEEN $2 AND $3`,
    [tenantId, from, to]
  );
  const methods = await query<{ method: string; cnt: number; amt: string }>(
    `SELECT p.method, COUNT(*)::int AS cnt, COALESCE(SUM(p.amount_cents), 0)::bigint AS amt
     FROM payments p JOIN orders o ON o.id = p.order_id
     WHERE p.tenant_id = $1 AND o.status = 'paid' AND o.closed_at::date BETWEEN $2 AND $3
       AND p.status IN ('recorded', 'succeeded')
     GROUP BY p.method ORDER BY p.method`,
    [tenantId, from, to]
  );
  const h = head[0];
  const subtotalCents = n(h.subtotal);
  const discountCents = n(h.discount);
  const paymentsByMethod: PaymentMethodTotal[] = methods.map((m) => ({ method: m.method, amountCents: n(m.amt), count: m.cnt }));
  return {
    from,
    to,
    paidOrderCount: h.cnt,
    subtotalCents,
    discountCents,
    netSalesCents: subtotalCents - discountCents,
    taxCents: n(h.tax),
    tipCents: n(h.tip),
    totalCollectedCents: n(h.total),
    refundCount: refunds[0].cnt,
    refundedCents: n(refunds[0].total),
    paymentsByMethod,
  };
}

/** Income statement over [from, to] (inclusive), from posted journal lines by entry date. */
export async function incomeSummary(tenantId: string, from: string, to: string): Promise<IncomeSummary> {
  const rows = await query<{ type: string; code: string; name: string; d: string; c: string }>(
    `SELECT a.type, a.code, a.name,
            COALESCE(SUM(l.debit_cents), 0)::bigint AS d,
            COALESCE(SUM(l.credit_cents), 0)::bigint AS c
     FROM journal_lines l
     JOIN accounts a ON a.id = l.account_id
     JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.tenant_id = $1 AND a.type IN ('revenue', 'expense') AND e.entry_date BETWEEN $2 AND $3
     GROUP BY a.type, a.code, a.name
     ORDER BY a.code`,
    [tenantId, from, to]
  );
  const revenue: IncomeLine[] = [];
  const expenses: IncomeLine[] = [];
  let revenueCents = 0;
  let expenseCents = 0;
  let cogsCents = 0;
  for (const r of rows) {
    if (r.type === "revenue") {
      const amt = n(r.c) - n(r.d); // revenue is a credit balance
      if (amt !== 0) revenue.push({ code: r.code, name: r.name, amountCents: amt });
      revenueCents += amt;
    } else {
      const amt = n(r.d) - n(r.c); // expense is a debit balance
      if (amt !== 0) expenses.push({ code: r.code, name: r.name, amountCents: amt });
      expenseCents += amt;
      if (r.code.startsWith("5")) cogsCents += amt; // COGS accounts are coded 5xxx
    }
  }
  return {
    from,
    to,
    revenueCents,
    cogsCents,
    grossProfitCents: revenueCents - cogsCents,
    operatingExpenseCents: expenseCents - cogsCents,
    expenseCents,
    netIncomeCents: revenueCents - expenseCents,
    revenue,
    expenses,
  };
}

/**
 * Balance Sheet as of `asOf` (inclusive), straight from the general ledger — the other half of the
 * core financial statements (the "real books / replace QuickBooks" thesis). Asset/liability/equity
 * balances are cumulative through `asOf`; because there is no period-close yet, revenue and expense
 * accounts never roll into equity, so net-income-to-date is computed and folded into equity as a
 * synthetic line. That makes the double-entry invariant hold: Assets = Liabilities + Equity.
 */
export async function balanceSheet(tenantId: string, asOf: string): Promise<BalanceSheet> {
  const rows = await query<{ type: string; code: string; name: string; d: string; c: string }>(
    `SELECT a.type, a.code, a.name,
            COALESCE(SUM(l.debit_cents), 0)::bigint AS d,
            COALESCE(SUM(l.credit_cents), 0)::bigint AS c
     FROM accounts a
     LEFT JOIN journal_lines l ON l.account_id = a.id AND l.tenant_id = a.tenant_id
     LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.entry_date <= $2
     WHERE a.tenant_id = $1
     GROUP BY a.type, a.code, a.name
     ORDER BY a.code`,
    [tenantId, asOf]
  );

  const assets: BalanceSheetLine[] = [];
  const liabilities: BalanceSheetLine[] = [];
  const equity: BalanceSheetLine[] = [];
  let totalAssets = 0, totalLiabilities = 0, equityAccounts = 0, netIncome = 0;

  for (const r of rows) {
    const debitBal = n(r.d) - n(r.c); // >0 = net debit
    if (r.type === "asset") {
      if (debitBal !== 0) assets.push({ code: r.code, name: r.name, balanceCents: debitBal });
      totalAssets += debitBal;
    } else if (r.type === "liability") {
      const bal = -debitBal; // liabilities carry a credit balance
      if (bal !== 0) liabilities.push({ code: r.code, name: r.name, balanceCents: bal });
      totalLiabilities += bal;
    } else if (r.type === "equity") {
      const bal = -debitBal; // equity carries a credit balance
      if (bal !== 0) equity.push({ code: r.code, name: r.name, balanceCents: bal });
      equityAccounts += bal;
    } else if (r.type === "revenue") {
      netIncome += -debitBal; // revenue is a credit balance
    } else if (r.type === "expense") {
      netIncome -= debitBal; // expense is a debit balance
    }
  }

  // Fold net income to date into equity (no closing entry exists yet) so the sheet balances.
  if (netIncome !== 0) equity.push({ code: "3999", name: "Net income (undistributed)", balanceCents: netIncome });
  const totalEquity = equityAccounts + netIncome;
  const outOfBalance = totalAssets - (totalLiabilities + totalEquity);
  return {
    asOf,
    assets,
    liabilities,
    equity,
    totalAssetsCents: totalAssets,
    totalLiabilitiesCents: totalLiabilities,
    netIncomeToDateCents: netIncome,
    totalEquityCents: totalEquity,
    outOfBalanceCents: outOfBalance,
    balanced: outOfBalance === 0,
  };
}

/**
 * Accounts-receivable aging as of `asOf`: outstanding (unpaid) member dues invoices grouped into the
 * standard buckets (Current / 1–30 / 31–60 / 61–90 / 90+ days past due), aged by the dues period start.
 * Because dues now accrue to A/R when invoiced (accrual basis), the total here reconciles to the
 * Balance Sheet's Accounts Receivable (1200) line.
 */
export async function receivablesAging(tenantId: string, asOf: string): Promise<ReceivablesAging> {
  const rows = await query<{ invoice_id: string; client_name: string; amount_cents: number; due_date: string; days: number }>(
    `SELECT mi.id::text AS invoice_id, c.display_name AS client_name, mi.amount_cents,
            mi.period_start::text AS due_date, ($2::date - mi.period_start)::int AS days
       FROM membership_invoices mi
       JOIN memberships m ON m.id = mi.membership_id
       JOIN clients c ON c.id = m.client_id
      WHERE mi.tenant_id = $1 AND mi.status = 'pending'
      ORDER BY mi.period_start`,
    [tenantId, asOf]
  );
  const defs: Array<{ label: string; test: (d: number) => boolean }> = [
    { label: "Current", test: (d) => d <= 0 },
    { label: "1–30 days", test: (d) => d >= 1 && d <= 30 },
    { label: "31–60 days", test: (d) => d >= 31 && d <= 60 },
    { label: "61–90 days", test: (d) => d >= 61 && d <= 90 },
    { label: "90+ days", test: (d) => d > 90 },
  ];
  const buckets: AgingBucket[] = defs.map((def) => ({ label: def.label, count: 0, cents: 0 }));
  const items: ReceivableItem[] = [];
  let totalCents = 0;
  for (const r of rows) {
    const d = Number(r.days);
    const amt = n(r.amount_cents);
    totalCents += amt;
    const idx = defs.findIndex((def) => def.test(d));
    buckets[idx].count++;
    buckets[idx].cents += amt;
    items.push({ invoiceId: r.invoice_id, clientName: r.client_name, amountCents: amt, dueDate: r.due_date, daysPastDue: Math.max(0, d) });
  }
  return { asOf, buckets, items, totalCents, totalCount: rows.length };
}

/**
 * Direct-method Cash Flow statement over [from, to] from the ledger (the method recommended for
 * small/service businesses, and exact given transaction-level data). For every journal entry that
 * touches Cash (1010), each non-cash counterpart line contributes (credit − debit) to cash flow,
 * categorized by the counterpart account: revenue/expense/current-asset(A-R,inventory)/liability →
 * Operating; equity → Financing; other (long-term) assets → Investing. By double-entry the three
 * sections sum exactly to the change in the Cash balance — which the result asserts (`reconciled`).
 */
export async function cashFlow(tenantId: string, from: string, to: string): Promise<CashFlowStatement> {
  const rows = await query<{ type: string; code: string; name: string; flow: string }>(
    `WITH cash_entries AS (
       SELECT DISTINCT l.entry_id
         FROM journal_lines l
         JOIN accounts a ON a.id = l.account_id
         JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.tenant_id = $1 AND a.code = '1010' AND e.entry_date BETWEEN $2 AND $3
     )
     SELECT a.type, a.code, a.name, COALESCE(SUM(l.credit_cents - l.debit_cents), 0)::bigint AS flow
       FROM journal_lines l
       JOIN accounts a ON a.id = l.account_id
      WHERE l.tenant_id = $1 AND a.code <> '1010' AND l.entry_id IN (SELECT entry_id FROM cash_entries)
      GROUP BY a.type, a.code, a.name
      ORDER BY a.code`,
    [tenantId, from, to]
  );

  const cat = (type: string, code: string): "operating" | "investing" | "financing" => {
    if (type === "equity") return "financing";
    if (type === "asset") return code === "1200" || code === "1500" ? "operating" : "investing";
    return "operating"; // revenue, expense, liability (current) → operating
  };
  const operating: CashFlowLine[] = [];
  const investing: CashFlowLine[] = [];
  const financing: CashFlowLine[] = [];
  let operatingCents = 0, investingCents = 0, financingCents = 0;
  for (const r of rows) {
    const amt = n(r.flow);
    if (amt === 0) continue;
    const line: CashFlowLine = { code: r.code, name: r.name, amountCents: amt };
    const c = cat(r.type, r.code);
    if (c === "operating") { operating.push(line); operatingCents += amt; }
    else if (c === "investing") { investing.push(line); investingCents += amt; }
    else { financing.push(line); financingCents += amt; }
  }

  const cash = await query<{ beginning: string; ending: string }>(
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents) FILTER (WHERE e.entry_date < $2), 0)::bigint AS beginning,
            COALESCE(SUM(l.debit_cents - l.credit_cents) FILTER (WHERE e.entry_date <= $3), 0)::bigint AS ending
       FROM journal_lines l
       JOIN accounts a ON a.id = l.account_id
       JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.tenant_id = $1 AND a.code = '1010'`,
    [tenantId, from, to]
  );
  const beginningCashCents = n(cash[0].beginning);
  const endingCashCents = n(cash[0].ending);
  const netChangeCents = operatingCents + investingCents + financingCents;
  const reconciled = netChangeCents === endingCashCents - beginningCashCents;
  return {
    from,
    to,
    operating,
    investing,
    financing,
    operatingCents,
    investingCents,
    financingCents,
    netChangeCents,
    beginningCashCents,
    endingCashCents,
    reconciled,
  };
}

/** Current stock position (not date-ranged). */
export async function inventorySnapshot(tenantId: string): Promise<InventorySnapshot> {
  const head = await query<{ active_cnt: number; tracked_cnt: number; cost_val: string; retail_val: string; oos: number }>(
    `SELECT COUNT(*) FILTER (WHERE is_active)::int AS active_cnt,
            COUNT(*) FILTER (WHERE is_active AND track_inventory)::int AS tracked_cnt,
            COALESCE(SUM(CASE WHEN is_active AND track_inventory THEN stock_qty * cost_cents ELSE 0 END), 0)::bigint AS cost_val,
            COALESCE(SUM(CASE WHEN is_active AND track_inventory THEN stock_qty * price_cents ELSE 0 END), 0)::bigint AS retail_val,
            COUNT(*) FILTER (WHERE is_active AND track_inventory AND stock_qty <= 0)::int AS oos
     FROM products WHERE tenant_id = $1`,
    [tenantId]
  );
  const low = await query<{ id: string; name: string; stock_qty: number; reorder_point: number }>(
    `SELECT id::text AS id, name, stock_qty, reorder_point
     FROM products
     WHERE tenant_id = $1 AND is_active AND track_inventory AND reorder_point > 0 AND stock_qty <= reorder_point
     ORDER BY name`,
    [tenantId]
  );
  const h = head[0];
  const lowStock: LowStockItem[] = low.map((p) => ({ id: p.id, name: p.name, stockQty: p.stock_qty, reorderPoint: p.reorder_point }));
  return {
    productCount: h.active_cnt,
    trackedProductCount: h.tracked_cnt,
    inventoryValueCents: n(h.cost_val),
    retailValueCents: n(h.retail_val),
    outOfStockCount: h.oos,
    lowStock,
  };
}
