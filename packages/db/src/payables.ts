import { query, withTransaction } from "./index";
import type { Bill, PayablesSummary, Vendor } from "@prodigy/contracts";

/**
 * Accounts payable (BL-028): vendors and the bills we owe them, on an ACCRUAL basis.
 *  - Entering a bill posts: Dr <expense account> / Cr Accounts Payable (2000).
 *  - Paying a bill posts:   Dr Accounts Payable (2000) / Cr Cash (1010).
 * So the A/P liability accrues on the Balance Sheet between entry and payment, and the expense is
 * recognized when the bill is entered (proper accrual) — the matching pillar to the financial
 * statements (BL-026/027). The GL entry is posted atomically with the bill row (money path, P4).
 */
export class PayablesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayablesError";
  }
}

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const dateOnly = (v: string | Date): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const today = (): string => new Date().toISOString().slice(0, 10);

// ---------- vendors ----------
interface VendorRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string | Date;
}
const VENDOR_COLS = `id::text AS id, name, email, phone, notes, is_active, created_at`;
const mapVendor = (r: VendorRow): Vendor => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  notes: r.notes,
  isActive: r.is_active,
  createdAt: iso(r.created_at),
});

export async function createVendor(
  tenantId: string,
  input: { name: string; email?: string | null; phone?: string | null; notes?: string | null }
): Promise<Vendor> {
  const name = (input.name ?? "").trim();
  if (!name) throw new PayablesError("Vendor name is required.");
  const rows = await query<VendorRow>(
    `INSERT INTO vendors (tenant_id, name, email, phone, notes) VALUES ($1, $2, $3, $4, $5) RETURNING ${VENDOR_COLS}`,
    [tenantId, name, input.email?.trim() || null, input.phone?.trim() || null, input.notes?.trim() || null]
  );
  return mapVendor(rows[0]);
}

export async function listVendors(tenantId: string, opts: { activeOnly?: boolean } = {}): Promise<Vendor[]> {
  const rows = await query<VendorRow>(
    `SELECT ${VENDOR_COLS} FROM vendors WHERE tenant_id = $1 ${opts.activeOnly ? "AND is_active = true" : ""} ORDER BY name`,
    [tenantId]
  );
  return rows.map(mapVendor);
}

// ---------- bills ----------
interface BillRow {
  id: string;
  vendor_id: string;
  vendor_name: string;
  expense_account_id: string;
  expense_account_code: string;
  expense_account_name: string;
  bill_date: string;
  due_date: string;
  amount_cents: number;
  memo: string | null;
  status: Bill["status"];
  paid_at: string | Date | null;
  created_at: string | Date;
}
const BILL_SELECT = `SELECT b.id::text AS id, b.vendor_id::text AS vendor_id, v.name AS vendor_name,
       b.expense_account_id::text AS expense_account_id, a.code AS expense_account_code, a.name AS expense_account_name,
       b.bill_date::text AS bill_date, b.due_date::text AS due_date, b.amount_cents, b.memo, b.status, b.paid_at, b.created_at
  FROM bills b JOIN vendors v ON v.id = b.vendor_id JOIN accounts a ON a.id = b.expense_account_id`;
const mapBill = (r: BillRow): Bill => ({
  id: r.id,
  vendorId: r.vendor_id,
  vendorName: r.vendor_name,
  expenseAccountId: r.expense_account_id,
  expenseAccountCode: r.expense_account_code,
  expenseAccountName: r.expense_account_name,
  billDate: r.bill_date,
  dueDate: r.due_date,
  amountCents: r.amount_cents,
  memo: r.memo,
  status: r.status,
  paidAt: r.paid_at ? iso(r.paid_at) : null,
  createdAt: iso(r.created_at),
});

type Tx = Parameters<Parameters<typeof withTransaction>[0]>[0];
interface PostLine { accountId: string; debitCents?: number; creditCents?: number }
/** Insert a balanced journal entry on the transaction client (atomic with the bill change). */
async function postEntry(
  q: Tx,
  tenantId: string,
  e: { entryDate: string; memo: string; sourceType: string; sourceId: string; lines: PostLine[] }
): Promise<void> {
  const rows = await q<{ id: string }>(
    `INSERT INTO journal_entries (tenant_id, entry_date, memo, source_type, source_id)
     VALUES ($1, $2, $3, $4, $5::bigint) RETURNING id::text AS id`,
    [tenantId, e.entryDate, e.memo, e.sourceType, e.sourceId]
  );
  const entryId = rows[0].id;
  for (const l of e.lines) {
    await q(
      `INSERT INTO journal_lines (tenant_id, entry_id, account_id, debit_cents, credit_cents)
       VALUES ($1, $2::bigint, $3::bigint, $4, $5)`,
      [tenantId, entryId, l.accountId, l.debitCents ?? 0, l.creditCents ?? 0]
    );
  }
}

