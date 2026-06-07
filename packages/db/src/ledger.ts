import { query, withTransaction } from "./index";
import type {
  Account,
  AccountType,
  JournalEntry,
  JournalEntryListItem,
  JournalLineInput,
  NormalSide,
  Order,
  TrialBalance,
} from "@prodigy/contracts";

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const dateOnly = (v: string | Date): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const today = (): string => new Date().toISOString().slice(0, 10);

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

export const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
export function normalSideFor(type: AccountType): NormalSide {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

// ---------- accounts ----------
interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normal_side: NormalSide;
  is_active: boolean;
}
const mapAccount = (r: AccountRow): Account => ({
  id: r.id,
  code: r.code,
  name: r.name,
  type: r.type,
  normalSide: r.normal_side,
  isActive: r.is_active,
});

export async function listAccounts(tenantId: string, opts: { activeOnly?: boolean } = {}): Promise<Account[]> {
  const rows = await query<AccountRow>(
    `SELECT id::text AS id, code, name, type, normal_side, is_active
     FROM accounts WHERE tenant_id = $1 AND ($2::boolean IS NOT TRUE OR is_active = true)
     ORDER BY code`,
    [tenantId, opts.activeOnly ?? false]
  );
  return rows.map(mapAccount);
}

export async function createAccount(
  tenantId: string,
  input: { code: string; name: string; type: AccountType }
): Promise<Account> {
  if (!ACCOUNT_TYPES.includes(input.type)) throw new LedgerError("Invalid account type.");
  const exists = await query(`SELECT 1 FROM accounts WHERE tenant_id = $1 AND code = $2 LIMIT 1`, [tenantId, input.code]);
  if (exists.length) throw new LedgerError("An account with that code already exists.");
  const rows = await query<AccountRow>(
    `INSERT INTO accounts (tenant_id, code, name, type, normal_side)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id::text AS id, code, name, type, normal_side, is_active`,
    [tenantId, input.code, input.name, input.type, normalSideFor(input.type)]
  );
  return mapAccount(rows[0]);
}

export async function updateAccount(
  tenantId: string,
  id: string,
  patch: { name?: string; isActive?: boolean }
): Promise<Account | null> {
  const rows = await query<AccountRow>(
    `UPDATE accounts SET
       name = COALESCE($3, name),
       is_active = COALESCE($4, is_active)
     WHERE tenant_id = $1 AND id = $2
     RETURNING id::text AS id, code, name, type, normal_side, is_active`,
    [tenantId, id, patch.name ?? null, patch.isActive ?? null]
  );
  return rows[0] ? mapAccount(rows[0]) : null;
}

async function accountIdsByCode(tenantId: string, codes: string[]): Promise<Record<string, string> | null> {
  const rows = await query<{ id: string; code: string }>(
    `SELECT id::text AS id, code FROM accounts WHERE tenant_id = $1 AND code = ANY($2)`,
    [tenantId, codes]
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.code] = r.id;
  for (const c of codes) if (!map[c]) return null; // a required account is missing
  return map;
}

// ---------- journal entries ----------
export interface CreateEntryInput {
  entryDate: string;
  memo: string | null;
  sourceType: string | null;
  sourceId: string | null;
  reversesEntryId?: string | null;
  lines: JournalLineInput[];
}

export async function createJournalEntry(tenantId: string, input: CreateEntryInput): Promise<JournalEntry> {
  const lines = input.lines ?? [];
  if (lines.length < 2) throw new LedgerError("A journal entry needs at least two lines.");
  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of lines) {
    const d = l.debitCents ?? 0;
    const c = l.creditCents ?? 0;
    if (d < 0 || c < 0) throw new LedgerError("Debit and credit amounts can't be negative.");
    if ((d > 0) === (c > 0)) throw new LedgerError("Each line must be either a debit or a credit, not both or neither.");
    totalDebit += d;
    totalCredit += c;
  }
  if (totalDebit !== totalCredit) throw new LedgerError("Debits and credits must be equal.");
  if (totalDebit === 0) throw new LedgerError("A journal entry can't be empty.");

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const found = await query<{ id: string }>(`SELECT id::text AS id FROM accounts WHERE tenant_id = $1 AND id = ANY($2)`, [
    tenantId,
    accountIds,
  ]);
  if (found.length !== accountIds.length) throw new LedgerError("One or more accounts don't exist.");

  let entryId = "";
  await withTransaction(async (q) => {
    const rows = await q<{ id: string }>(
      `INSERT INTO journal_entries (tenant_id, entry_date, memo, source_type, source_id, reverses_entry_id)
       VALUES ($1, $2, $3, $4, $5::bigint, $6::bigint) RETURNING id::text AS id`,
      [tenantId, input.entryDate, input.memo, input.sourceType, input.sourceId, input.reversesEntryId ?? null]
    );
    entryId = rows[0].id;
    for (const l of lines) {
      await q(
        `INSERT INTO journal_lines (tenant_id, entry_id, account_id, debit_cents, credit_cents)
         VALUES ($1, $2::bigint, $3::bigint, $4, $5)`,
        [tenantId, entryId, l.accountId, l.debitCents ?? 0, l.creditCents ?? 0]
      );
    }
  });
  const entry = await getJournalEntry(tenantId, entryId);
  if (!entry) throw new Error("failed to load created journal entry");
  return entry;
}

