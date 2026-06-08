import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type { ClassRosterEntry, ClassSession, ClientListItem } from "@prodigy/contracts";

const fmtWhen = (iso: string): string => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export function ClassesPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("scheduling.manage");
  const [classes, setClasses] = useState<ClassSession[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [capacity, setCapacity] = useState("10");
  const [saving, setSaving] = useState(false);

  const load = () =>
    api<{ classes: ClassSession[] }>("/classes?upcoming=true")
      .then((r) => setClasses(r.classes))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setError(null);
    if (!name.trim()) return setError("Name the class.");
    if (!startsAt || !endsAt) return setError("Set start and end times.");
    setSaving(true);
    try {
      await api("/classes", "POST", {
        name: name.trim(),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        capacity: parseInt(capacity, 10) || 1,
      });
      setAdding(false);
      setName("");
      setStartsAt("");
      setEndsAt("");
      setCapacity("10");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (open) return <RosterView classId={open} canWrite={canWrite} onBack={() => { setOpen(null); void load(); }} />;

  return (
    <>
      {canWrite && (
        <section className="card">
          {!adding ? (
            <button className="btn primary" onClick={() => setAdding(true)}>
              Schedule a class
            </button>
          ) : (
            <>
              <h2>Schedule a class</h2>
              <div className="form-row">
                <label className="field">
                  <span>Class name</span>
                  <input className="input" placeholder="e.g. Restorative Yoga" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="field" style={{ maxWidth: 130 }}>
                  <span>Capacity</span>
                  <input className="input" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
                </label>
              </div>
              <div className="form-row">
                <label className="field">
                  <span>Starts</span>
                  <input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </label>
                <label className="field">
                  <span>Ends</span>
                  <input className="input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </label>
              </div>
              {error && <p className="bad small">{error}</p>}
              <div className="editor-actions">
                <button className="btn" onClick={() => { setAdding(false); setError(null); }}>Cancel</button>
                <button className="btn primary" disabled={saving} onClick={() => void create()}>
                  {saving ? "Saving…" : "Schedule class"}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card">
        <h2>Upcoming classes</h2>
        {error && !adding && <p className="bad small">{error}</p>}
        {!classes && <p className="muted">Loading&hellip;</p>}
        {classes && classes.length === 0 && <p className="muted small">No upcoming classes scheduled.</p>}
        {classes && classes.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>When</th>
                <th className="num">Enrolled</th>
                <th className="num">Spots left</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setOpen(c.id)}>
                  <td className="list-title">{c.name}</td>
                  <td>{fmtWhen(c.startsAt)}</td>
                  <td className="num">{c.enrolledCount}/{c.capacity}</td>
                  <td className="num">
                    {c.spotsLeft > 0 ? c.spotsLeft : <span className="status-badge s-pending">Full</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function RosterView({ classId, canWrite, onBack }: { classId: string; canWrite: boolean; onBack: () => void }) {
  const [cls, setCls] = useState<ClassSession | null>(null);
  const [roster, setRoster] = useState<ClassRosterEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ClientListItem[]>([]);

  const load = () =>
    api<{ class: ClassSession; roster: ClassRosterEntry[] }>(`/classes/${classId}/roster`)
      .then((r) => { setCls(r.class); setRoster(r.roster); })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    let live = true;
    const t = setTimeout(() => {
      api<{ clients: ClientListItem[] }>(`/clients?search=${encodeURIComponent(search.trim())}`)
        .then((r) => live && setResults(r.clients.slice(0, 6)))
        .catch(() => {});
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [search]);

  const enroll = async (clientId: string) => {
    setError(null);
    try {
      await api(`/classes/${classId}/enroll`, "POST", { clientId });
      setSearch("");
      setResults([]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const mark = async (enrollmentId: string, status: string) => {
    setError(null);
    try {
      await api(`/enrollments/${enrollmentId}/status`, "POST", { status });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const active = roster.filter((r) => r.status !== "cancelled");

  return (
    <section className="card">
      <button className="link-btn" onClick={onBack}>‹ Back to classes</button>
      {cls && (
        <div className="ticket-head">
          <h2>{cls.name}</h2>
          <span className="muted small">{fmtWhen(cls.startsAt)} · {cls.enrolledCount}/{cls.capacity} enrolled{cls.spotsLeft === 0 ? " · full" : ""}</span>
        </div>
      )}
      {error && <p className="bad small">{error}</p>}

      {canWrite && cls && (
        <div className="field" style={{ marginBottom: 12 }}>
          <span>Enroll a client {cls.spotsLeft === 0 && <span className="bad small">— class is full; use the waitlist</span>}</span>
          <input className="input" placeholder="Search by name, email, or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          {results.length > 0 && (
            <ul className="plain-list" style={{ marginTop: 6 }}>
              {results.map((c) => (
                <li key={c.id} className="list-row clickable" onClick={() => void enroll(c.id)}>
                  <span className="list-title">{c.displayName}</span>
                  {c.email && <span className="muted small">{c.email}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <h3>Roster</h3>
      {active.length === 0 && <p className="muted small">No one enrolled yet.</p>}
      {active.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Status</th>
              {canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {active.map((e) => (
              <tr key={e.enrollmentId}>
                <td>{e.clientName}</td>
                <td className="cap">{e.status.replace("_", " ")}</td>
                {canWrite && (
                  <td className="num">
                    <button className="link-btn" onClick={() => void mark(e.enrollmentId, "attended")}>Attended</button>
                    <button className="link-btn muted" onClick={() => void mark(e.enrollmentId, "no_show")} style={{ marginLeft: 8 }}>No-show</button>
                    <button className="link-btn muted" onClick={() => void mark(e.enrollmentId, "cancelled")} style={{ marginLeft: 8 }}>Remove</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
