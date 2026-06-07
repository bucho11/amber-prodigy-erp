import { query, withTransaction } from "./index";
import { getOrder, updateAdjustments } from "./payments";
import { postMembershipPayment, postMembershipInvoiceAccrual } from "./ledger";
import type { Membership, MembershipInvoice, MembershipPlan, Order } from "@prodigy/contracts";

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const today = (): string => new Date().toISOString().slice(0, 10);

export class MembershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipError";
  }
}

// ---------- plans ----------
interface PlanRow {
  id: string;
  name: string;
  price_cents: number;
  billing_period: string;
  discount_bps: number;
  is_active: boolean;
  note: string | null;
  created_at: string | Date;
}
const mapPlan = (r: PlanRow): MembershipPlan => ({
  id: r.id,
  name: r.name,
  priceCents: r.price_cents,
  billingPeriod: r.billing_period,
  discountBps: r.discount_bps,
  isActive: r.is_active,
  note: r.note,
  createdAt: iso(r.created_at),
});
const PLAN_COLS = `id::text AS id, name, price_cents, billing_period, discount_bps, is_active, note, created_at`;

export async function listPlans(tenantId: string, opts: { activeOnly?: boolean } = {}): Promise<MembershipPlan[]> {
  const rows = await query<PlanRow>(
    `SELECT ${PLAN_COLS} FROM membership_plans WHERE tenant_id = $1 AND ($2::boolean IS NOT TRUE OR is_active = true) ORDER BY name`,
    [tenantId, opts.activeOnly ?? false]
  );
  return rows.map(mapPlan);
}