export async function listJournalEntries(
  tenantId: string,
  opts: { limit?: number; from?: string; to?: string } = {}
): Promise<JournalEntryListItem[]> {
  const rows = await query<{ id: string; entry_date: string | Date; memo: string | null; source_type: string | null; total: string; created_at: string | Date }>(
    `SELECT e.id::text AS id, e.entry_date, e.memo, e.source_type,
            COALESCE((SELECT SUM(debit_cents) FROM journal_lines l WHERE l.entry_id = e.id), 0)::text AS total,
            e.created_at
     FROM journal_entries e
     WHERE e.tenant_id = $1
       AND ($2::date IS NULL OR e.entry_date >= $2)
       AND ($3::date IS NULL OR e.entry_date <= $3)
     ORDER BY e.entry_date DESC, e.id DESC
     LIMIT $4`,
    [tenantId, opts.from ?? null, opts.to ?? null, opts.limit ?? 100]
  );
  return rows.map((r) => ({
    id: r.id,
    entryDate: dateOnly(r.entry_date),
    memo: r.memo,
    sourceType: r.source_type,
    totalCents: Number(r.total),
    createdAt: iso(r.created_at),
  }));
}

export async function getJournalEntry(tenantId: string, id: string): Promise<JournalEntry | null> {
  const head = await query<{
    id: string;
    entry_date: string | Date;
    memo: string | null;
    source_type: string | null;
    source_id: string | null;
    reverses_entry_id: string | null;
    created_at: string | Date;
  }>(
    `SELECT id::text AS id, entry_date, memo, source_type, source_id::text AS source_id,
            reverses_entry_id::text AS reverses_entry_id, created_at
     FROM journal_entries WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id]
  );
  if (!head[0]) return null;
  const lines = await query<{ id: string; account_id: string; code: string; name: string; debit_cents: number; credit_cents: number }>(
    `SELECT l.id::text AS id, l.account_id::text AS account_id, a.code, a.name, l.debit_cents, l.credit_cents
     FROM journal_lines l JOIN accounts a ON a.id = l.account_id
     WHERE l.tenant_id = $1 AND l.entry_id = $2 ORDER BY l.id`,
    [tenantId, id]
  );
  const h = head[0];
  return {
    id: h.id,
    entryDate: dateOnly(h.entry_date),
    memo: h.memo,
    sourceType: h.source_type,
    sourceId: h.source_id,
    reversesEntryId: h.reverses_entry_id,
    createdAt: iso(h.created_at),
    lines: lines.map((l) => ({
      id: l.id,
      accountId: l.account_id,
      accountCode: l.code,
      accountName: l.name,
      debitCents: l.debit_cents,
      creditCents: l.credit_cents,
    })),
  };
}

export async function trialBalance(tenantId: string): Promise<TrialBalance> {
  const rows = await query<{ id: string; code: string; name: string; type: AccountType; d: string; c: string }>(
    `SELECT a.id::text AS id, a.code, a.name, a.type,
            COALESCE(SUM(l.debit_cents), 0)::text AS d, COALESCE(SUM(l.credit_cents), 0)::text AS c
     FROM accounts a
     LEFT JOIN journal_lines l ON l.account_id = a.id AND l.tenant_id = a.tenant_id
     WHERE a.tenant_id = $1
     GROUP BY a.id, a.code, a.name, a.type
     ORDER BY a.code`,
    [tenantId]
  );
  let totalDebit = 0;
  let totalCredit = 0;
  const out = [];
  for (const r of rows) {
    const net = Number(r.d) - Number(r.c); // >0 = net debit
    if (net === 0) continue;
    const debitCents = net > 0 ? net : 0;
    const creditCents = net < 0 ? -net : 0;
    totalDebit += debitCents;
    totalCredit += creditCents;
    out.push({ accountId: r.id, code: r.code, name: r.name, type: r.type, debitCents, creditCents });
  }
  return { rows: out, totalDebitCents: totalDebit, totalCreditCents: totalCredit };
}

// ---------- automatic posting (idempotent; never throws on missing accounts) ----------
async function alreadyPosted(tenantId: string, sourceType: string, sourceId: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM journal_entries WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3 AND reverses_entry_id IS NULL LIMIT 1`,
    [tenantId, sourceType, sourceId]
  );
  return rows.length > 0;
}

