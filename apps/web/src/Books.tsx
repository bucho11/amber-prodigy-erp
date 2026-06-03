import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type { Account, AccountType, JournalEntry, JournalEntryListItem, TrialBalance } from "@prodigy/contracts";

const fmt = (cents: number): string => {
  const v = (Math.abs(cents) / 100).toFixed(2);
  return `${cents < 0 ? "-" : ""}$${v}`;
};
const dollarsToCents = (s: string): number => Math.round((parseFloat(s) || 0) * 100);
const todayStr = (): string => new Date().toISOString().slice(0, 10);

const SOURCE_LABEL: Record<string, string> = {
  order: "Sale",
  gift_card: "Gift card",
  package: "Package",
  manual: "Manual",
};

export function BooksPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("books.manage");
  const [tab, setTab] = useState<"trial" | "journal" | "accounts">("trial");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const loadAccounts = () => api<{ accounts: Account[] }>("/accounts").then((r) => setAccounts(r.accounts)).catch(() => {});
  useEffect(() => {
    void loadAccounts();
  }, []);

  return (
    <>
      <div className="subtabs">
        <button className={tab === "trial" ? "subtab active" : "subtab"} onClick={() => setTab("trial")}>
          Trial balance
        </button>
        <button className={tab === "journal" ? "subtab active" : "subtab"} onClick={() => setTab("journal")}>
          Journal
        </button>
        <button className={tab === "accounts" ? "subtab active" : "subtab"} onClick={() => setTab("accounts")}>
          Chart of accounts
        </button>
      </div>
      {tab === "trial" && <TrialBalanceView />}
      {tab === "journal" && <JournalView accounts={accounts} canWrite={canWrite} />}
      {tab === "accounts" && <AccountsView accounts={accounts} canWrite={canWrite} onChange={loadAccounts} />}
    </>
  );
}

