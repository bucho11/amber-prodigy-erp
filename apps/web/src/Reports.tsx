import { useEffect, useState } from "react";
import { api } from "./api";
import type { IncomeSummary, InventorySnapshot, SalesSummary } from "@prodigy/contracts";

const fmt = (cents: number): string => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
const todayStr = (): string => new Date().toISOString().slice(0, 10);
const firstOfMonth = (): string => todayStr().slice(0, 8) + "01";
const daysAgo = (n: number): string => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  external_card: "Card (external)",
  stripe_card: "Card (Stripe)",
  gift_card: "Gift card",
  other: "Other",
};

export function ReportsPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayStr());
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [income, setIncome] = useState<IncomeSummary | null>(null);
  const [inv, setInv] = useState<InventorySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (f: string, t: string) => {
    setLoading(true);
    setError(null);
    try {
      const [s, i, v] = await Promise.all([
        api<{ salesSummary: SalesSummary }>(`/reports/sales?from=${f}&to=${t}`),
        api<{ incomeSummary: IncomeSummary }>(`/reports/income?from=${f}&to=${t}`),
        api<{ inventorySnapshot: InventorySnapshot }>(`/reports/inventory`),
      ]);
      setSales(s.salesSummary);
      setIncome(i.incomeSummary);
      setInv(v.inventorySnapshot);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preset = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
    void load(f, t);
  };

  return (
    <>
      <section className="card">
        <h2>Reports</h2>
        <div className="form-row">
          <label className="field" style={{ maxWidth: 180 }}>
            <span>From</span>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field" style={{ maxWidth: 180 }}>
            <span>To</span>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div className="field" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" disabled={loading} onClick={() => void load(from, to)}>
              {loading ? "Loading\u2026" : "Apply"}
            </button>
          </div>
        </div>
        <div className="chip-row">
          <button className="chip" onClick={() => preset(firstOfMonth(), todayStr())}>
            This month
          </button>
          <button className="chip" onClick={() => preset(daysAgo(30), todayStr())}>
            Last 30 days
          </button>
          <button className="chip" onClick={() => preset(todayStr().slice(0, 4) + "-01-01", todayStr())}>
            This year
          </button>
        </div>
        {error && <p className="bad small">{error}</p>}
      </section>

      <section className="card">
        <h2>Sales</h2>
        <p className="muted small">
          {from} to {to}
        </p>
        {sales && (
          <>
            <div className="totals" style={{ borderTop: "none", paddingTop: 0 }}>
              <div className="totline grand">
                <span>Net sales</span>
                <span>{fmt(sales.netSalesCents)}</span>
              </div>
              <div className="totline">
                <span className="muted small">Gross (line totals)</span>
                <span>{fmt(sales.subtotalCents)}</span>
              </div>
              <div className="totline">
                <span className="muted small">Discounts</span>
                <span>{sales.discountCents ? `- ${fmt(sales.discountCents)}` : fmt(0)}</span>
              </div>
              <div className="totline">
                <span className="muted small">Sales tax collected</span>
                <span>{fmt(sales.taxCents)}</span>
              </div>
              <div className="totline">
                <span className="muted small">Tips</span>
                <span>{fmt(sales.tipCents)}</span>
              </div>
              <div className="totline grand">
                <span>Total collected</span>
                <span>{fmt(sales.totalCollectedCents)}</span>
              </div>
              <div className="totline">
                <span className="muted small">Paid sales</span>
                <span>{sales.paidOrderCount}</span>
              </div>
              {sales.refundCount > 0 && (
                <div className="totline">
                  <span className="muted small">Refunds ({sales.refundCount})</span>
                  <span>- {fmt(sales.refundedCents)}</span>
                </div>
              )}
            </div>
            {sales.paymentsByMethod.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Paid by</th>
                    <th className="num">Count</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.paymentsByMethod.map((m) => (
                    <tr key={m.method}>
                      <td>{METHOD_LABEL[m.method] || m.method}</td>
                      <td className="num">{m.count}</td>
                      <td className="num">{fmt(m.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Income</h2>
        <p className="muted small">From the books, {from} to {to}</p>
        {income && (
          <>
            <table className="data-table">
              <tbody>
                {income.revenue.map((r) => (
                  <tr key={r.code}>
                    <td>
                      <span className="muted small">{r.code}</span> {r.name}
                    </td>
                    <td className="num">{fmt(r.amountCents)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td>Revenue</td>
                  <td className="num">{fmt(income.revenueCents)}</td>
                </tr>
                {income.expenses.map((e) => (
                  <tr key={e.code}>
                    <td>
                      <span className="muted small">{e.code}</span> {e.name}
                    </td>
                    <td className="num">- {fmt(e.amountCents)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td>Expenses</td>
                  <td className="num">- {fmt(income.expenseCents)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="total-row">
                  <td>Net income</td>
                  <td className="num">{fmt(income.netIncomeCents)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="muted small">Reflects what&rsquo;s posted to the ledger in this range. Simplified, cash-basis-style books.</p>
          </>
        )}
      </section>

      <section className="card">
        <h2>Inventory</h2>
        <p className="muted small">Current stock position</p>
        {inv && (
          <>
            <div className="totals" style={{ borderTop: "none", paddingTop: 0 }}>
              <div className="totline grand">
                <span>Stock value (at cost)</span>
                <span>{fmt(inv.inventoryValueCents)}</span>
              </div>
              <div className="totline">
                <span className="muted small">Stock value (at retail)</span>
                <span>{fmt(inv.retailValueCents)}</span>
              </div>
              <div className="totline">
                <span className="muted small">Tracked products</span>
                <span>{inv.trackedProductCount}</span>
              </div>
              {inv.outOfStockCount > 0 && (
                <div className="totline">
                  <span className="muted small">Out of stock</span>
                  <span>{inv.outOfStockCount}</span>
                </div>
              )}
            </div>
            {inv.lowStock.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Low stock</th>
                    <th className="num">On hand</th>
                    <th className="num">Reorder at</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lowStock.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="num">{p.stockQty}</td>
                      <td className="num">{p.reorderPoint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted small">Nothing below its reorder level.</p>
            )}
          </>
        )}
      </section>
    </>
  );
}