/** Post the books entry for a settled sale. Debits cash (and/or gift-card liability for the
 *  gift-card-paid portion); credits sales revenue (net of discount), sales tax, and tips. */
export async function postOrderSettlement(tenantId: string, order: Order): Promise<void> {
  if (order.totalCents <= 0) return;
  if (await alreadyPosted(tenantId, "order", order.id)) return;
  const ids = await accountIdsByCode(tenantId, ["1010", "2200", "4000", "2100", "2150"]);
  if (!ids) return;

  const net = order.subtotalCents - order.discountCents;
  const tax = order.taxCents;
  const tip = order.tipCents;
  const giftPaid = order.payments
    .filter((p) => p.method === "gift_card" && (p.status === "recorded" || p.status === "succeeded"))
    .reduce((sum, p) => sum + p.amountCents, 0);
  const giftDebit = Math.min(Math.max(giftPaid, 0), order.totalCents);
  const cashDebit = order.totalCents - giftDebit;
  if (net < 0) return; // defensive: don't post nonsensical entries

  const lines: JournalLineInput[] = [];
  if (cashDebit > 0) lines.push({ accountId: ids["1010"], debitCents: cashDebit, creditCents: 0 });
  if (giftDebit > 0) lines.push({ accountId: ids["2200"], debitCents: giftDebit, creditCents: 0 });
  if (net > 0) lines.push({ accountId: ids["4000"], debitCents: 0, creditCents: net });
  if (tax > 0) lines.push({ accountId: ids["2100"], debitCents: 0, creditCents: tax });
  if (tip > 0) lines.push({ accountId: ids["2150"], debitCents: 0, creditCents: tip });
  if (lines.length < 2) return;

  await createJournalEntry(tenantId, {
    entryDate: today(),
    memo: `Sale #${order.id}${order.clientName ? ` — ${order.clientName}` : ""}`,
    sourceType: "order",
    sourceId: order.id,
    lines,
  });
}

/** Reverse a previously posted settlement (for void / refund). */
async function reverseEntryForSource(tenantId: string, sourceType: string, sourceId: string, reason: string): Promise<void> {
  const orig = await query<{ id: string }>(
    `SELECT id::text AS id FROM journal_entries
     WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3 AND reverses_entry_id IS NULL
     ORDER BY id DESC LIMIT 1`,
    [tenantId, sourceType, sourceId]
  );
  if (!orig[0]) return;
  const already = await query(`SELECT 1 FROM journal_entries WHERE tenant_id = $1 AND reverses_entry_id = $2 LIMIT 1`, [
    tenantId,
    orig[0].id,
  ]);
  if (already.length) return;
  const lines = await query<{ account_id: string; debit_cents: number; credit_cents: number }>(
    `SELECT account_id::text AS account_id, debit_cents, credit_cents FROM journal_lines WHERE tenant_id = $1 AND entry_id = $2`,
    [tenantId, orig[0].id]
  );
  if (!lines.length) return;
  await createJournalEntry(tenantId, {
    entryDate: today(),
    memo: `${reason} — reverses #${sourceId}`,
    sourceType,
    sourceId,
    reversesEntryId: orig[0].id,
    lines: lines.map((l) => ({ accountId: l.account_id, debitCents: l.credit_cents, creditCents: l.debit_cents })),
  });
}

/** Reverse a previously posted sale settlement (for void / refund). */
export async function reverseOrderSettlement(tenantId: string, orderId: string, reason: string): Promise<void> {
  return reverseEntryForSource(tenantId, "order", orderId, reason);
}

