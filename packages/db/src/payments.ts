import { query, withTransaction } from "./index";
import { postOrderSettlement, reverseOrderSettlement } from "./ledger";
import type {
  Order,
  OrderLineItem,
  OrderListItem,
  OrderPayment,
  LineKind,
  PaymentMethod,
  PaymentStatus,
} from "@prodigy/contracts";

const iso = (v: string | Date | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

// ---------- tenant billing ----------
export interface TenantBilling {
  taxRateBps: number;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
}
export async function getTenantBilling(tenantId: string): Promise<TenantBilling> {
  const rows = await query<{ tax_rate_bps: number; stripe_account_id: string | null; stripe_charges_enabled: boolean }>(
    `SELECT tax_rate_bps, stripe_account_id, stripe_charges_enabled FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId]
  );
  const r = rows[0] ?? { tax_rate_bps: 0, stripe_account_id: null, stripe_charges_enabled: false };
  return { taxRateBps: r.tax_rate_bps, stripeAccountId: r.stripe_account_id, stripeChargesEnabled: r.stripe_charges_enabled };
}
export async function setTenantTaxRate(tenantId: string, taxRateBps: number): Promise<void> {
  await query(`UPDATE tenants SET tax_rate_bps = $2 WHERE id = $1`, [tenantId, taxRateBps]);
}
export async function setTenantStripeAccount(tenantId: string, accountId: string): Promise<void> {
  await query(`UPDATE tenants SET stripe_account_id = $2 WHERE id = $1`, [tenantId, accountId]);
}
export async function setTenantStripeChargesEnabled(tenantId: string, enabled: boolean): Promise<void> {
  await query(`UPDATE tenants SET stripe_charges_enabled = $2 WHERE id = $1`, [tenantId, enabled]);
}

// ---------- orders ----------
interface OrderRow {
  id: string;
  client_id: string | null;
  client_name: string | null;
  status: OrderStatus;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  created_at: string | Date;
  closed_at: string | Date | null;
}
type OrderStatus = Order["status"];

const ORDER_SELECT = `
  SELECT o.id::text AS id, o.client_id::text AS client_id, c.display_name AS client_name,
         o.status, o.subtotal_cents, o.discount_cents, o.tax_cents, o.tip_cents, o.total_cents,
         o.created_at, o.closed_at
  FROM orders o
  LEFT JOIN clients c ON c.id = o.client_id`;

async function fetchLines(tenantId: string, orderId: string): Promise<OrderLineItem[]> {
  const rows = await query<{
    id: string;
    kind: LineKind;
    description: string;
    quantity: number;
    unit_price_cents: number;
    amount_cents: number;
    taxable: boolean;
    service_variant_id: string | null;
    appointment_id: string | null;
    package_id: string | null;
  }>(
    `SELECT id::text AS id, kind, description, quantity, unit_price_cents, amount_cents, taxable,
            service_variant_id::text AS service_variant_id, appointment_id::text AS appointment_id,
            package_id::text AS package_id
     FROM order_line_items WHERE tenant_id = $1 AND order_id = $2 ORDER BY id`,
    [tenantId, orderId]
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    description: r.description,
    quantity: r.quantity,
    unitPriceCents: r.unit_price_cents,
    amountCents: r.amount_cents,
    taxable: r.taxable,
    serviceVariantId: r.service_variant_id,
    appointmentId: r.appointment_id,
    packageId: r.package_id,
  }));
}

async function fetchPayments(tenantId: string, orderId: string): Promise<OrderPayment[]> {
  const rows = await query<{
    id: string;
    method: PaymentMethod;
    amount_cents: number;
    status: PaymentStatus;
    processor_ref: string | null;
    created_at: string | Date;
  }>(
    `SELECT id::text AS id, method, amount_cents, status, processor_ref, created_at
     FROM payments WHERE tenant_id = $1 AND order_id = $2 ORDER BY id`,
    [tenantId, orderId]
  );
  return rows.map((r) => ({
    id: r.id,
    method: r.method,
    amountCents: r.amount_cents,
    status: r.status,
    processorRef: r.processor_ref,
    createdAt: iso(r.created_at) as string,
  }));
}

const PAID_STATUSES: PaymentStatus[] = ["recorded", "succeeded"];

async function assembleOrder(tenantId: string, row: OrderRow): Promise<Order> {
  const [lineItems, payments] = await Promise.all([fetchLines(tenantId, row.id), fetchPayments(tenantId, row.id)]);
  const paidCents = payments.filter((p) => PAID_STATUSES.includes(p.status)).reduce((s, p) => s + p.amountCents, 0);
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    taxCents: row.tax_cents,
    tipCents: row.tip_cents,
    totalCents: row.total_cents,
    paidCents,
    balanceCents: row.total_cents - paidCents,
    lineItems,
    payments,
    createdAt: iso(row.created_at) as string,
    closedAt: iso(row.closed_at),
  };
}

export async function getOrder(tenantId: string, id: string): Promise<Order | null> {
  const rows = await query<OrderRow>(`${ORDER_SELECT} WHERE o.tenant_id = $1 AND o.id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? assembleOrder(tenantId, rows[0]) : null;
}

export async function listOrders(
  tenantId: string,
  opts: { status?: string; clientId?: string } = {}
): Promise<OrderListItem[]> {
  const rows = await query<OrderRow>(
    `${ORDER_SELECT}
     WHERE o.tenant_id = $1
       AND ($2::text IS NULL OR o.status = $2)
       AND ($3::bigint IS NULL OR o.client_id = $3)
     ORDER BY o.created_at DESC
     LIMIT 200`,
    [tenantId, opts.status ?? null, opts.clientId ?? null]
  );
  // paidCents for the list view (small N).
  const out: OrderListItem[] = [];
  for (const r of rows) {
    const payments = await fetchPayments(tenantId, r.id);
    const paidCents = payments.filter((p) => PAID_STATUSES.includes(p.status)).reduce((s, p) => s + p.amountCents, 0);
    out.push({
      id: r.id,
      clientName: r.client_name,
      status: r.status,
      totalCents: r.total_cents,
      paidCents,
      createdAt: iso(r.created_at) as string,
      closedAt: iso(r.closed_at),
    });
  }
  return out;
}

export async function createOrder(tenantId: string, input: { clientId: string | null }): Promise<Order> {
  const rows = await query<{ id: string }>(
    `INSERT INTO orders (tenant_id, client_id, status) VALUES ($1, $2::bigint, 'open') RETURNING id::text AS id`,
    [tenantId, input.clientId]
  );
  const order = await getOrder(tenantId, rows[0].id);
  if (!order) throw new Error("failed to load created order");
  return order;
}

/** Recompute money columns from current line items + discount/tip + tenant tax rate. */
async function recompute(tenantId: string, orderId: string): Promise<void> {
  const billing = await getTenantBilling(tenantId);
  const rows = await query<{ subtotal: string | null; taxable: string | null; discount: number; tip: number }>(
    `SELECT
       (SELECT COALESCE(SUM(amount_cents), 0) FROM order_line_items WHERE order_id = o.id)::text AS subtotal,
       (SELECT COALESCE(SUM(amount_cents), 0) FROM order_line_items WHERE order_id = o.id AND taxable)::text AS taxable,
       o.discount_cents AS discount, o.tip_cents AS tip
     FROM orders o WHERE o.tenant_id = $1 AND o.id = $2`,
    [tenantId, orderId]
  );
  if (!rows[0]) return;
  const subtotal = Number(rows[0].subtotal ?? 0);
  const taxable = Number(rows[0].taxable ?? 0);
  const discount = rows[0].discount;
  const tip = rows[0].tip;
  const taxCents = Math.round((taxable * billing.taxRateBps) / 10000);
  const total = Math.max(0, subtotal - discount + taxCents + tip);
  await query(`UPDATE orders SET subtotal_cents = $3, tax_cents = $4, total_cents = $5 WHERE tenant_id = $1 AND id = $2`, [
    tenantId,
    orderId,
    subtotal,
    taxCents,
    total,
  ]);
}

async function requireOpen(tenantId: string, orderId: string): Promise<OrderRow> {
  const rows = await query<OrderRow>(`${ORDER_SELECT} WHERE o.tenant_id = $1 AND o.id = $2 LIMIT 1`, [tenantId, orderId]);
  const row = rows[0];
  if (!row) throw new OrderNotFoundError();
  if (row.status !== "open") throw new OrderClosedError();
  return row;
}

export class OrderNotFoundError extends Error {
  constructor() {
    super("Order not found.");
    this.name = "OrderNotFoundError";
  }
}
export class OrderClosedError extends Error {
  constructor() {
    super("This sale is already closed and can't be modified.");
    this.name = "OrderClosedError";
  }
}

export interface AddLineInput {
  kind: LineKind;
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxable: boolean;
  serviceVariantId: string | null;
  appointmentId: string | null;
}
export async function addLineItem(tenantId: string, orderId: string, input: AddLineInput): Promise<Order> {
  await requireOpen(tenantId, orderId);
  const amount = input.quantity * input.unitPriceCents;
  await query(
    `INSERT INTO order_line_items
       (tenant_id, order_id, kind, description, quantity, unit_price_cents, amount_cents, taxable, service_variant_id, appointment_id)
     VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, $8, $9::bigint, $10::bigint)`,
    [
      tenantId,
      orderId,
      input.kind,
      input.description,
      input.quantity,
      input.unitPriceCents,
      amount,
      input.taxable,
      input.serviceVariantId,
      input.appointmentId,
    ]
  );
  await recompute(tenantId, orderId);
  return (await getOrder(tenantId, orderId))!;
}

export async function removeLineItem(tenantId: string, orderId: string, lineId: string): Promise<Order> {
  await requireOpen(tenantId, orderId);
  await withTransaction(async (q) => {
    const rows = await q<{ package_id: string | null }>(
      `SELECT package_id::text AS package_id FROM order_line_items WHERE tenant_id = $1 AND order_id = $2 AND id = $3`,
      [tenantId, orderId, lineId]
    );
    await q(`DELETE FROM order_line_items WHERE tenant_id = $1 AND order_id = $2 AND id = $3`, [tenantId, orderId, lineId]);
    const pkg = rows[0]?.package_id;
    if (pkg) {
      await q(`UPDATE packages SET remaining_credits = remaining_credits + 1 WHERE tenant_id = $1 AND id = $2`, [tenantId, pkg]);
      await q(
        `INSERT INTO package_txns (tenant_id, package_id, kind, credits, order_id) VALUES ($1, $2::bigint, 'restore', 1, $3::bigint)`,
        [tenantId, pkg, orderId]
      );
    }
  });
  await recompute(tenantId, orderId);
  return (await getOrder(tenantId, orderId))!;
}

export async function updateAdjustments(
  tenantId: string,
  orderId: string,
  patch: { discountCents?: number; tipCents?: number }
): Promise<Order> {
  await requireOpen(tenantId, orderId);
  const sets: string[] = [];
  const params: unknown[] = [tenantId, orderId];
  if (patch.discountCents !== undefined) {
    params.push(patch.discountCents);
    sets.push(`discount_cents = $${params.length}`);
  }
  if (patch.tipCents !== undefined) {
    params.push(patch.tipCents);
    sets.push(`tip_cents = $${params.length}`);
  }
  if (sets.length > 0) await query(`UPDATE orders SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2`, params);
  await recompute(tenantId, orderId);
  return (await getOrder(tenantId, orderId))!;
}

export interface AddPaymentInput {
  method: PaymentMethod;
  amountCents: number;
  status?: PaymentStatus;
  processorRef?: string | null;
}
export async function addPayment(tenantId: string, orderId: string, input: AddPaymentInput): Promise<Order> {
  const status: PaymentStatus = input.status ?? (input.method === "stripe_card" ? "pending" : "recorded");
  await withTransaction(async (q) => {
    const orderRows = await q<{ status: string; total_cents: number }>(
      `SELECT status, total_cents FROM orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, orderId]
    );
    const o = orderRows[0];
    if (!o) throw new OrderNotFoundError();
    if (o.status !== "open") throw new OrderClosedError();
    await q(
      `INSERT INTO payments (tenant_id, order_id, method, amount_cents, status, processor_ref)
       VALUES ($1, $2::bigint, $3, $4, $5, $6)`,
      [tenantId, orderId, input.method, input.amountCents, status, input.processorRef ?? null]
    );
    const paidRows = await q<{ paid: string }>(
      `SELECT COALESCE(SUM(amount_cents), 0)::text AS paid FROM payments
       WHERE tenant_id = $1 AND order_id = $2 AND status IN ('recorded', 'succeeded')`,
      [tenantId, orderId]
    );
    const paid = Number(paidRows[0].paid);
    if (o.total_cents > 0 && paid >= o.total_cents) {
      await q(`UPDATE orders SET status = 'paid', closed_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, orderId]);
    }
  });
  const order = (await getOrder(tenantId, orderId))!;
  if (order.status === "paid") {
    try {
      await postOrderSettlement(tenantId, order);
    } catch (e) {
      console.error("[ledger] settlement post failed", e);
    }
  }
  return order;
}

