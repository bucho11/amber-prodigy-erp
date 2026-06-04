import { useEffect, useState } from "react";

interface PSvc {
  variantId: string;
  serviceName: string;
  variantName: string;
  durationMinutes: number;
  priceCents: number;
}
interface PProv {
  id: string;
  name: string;
}
interface PSlot {
  startsAt: string;
  label: string;
}
interface PConf {
  startsAt: string;
  endsAt: string;
  serviceName: string;
  providerName: string;
  manageToken: string;
}
interface Info {
  businessName: string;
  timezone: string;
  services: PSvc[];
  providers: PProv[];
}

const fmt = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const todayStr = (): string => new Date().toISOString().slice(0, 10);

function tenantSlug(): string {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[0] === "book" && parts[1] ? parts[1] : "prodigy";
}

async function pub<T>(slug: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-tenant-slug": slug },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

export function PublicBooking() {
  const slug = tenantSlug();
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [variantId, setVariantId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [date, setDate] = useState(todayStr());

  const [slots, setSlots] = useState<PSlot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [chosen, setChosen] = useState<PSlot | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PConf | null>(null);

  useEffect(() => {
    pub<Info>(slug, "/public/booking-info")
      .then(setInfo)
      .catch((e) => setLoadErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setChosen(null);
    setSlots(null);
    if (!variantId || !providerId || !date) return;
    setSlotsLoading(true);
    pub<{ slots: PSlot[] }>(slug, `/public/slots?serviceVariantId=${encodeURIComponent(variantId)}&providerId=${encodeURIComponent(providerId)}&date=${date}`)
      .then((r) => setSlots(r.slots))
      .catch((e) => {
        setSlots([]);
        setError((e as Error).message);
      })
      .finally(() => setSlotsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId, providerId, date]);

  const book = async () => {
    setError(null);
    if (!firstName.trim() || !lastName.trim()) return setError("Please enter your name.");
    if (!email.trim()) return setError("Please enter your email.");
    if (!phone.trim()) return setError("Please enter your phone number.");
    if (!chosen) return;
    setBooking(true);
    try {
      const r = await pub<{ confirmation: PConf }>(slug, "/public/book", "POST", {
        serviceVariantId: variantId,
        providerId,
        startsAt: chosen.startsAt,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
      setConfirmation(r.confirmation);
    } catch (e) {
      setError((e as Error).message);
      // a conflict means our slot list is stale — refresh it
      pub<{ slots: PSlot[] }>(slug, `/public/slots?serviceVariantId=${encodeURIComponent(variantId)}&providerId=${encodeURIComponent(providerId)}&date=${date}`)
        .then((rr) => setSlots(rr.slots))
        .catch(() => {});
      setChosen(null);
    } finally {
      setBooking(false);
    }
  };

  const reset = () => {
    setConfirmation(null);
    setVariantId("");
    setProviderId("");
    setDate(todayStr());
    setSlots(null);
    setChosen(null);
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setError(null);
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
  if (!info) {
    return (
      <div className="public-book">
        <p className="muted">Loading&hellip;</p>
      </div>
    );
  }

  if (confirmation) {
    return (
      <div className="public-book">
        <div className="card">
          <h1>You&rsquo;re booked!</h1>
          <p className="muted">A confirmation isn&rsquo;t emailed yet — please save these details.</p>
          <div className="totals" style={{ borderTop: "none" }}>
            <div className="totline">
              <span className="muted small">Service</span>
              <span>{confirmation.serviceName}</span>
            </div>
            <div className="totline">
              <span className="muted small">With</span>
              <span>{confirmation.providerName}</span>
            </div>
            <div className="totline">
              <span className="muted small">When</span>
              <span>
                {date} at {chosen?.label ?? ""}
              </span>
            </div>
          </div>
          <p className="muted small">
            Need to change it? <a href={`/book/manage/${confirmation.manageToken}`}>Manage or cancel this booking</a> — save this link.
          </p>
          <div className="editor-actions">
            <button className="btn primary" onClick={reset}>
              Book another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="public-book">
      <header className="public-head">
        <h1>{info.businessName}</h1>
        <p className="muted">Book an appointment</p>
      </header>

      <section className="card">
        <label className="field">
          <span>Service</span>
          <select className="input" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="">Choose a service&hellip;</option>
            {info.services.map((s) => (
              <option key={s.variantId} value={s.variantId}>
                {s.serviceName} — {s.variantName} · {s.durationMinutes} min · {fmt(s.priceCents)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Provider</span>
          <select className="input" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            <option value="">Choose a provider&hellip;</option>
            {info.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Date</span>
          <input className="input" type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </section>

      {variantId && providerId && date && (
        <section className="card">
          <h2>Pick a time</h2>
          {slotsLoading && <p className="muted small">Finding open times&hellip;</p>}
          {!slotsLoading && slots && slots.length === 0 && <p className="muted small">No open times that day. Try another date or provider.</p>}
          <div className="chip-row">
            {slots?.map((s) => (
              <button key={s.startsAt} className={chosen?.startsAt === s.startsAt ? "chip chip-on" : "chip"} onClick={() => { setChosen(s); setError(null); }}>
                {s.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {chosen && (
        <section className="card">
          <h2>Your details</h2>
          <div className="form-row">
            <label className="field">
              <span>First name</span>
              <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </label>
            <label className="field">
              <span>Last name</span>
              <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Phone</span>
            <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          {error && <p className="bad small">{error}</p>}
          <div className="editor-actions">
            <button className="btn primary" disabled={booking} onClick={() => void book()}>
              {booking ? "Booking\u2026" : `Confirm ${date} at ${chosen.label}`}
            </button>
          </div>
        </section>
      )}

      {!chosen && error && (
        <section className="card">
          <p className="bad small">{error}</p>
        </section>
      )}
    </div>
  );
}