/** Reverse a previously posted cost-of-goods entry (for refund). */
export async function reverseOrderCOGS(tenantId: string, orderId: string, reason: string): Promise<void> {
  return reverseEntryForSource(tenantId, "cogs", orderId, reason);
}

/** Selling a gift card: cash in, liability owed. */
export async function postGiftCardIssued(
  tenantId: string,
  card: { id: string; code: string; initialCents: number }
): Promise<void> {
  if (card.initialCents <= 0) return;
  if (await alreadyPosted(tenantId, "gift_card", card.id)) return;
  const ids = await accountIdsByCode(tenantId, ["1010", "2200"]);
  if (!ids) return;
  await createJournalEntry(tenantId, {
    entryDate: today(),
    memo: `Gift card ${card.code}`,
    sourceType: "gift_card",
    sourceId: card.id,
    lines: [
      { accountId: ids["1010"], debitCents: card.initialCents, creditCents: 0 },
      { accountId: ids["2200"], debitCents: 0, creditCents: card.initialCents },
    ],
  });
}

/** Selling a package: cash in, revenue recognized at point of sale (simplified, cash-basis). */
export async function postPackageSold(
  tenantId: string,
  pkg: { id: string; priceCents: number; serviceName: string | null }
): Promise<void> {
  if (pkg.priceCents <= 0) return;
  if (await alreadyPosted(tenantId, "package", pkg.id)) return;
  const ids = await accountIdsByCode(tenantId, ["1010", "4000"]);
  if (!ids) return;
  await createJournalEntry(tenantId, {
    entryDate: today(),
    memo: `Package${pkg.serviceName ? ` — ${pkg.serviceName}` : ""}`,
    sourceType: "package",
    sourceId: pkg.id,
    lines: [
      { accountId: ids["1010"], debitCents: pkg.priceCents, creditCents: 0 },
      { accountId: ids["4000"], debitCents: 0, creditCents: pkg.priceCents },
    ],
  });
}


// ---- inventory <-> books (slice 16): perpetual inventory + COGS ----
async function postInventoryEntry(
  tenantId: string,
  sourceType: string,
  txnId: string,
  memo: string,
  debitCode: string,
  creditCode: string,
  amountCents: number
): Promise<void> {
  if (amountCents <= 0) return;
  if (await alreadyPosted(tenantId, sourceType, txnId)) return;
  const ids = await accountIdsByCode(tenantId, [debitCode, creditCode]);
  if (!ids) return;
  await createJournalEntry(tenantId, {
    entryDate: today(),
    memo,
    sourceType,
    sourceId: txnId,
    lines: [
      { accountId: ids[debitCode], debitCents: amountCents, creditCents: 0 },
      { accountId: ids[creditCode], debitCents: 0, creditCents: amountCents },
    ],
  });
}

/** Opening stock at product creation: capitalize inventory against owner's equity. */
export async function postInventoryOpening(tenantId: string, txnId: string, valueCents: number, name: string): Promise<void> {
  await postInventoryEntry(tenantId, "inv_open", txnId, `Opening stock \u2014 ${name}`, "1500", "3000", valueCents);
}

/** Receiving purchased stock: inventory up, cash down (assumes paid on receipt). */
export async function postInventoryReceipt(tenantId: string, txnId: string, valueCents: number, name: string): Promise<void> {
  await postInventoryEntry(tenantId, "inv_receive", txnId, `Received stock \u2014 ${name}`, "1500", "1010", valueCents);
}

/** Manual adjustment / count: the inventory value change flows through operating expenses. */
export async function postInventoryAdjustment(tenantId: string, txnId: string, valueCents: number, name: string): Promise<void> {
  if (valueCents > 0) await postInventoryEntry(tenantId, "inv_adjust", txnId, `Inventory adjustment \u2014 ${name}`, "1500", "6000", valueCents);
  else if (valueCents < 0) await postInventoryEntry(tenantId, "inv_adjust", txnId, `Inventory adjustment \u2014 ${name}`, "6000", "1500", -valueCents);
}

