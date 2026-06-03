import { useCallback, useEffect, useMemo, useState } from "react";
import type { Appointment, AppointmentStatus, Catalog, ClientListItem, Provider } from "@prodigy/contracts";
import { api } from "./api";
import { useAuth } from "./auth";

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtPrice = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDateLong = (dateStr: string) =>
  new Date(`${dateStr}T00:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  booked: "Booked",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export function ScheduleAdmin() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("scheduling.manage");

  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [providerFilter, setProviderFilter] = useState("");
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: "new" } | { mode: "edit"; appt: Appointment } | null>(null);

  useEffect(() => {
    Promise.all([api<{ providers: Provider[] }>("/providers"), api<Catalog>("/catalog")])
      .then(([p, c]) => {
        setProviders(p.providers);
        setCatalog(c);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const load = useCallback(async () => {
    try {
      const from = new Date(`${date}T00:00:00`).toISOString();
      const to = new Date(new Date(`${date}T00:00:00`).getTime() + 24 * 3600 * 1000).toISOString();
      const params = new URLSearchParams({ from, to });
      if (providerFilter) params.set("providerId", providerFilter);
      const res = await api<{ appointments: Appointment[] }>(`/appointments?${params.toString()}`);
      setAppts(res.appointments);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [date, providerFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const shiftDay = (delta: number) => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(toDateInput(d));
  };

  const setStatus = async (appt: Appointment, status: AppointmentStatus) => {
    try {
      await api(`/appointments/${appt.id}/status`, "POST", { status });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (editor && catalog) {
    return (
      <BookingForm
        catalog={catalog}
        providers={providers}
        defaultDate={date}
        editing={editor.mode === "edit" ? editor.appt : undefined}
        onClose={() => setEditor(null)}
        onSaved={async () => {
          setEditor(null);
          await load();
        }}
      />
    );
  }

  return (
    <>
      <header>
        <p className="eyebrow">Schedule</p>
        <h1>Calendar</h1>
        <p className="sub">Your day at a glance. Book appointments, reschedule, and update their status.</p>
      </header>

      <section className="card">
        <div className="day-nav">
          <button className="btn sm" onClick={() => shiftDay(-1)}>
            ‹ Prev
          </button>
          <button className="btn sm" onClick={() => setDate(toDateInput(new Date()))}>
            Today
          </button>
          <button className="btn sm" onClick={() => shiftDay(1)}>
            Next ›
          </button>
          <input className="input day-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <select className="input day-input" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
          {canManage && (
            <button className="btn primary book-btn" onClick={() => setEditor({ mode: "new" })}>
              + Book
            </button>
          )}
        </div>
        <p className="day-label">{fmtDateLong(date)}</p>

        {error && <p className="bad small">{error}</p>}
        {!appts && !error && <p className="muted">Loading&hellip;</p>}
        {appts && appts.length === 0 && <p className="muted small">No appointments this day.</p>}

        <ul className="agenda">
          {appts?.map((a) => (
            <li key={a.id} className={`agenda-row status-${a.status}`}>
              <div className="agenda-time">
                <b>{fmtTime(a.startsAt)}</b>
                <span className="muted small">{fmtTime(a.endsAt)}</span>
              </div>
              <div className="agenda-body">
                <div className="agenda-line1">
                  <span className="agenda-client">{a.clientName}</span>
                  <span className={`status-badge s-${a.status}`}>{STATUS_LABEL[a.status]}</span>
                </div>
                <div className="muted small">
                  {a.serviceName} · {a.variantName} · {a.providerName}
                  {a.roomName ? ` · ${a.roomName}` : ""} · {fmtPrice(a.priceCents)}
                </div>
                {a.notes && <div className="muted small agenda-notes">“{a.notes}”</div>}
                {canManage && (
                  <div className="agenda-actions">
                    <button className="link-btn" onClick={() => setEditor({ mode: "edit", appt: a })}>
                      Edit
                    </button>
                    {a.status === "booked" && (
                      <>
                        <button className="link-btn" onClick={() => void setStatus(a, "completed")}>
                          Complete
                        </button>
                        <button className="link-btn muted" onClick={() => void setStatus(a, "no_show")}>
                          No-show
                        </button>
                        <button className="link-btn muted" onClick={() => void setStatus(a, "cancelled")}>
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function BookingForm({
  catalog,
  providers,
  defaultDate,
  editing,
  onClose,
  onSaved,
}: {
  catalog: Catalog;
  providers: Provider[];
  defaultDate: string;
  editing?: Appointment;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = !!editing;
  const init = useMemo(() => {
    if (editing) {
      const d = new Date(editing.startsAt);
      return {
        clientId: editing.clientId,
        clientName: editing.clientName,
        serviceVariantId: editing.serviceVariantId,
        providerId: editing.providerId,
        roomId: editing.roomId ?? "",
        date: toDateInput(d),
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        notes: editing.notes ?? "",
      };
    }
    return {
      clientId: "",
      clientName: "",
      serviceVariantId: "",
      providerId: providers[0]?.id ?? "",
      roomId: "",
      date: defaultDate,
      time: "09:00",
      notes: "",
    };
  }, [editing, providers, defaultDate]);

  const [clientId, setClientId] = useState(init.clientId);
  const [clientName, setClientName] = useState(init.clientName);
  const [serviceVariantId, setServiceVariantId] = useState(init.serviceVariantId);
  const [providerId, setProviderId] = useState(init.providerId);
  const [roomId, setRoomId] = useState(init.roomId);
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [notes, setNotes] = useState(init.notes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const activeServices = catalog.services.filter((s) => s.isActive && s.variants.some((v) => v.isActive));
  const activeRooms = catalog.rooms.filter((r) => r.isActive);

  const submit = async () => {
    setErr(null);
    if (!clientId) return setErr("Choose a client.");
    if (!serviceVariantId) return setErr("Choose a service.");
    if (!providerId) return setErr("Choose a provider.");
    if (!date || !time) return setErr("Pick a date and time.");
    const startsAt = new Date(`${date}T${time}`).toISOString();
    const payload = { clientId, providerId, serviceVariantId, roomId: roomId || null, startsAt, notes };
    setBusy(true);
    try {
      if (isEdit) {
        await api(`/appointments/${editing!.id}`, "PATCH", payload);
      } else {
        await api("/appointments", "POST", payload);
      }
      await onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <header>
        <button className="link-btn" onClick={onClose}>
          ‹ Back to calendar
        </button>
        <h1>{isEdit ? "Edit appointment" : "Book appointment"}</h1>
      </header>

      <section className="card">
        <label className="field">
          <span>Client</span>
          {isEdit ? (
            <input className="input" value={clientName} disabled />
          ) : (
            <ClientPicker
              value={clientId}
              displayName={clientName}
              onPick={(id, name) => {
                setClientId(id);
                setClientName(name);
              }}
            />
          )}
        </label>

        <label className="field">
          <span>Service</span>
          <select className="input" value={serviceVariantId} onChange={(e) => setServiceVariantId(e.target.value)}>
            <option value="">Choose a service&hellip;</option>
            {activeServices.map((s) => (
              <optgroup key={s.id} label={s.name}>
                {s.variants
                  .filter((v) => v.isActive)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.durationMinutes} min · {fmtPrice(v.priceCents)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>

        <div className="form-row">
          <label className="field" style={{ flex: 1 }}>
            <span>Provider</span>
            <select className="input" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Room</span>
            <select className="input" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">No room</option>
              {activeRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-row">
          <label className="field" style={{ flex: 1 }}>
            <span>Date</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Start time</span>
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>Notes (optional)</span>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Booking notes (not clinical)" />
        </label>

        {err && <p className="bad small">{err}</p>}
        <div className="editor-actions">
          <button className="btn primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving\u2026" : isEdit ? "Save changes" : "Book it"}
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </>
  );
}

function ClientPicker({
  value,
  displayName,
  onPick,
}: {
  value: string;
  displayName: string;
  onPick: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(!value);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        const res = await api<{ clients: ClientListItem[] }>(`/clients?${params.toString()}`);
        setResults(res.clients.slice(0, 8));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  if (!open && value) {
    return (
      <div className="picker-selected">
        <span>{displayName}</span>
        <button className="link-btn" onClick={() => setOpen(true)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="picker">
      <input
        className="input"
        placeholder="Search clients by name, email, or phone"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <div className="picker-results">
        {loading && <div className="muted small picker-empty">Searching&hellip;</div>}
        {!loading && results.length === 0 && (
          <div className="muted small picker-empty">No clients found. Add them in the Clients tab first.</div>
        )}
        {results.map((c) => (
          <button
            key={c.id}
            className="picker-option"
            onClick={() => {
              onPick(c.id, c.displayName);
              setOpen(false);
            }}
          >
            <span>{c.displayName}</span>
            <span className="muted small">{[c.email, c.phone].filter(Boolean).join(" · ")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