function TrialBalanceView() {
  const [tb, setTb] = useState<TrialBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ trialBalance: TrialBalance }>("/reports/trial-balance")
      .then((r) => setTb(r.trialBalance))
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <section className="card">
      <h2>Trial balance</h2>
      <p className="muted small">Every account&rsquo;s current balance. Total debits always equal total credits.</p>
      {error && <p className="bad small">{error}</p>}
      {!tb && !error && <p className="muted">Loading&hellip;</p>}
      {tb && tb.rows.length === 0 && <p className="muted small">No activity yet.</p>}
      {tb && tb.rows.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.accountId}>
                <td>
                  <span className="muted small">{r.code}</span> {r.name}
                </td>
                <td className="num">{r.debitCents ? fmt(r.debitCents) : ""}</td>
                <td className="num">{r.creditCents ? fmt(r.creditCents) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td>Total</td>
              <td className="num">{fmt(tb.totalDebitCents)}</td>
              <td className="num">{fmt(tb.totalCreditCents)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}

interface LineDraft {
  accountId: string;
  side: "debit" | "credit";
  amount: string;
}

function JournalView({ accounts, canWrite }: { accounts: Account[]; canWrite: boolean }) {
  const [entries, setEntries] = useState<JournalEntryListItem[] | null>(null);
  const [detail, setDetail] = useState<JournalEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { accountId: "", side: "debit", amount: "" },
    { accountId: "", side: "credit", amount: "" },
  ]);
  const [saving, setSaving] = useState(false);

  const load = () =>
    api<{ entries: JournalEntryListItem[] }>("/journal")
      .then((r) => setEntries(r.entries))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  const options = useMemo(() => accounts.filter((a) => a.isActive), [accounts]);

  const totals = useMemo(() => {
    let d = 0;
    let c = 0;
    for (const l of lines) {
      const cents = dollarsToCents(l.amount);
      if (l.side === "debit") d += cents;
      else c += cents;
    }
    return { d, c };
  }, [lines]);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    setError(null);
    const payloadLines = lines
      .filter((l) => l.accountId && dollarsToCents(l.amount) > 0)
      .map((l) => ({
        accountId: l.accountId,
        debitCents: l.side === "debit" ? dollarsToCents(l.amount) : 0,
        creditCents: l.side === "credit" ? dollarsToCents(l.amount) : 0,
      }));
    if (payloadLines.length < 2) return setError("Add at least two lines with an account and amount.");
    if (totals.d !== totals.c) return setError("Debits and credits must be equal.");
    setSaving(true);
    try {
      await api("/journal", "POST", { entryDate: date, memo: memo.trim() || null, lines: payloadLines });
      setAdding(false);
      setMemo("");
      setDate(todayStr());
      setLines([
        { accountId: "", side: "debit", amount: "" },
        { accountId: "", side: "credit", amount: "" },
      ]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (detail) {
    return (
      <section className="card">
        <button className="link-btn" onClick={() => setDetail(null)}>
          ‹ Back to journal
        </button>
        <div className="ticket-head">
          <h2>{detail.memo || "Journal entry"}</h2>
          <span className="muted small">{detail.entryDate}</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            {detail.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <span className="muted small">{l.accountCode}</span> {l.accountName}
                </td>
                <td className="num">{l.debitCents ? fmt(l.debitCents) : ""}</td>
                <td className="num">{l.creditCents ? fmt(l.creditCents) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {detail.reversesEntryId && <p className="muted small">This entry reverses an earlier one.</p>}
      </section>
    );
  }

  return (
    <>
      {canWrite && (
        <section className="card">
          {!adding ? (
            <button className="btn primary" onClick={() => setAdding(true)}>
              New journal entry
            </button>
          ) : (
            <>
              <h2>New journal entry</h2>
              <div className="form-row">
                <label className="field" style={{ maxWidth: 180 }}>
                  <span>Date</span>
                  <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className="field">
                  <span>Memo</span>
                  <input className="input" placeholder="What is this for?" value={memo} onChange={(e) => setMemo(e.target.value)} />
                </label>
              </div>
              {lines.map((l, i) => (
                <div className="form-row" key={i}>
                  <label className="field">
                    <span>Account</span>
                    <select className="input" value={l.accountId} onChange={(e) => setLine(i, { accountId: e.target.value })}>
                      <option value="">Choose&hellip;</option>
                      {options.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field" style={{ maxWidth: 130 }}>
                    <span>Type</span>
                    <select className="input" value={l.side} onChange={(e) => setLine(i, { side: e.target.value as "debit" | "credit" })}>
                      <option value="debit">Debit</option>
                      <option value="credit">Credit</option>
                    </select>
                  </label>
                  <label className="field" style={{ maxWidth: 140 }}>
                    <span>Amount</span>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <span className="dollar">$</span>
                      <input className="input" inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
                    </div>
                  </label>
                  {lines.length > 2 && (
                    <button className="link-btn muted" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button className="link-btn" onClick={() => setLines((ls) => [...ls, { accountId: "", side: "debit", amount: "" }])}>
                + Add line
              </button>
              <div className="totals">
                <div className="totline">
                  <span className="muted small">Debits</span>
                  <span>{fmt(totals.d)}</span>
                </div>
                <div className="totline">
                  <span className="muted small">Credits</span>
                  <span>{fmt(totals.c)}</span>
                </div>
                <div className={`totline grand ${totals.d === totals.c ? "" : "bad"}`}>
                  <span>{totals.d === totals.c ? "Balanced" : "Out of balance"}</span>
                  <span>{fmt(Math.abs(totals.d - totals.c))}</span>
                </div>
              </div>
              {error && <p className="bad small">{error}</p>}
              <div className="editor-actions">
                <button className="btn" onClick={() => { setAdding(false); setError(null); }}>
                  Cancel
                </button>
                <button className="btn primary" disabled={saving} onClick={() => void submit()}>
                  {saving ? "Saving\u2026" : "Post entry"}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card">
        <h2>Journal</h2>
        {error && !adding && <p className="bad small">{error}</p>}
        {!entries && <p className="muted">Loading&hellip;</p>}
        {entries && entries.length === 0 && <p className="muted small">No entries yet. Sales and payments post here automatically.</p>}
        <ul className="plain-list">
          {entries?.map((e) => (
            <li key={e.id} className="list-row clickable" onClick={() => void api<{ entry: JournalEntry }>(`/journal/${e.id}`).then((r) => setDetail(r.entry)).catch((err) => setError((err as Error).message))}>
              <div>
                <div className="list-title">
                  {e.memo || "Journal entry"}
                  {e.sourceType && <span className="status-badge s-completed">{SOURCE_LABEL[e.sourceType] || e.sourceType}</span>}
                </div>
                <div className="muted small">{e.entryDate}</div>
              </div>
              <span>{fmt(e.totalCents)}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function AccountsView({ accounts, canWrite, onChange }: { accounts: Account[]; canWrite: boolean; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("expense");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    setError(null);
    if (!code.trim() || !name.trim()) return setError("Enter a code and a name.");
    setSaving(true);
    try {
      await api("/accounts", "POST", { code: code.trim(), name: name.trim(), type });
      setCode("");
      setName("");
      setType("expense");
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {canWrite && (
        <section className="card">
          <h2>Add an account</h2>
          <div className="form-row">
            <label className="field" style={{ maxWidth: 120 }}>
              <span>Code</span>
              <input className="input" value={code} inputMode="numeric" onChange={(e) => setCode(e.target.value)} />
            </label>
            <label className="field">
              <span>Name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field" style={{ maxWidth: 160 }}>
              <span>Type</span>
              <select className="input" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                <option value="asset">Asset</option>
                <option value="liability">Liability</option>
                <option value="equity">Equity</option>
                <option value="revenue">Revenue</option>
                <option value="expense">Expense</option>
              </select>
            </label>
          </div>
          {error && <p className="bad small">{error}</p>}
          <div className="editor-actions">
            <button className="btn primary" disabled={saving} onClick={() => void add()}>
              {saving ? "Saving\u2026" : "Add account"}
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Chart of accounts</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className={a.isActive ? "" : "muted"}>
                <td>{a.code}</td>
                <td>
                  {a.name}
                  {!a.isActive && <span className="muted small"> (inactive)</span>}
                </td>
                <td className="cap">{a.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