/** Cost of goods sold when a sale settles: COGS up, inventory down (current cost). */
export async function postOrderCOGS(tenantId: string, order: Order): Promise<void> {
  if (await alreadyPosted(tenantId, "cogs", order.id)) return;
  if (!order.lineItems.some((l) => l.productId)) return;
  const rows = await query<{ cogs: string }>(
    `SELECT COALESCE(SUM(oli.quantity * p.cost_cents), 0)::bigint AS cogs
     FROM order_line_items oli JOIN products p ON p.id = oli.product_id
     WHERE oli.tenant_id = $1 AND oli.order_id = $2 AND p.track_inventory = true`,
    [tenantId, order.id]
  );
  const cogs = Number(rows[0].cogs);
  if (cogs <= 0) return;
  const ids = await accountIdsByCode(tenantId, ["5000", "1500"]);
  if (!ids) return;
  await createJournalEntry(tenantId, {
    entryDate: today(),
    memo: `Cost of goods \u2014 sale #${order.id}`,
    sourceType: "cogs",
    sourceId: order.id,
    lines: [
      { accountId: ids["5000"], debitCents: cogs, creditCents: 0 },
      { accountId: ids["1500"], debitCents: 0, creditCents: cogs },
    ],
  });
}


/** Settling a membership dues payment: cash in, draw down the receivable accrued at invoice time. */
export async function postMembershipPayment(tenantId: string, invoiceId: string, amountCents: number): Promise<void> {
  if (amountCents <= 0) return;
  if (await alreadyPosted(tenantId, "membership_invoice", invoiceId)) return;
  // Revenue was recognized when the invoice was issued (postMembershipInvoiceAccrual); paying it
  // just settles the receivable: Dr Cash (1010) / Cr Accounts Receivable (1200).
  const ids = await accountIdsByCode(tenantId, ["1010", "1200"]);
  if (!ids) return;
  await createJournalEntry(tenantId, {
    entryDate: today(),
    memo: `Membership dues paid — invoice #${invoiceId}`,
    sourceType: "membership_invoice",
    sourceId: invoiceId,
    lines: [
      { accountId: ids["1010"], debitCents: amountCents, creditCents: 0 },
      { accountId: ids["1200"], debitCents: 0, creditCents: amountCents },
    ],
  });
}

/**
 * Recognize membership dues when invoiced (accrual basis): Dr Accounts Receivable (1200) /
 * Cr Membership Revenue (4100). The receivable sits on the Balance Sheet until paid, so the A/R
 * aging reconciles to the ledger — mirroring how a bill accrues into Accounts Payable (BL-028).
 */
export async function postMembershipInvoiceAccrual(tenantId: string, invoiceId: string, amountCents: number, entryDate?: string): Promise<void> {
  if (amountCents <= 0) return;
  if (await alreadyPosted(tenantId, "membership_accrual", invoiceId)) return;
  const ids = await accountIdsByCode(tenantId, ["1200", "4100"]);
  if (!ids) return;
  await createJournalEntry(tenantId, {
    entryDate: entryDate ?? today(),
    memo: `Membership dues invoiced — #${invoiceId}`,
    sourceType: "membership_accrual",
    sourceId: invoiceId,
    lines: [
      { accountId: ids["1200"], debitCents: amountCents, creditCents: 0 },
      { accountId: ids["4100"], debitCents: 0, creditCents: amountCents },
    ],
  });
}

/**
 * Record an operating expense as a balanced journal entry: Dr <expense account> / Cr Cash 1010.
 * The account must be an existing expense-type account (e.g. 6000 Operating Expenses, 6200 Rent).
 * A safe, single entry point for "money went out" so the books stay balanced.
 */
export async function recordExpense(
  tenantId: string,
  input: { expenseAccountCode: string; amountCents: number; memo: string; date?: string }
): Promise<JournalEntry> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new LedgerError("Amount must be a positive integer (cents).");
  const accounts = await listAccounts(tenantId);
  const expense = accounts.find((a) => a.code === input.expenseAccountCode);
  if (!expense) throw new LedgerError(`No account with code '${input.expenseAccountCode}'.`);
  if (expense.type !== "expense") throw new LedgerError(`Account ${expense.code} is not an expense account.`);
  const cash = accounts.find((a) => a.code === "1010");
  if (!cash) throw new LedgerError("Cash account (1010) is missing.");
  return createJournalEntry(tenantId, {
    entryDate: input.date ?? today(),
    memo: input.memo,
    sourceType: "expense",
    sourceId: null,
    lines: [
      { accountId: expense.id, debitCents: input.amountCents, creditCents: 0 },
      { accountId: cash.id, debitCents: 0, creditCents: input.amountCents },
    ],
  });
}