export async function getPlan(tenantId: string, id: string): Promise<MembershipPlan | null> {
  const rows = await query<PlanRow>(`SELECT ${PLAN_COLS} FROM membership_plans WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapPlan(rows[0]) : null;
}

export async function createPlan(
  tenantId: string,
  input: { name: string; priceCents: number; discountBps: number; note: string | null }
): Promise<MembershipPlan> {
  const rows = await query<PlanRow>(
    `INSERT INTO membership_plans (tenant_id, name, price_cents, billing_period, discount_bps, note)
     VALUES ($1, $2, $3, 'monthly', $4, $5) RETURNING ${PLAN_COLS}`,
    [tenantId, input.name, input.priceCents, input.discountBps, input.note]
  );
  return mapPlan(rows[0]);
}

export async function updatePlan(
  tenantId: string,
  id: string,
  patch: { name?: string; priceCents?: number; discountBps?: number; note?: string | null; isActive?: boolean }
): Promise<MembershipPlan | null> {
  const rows = await query<PlanRow>(
    `UPDATE membership_plans SET
       name = COALESCE($3, name),
       price_cents = COALESCE($4, price_cents),
       discount_bps = COALESCE($5, discount_bps),
       note = COALESCE($6, note),
       is_active = COALESCE($7, is_active)
     WHERE tenant_id = $1 AND id = $2 RETURNING ${PLAN_COLS}`,
    [tenantId, id, patch.name ?? null, patch.priceCents ?? null, patch.discountBps ?? null, patch.note === undefined ? null : patch.note, patch.isActive ?? null]
  );
  return rows[0] ? mapPlan(rows[0]) : null;
}

// ---------- memberships ----------
interface MembershipRow {
  id: string;
  client_id: string;
  client_name: string | null;
  plan_id: string;
  plan_name: string | null;
  status: Membership["status"];
  price_cents: number;
  discount_bps: number;
  started_on: string;
  current_period_start: string;
  current_period_end: string;
  created_at: string | Date;
}
const mapMembership = (r: MembershipRow): Membership => ({
  id: r.id,
  clientId: r.client_id,
  clientName: r.client_name,
  planId: r.plan_id,
  planName: r.plan_name,
  status: r.status,
  priceCents: r.price_cents,
  discountBps: r.discount_bps,
  startedOn: r.started_on,
  currentPeriodStart: r.current_period_start,
  currentPeriodEnd: r.current_period_end,
  createdAt: iso(r.created_at),
});
const MEMBERSHIP_SELECT = `
  SELECT m.id::text AS id, m.client_id::text AS client_id, c.display_name AS client_name,
         m.plan_id::text AS plan_id, pl.name AS plan_name, m.status, m.price_cents, m.discount_bps,
         m.started_on::text AS started_on, m.current_period_start::text AS current_period_start,
         m.current_period_end::text AS current_period_end, m.created_at
  FROM memberships m
  LEFT JOIN clients c ON c.id = m.client_id
  LEFT JOIN membership_plans pl ON pl.id = m.plan_id`;

export async function subscribe(
  tenantId: string,
  input: { clientId: string; planId: string; startedOn?: string }
): Promise<Membership> {
  const plan = await getPlan(tenantId, input.planId);
  if (!plan) throw new MembershipError("Plan not found.");
  if (!plan.isActive) throw new MembershipError("That plan isn't active.");
  const start = input.startedOn ?? today();
  let id = "";
  let invoiceId = "";
  await withTransaction(async (q) => {
    const m = await q<{ id: string }>(
      `INSERT INTO memberships (tenant_id, client_id, plan_id, status, price_cents, discount_bps, started_on, current_period_start, current_period_end)
       VALUES ($1, $2::bigint, $3::bigint, 'active', $4, $5, $6::date, $6::date, ($6::date + interval '1 month')::date)
       RETURNING id::text AS id`,
      [tenantId, input.clientId, input.planId, plan.priceCents, plan.discountBps, start]
    );
    id = m[0].id;
    const inv = await q<{ id: string }>(
      `INSERT INTO membership_invoices (tenant_id, membership_id, period_start, period_end, amount_cents, status, paid_at)
       VALUES ($1, $2::bigint, $3::date, ($3::date + interval '1 month')::date, $4, $5, $6) RETURNING id::text AS id`,
      [tenantId, id, start, plan.priceCents, plan.priceCents > 0 ? "pending" : "paid", plan.priceCents > 0 ? null : new Date().toISOString()]
    );
    invoiceId = inv[0].id;
  });
  // Accrue the receivable for the first (unpaid) dues invoice (accrual basis).
  if (invoiceId && plan.priceCents > 0) await postMembershipInvoiceAccrual(tenantId, invoiceId, plan.priceCents, start);
  const m = await getMembership(tenantId, id);
  if (!m) throw new Error("failed to load created membership");
  return m;
}

export async function listMemberships(tenantId: string, opts: { clientId?: string; status?: string } = {}): Promise<Membership[]> {
  const rows = await query<MembershipRow>(
    `${MEMBERSHIP_SELECT}
     WHERE m.tenant_id = $1 AND ($2::bigint IS NULL OR m.client_id = $2) AND ($3::text IS NULL OR m.status = $3)
     ORDER BY m.created_at DESC LIMIT 500`,
    [tenantId, opts.clientId ?? null, opts.status ?? null]
  );
  return rows.map(mapMembership);
}

export async function getMembership(tenantId: string, id: string): Promise<Membership | null> {
  const rows = await query<MembershipRow>(`${MEMBERSHIP_SELECT} WHERE m.tenant_id = $1 AND m.id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapMembership(rows[0]) : null;
}

/** Most recent active membership for a client (used at checkout for the member discount). */
export async function activeMembershipForClient(tenantId: string, clientId: string): Promise<Membership | null> {
  const rows = await query<MembershipRow>(
    `${MEMBERSHIP_SELECT} WHERE m.tenant_id = $1 AND m.client_id = $2 AND m.status = 'active' ORDER BY m.current_period_end DESC LIMIT 1`,
    [tenantId, clientId]
  );
  return rows[0] ? mapMembership(rows[0]) : null;
}

async function setStatus(tenantId: string, id: string, from: string[], to: string, stamp: boolean): Promise<Membership | null> {
  const rows = await query<{ id: string }>(
    `UPDATE memberships SET status = $3${stamp ? ", cancelled_at = now()" : ""}
     WHERE tenant_id = $1 AND id = $2 AND status = ANY($4) RETURNING id::text AS id`,
    [tenantId, id, to, from]
  );
  if (!rows[0]) {
    const exists = await getMembership(tenantId, id);
    if (!exists) return null;
    throw new MembershipError(`Can't move a ${exists.status} membership to ${to}.`);
  }
  return getMembership(tenantId, id);
}
export const pauseMembership = (t: string, id: string) => setStatus(t, id, ["active"], "paused", false);
export const resumeMembership = (t: string, id: string) => setStatus(t, id, ["paused"], "active", false);
export const cancelMembership = (t: string, id: string) => setStatus(t, id, ["active", "paused"], "cancelled", true);

// ---------- invoices + billing ----------
interface InvoiceRow {
  id: string;
  period_start: string;
  period_end: string;
  amount_cents: number;
  status: MembershipInvoice["status"];
  paid_at: string | Date | null;
  created_at: string | Date;
}
const mapInvoice = (r: InvoiceRow): MembershipInvoice => ({
  id: r.id,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  amountCents: r.amount_cents,
  status: r.status,
  paidAt: r.paid_at ? iso(r.paid_at) : null,
  createdAt: iso(r.created_at),
});
const INVOICE_COLS = `id::text AS id, period_start::text AS period_start, period_end::text AS period_end, amount_cents, status, paid_at, created_at`;

export async function listMembershipInvoices(tenantId: string, membershipId: string): Promise<MembershipInvoice[]> {
  const rows = await query<InvoiceRow>(
    `SELECT ${INVOICE_COLS} FROM membership_invoices WHERE tenant_id = $1 AND membership_id = $2 ORDER BY period_start DESC`,
    [tenantId, membershipId]
  );
  return rows.map(mapInvoice);
}

export async function getInvoice(tenantId: string, id: string): Promise<MembershipInvoice | null> {
  const rows = await query<InvoiceRow>(`SELECT ${INVOICE_COLS} FROM membership_invoices WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapInvoice(rows[0]) : null;
}

/** Generate the next dues invoice for active memberships whose period has ended; advances one period. */
export async function runBilling(tenantId: string): Promise<{ created: number }> {
  const due = await query<{ id: string; cpe: string; price_cents: number }>(
    `SELECT id::text AS id, current_period_end::text AS cpe, price_cents
     FROM memberships WHERE tenant_id = $1 AND status = 'active' AND current_period_end <= CURRENT_DATE`,
    [tenantId]
  );
  let created = 0;
  const accruals: Array<{ invoiceId: string; amountCents: number; periodStart: string }> = [];
  await withTransaction(async (q) => {
    for (const m of due) {
      const exists = await q(
        `SELECT 1 FROM membership_invoices WHERE tenant_id = $1 AND membership_id = $2 AND period_start = $3::date LIMIT 1`,
        [tenantId, m.id, m.cpe]
      );
      if (exists.length) continue;
      const inv = await q<{ id: string }>(
        `INSERT INTO membership_invoices (tenant_id, membership_id, period_start, period_end, amount_cents, status, paid_at)
         VALUES ($1, $2::bigint, $3::date, ($3::date + interval '1 month')::date, $4, $5, $6) RETURNING id::text AS id`,
        [tenantId, m.id, m.cpe, m.price_cents, m.price_cents > 0 ? "pending" : "paid", m.price_cents > 0 ? null : new Date().toISOString()]
      );
      await q(
        `UPDATE memberships SET current_period_start = current_period_end, current_period_end = (current_period_end + interval '1 month')::date
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, m.id]
      );
      if (m.price_cents > 0) accruals.push({ invoiceId: inv[0].id, amountCents: m.price_cents, periodStart: m.cpe });
      created++;
    }
  });
  // Accrue each new dues invoice to Accounts Receivable (accrual basis).
  for (const a of accruals) await postMembershipInvoiceAccrual(tenantId, a.invoiceId, a.amountCents, a.periodStart);
  return { created };
}

