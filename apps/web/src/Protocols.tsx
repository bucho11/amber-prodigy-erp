import { useEffect, useMemo, useState } from "react";
import type {
  Appointment,
  ApplyProtocolResult,
  Catalog,
  Protocol,
  ProtocolInstance,
  ProtocolListItem,
  Provider,
} from "@prodigy/contracts";
import { api } from "./api";
import { useAuth } from "./auth";
import { ClientPicker } from "./Schedule";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtPrice = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = (dateStr: string) =>
  new Date(`${dateStr}T00:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

interface VariantOption {
  id: string;
  label: string;
}
function variantOptions(catalog: Catalog): VariantOption[] {
  const out: VariantOption[] = [];
  for (const s of catalog.services.filter((x) => x.isActive)) {
    for (const v of s.variants.filter((x) => x.isActive)) {
      out.push({ id: v.id, label: `${s.name} · ${v.name} (${v.durationMinutes}m · ${fmtPrice(v.priceCents)})` });
    }
  }
  return out;
}

export function ProtocolsAdmin() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("scheduling.manage");
  const [view, setView] = useState<"templates" | "plans">("templates");
  const [protocols, setProtocols] = useState<ProtocolListItem[] | null>(null);
  const [instances, setInstances] = useState<ProtocolInstance[] | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editor, setEditor] = useState<{ mode: "new" } | { mode: "edit"; protocol: Protocol } | null>(null);
  const [applying, setApplying] = useState<ProtocolListItem | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<{ providers: Provider[] }>("/providers"), api<Catalog>("/catalog")])
      .then(([p, c]) => {
        setProviders(p.providers);
        setCatalog(c);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const loadProtocols = async () => {
    try {
      const r = await api<{ protocols: ProtocolListItem[] }>("/protocols");
      setProtocols(r.protocols);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const loadInstances = async () => {
    try {
      const r = await api<{ instances: ProtocolInstance[] }>("/protocol-instances");
      setInstances(r.instances);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void loadProtocols();
    void loadInstances();
  }, []);

  const openEdit = async (id: string) => {
    try {
      const r = await api<{ protocol: Protocol }>(`/protocols/${id}`);
      setEditor({ mode: "edit", protocol: r.protocol });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const toggleArchive = async (p: ProtocolListItem) => {
    try {
      await api(`/protocols/${p.id}`, "PATCH", { isActive: !p.isActive });
      await loadProtocols();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (editor && catalog) {
    return (
      <ProtocolEditor
        catalog={catalog}
        editing={editor.mode === "edit" ? editor.protocol : undefined}
        onClose={() => setEditor(null)}
        onSaved={async () => {
          setEditor(null);
          await loadProtocols();
        }}
      />
    );
  }
  if (applying && catalog) {
    return (
      <ApplyForm
        template={applying}
        providers={providers}
        catalog={catalog}
        onClose={() => setApplying(null)}
        onApplied={async () => {
          await loadInstances();
        }}
        onDone={() => {
          setApplying(null);
          setView("plans");
        }}
      />
    );
  }
  if (viewing) {
    return (
      <InstanceDetail
        id={viewing}
        canManage={canManage}
        onClose={() => setViewing(null)}
        onChanged={async () => {
          await loadInstances();
        }}
      />
    );
  }

  return (
    <>
      <header>
        <p className="eyebrow">Recovery protocols</p>
        <h1>Protocols</h1>
        <p className="sub">
          Define a recovery plan once, then apply it to a client from their procedure date — the whole series of sessions
          gets booked automatically.
        </p>
      </header>

      <div className="subtabs">
        <button className={view === "templates" ? "subtab active" : "subtab"} onClick={() => setView("templates")}>
          Protocol templates
        </button>
        <button className={view === "plans" ? "subtab active" : "subtab"} onClick={() => setView("plans")}>
          Active plans
        </button>
      </div>

      {error && <p className="bad small">{error}</p>}

      {view === "templates" && (
        <section className="card">
          {canManage && (
            <div className="row-actions">
              <button className="btn primary" onClick={() => setEditor({ mode: "new" })}>
                + New protocol
              </button>
            </div>
          )}
          {!protocols && <p className="muted">Loading&hellip;</p>}
          {protocols && protocols.length === 0 && (
            <p className="muted small">No protocols yet. Create one to start auto-scheduling recovery plans.</p>
          )}
          <ul className="plain-list">
            {protocols?.map((p) => (
              <li key={p.id} className={`list-row${p.isActive ? "" : " inactive"}`}>
                <div>
                  <div className="list-title">
                    {p.name}
                    {!p.isActive && <span className="status-badge s-cancelled">Archived</span>}
                  </div>
                  <div className="muted small">
                    {p.stepCount} session{p.stepCount === 1 ? "" : "s"} over {p.spanDays} day{p.spanDays === 1 ? "" : "s"}
                    {p.description ? ` · ${p.description}` : ""}
                  </div>
                </div>
                <div className="list-row-actions">
                  {canManage && p.isActive && (
                    <button className="btn sm primary" onClick={() => setApplying(p)}>
                      Apply
                    </button>
                  )}
                  {canManage && (
                    <button className="link-btn" onClick={() => void openEdit(p.id)}>
                      Edit
                    </button>
                  )}
                  {canManage && (
                    <button className="link-btn muted" onClick={() => void toggleArchive(p)}>
                      {p.isActive ? "Archive" : "Restore"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === "plans" && (
        <section className="card">
          {!instances && <p className="muted">Loading&hellip;</p>}
          {instances && instances.length === 0 && (
            <p className="muted small">No active plans yet. Apply a protocol to a client to create one.</p>
          )}
          <ul className="plain-list">
            {instances?.map((inst) => (
              <li key={inst.id} className="list-row clickable" onClick={() => setViewing(inst.id)}>
                <div>
                  <div className="list-title">
                    {inst.clientName}
                    <span className={`status-badge s-${inst.status === "active" ? "booked" : inst.status}`}>{inst.status}</span>
                  </div>
                  <div className="muted small">
                    {inst.protocolName} · starts {fmtDate(inst.anchorDate)} · {inst.providerName} · {inst.appointmentCount}{" "}
                    session{inst.appointmentCount === 1 ? "" : "s"}
                  </div>
                </div>
                <span className="chev">›</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

type StepDraft = { dayOffset: number; timeOfDay: string; serviceVariantId: string; label: string };

function ProtocolEditor({
  catalog,
  editing,
  onClose,
  onSaved,
}: {
  catalog: Catalog;
  editing?: Protocol;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const opts = useMemo(() => variantOptions(catalog), [catalog]);
  const firstVariant = opts[0]?.id ?? "";
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [steps, setSteps] = useState<StepDraft[]>(
    editing
      ? editing.steps.map((s) => ({
          dayOffset: s.dayOffset,
          timeOfDay: s.timeOfDay ?? "",
          serviceVariantId: s.serviceVariantId,
          label: s.label ?? "",
        }))
      : [{ dayOffset: 0, timeOfDay: "", serviceVariantId: firstVariant, label: "" }]
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setStep = (i: number, patch: Partial<StepDraft>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addStep = () => {
    const lastDay = steps.length ? steps[steps.length - 1].dayOffset : -1;
    setSteps((prev) => [...prev, { dayOffset: lastDay + 1, timeOfDay: "", serviceVariantId: firstVariant, label: "" }]);
  };
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    setErr(null);
    if (!name.trim()) return setErr("Give the protocol a name.");
    if (steps.length === 0) return setErr("Add at least one session.");
    if (opts.length === 0) return setErr("Add a service in Services & Rooms first.");
    const payloadSteps = [...steps]
      .sort((a, b) => a.dayOffset - b.dayOffset)
      .map((s) => ({
        dayOffset: s.dayOffset,
        timeOfDay: s.timeOfDay || null,
        serviceVariantId: s.serviceVariantId,
        label: s.label.trim() || null,
      }));
    setBusy(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null, steps: payloadSteps };
      if (editing) await api(`/protocols/${editing.id}`, "PATCH", body);
      else await api("/protocols", "POST", body);
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
          ‹ Back to protocols
        </button>
        <h1>{editing ? "Edit protocol" : "New protocol"}</h1>
      </header>

      <section className="card">
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Post-Op Lymphatic Recovery" />
        </label>
        <label className="field">
          <span>Description (optional)</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When to use this plan" />
        </label>

        <div className="steps-head">
          <span>Sessions</span>
          <span className="muted small">Day 0 = the client&rsquo;s procedure / start date</span>
        </div>
        <div className="steps-list">
          {steps.map((s, i) => (
            <div className="step-row" key={i}>
              <label>
                <span className="muted small">Day</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={s.dayOffset}
                  onChange={(e) => setStep(i, { dayOffset: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <label>
                <span className="muted small">Time (optional)</span>
                <input className="input" type="time" value={s.timeOfDay} onChange={(e) => setStep(i, { timeOfDay: e.target.value })} />
              </label>
              <label className="grow">
                <span className="muted small">Service</span>
                <select className="input" value={s.serviceVariantId} onChange={(e) => setStep(i, { serviceVariantId: e.target.value })}>
                  {opts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grow">
                <span className="muted small">Label (optional)</span>
                <input className="input" value={s.label} onChange={(e) => setStep(i, { label: e.target.value })} placeholder="e.g. Initial drainage" />
              </label>
              <button className="link-btn muted step-remove" onClick={() => removeStep(i)} title="Remove session">
                ✕
              </button>
            </div>
          ))}
        </div>
        <button className="btn sm" onClick={addStep}>
          + Add session
        </button>

        {err && <p className="bad small">{err}</p>}
        <div className="editor-actions">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving\u2026" : editing ? "Save protocol" : "Create protocol"}
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </>
  );
}

function ApplyForm({
  template,
  providers,
  catalog,
  onClose,
  onApplied,
  onDone,
}: {
  template: ProtocolListItem;
  providers: Provider[];
  catalog: Catalog;
  onClose: () => void;
  onApplied: () => Promise<void>;
  onDone: () => void;
}) {
  const [full, setFull] = useState<Protocol | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [roomId, setRoomId] = useState("");
  const [anchorDate, setAnchorDate] = useState(toDateInput(new Date()));
  const [defaultTime, setDefaultTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyProtocolResult | null>(null);

  const activeRooms = catalog.rooms.filter((r) => r.isActive);

  useEffect(() => {
    api<{ protocol: Protocol }>(`/protocols/${template.id}`)
      .then((r) => setFull(r.protocol))
      .catch((e) => setErr((e as Error).message));
  }, [template.id]);

  const preview = useMemo(() => {
    if (!full) return [];
    return full.steps.map((s) => ({
      date: addDaysStr(anchorDate, s.dayOffset),
      time: s.timeOfDay || defaultTime,
      label: s.label,
      service: `${s.serviceName ?? ""} · ${s.variantName ?? ""}`,
    }));
  }, [full, anchorDate, defaultTime]);

  const apply = async () => {
    setErr(null);
    if (!clientId) return setErr("Choose a client.");
    if (!providerId) return setErr("Choose a provider.");
    setBusy(true);
    try {
      const r = await api<ApplyProtocolResult>(`/protocols/${template.id}/apply`, "POST", {
        clientId,
        providerId,
        roomId: roomId || null,
        anchorDate,
        defaultTime,
      });
      setResult(r);
      await onApplied();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <>
        <header>
          <h1>{template.name} applied</h1>
        </header>
        <section className="card">
          <p className="result-ok">
            Booked {result.created.length} of {result.created.length + result.skipped.length} sessions for{" "}
            {result.instance.clientName}.
          </p>
          <ul className="preview-list">
            {result.created.map((a: Appointment) => (
              <li key={a.id}>
                <span>{fmtDateTime(a.startsAt)}</span>
                <span className="muted small">{a.notes || `${a.serviceName} · ${a.variantName}`}</span>
              </li>
            ))}
          </ul>
          {result.skipped.length > 0 && (
            <>
              <p className="result-skip">{result.skipped.length} left unbooked (a conflict at that time):</p>
              <ul className="preview-list">
                {result.skipped.map((s) => (
                  <li key={s.stepNumber}>
                    <span>Session {s.stepNumber} (day {s.dayOffset})</span>
                    <span className="muted small">{s.reason}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">You can book those manually from the Calendar.</p>
            </>
          )}
          <div className="editor-actions">
            <button className="btn primary" onClick={onDone}>
              Done
            </button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <header>
        <button className="link-btn" onClick={onClose}>
          ‹ Back to protocols
        </button>
        <h1>Apply: {template.name}</h1>
      </header>

      <section className="card">
        <label className="field">
          <span>Client</span>
          <ClientPicker
            value={clientId}
            displayName={clientName}
            onPick={(id, n) => {
              setClientId(id);
              setClientName(n);
            }}
          />
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
            <span>Start date (day 0)</span>
            <input className="input" type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Default time</span>
            <input className="input" type="time" value={defaultTime} onChange={(e) => setDefaultTime(e.target.value)} />
          </label>
        </div>

        <div className="steps-head">
          <span>Schedule preview</span>
          <span className="muted small">{preview.length} sessions</span>
        </div>
        {!full && <p className="muted small">Loading sessions&hellip;</p>}
        <ul className="preview-list">
          {preview.map((p, i) => (
            <li key={i}>
              <span>
                {fmtDate(p.date)} · {p.time}
              </span>
              <span className="muted small">{p.label || p.service}</span>
            </li>
          ))}
        </ul>

        {err && <p className="bad small">{err}</p>}
        <div className="editor-actions">
          <button className="btn primary" disabled={busy || !full} onClick={() => void apply()}>
            {busy ? "Booking\u2026" : "Book the series"}
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </>
  );
}

function InstanceDetail({
  id,
  canManage,
  onClose,
  onChanged,
}: {
  id: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [instance, setInstance] = useState<ProtocolInstance | null>(null);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await api<{ instance: ProtocolInstance; appointments: Appointment[] }>(`/protocol-instances/${id}`);
      setInstance(r.instance);
      setAppts(r.appointments);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, [id]);

  const cancel = async () => {
    setBusy(true);
    try {
      await api(`/protocol-instances/${id}/cancel`, "POST");
      await load();
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header>
        <button className="link-btn" onClick={onClose}>
          ‹ Back to plans
        </button>
        <h1>{instance ? `${instance.clientName} — ${instance.protocolName}` : "Plan"}</h1>
      </header>

      <section className="card">
        {err && <p className="bad small">{err}</p>}
        {!instance && <p className="muted">Loading&hellip;</p>}
        {instance && (
          <>
            <div className="muted small detail-meta">
              Starts {fmtDate(instance.anchorDate)} · {instance.providerName}
              {instance.roomName ? ` · ${instance.roomName}` : ""} ·{" "}
              <span className={`status-badge s-${instance.status === "active" ? "booked" : instance.status}`}>{instance.status}</span>
            </div>
            <ul className="agenda">
              {appts.map((a) => (
                <li key={a.id} className={`agenda-row status-${a.status}`}>
                  <div className="agenda-time">
                    <b>{new Date(a.startsAt).toLocaleDateString([], { month: "short", day: "numeric" })}</b>
                    <span className="muted small">{new Date(a.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  </div>
                  <div className="agenda-body">
                    <div className="agenda-line1">
                      <span className="agenda-client">{a.serviceName} · {a.variantName}</span>
                      <span className={`status-badge s-${a.status}`}>{a.status}</span>
                    </div>
                    {a.notes && <div className="muted small">{a.notes}</div>}
                  </div>
                </li>
              ))}
            </ul>
            {appts.length === 0 && <p className="muted small">No sessions were booked for this plan.</p>}
            {canManage && instance.status === "active" && (
              <div className="editor-actions">
                <button className="btn" disabled={busy} onClick={() => void cancel()}>
                  {busy ? "Cancelling\u2026" : "Cancel remaining sessions"}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