export async function voidOrder(tenantId: string, orderId: string): Promise<Order> {
  const existing = await getOrder(tenantId, orderId);
  if (!existing) throw new OrderNotFoundError();
  if (existing.status !== "open") throw new OrderClosedError();
  await withTransaction(async (q) => {
    await q(`UPDATE orders SET status = 'void', closed_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, orderId]);
    for (const li of existing.lineItems) {
      if (li.packageId) {
        await q(`UPDATE packages SET remaining_credits = remaining_credits + 1 WHERE tenant_id = $1 AND id = $2`, [tenantId, li.packageId]);
        await q(
          `INSERT INTO package_txns (tenant_id, package_id, kind, credits, order_id) VALUES ($1, $2::bigint, 'restore', 1, $3::bigint)`,
          [tenantId, li.packageId, orderId]
        );
      }
    }
  });
  try {
    await reverseOrderSettlement(tenantId, orderId, "Voided");
  } catch (e) {
    console.error("[ledger] void reversal failed", e);
  }
  return (await getOrder(tenantId, orderId))!;
}

export async function refundOrder(tenantId: string, orderId: string): Promise<Order | null> {
  const existing = await getOrder(tenantId, orderId);
  if (!existing) return null;
  if (existing.status !== "paid") throw new OrderClosedError();
  await withTransaction(async (q) => {
    await q(`UPDATE payments SET status = 'refunded' WHERE tenant_id = $1 AND order_id = $2 AND status IN ('recorded', 'succeeded')`, [
      tenantId,
      orderId,
    ]);
    await q(`UPDATE orders SET status = 'refunded' WHERE tenant_id = $1 AND id = $2`, [tenantId, orderId]);
  });
  try {
    await reverseOrderSettlement(tenantId, orderId, "Refund");
  } catch (e) {
    console.error("[ledger] refund reversal failed", e);
  }
  return getOrder(tenantId, orderId);
}

/** Mark a pending Stripe payment as succeeded (called from the webhook when configured). */
export async function markPaymentSucceeded(tenantId: string, processorRef: string): Promise<void> {
  await withTransaction(async (q) => {
    const rows = await q<{ order_id: string }>(
      `UPDATE payments SET status = 'succeeded' WHERE tenant_id = $1 AND processor_ref = $2 AND status = 'pending' RETURNING order_id::text AS order_id`,
      [tenantId, processorRef]
    );
    const orderId = rows[0]?.order_id;
    if (!orderId) return;
    const ordRows = await q<{ total_cents: number; status: string }>(
      `SELECT total_cents, status FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const paidRows = await q<{ paid: string }>(
      `SELECT COALESCE(SUM(amount_cents), 0)::text AS paid FROM payments WHERE order_id = $1 AND status IN ('recorded','succeeded')`,
      [orderId]
    );
    if (ordRows[0] && ordRows[0].status === "open" && Number(paidRows[0].paid) >= ordRows[0].total_cents && ordRows[0].total_cents > 0) {
      await q(`UPDATE orders SET status = 'paid', closed_at = now() WHERE id = $1`, [orderId]);
    }
  });
}
