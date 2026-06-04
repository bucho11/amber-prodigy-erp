import { useEffect, useState } from "react";

interface Booking {
  startsAt: string;
  endsAt: string;
  status: string;
  serviceName: string;
  providerName: string;
  canModify: boolean;
}
interface MSlot {
  startsAt: string;
  label: string;
}

const SLUG = "prodigy";
const todayStr = (): string => new Date().toISOString().slice(0, 10);
const whenStr = (iso: string): string => new Date(iso).toLocaleString([], { dateStyle: "full", timeStyle: "short" });

function tokenFromPath(): string {
  const parts = window.location.pathname.split("/").filter(Boolean); // ['book','manage', <token>]
  return parts[0] === "book" && parts[1] === "manage" && parts[2] ? parts[2] : "";
}

async function pub<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-tenant-slug": SLUG },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

export function PublicManageBooking() {
  const token = tokenFromPath();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [mode, setMode] = useState<"none" | "reschedule" | "cancel">("none");
  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState<MSlot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () =>
    pub<{ booking: Booking }>(`/public/booking/${token}`)
      .then((r) => setBooking(r.booking))
      .catch((e) => setLoadErr((e as Error).message));

  useEffect(() => {
    if (!token) {
      setLoadErr("This link is missing its booking code.");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== "reschedule") return;
    setSlots(null);
    setSlotsLoading(true);
    pub<{ slots: MSlot[] }>(`/public/booking/${token}/slots?date=${date}`)
      .then((r) => setSlots(r.slots))
      .catch((e) => { setSlots([]); setError((e as Error).message); })
      .finally(() => setSlotsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, date]);

  const reschedule = async (slot: MSlot) => {
    setBusy(true);
    setError(null);
    try {
      const r = await pub<{ booking: Booking }>(`/public/booking/${token}/reschedule`, "POST", { startsAt: slot.startsAt });
      setBooking(r.booking);
      setMode("none");
      setMsg(`Rescheduled to ${whenStr(r.booking.startsAt)}.`);
    } catch (e) {
      setError((e as Error).message);
      pub<{ slots: MSlot[] }>(`/public/booking/${token}/slots?date=${date}`).then((rr) => setSlots(rr.slots)).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await pub<{ booking: Booking }>(`/public/booking/${token}/cancel`, "POST");
      setBooking(r.booking);
      setMode("none");
      setMsg("Your appointment has been cancelled.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loadErr) {
    return (
      <div className="public-book">
        <div className="card">
          <p className="bad">{loadErr}</p>
        </div>
      </div>
    );
  }
  if (!booking) {
    return (
      <div className="public-book">
        <p className="muted">Loading&hellip;</p>
      </div>
    );
  }

  return (
    <div className="public-book">
      <header className="public-head">
        <h1>Your appointment</h1>
      </header>

      <section className="card">
        <div className="totals" style={{ borderTop: "none" }}>
          <div className="totline">
            <span className="muted small">Service</span>
            <span>{booking.serviceName}</span>
          </div>
          <div className="totline">
            <span className="muted small">With</span>
            <span>{booking.providerName}</span>
          </div>
          <div className="totline">
            <span className="muted small">When</span>
            <span>{whenStr(booking.startsAt)}</span>
          </div>
          <div className="totline">
            <span className="muted small">Status</span>
            <span className={`status-badge ${booking.status === "booked" ? "s-booked" : "s-cancelled"}`}>{booking.status}</span>
          </div>
        </div>
        {msg && <p className="muted small">{msg}</p>}
        {error && <p className="bad small">{error}</p>}

        {booking.status === "cancelled" && <p className="muted small">This appointment has been cancelled. To rebook, visit our booking page.</p>}
        {booking.status === "booked" && !booking.canModify && (
          <p className="muted small">This appointment can&rsquo;t be changed online &mdash; please call us.</p>
        )}

        {booking.canModify && mode === "none" && (
          <div className="editor-actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn primary" onClick={() => { setMode("reschedule"); setError(null); setMsg(null); }}>
              Reschedule
            </button>
            <button className="btn" onClick={() => { setMode("cancel"); setError(null); setMsg(null); }}>
              Cancel appointment
            </button>
          </div>
        )}

        {booking.canModify && mode === "cancel" && (
          <div>
            <p className="small">Cancel this appointment? This can&rsquo;t be undone.</p>
            <div className="editor-actions" style={{ justifyContent: "flex-start" }}>
              <button className="btn bad" disabled={busy} onClick={() => void cancel()}>
                {busy ? "Cancelling\u2026" : "Yes, cancel it"}
              </button>
              <button className="btn" onClick={() => setMode("none")}>
                Keep it
              </button>
            </div>
          </div>
        )}
      </section>

      {booking.canModify && mode === "reschedule" && (
        <section className="card">
          <div className="ticket-head">
            <h2>Pick a new time</h2>
            <button className="link-btn" onClick={() => setMode("none")}>
              Cancel
            </button>
          </div>
          <label className="field">
            <span>Date</span>
            <input className="input" type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {slotsLoading && <p className="muted small">Finding open times&hellip;</p>}
          {!slotsLoading && slots && slots.length === 0 && <p className="muted small">No open times that day. Try another date.</p>}
          <div className="chip-row">
            {slots?.map((s) => (
              <button key={s.startsAt} className="chip" disabled={busy} onClick={() => void reschedule(s)}>
                {s.label}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
