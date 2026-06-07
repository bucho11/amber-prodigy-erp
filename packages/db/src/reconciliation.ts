import { query } from "./index";
import type { BankReconciliation, CashTransaction } from "@prodigy/contracts";

/**
 * Bank reconciliation (BL-032): the cash side of the ledger vs. what's cleared the bank. A cash
 * transaction is any journal entry touching Cash (1010); marking it cleared records that the bank
 * has posted it. The CLEARED balance should match the bank statement; the difference between the
 * BOOK balance and the cleared balance is the outstanding (in-transit) items — the standard
 * cleared-vs-outstanding model. Manual clearing only (no bank-feed rail).
 */

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const today = (): string => new Date().toISOString().slice(0, 10);
const n = (v: unknown): number => Number(v ?? 0);

interface Row {
  entry_id: string;
  date: string;
  memo: string | null;
  amount: string;
  cleared: boolean;
}

export async function bankReconciliation(tenantId: string, asOf?: string): Promise<BankReconciliation> {
  const d = asOf ?? today();
  const rows = await query<Row>(
    `SELECT e.id::text AS entry_id, e.entry_date::text AS date, e.memo,
            SUM(CASE WHEN a.code = '1010' THEN l.debit_cents - l.credit_cents ELSE 0 END)::bigint AS amount,
            (e.cleared_at IS NOT NULL) AS cleared
       FROM journal_entries e
       JOIN journal_lines l ON l.entry_id = e.id
       JOIN accounts a ON a.id = l.account_id
      WHERE e.tenant_id = $1 AND e.entry_date <= $2
      GROUP BY e.id, e.entry_date, e.memo, e.cleared_at
     HAVING SUM(CASE WHEN a.code = '1010' THEN 1 ELSE 0 END) > 0
      ORDER BY e.entry_date DESC, e.id DESC`,
    [tenantId, d]
  );

  let bookBalanceCents = 0;
  let clearedBalanceCents = 0;
  let unclearedCount = 0;
  let unclearedCents = 0;
  const transactions: CashTransaction[] = [];
  for (const r of rows) {
    const amt = n(r.amount);
    bookBalanceCents += amt;
    if (r.cleared) clearedBalanceCents += amt;
    else {
      unclearedCount++;
      unclearedCents += amt;
    }
    if (transactions.length < 200) {
      transactions.push({ entryId: r.entry_id, date: r.date, memo: r.memo, amountCents: amt, cleared: r.cleared });
    }
  }
  return { asOf: d, bookBalanceCents, clearedBalanceCents, unclearedCount, unclearedCents, transactions };
}

export class ReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconciliationError";
  }
}

/** Mark a cash transaction cleared (posted by the bank) or un-cleared. */
export async function setEntryCleared(tenantId: string, entryId: string, cleared: boolean): Promise<void> {
  const isCash = await query(
    `SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l.account_id
      WHERE l.tenant_id = $1 AND l.entry_id = $2 AND a.code = '1010' LIMIT 1`,
    [tenantId, entryId]
  );
  if (!isCash.length) throw new ReconciliationError("That entry isn't a cash transaction.");
  await query(`UPDATE journal_entries SET cleared_at = $3 WHERE tenant_id = $1 AND id = $2`, [
    tenantId,
    entryId,
    cleared ? iso(new Date()) : null,
  ]);
}