export async function createBill(
  tenantId: string,
  input: { vendorId: string; expenseAccountCode: string; amountCents: number; billDate?: string; dueDate?: string; memo?: string | null }
): Promise<Bill> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PayablesError("Amount must be a positive integer (cents).");
  }
  const vendor = await query<{ name: string }>(`SELECT name FROM vendors WHERE tenant_id = $1 AND id = $2`, [tenantId, input.vendorId]);
  if (!vendor.length) throw new PayablesError("Vendor not found.");
  const accts = await query<{ id: string; code: string; type: string }>(
    `SELECT id::text AS id, code, type FROM accounts WHERE tenant_id = $1 AND code = ANY($2)`,
    [tenantId, [input.expenseAccountCode, "2000"]]
  );
  const expense = accts.find((a) => a.code === input.expenseAccountCode);
  const ap = accts.find((a) => a.code === "2000");
  if (!expense) throw new PayablesError(`No account with code '${input.expenseAccountCode}'.`);
  if (expense.type !== "expense") throw new PayablesError(`Account ${expense.code} is not an expense account.`);
  if (!ap) throw new PayablesError("Accounts Payable account (2000) is missing.");

  const billDate = dateOnly(input.billDate ?? today());
  const dueDate = dateOnly(input.dueDate ?? billDate);
  const memo = input.memo?.trim() || null;
  let billId = "";
  await withTransaction(async (q) => {
    const rows = await q<{ id: string }>(
      `INSERT INTO bills (tenant_id, vendor_id, expense_account_id, bill_date, due_date, amount_cents, memo)
       VALUES ($1, $2::bigint, $3::bigint, $4, $5, $6, $7) RETURNING id::text AS id`,
      [tenantId, input.vendorId, expense.id, billDate, dueDate, input.amountCents, memo]
    );
    billId = rows[0].id;
    await postEntry(q, tenantId, {
      entryDate: billDate,
      memo: memo || `Bill — ${vendor[0].name}`,
      sourceType: "bill",
      sourceId: billId,
      lines: [
        { accountId: expense.id, debitCents: input.amountCents },
        { accountId: ap.id, creditCents: input.amountCents },
      ],
    });
  });
  const bill = await getBill(tenantId, billId);
  if (!bill) throw new Error("failed to load created bill");
  return bill;
}

export async function payBill(tenantId: string, billId: string): Promise<Bill> {
  const bill = await getBill(tenantId, billId);
  if (!bill) throw new PayablesError("Bill not found.");
  if (bill.status !== "open") throw new PayablesError(`That bill is already ${bill.status}.`);
  const accts = await query<{ id: string; code: string }>(
    `SELECT id::text AS id, code FROM accounts WHERE tenant_id = $1 AND code = ANY($2)`,
    [tenantId, ["2000", "1010"]]
  );
  const ap = accts.find((a) => a.code === "2000");
  const cash = accts.find((a) => a.code === "1010");
  if (!ap || !cash) throw new PayablesError("Required accounts (Accounts Payable 2000 / Cash 1010) are missing.");
  await withTransaction(async (q) => {
    await q(`UPDATE bills SET status = 'paid', paid_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, billId]);
    await postEntry(q, tenantId, {
      entryDate: today(),
      memo: `Bill payment — ${bill.vendorName}`,
      sourceType: "bill_payment",
      sourceId: billId,
      lines: [
        { accountId: ap.id, debitCents: bill.amountCents },
        { accountId: cash.id, creditCents: bill.amountCents },
      ],
    });
  });
  const updated = await getBill(tenantId, billId);
  if (!updated) throw new Error("failed to load paid bill");
  return updated;
}

export async function listBills(tenantId: string, opts: { status?: string; vendorId?: string } = {}): Promise<Bill[]> {
  const rows = await query<BillRow>(
    `${BILL_SELECT}
      WHERE b.tenant_id = $1 AND ($2::text IS NULL OR b.status = $2) AND ($3::bigint IS NULL OR b.vendor_id = $3)
      ORDER BY b.status = 'open' DESC, b.due_date, b.id DESC`,
    [tenantId, opts.status ?? null, opts.vendorId ?? null]
  );
  return rows.map(mapBill);
}

export async function getBill(tenantId: string, id: string): Promise<Bill | null> {
  const rows = await query<BillRow>(`${BILL_SELECT} WHERE b.tenant_id = $1 AND b.id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapBill(rows[0]) : null;
}

/** What we owe right now: open bills total, and the overdue subset (due before `asOf`). */
export async function payablesSummary(tenantId: string, asOf?: string): Promise<PayablesSummary> {
  const d = dateOnly(asOf ?? today());
  const rows = await query<{ open_count: number; open_cents: string; overdue_count: number; overdue_cents: string }>(
    `SELECT COUNT(*)::int AS open_count,
            COALESCE(SUM(amount_cents), 0)::bigint AS open_cents,
            COUNT(*) FILTER (WHERE due_date < $2)::int AS overdue_count,
            COALESCE(SUM(amount_cents) FILTER (WHERE due_date < $2), 0)::bigint AS overdue_cents
       FROM bills WHERE tenant_id = $1 AND status = 'open'`,
    [tenantId, d]
  );
  const r = rows[0];
  return {
    openCount: r.open_count,
    openCents: Number(r.open_cents),
    overdueCount: r.overdue_count,
    overdueCents: Number(r.overdue_cents),
  };
}