/** Record a manual / cash dues payment and post it to the books. */
export async function recordInvoicePayment(tenantId: string, invoiceId: string): Promise<MembershipInvoice> {
  const inv = await getInvoice(tenantId, invoiceId);
  if (!inv) throw new MembershipError("Invoice not found.");
  if (inv.status !== "pending") throw new MembershipError("That invoice is already settled or void.");
  await query(`UPDATE membership_invoices SET status = 'paid', paid_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, invoiceId]);
  try {
    await postMembershipPayment(tenantId, invoiceId, inv.amountCents);
  } catch (e) {
    console.error("[ledger] membership payment post failed", e);
  }
  const updated = await getInvoice(tenantId, invoiceId);
  if (!updated) throw new Error("failed to load invoice after payment");
  return updated;
}

/** Apply the client's active member discount to an open order (sets the order discount). */
export async function applyMemberDiscount(tenantId: string, orderId: string): Promise<Order> {
  const order = await getOrder(tenantId, orderId);
  if (!order) throw new MembershipError("Sale not found.");
  if (order.status !== "open") throw new MembershipError("This sale is already closed.");
  if (!order.clientId) throw new MembershipError("Attach a client to this sale first.");
  const m = await activeMembershipForClient(tenantId, order.clientId);
  if (!m || m.discountBps <= 0) throw new MembershipError("This client has no active member discount.");
  const discountCents = Math.round((order.subtotalCents * m.discountBps) / 10000);
  return updateAdjustments(tenantId, orderId, { discountCents });
}
