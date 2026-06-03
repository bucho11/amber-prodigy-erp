import { useEffect, useState } from "react";
import type { Appointment, ClientIntake, Provider, SoapNote, SoapNoteListItem } from "@prodigy/contracts";
import { api } from "./api";
import { useAuth } from "./auth";

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });

export function ClinicalSection({ clientId }: { clientId: string }) {
  const { hasPermission } = useAuth();
  const canView = hasPermission("clinical.view");
  const canManage = hasPermission("clinical.manage");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);

  useEffect(() => {
    if (!canView) return;
    api<{ providers: Provider[] }>("/providers").then((r) => setProviders(r.providers)).catch(() => {});
    api<{ appointments: Appointment[] }>(`/appointments?clientId=${clientId}`)
      .then((r) => setAppts(r.appointments))
      .catch(() => {});
  }, [canView, clientId]);

  if (!canView) return null;

  return (
    <>
      <p className="eyebrow" style={{ marginTop: 8 }}>Clinical &mdash; visible only to staff with clinical access</p>
      <IntakeBlock clientId={clientId} canManage={canManage} />
      <SoapBlock clientId={clientId} canManage={canManage} providers={providers} appts={appts} />
    </>
  );
}

// ---------------- intake ----------------
const PREG = (v: boolean | null) => (v === true ? "yes" : v === false ? "no" : "");
function IntakeBlock({ clientId, canManage }: { clientId: string; canManage: boolean }) {
  const [intake, setIntake] = useState<ClientIntake | null>(null);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api<{ intake: ClientIntake }>(`/clients/${clientId}/intake`).then((r) => setIntake(r.intake)).catch((e) => setErr((e as Error).message));
  useEffect(() => {
    void load();
  }, [clientId]);

  if (!intake) return <section className="card"><h2>Health intake</h2><p className="muted">Loading&hellip;</p></section>;

  if (editing) return <IntakeForm intake={intake} clientId={clientId} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await load(); }} />;

  const row = (label: string, val: string | null) =>
    val ? (
      <div className="totline" key={label}>
        <span className="muted small">{label}</span>
        <span style={{ textAlign: "right", maxWidth: "65%" }}>{val}</span>
      </div>
    ) : null;

  return (
    <section className="card">
      <div className="ticket-head">
        <h2>Health intake</h2>
        {canManage && <button className="link-btn" onClick={() => setEditing(true)}>{intake.hasIntake ? "Edit" : "Add intake"}</button>}
      </div>
      {err && <p className="bad small">{err}</p>}
      {!intake.hasIntake && <p className="muted small">No intake recorded yet.</p>}
      {intake.hasIntake && (
        <div className="totals" style={{ borderTop: "none", paddingTop: 0 }}>
          {row("Reason for visit", intake.reasonForVisit)}
          {row("Medical conditions", intake.medicalConditions)}
          {row("Medications", intake.medications)}
          {row("Allergies", intake.allergies)}
          {row("Surgeries", intake.surgeries)}
          {row("Injuries", intake.injuries)}
          {intake.pregnant !== null && row("Pregnant", intake.pregnant ? "Yes" : "No")}
          {row("Pressure preference", intake.pressurePreference)}
          {row("Areas to avoid", intake.areasToAvoid)}
          {row("Notes", intake.notes)}
          <div className="totline">
            <span className="muted small">Consent to treat</span>
            <span>
              {intake.consentToTreat ? (
                <span className="result-ok">
                  Signed{intake.signatureName ? ` by ${intake.signatureName}` : ""}
                  {intake.signedAt ? ` · ${new Date(intake.signedAt).toLocaleDateString()}` : ""}
                </span>
              ) : (
                <span className="muted">Not on file</span>
              )}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function IntakeForm({ intake, clientId, onClose, onSaved }: { intake: ClientIntake; clientId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({
    reasonForVisit: intake.reasonForVisit ?? "",
    medicalConditions: intake.medicalConditions ?? "",
    medications: intake.medications ?? "",
    allergies: intake.allergies ?? "",
    surgeries: intake.surgeries ?? "",
    injuries: intake.injuries ?? "",
    pregnant: PREG(intake.pregnant),
    pressurePreference: intake.pressurePreference ?? "",
    areasToAvoid: intake.areasToAvoid ?? "",
    notes: intake.notes ?? "",
    consentToTreat: intake.consentToTreat,
    signatureName: intake.signatureName ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const u = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    if (f.consentToTreat && !f.signatureName.trim()) return setErr("Enter the client's name to record consent.");
    setBusy(true);
    setErr(null);
    try {
      await api(`/clients/${clientId}/intake`, "PUT", {
        ...f,
        pregnant: f.pregnant === "" ? null : f.pregnant === "yes",
      });
      await onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const field = (label: string, k: keyof typeof f, area = false) => (
    <label className="field">
      <span>{label}</span>
      {area ? (
        <textarea className="input" rows={2} value={f[k] as string} onChange={u(k)} />
      ) : (
        <input className="input" value={f[k] as string} onChange={u(k)} />
      )}
    </label>
  );

  return (
    <section className="card">
      <h2>Health intake</h2>
      {field("Reason for visit", "reasonForVisit")}
      {field("Medical conditions", "medicalConditions", true)}
      <div className="form-row">
        {field("Medications", "medications")}
        {field("Allergies", "allergies")}
      </div>
      <div className="form-row">
        {field("Surgeries", "surgeries")}
        {field("Injuries", "injuries")}
      </div>
      <div className="form-row">
        <label className="field" style={{ maxWidth: 160 }}>
          <span>Pregnant</span>
          <select className="input" value={f.pregnant} onChange={u("pregnant")}>
            <option value="">Not specified</option>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        {field("Pressure preference", "pressurePreference")}
      </div>
      {field("Areas to avoid", "areasToAvoid")}
      {field("Notes", "notes", true)}

      <label className="checkline" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={f.consentToTreat} onChange={(e) => setF({ ...f, consentToTreat: e.target.checked })} />
        <span className="small">Client consents to treatment</span>
      </label>
      {f.consentToTreat && (
        <label className="field">
          <span>Signature (type client&rsquo;s name)</span>
          <input className="input" value={f.signatureName} onChange={u("signatureName")} placeholder="Client's full name" />
        </label>
      )}

      {err && <p className="bad small">{err}</p>}
      <div className="editor-actions">
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving\u2026" : "Save intake"}
        </button>
        <button className="btn" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  );
}

// ---------------- SOAP notes ----------------
function SoapBlock({ clientId, canManage, providers, appts }: { clientId: string; canManage: boolean; providers: Provider[]; appts: Appointment[] }) {
  const [notes, setNotes] = useState<SoapNoteListItem[] | null>(null);
  const [editing, setEditing] = useState<{ mode: "new" } | { mode: "edit"; note: SoapNote } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api<{ notes: SoapNoteListItem[] }>(`/clients/${clientId}/soap-notes`).then((r) => setNotes(r.notes)).catch((e) => setErr((e as Error).message));
  useEffect(() => {
    void load();
  }, [clientId]);

  const open = async (id: string) => {
    try {
      const r = await api<{ note: SoapNote }>(`/soap-notes/${id}`);
      setEditing({ mode: "edit", note: r.note });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (editing) {
    return (
      <SoapForm
        clientId={clientId}
        providers={providers}
        appts={appts}
        existing={editing.mode === "edit" ? editing.note : undefined}
        readOnly={!canManage}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    );
  }

  return (
    <section className="card">
      <div className="ticket-head">
        <h2>Visit notes (SOAP)</h2>
        {canManage && <button className="link-btn" onClick={() => setEditing({ mode: "new" })}>+ Add note</button>}
      </div>
      {err && <p className="bad small">{err}</p>}
      {!notes && <p className="muted">Loading&hellip;</p>}
      {notes && notes.length === 0 && <p className="muted small">No visit notes yet.</p>}
      <ul className="plain-list">
        {notes?.map((n) => (
          <li key={n.id} className="list-row clickable" onClick={() => void open(n.id)}>
            <div>
              <div className="list-title">{fmtDate(n.date)}</div>
              <div className="muted small">{n.providerName || "No provider"}</div>
            </div>
            <span className="chev">›</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SoapForm({
  clientId,
  providers,
  appts,
  existing,
  readOnly,
  onClose,
  onSaved,
}: {
  clientId: string;
  providers: Provider[];
  appts: Appointment[];
  existing?: SoapNote;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [date, setDate] = useState(existing?.date ?? today());
  const [providerId, setProviderId] = useState(existing?.providerId ?? "");
  const [appointmentId, setAppointmentId] = useState(existing?.appointmentId ?? "");
  const [s, setS] = useState(existing?.subjective ?? "");
  const [o, setO] = useState(existing?.objective ?? "");
  const [a, setA] = useState(existing?.assessment ?? "");
  const [p, setP] = useState(existing?.plan ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    const body = {
      date,
      providerId: providerId || null,
      appointmentId: appointmentId || null,
      subjective: s.trim() || null,
      objective: o.trim() || null,
      assessment: a.trim() || null,
      plan: p.trim() || null,
    };
    try {
      if (existing) await api(`/soap-notes/${existing.id}`, "PATCH", body);
      else await api(`/clients/${clientId}/soap-notes`, "POST", body);
      await onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const soapField = (label: string, hint: string, val: string, setVal: (v: string) => void) => (
    <label className="field">
      <span>
        {label} <span className="muted small">{hint}</span>
      </span>
      <textarea className="input" rows={2} value={val} onChange={(e) => setVal(e.target.value)} disabled={readOnly} />
    </label>
  );

  return (
    <section className="card">
      <button className="link-btn" onClick={onClose}>
        ‹ Back to visit notes
      </button>
      <h2>{existing ? "Visit note" : "New visit note"}</h2>
      <div className="form-row">
        <label className="field" style={{ maxWidth: 180 }}>
          <span>Date</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={readOnly} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>Provider</span>
          <select className="input" value={providerId} onChange={(e) => setProviderId(e.target.value)} disabled={readOnly}>
            <option value="">&mdash;</option>
            {providers.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Linked appointment (optional)</span>
        <select className="input" value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)} disabled={readOnly}>
          <option value="">&mdash;</option>
          {appts.map((ap) => (
            <option key={ap.id} value={ap.id}>
              {new Date(ap.startsAt).toLocaleDateString()} · {ap.variantName}
            </option>
          ))}
        </select>
      </label>
      {soapField("Subjective", "what the client reports", s, setS)}
      {soapField("Objective", "what you observe / findings", o, setO)}
      {soapField("Assessment", "your evaluation", a, setA)}
      {soapField("Plan", "treatment & next steps", p, setP)}

      {err && <p className="bad small">{err}</p>}
      {!readOnly && (
        <div className="editor-actions">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving\u2026" : existing ? "Save note" : "Save note"}
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
