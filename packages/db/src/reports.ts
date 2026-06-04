import { query } from "./index";
import type { IncomeLine, IncomeSummary, InventorySnapshot, LowStockItem, PaymentMethodTotal, SalesSummary } from "@prodigy/contracts";

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
  for (const r of rows) {
    if (r.type === "revenue") {
      const amt = n(r.c) - n(r.d); // revenue is a credit balance
      if (amt !== 0) revenue.push({ code: r.code, name: r.name, amountCents: amt });
      revenueCents += amt;
    } else {
      const amt = n(r.d) - n(r.c); // expense is a debit balance
      if (amt !== 0) expenses.push({ code: r.code, name: r.name, amountCents: amt });
      expenseCents += amt;
    }
  }
  return { from, to, revenueCents, expenseCents, netIncomeCents: revenueCents - expenseCents, revenue, expenses };
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
