import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { ClientPicker } from "./Schedule";
import type { Membership, MembershipInvoice, MembershipPlan } from "@prodigy/contracts";

const fmt = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const dollarsToCents = (s: string): number => Math.round((parseFloat(s) || 0) * 100);
const pct = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

const STATUS_CLASS: Record<string, string> = { active: "s-completed", paused: "s-no_show", cancelled: "s-cancelled" };

export function MembershipsPage() {
  const [tab, setTab] = useState<"members" | "plans">("members");
  return (
    <>
      <div className="subtabs">
        <button className={tab === "members" ? "subtab active" : "subtab"} onClick={() => setTab("members")}>
          Members
        </button>
        <button className={tab === "plans" ? "subtab active" : "subtab"} onClick={() => setTab("plans")}>
          Plans
        </button>
      </div>
      {tab === "members" ? <MembersView /> : <PlansView />}
    </>
  );
}

function PlansView() {
  const [plans, setPlans] = useState<MembershipPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => api<{ plans: MembershipPlan[] }>("/membership-plans").then((r) => setPlans(r.plans)).catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    setError(null);
    if (!name.trim()) return setError("Enter a plan name.");
    setSaving(true);
    try {
      await api("/membership-plans", "POST", {
        name: name.trim(),
        priceCents: dollarsToCents(price),
        discountBps: Math.round((parseFloat(discount) || 0) * 100),
        note: note.trim() || null,
      });
      setName(""); setPrice(""); setDiscount(""); setNote("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="card">
        <h2>Add a plan</h2>
        <div className="form-row">
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field" style={{ maxWidth: 150 }}>
            <span>Price / month</span>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span className="dollar">$</span>
              <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </label>
          <label className="field" style={{ maxWidth: 150 }}>
            <span>Member discount</span>
            <div style={{ display: "flex", alignItems: "center" }}>
              <input className="input" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              <span className="dollar">%</span>
            </div>
          </label>
        </div>
        <input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="bad small">{error}</p>}
        <div className="editor-actions">
          <button className="btn primary" disabled={saving} onClick={() => void add()}>
            {saving ? "Saving\u2026" : "Add plan"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Plans</h2>
        {!plans && <p className="muted">Loading&hellip;</p>}
        {plans && plans.length === 0 && <p className="muted small">No plans yet.</p>}
        <ul className="plain-list">
          {plans?.map((p) => (
            <li key={p.id} className="list-row">
              <div>
                <div className="list-title">
                  {p.name}
                  {!p.isActive && <span className="status-badge s-cancelled">inactive</span>}
                </div>
                <div className="muted small">
                  {fmt(p.priceCents)}/mo{p.discountBps > 0 ? ` · ${pct(p.discountBps)} member discount` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function MembersView() {
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [planId, setPlanId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => api<{ memberships: Membership[] }>("/memberships").then((r) => setMembers(r.memberships)).catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    api<{ plans: MembershipPlan[] }>("/membership-plans?activeOnly=true").then((r) => setPlans(r.plans)).catch(() => {});
  }, []);

  const activePlans = useMemo(() => plans.filter((p) => p.isActive), [plans]);

  const subscribe = async () => {
    setError(null);
    if (!clientId) return setError("Choose a client.");
    if (!planId) return setError("Choose a plan.");
    setSaving(true);
    try {
      await api("/memberships", "POST", { clientId, planId });
      setClientId(""); setClientName(""); setPlanId("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runBilling = async () => {
    setMsg(null);
    setError(null);
    try {
      const r = await api<{ created: number }>("/memberships/run-billing", "POST");
      setMsg(r.created === 0 ? "No dues were due." : `Generated ${r.created} due invoice${r.created === 1 ? "" : "s"}.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (openId) return <MemberDetail id={openId} onBack={() => setOpenId(null)} onChange={load} />;

  return (
    <>
      <section className="card">
        <h2>Add a member</h2>
        <label className="field">
          <span>Client</span>
          <ClientPicker value={clientId} displayName={clientName} onPick={(id, n) => { setClientId(id); setClientName(n); }} />
        </label>
        <label className="field">
          <span>Plan</span>
          <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Choose a plan&hellip;</option>
            {activePlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {fmt(p.priceCents)}/mo
              </option>
            ))}
          </select>
        </label>
        {error && <p className="bad small">{error}</p>}
        <div className="editor-actions">
          <button className="btn primary" disabled={saving} onClick={() => void subscribe()}>
            {saving ? "Saving\u2026" : "Subscribe"}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="ticket-head">
          <h2>Members</h2>
          <button className="btn" onClick={() => void runBilling()}>
            Run billing
          </button>
        </div>
        {msg && <p className="muted small">{msg}</p>}
        {!members && <p className="muted">Loading&hellip;</p>}
        {members && members.length === 0 && <p className="muted small">No members yet.</p>}
        <ul className="plain-list">
          {members?.map((m) => (
            <li key={m.id} className="list-row clickable" onClick={() => setOpenId(m.id)}>
              <div>
                <div className="list-title">
                  {m.clientName || "Member"}
                  <span className={`status-badge ${STATUS_CLASS[m.status] || ""}`}>{m.status}</span>
                </div>
                <div className="muted small">
                  {m.planName || "Plan"} · {fmt(m.priceCents)}/mo
                  {m.status === "active" ? ` · next bill ${m.currentPeriodEnd}` : ""}
                </div>
              </div>
              <span className="chev">›</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function MemberDetail({ id, onBack, onChange }: { id: string; onBack: () => void; onChange: () => void }) {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [invoices, setInvoices] = useState<MembershipInvoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<{ membership: Membership; invoices: MembershipInvoice[] }>(`/memberships/${id}`)
      .then((r) => { setMembership(r.membership); setInvoices(r.invoices); })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/memberships/${id}/${path}`, "POST");
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const payInvoice = async (invId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/membership-invoices/${invId}/pay`, "POST");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!membership) return <section className="card">{error ? <p className="bad small">{error}</p> : <p className="muted">Loading&hellip;</p>}</section>;

  return (
    <>
      <section className="card">
        <button className="link-btn" onClick={onBack}>
          ‹ Back to members
        </button>
        <div className="ticket-head">
          <h2>{membership.clientName || "Member"}</h2>
          <span className={`status-badge ${STATUS_CLASS[membership.status] || ""}`}>{membership.status}</span>
        </div>
        <div className="totals" style={{ borderTop: "none", paddingTop: 0 }}>
          <div className="totline">
            <span className="muted small">Plan</span>
            <span>{membership.planName}</span>
          </div>
          <div className="totline">
            <span className="muted small">Dues</span>
            <span>{fmt(membership.priceCents)}/mo</span>
          </div>
          {membership.discountBps > 0 && (
            <div className="totline">
              <span className="muted small">Member discount</span>
              <span>{pct(membership.discountBps)}</span>
            </div>
          )}
          <div className="totline">
            <span className="muted small">Current period</span>
            <span>
              {membership.currentPeriodStart} → {membership.currentPeriodEnd}
            </span>
          </div>
        </div>
        {error && <p className="bad small">{error}</p>}
        {membership.status !== "cancelled" && (
          <div className="editor-actions" style={{ justifyContent: "flex-start" }}>
            {membership.status === "active" && (
              <button className="btn" disabled={busy} onClick={() => void act("pause")}>
                Pause
              </button>
            )}
            {membership.status === "paused" && (
              <button className="btn" disabled={busy} onClick={() => void act("resume")}>
                Resume
              </button>
            )}
            <button className="btn" disabled={busy} onClick={() => void act("cancel")}>
              Cancel membership
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Dues invoices</h2>
        {invoices.length === 0 && <p className="muted small">No invoices yet.</p>}
        <table className="data-table">
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>
                  {inv.periodStart} → {inv.periodEnd}
                </td>
                <td className="num">{fmt(inv.amountCents)}</td>
                <td>
                  <span className={`status-badge ${inv.status === "paid" ? "s-completed" : inv.status === "void" ? "s-cancelled" : "s-no_show"}`}>{inv.status}</span>
                </td>
                <td className="num">
                  {inv.status === "pending" && (
                    <button className="link-btn" disabled={busy} onClick={() => void payInvoice(inv.id)}>
                      Record payment
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
