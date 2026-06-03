import { useEffect, useMemo, useState } from "react";
import type {
  Appointment,
  Catalog,
  Order,
  OrderListItem,
  PaymentMethod,
  PaymentsConfig,
} from "@prodigy/contracts";
import { api } from "./api";
import { useAuth } from "./auth";
import { ClientPicker } from "./Schedule";

const fmt = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const dollarsToCents = (s: string) => Math.max(0, Math.round((parseFloat(s) || 0) * 100));
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  external_card: "Card (external)",
  stripe_card: "Card (Stripe)",
  other: "Other",
};

export function CheckoutPage() {
  const { hasPermission } = useAuth();
  const canOperate = hasPermission("pos.operate");
  const canHistory = hasPermission("financials.view");
  const canSetup = hasPermission("settings.manage");
  const first = canOperate ? "sale" : canHistory ? "recent" : "setup";
  const [tab, setTab] = useState<"sale" | "recent" | "setup">(first as "sale" | "recent" | "setup");
  const [config, setConfig] = useState<PaymentsConfig | null>(null);

  const loadConfig = async () => {
    try {
      setConfig(await api<PaymentsConfig>("/payments/config"));
    } catch {
      /* config needs pos.operate; ignore for setup/history-only users */
    }
  };
  useEffect(() => {
    if (canOperate) void loadConfig();
  }, [canOperate]);

  return (
    <>
      <header>
        <p className="eyebrow">Point of sale</p>
        <h1>Checkout</h1>
        <p className="sub">Ring up services and products, take payment, and keep a record of every sale.</p>
      </header>

      <div className="subtabs">
        {canOperate && (
          <button className={tab === "sale" ? "subtab active" : "subtab"} onClick={() => setTab("sale")}>
            New sale
          </button>
        )}
        {canHistory && (
          <button className={tab === "recent" ? "subtab active" : "subtab"} onClick={() => setTab("recent")}>
            Recent sales
          </button>
        )}
        {canSetup && (
          <button className={tab === "setup" ? "subtab active" : "subtab"} onClick={() => setTab("setup")}>
            Payments setup
          </button>
        )}
      </div>

      {tab === "sale" && canOperate && <SaleView config={config} />}
      {tab === "recent" && canHistory && <RecentView canOperate={canOperate} />}
      {tab === "setup" && canSetup && <SetupView config={config} onChanged={loadConfig} />}
    </>
  );
}

function SaleView({ config }: { config: PaymentsConfig | null }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [startClientId, setStartClientId] = useState("");
  const [startClientName, setStartClientName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startSale = async (clientId: string | null) => {
    setError(null);
    try {
      const r = await api<{ order: Order }>("/orders", "POST", { clientId });
      setOrder(r.order);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!order) {
    return (
      <section className="card">
        <h2>Start a sale</h2>
        <label className="field">
          <span>Client (optional)</span>
          <ClientPicker
            value={startClientId}
            displayName={startClientName}
            onPick={(id, n) => {
              setStartClientId(id);
              setStartClientName(n);
            }}
          />
        </label>
        {error && <p className="bad small">{error}</p>}
        <div className="editor-actions">
          <button className="btn primary" onClick={() => void startSale(startClientId || null)}>
            {startClientId ? `Start sale for ${startClientName}` : "Start sale"}
          </button>
          {startClientId && (
            <button className="btn" onClick={() => void startSale(null)}>
              Walk-in instead
            </button>
          )}
        </div>
      </section>
    );
  }

  if (order.status !== "open") {
    return <Receipt order={order} onNewSale={() => setOrder(null)} />;
  }

  return <Ticket order={order} config={config} onOrder={setOrder} onNewSale={() => setOrder(null)} />;
}

function Ticket({
  order,
  config,
  onOrder,
  onNewSale,
}: {
  order: Order;
  config: PaymentsConfig | null;
  onOrder: (o: Order) => void;
  onNewSale: () => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [variantId, setVariantId] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cPrice, setCPrice] = useState("");
  const [cQty, setCQty] = useState("1");
  const [cTax, setCTax] = useState(false);
  const [discount, setDiscount] = useState((order.discountCents / 100).toString());
  const [tip, setTip] = useState((order.tipCents / 100).toString());
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payAmount, setPayAmount] = useState((order.balanceCents / 100).toFixed(2));

  useEffect(() => {
    api<Catalog>("/catalog").then(setCatalog).catch(() => {});
  }, []);
  useEffect(() => {
    if (order.clientId) {
      api<{ appointments: Appointment[] }>(`/appointments?clientId=${order.clientId}`)
        .then((r) => setAppts(r.appointments.filter((a) => a.status === "booked" || a.status === "completed").slice(-5)))
        .catch(() => {});
    }
  }, [order.clientId]);
  useEffect(() => {
    setPayAmount((order.balanceCents / 100).toFixed(2));
  }, [order.balanceCents]);

  const variants = useMemo(() => {
    if (!catalog) return [];
    return catalog.services
      .filter((s) => s.isActive)
      .flatMap((s) => s.variants.filter((v) => v.isActive).map((v) => ({ id: v.id, label: `${s.name} · ${v.name}`, price: v.priceCents })));
  }, [catalog]);

  const call = async (p: Promise<{ order: Order }>) => {
    setErr(null);
    try {
      const r = await p;
      onOrder(r.order);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const addService = () => {
    const v = variants.find((x) => x.id === variantId);
    if (!v) return;
    void call(
      api<{ order: Order }>(`/orders/${order.id}/line-items`, "POST", {
        kind: "service",
        description: v.label,
        quantity: 1,
        unitPriceCents: v.price,
        taxable: false,
        serviceVariantId: v.id,
      })
    );
    setVariantId("");
  };
  const addAppt = (a: Appointment) =>
    void call(
      api<{ order: Order }>(`/orders/${order.id}/line-items`, "POST", {
        kind: "service",
        description: `${a.serviceName} · ${a.variantName}`,
        quantity: 1,
        unitPriceCents: a.priceCents,
        taxable: false,
        serviceVariantId: a.serviceVariantId,
        appointmentId: a.id,
      })
    );
  const addCustom = () => {
    if (!cDesc.trim() || !cPrice) return setErr("Enter an item name and price.");
    void call(
      api<{ order: Order }>(`/orders/${order.id}/line-items`, "POST", {
        kind: cTax ? "product" : "custom",
        description: cDesc.trim(),
        quantity: Math.max(1, parseInt(cQty) || 1),
        unitPriceCents: dollarsToCents(cPrice),
        taxable: cTax,
      })
    );
    setCDesc("");
    setCPrice("");
    setCQty("1");
    setCTax(false);
  };

  const takePayment = () => {
    const amount = dollarsToCents(payAmount);
    if (amount <= 0) return setErr("Enter a payment amount.");
    void call(api<{ order: Order }>(`/orders/${order.id}/payments`, "POST", { method: payMethod, amountCents: amount }));
  };

  const stripeConnected = config?.stripeConnected ?? false;
  const methods: PaymentMethod[] = ["cash", "external_card", "stripe_card", "other"];

  return (
    <section className="card">
      <div className="ticket-head">
        <h2>{order.clientName ? order.clientName : "Walk-in sale"}</h2>
        <button className="link-btn muted" onClick={() => void call(api<{ order: Order }>(`/orders/${order.id}/void`, "POST"))}>
          Void sale
        </button>
      </div>

      <ul className="ticket-lines">
        {order.lineItems.map((li) => (
          <li key={li.id} className="ticket-line">
            <span>
              {li.quantity > 1 ? `${li.quantity}× ` : ""}
              {li.description}
              {li.taxable ? <span className="muted small"> (taxable)</span> : ""}
            </span>
            <span className="ticket-amt">
              {fmt(li.amountCents)}
              <button className="link-btn muted line-x" onClick={() => void call(api<{ order: Order }>(`/orders/${order.id}/line-items/${li.id}`, "DELETE"))} title="Remove">
                ✕
              </button>
            </span>
          </li>
        ))}
        {order.lineItems.length === 0 && <li className="muted small">No items yet — add a service or product below.</li>}
      </ul>

      <div className="add-controls">
        <div className="form-row">
          <select className="input" value={variantId} onChange={(e) => setVariantId(e.target.value)} style={{ flex: 1 }}>
            <option value="">Add a service&hellip;</option>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} — {fmt(v.price)}
              </option>
            ))}
          </select>
          <button className="btn sm" disabled={!variantId} onClick={addService}>
            Add
          </button>
        </div>

        {appts.length > 0 && (
          <div className="quick-appts">
            <span className="muted small">From {order.clientName}&rsquo;s appointments:</span>
            <div className="chip-row">
              {appts.map((a) => (
                <button key={a.id} className="chip" onClick={() => addAppt(a)}>
                  {a.variantName} · {fmt(a.priceCents)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="form-row custom-row">
          <input className="input" placeholder="Product / custom item" value={cDesc} onChange={(e) => setCDesc(e.target.value)} style={{ flex: 1 }} />
          <input className="input" placeholder="Price" value={cPrice} onChange={(e) => setCPrice(e.target.value)} style={{ width: 90 }} inputMode="decimal" />
          <input className="input" value={cQty} onChange={(e) => setCQty(e.target.value)} style={{ width: 56 }} inputMode="numeric" title="Quantity" />
          <label className="tax-check">
            <input type="checkbox" checked={cTax} onChange={(e) => setCTax(e.target.checked)} /> tax
          </label>
          <button className="btn sm" onClick={addCustom}>
            Add
          </button>
        </div>
      </div>

      <div className="totals">
        <div className="totline">
          <span>Subtotal</span>
          <span>{fmt(order.subtotalCents)}</span>
        </div>
        <div className="totline">
          <span>Discount</span>
          <span>
            <span className="dollar">$</span>
            <input
              className="input mini"
              value={discount}
              inputMode="decimal"
              onChange={(e) => setDiscount(e.target.value)}
              onBlur={() => void call(api<{ order: Order }>(`/orders/${order.id}`, "PATCH", { discountCents: dollarsToCents(discount) }))}
            />
          </span>
        </div>
        <div className="totline">
          <span>Tax{config ? ` (${(config.taxRateBps / 100).toFixed(2)}%)` : ""}</span>
          <span>{fmt(order.taxCents)}</span>
        </div>
        <div className="totline">
          <span>Tip</span>
          <span>
            <span className="dollar">$</span>
            <input
              className="input mini"
              value={tip}
              inputMode="decimal"
              onChange={(e) => setTip(e.target.value)}
              onBlur={() => void call(api<{ order: Order }>(`/orders/${order.id}`, "PATCH", { tipCents: dollarsToCents(tip) }))}
            />
          </span>
        </div>
        <div className="totline grand">
          <span>Total</span>
          <span>{fmt(order.totalCents)}</span>
        </div>
        {order.paidCents > 0 && (
          <div className="totline">
            <span>Paid</span>
            <span>
              {fmt(order.paidCents)} · balance {fmt(order.balanceCents)}
            </span>
          </div>
        )}
      </div>

      <div className="pay-block">
        <div className="pay-methods">
          {methods.map((m) => {
            const disabled = m === "stripe_card" && !stripeConnected;
            return (
              <button
                key={m}
                className={`method-btn${payMethod === m ? " sel" : ""}`}
                disabled={disabled}
                title={disabled ? "Connect Stripe in Payments setup to enable card charging" : undefined}
                onClick={() => setPayMethod(m)}
              >
                {METHOD_LABEL[m]}
                {disabled ? " (setup)" : ""}
              </button>
            );
          })}
        </div>
        <div className="form-row">
          <span className="dollar big">$</span>
          <input className="input" value={payAmount} inputMode="decimal" onChange={(e) => setPayAmount(e.target.value)} style={{ width: 120 }} />
          <button className="btn primary" disabled={order.totalCents <= 0} onClick={takePayment}>
            Take payment
          </button>
        </div>
      </div>

      {err && <p className="bad small">{err}</p>}
      <button className="link-btn" onClick={onNewSale}>
        Cancel / start over
      </button>
    </section>
  );
}

function Receipt({ order, onNewSale }: { order: Order; onNewSale: () => void }) {
  return (
    <section className="card">
      <div className="receipt-head">
        <h2>{order.status === "paid" ? "Paid in full" : order.status === "void" ? "Sale voided" : "Refunded"}</h2>
        <span className={`status-badge s-${order.status === "paid" ? "completed" : order.status === "void" ? "cancelled" : "cancelled"}`}>
          {order.status}
        </span>
      </div>
      {order.clientName && <p className="muted small">{order.clientName}</p>}
      <ul className="ticket-lines">
        {order.lineItems.map((li) => (
          <li key={li.id} className="ticket-line">
            <span>
              {li.quantity > 1 ? `${li.quantity}× ` : ""}
              {li.description}
            </span>
            <span>{fmt(li.amountCents)}</span>
          </li>
        ))}
      </ul>
      <div className="totals">
        <div className="totline">
          <span>Subtotal</span>
          <span>{fmt(order.subtotalCents)}</span>
        </div>
        {order.discountCents > 0 && (
          <div className="totline">
            <span>Discount</span>
            <span>−{fmt(order.discountCents)}</span>
          </div>
        )}
        <div className="totline">
          <span>Tax</span>
          <span>{fmt(order.taxCents)}</span>
        </div>
        {order.tipCents > 0 && (
          <div className="totline">
            <span>Tip</span>
            <span>{fmt(order.tipCents)}</span>
          </div>
        )}
        <div className="totline grand">
          <span>Total</span>
          <span>{fmt(order.totalCents)}</span>
        </div>
      </div>
      {order.payments.length > 0 && (
        <div className="pay-list">
          {order.payments.map((p) => (
            <div key={p.id} className="totline">
              <span>
                {METHOD_LABEL[p.method]} <span className="muted small">{p.status}</span>
              </span>
              <span>{fmt(p.amountCents)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="editor-actions">
        <button className="btn primary" onClick={onNewSale}>
          New sale
        </button>
      </div>
    </section>
  );
}

function RecentView({ canOperate }: { canOperate: boolean }) {
  const [orders, setOrders] = useState<OrderListItem[] | null>(null);
  const [detail, setDetail] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api<{ orders: OrderListItem[] }>("/orders");
      setOrders(r.orders);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const open = async (id: string) => {
    if (!canOperate) return; // detail endpoint needs pos.operate
    try {
      const r = await api<{ order: Order }>(`/orders/${id}`);
      setDetail(r.order);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const refund = async () => {
    if (!detail) return;
    try {
      const r = await api<{ order: Order }>(`/orders/${detail.id}/refund`, "POST");
      setDetail(r.order);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (detail) {
    return (
      <section className="card">
        <button className="link-btn" onClick={() => setDetail(null)}>
          ‹ Back to recent sales
        </button>
        <Receipt order={detail} onNewSale={() => setDetail(null)} />
        {detail.status === "paid" && (
          <div className="editor-actions">
            <button className="btn" onClick={() => void refund()}>
              Refund this sale
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="card">
      {error && <p className="bad small">{error}</p>}
      {!orders && <p className="muted">Loading&hellip;</p>}
      {orders && orders.length === 0 && <p className="muted small">No sales yet.</p>}
      <ul className="plain-list">
        {orders?.map((o) => (
          <li key={o.id} className={`list-row${canOperate ? " clickable" : ""}`} onClick={() => void open(o.id)}>
            <div>
              <div className="list-title">
                {fmt(o.totalCents)}
                <span className={`status-badge s-${o.status === "paid" ? "completed" : o.status === "open" ? "booked" : "cancelled"}`}>{o.status}</span>
              </div>
              <div className="muted small">
                {o.clientName || "Walk-in"} · {fmtDateTime(o.createdAt)}
                {o.status === "open" && o.paidCents > 0 ? ` · ${fmt(o.paidCents)} paid` : ""}
              </div>
            </div>
            {canOperate && <span className="chev">›</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SetupView({ config, onChanged }: { config: PaymentsConfig | null; onChanged: () => Promise<void> }) {
  const [taxPct, setTaxPct] = useState(config ? (config.taxRateBps / 100).toString() : "0");
  const [savingTax, setSavingTax] = useState(false);
  const [taxMsg, setTaxMsg] = useState<string | null>(null);
  const [stripeBusy, setStripeBusy] = useState(false);
  const [stripeMsg, setStripeMsg] = useState<string | null>(null);

  useEffect(() => {
    if (config) setTaxPct((config.taxRateBps / 100).toString());
  }, [config]);

  const saveTax = async () => {
    setSavingTax(true);
    setTaxMsg(null);
    try {
      const bps = Math.round((parseFloat(taxPct) || 0) * 100);
      await api("/settings/tax", "POST", { taxRateBps: bps });
      await onChanged();
      setTaxMsg("Saved.");
    } catch (e) {
      setTaxMsg((e as Error).message);
    } finally {
      setSavingTax(false);
    }
  };

  const connectStripe = async () => {
    setStripeBusy(true);
    setStripeMsg(null);
    try {
      const r = await api<{ url: string }>("/payments/stripe/connect", "POST");
      window.open(r.url, "_blank");
    } catch (e) {
      setStripeMsg((e as Error).message);
    } finally {
      setStripeBusy(false);
    }
  };
  const refreshStripe = async () => {
    setStripeBusy(true);
    setStripeMsg(null);
    try {
      const r = await api<{ stripeConnected: boolean }>("/payments/stripe/refresh", "POST");
      await onChanged();
      setStripeMsg(r.stripeConnected ? "Stripe connected." : "Not connected yet — finish onboarding, then refresh.");
    } catch (e) {
      setStripeMsg((e as Error).message);
    } finally {
      setStripeBusy(false);
    }
  };

  return (
    <>
      <section className="card">
        <h2>Sales tax</h2>
        <p className="muted small" style={{ marginTop: -6 }}>
          Applied to items marked taxable. Not tax advice — confirm the correct rate and what&rsquo;s taxable for your area.
        </p>
        <div className="form-row">
          <label className="field" style={{ maxWidth: 160 }}>
            <span>Rate (%)</span>
            <input className="input" value={taxPct} inputMode="decimal" onChange={(e) => setTaxPct(e.target.value)} />
          </label>
          <button className="btn primary" disabled={savingTax} onClick={() => void saveTax()} style={{ alignSelf: "flex-end" }}>
            {savingTax ? "Saving\u2026" : "Save"}
          </button>
        </div>
        {taxMsg && <p className="muted small">{taxMsg}</p>}
      </section>

      <section className="card">
        <h2>Card payments (Stripe)</h2>
        {!config && <p className="muted small">Loading&hellip;</p>}
        {config && !config.stripePlatformConfigured && (
          <p className="muted small">
            Card payments via Stripe are <b>coming soon</b>. The server isn&rsquo;t configured for Stripe yet — once it is, you&rsquo;ll
            connect your account here and start taking cards in checkout. Until then, use Cash or Card (external).
          </p>
        )}
        {config && config.stripePlatformConfigured && config.stripeConnected && (
          <p className="result-ok">Stripe is connected — you can take card payments in checkout.</p>
        )}
        {config && config.stripePlatformConfigured && !config.stripeConnected && (
          <>
            <p className="muted small">Connect your Stripe account to accept card payments. You&rsquo;ll be taken to Stripe to finish setup.</p>
            <div className="editor-actions">
              <button className="btn primary" disabled={stripeBusy} onClick={() => void connectStripe()}>
                {stripeBusy ? "Working\u2026" : "Connect Stripe"}
              </button>
              <button className="btn" disabled={stripeBusy} onClick={() => void refreshStripe()}>
                Refresh status
              </button>
            </div>
          </>
        )}
        {stripeMsg && <p className="muted small">{stripeMsg}</p>}
      </section>
    </>
  );
}
