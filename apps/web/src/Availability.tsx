import { useEffect, useState } from "react";
import type { TimeOff, WorkingHour } from "@prodigy/contracts";
import { api } from "./api";

const DAYS: { dow: number; label: string }[] = [
  { dow: 1, label: "Monday" },
  { dow: 2, label: "Tuesday" },
  { dow: 3, label: "Wednesday" },
  { dow: 4, label: "Thursday" },
  { dow: 5, label: "Friday" },
  { dow: 6, label: "Saturday" },
  { dow: 0, label: "Sunday" },
];
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });

type Range = { start: string; end: string };

export function ProviderAvailability({ providerId }: { providerId: string }) {
  return (
    <>
      <HoursEditor providerId={providerId} />
      <TimeOffEditor providerId={providerId} />
    </>
  );
}

function HoursEditor({ providerId }: { providerId: string }) {
  const [byDay, setByDay] = useState<Record<number, Range[]>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api<{ hours: WorkingHour[] }>(`/staff/${providerId}/hours`);
      const map: Record<number, Range[]> = {};
      for (const h of r.hours) (map[h.dayOfWeek] ??= []).push({ start: toHHMM(h.startMinute), end: toHHMM(h.endMinute) });
      setByDay(map);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    void load();
  }, [providerId]);

  const update = (dow: number, ranges: Range[]) => setByDay({ ...byDay, [dow]: ranges });
  const addRange = (dow: number) => update(dow, [...(byDay[dow] ?? []), { start: "09:00", end: "17:00" }]);
  const removeRange = (dow: number, i: number) => update(dow, (byDay[dow] ?? []).filter((_, j) => j !== i));
  const setRange = (dow: number, i: number, key: keyof Range, val: string) =>
    update(dow, (byDay[dow] ?? []).map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  const quickWeekdays = () => {
    const next = { ...byDay };
    for (const d of [1, 2, 3, 4, 5]) next[d] = [{ start: "09:00", end: "17:00" }];
    setByDay(next);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const hours: WorkingHour[] = [];
    for (const { dow } of DAYS) {
      for (const r of byDay[dow] ?? []) {
        const s = toMin(r.start);
        const e = toMin(r.end);
        if (e <= s) {
          setMsg("Each time range must start before it ends.");
          setBusy(false);
          return;
        }
        hours.push({ dayOfWeek: dow, startMinute: s, endMinute: e });
      }
    }
    try {
      await api(`/staff/${providerId}/hours`, "PUT", { hours });
      setMsg("Hours saved.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <section className="card"><h2>Working hours</h2><p className="muted">Loading&hellip;</p></section>;

  return (
    <section className="card">
      <div className="ticket-head">
        <h2>Working hours</h2>
        <button className="link-btn" onClick={quickWeekdays}>Set Mon–Fri 9–5</button>
      </div>
      <p className="muted small" style={{ marginTop: -4 }}>These hours drive the open-slot suggestions when booking.</p>
      {DAYS.map(({ dow, label }) => (
        <div key={dow} className="hours-day">
          <div className="hours-day-label">{label}</div>
          <div className="hours-ranges">
            {(byDay[dow] ?? []).length === 0 && <span className="muted small">Closed</span>}
            {(byDay[dow] ?? []).map((r, i) => (
              <div key={i} className="hours-range">
                <input type="time" className="input mini-time" value={r.start} onChange={(e) => setRange(dow, i, "start", e.target.value)} />
                <span className="muted">–</span>
                <input type="time" className="input mini-time" value={r.end} onChange={(e) => setRange(dow, i, "end", e.target.value)} />
                <button className="link-btn muted line-x" onClick={() => removeRange(dow, i)} title="Remove">✕</button>
              </div>
            ))}
            <button className="link-btn" onClick={() => addRange(dow)}>+ hours</button>
          </div>
        </div>
      ))}
      {msg && <p className="muted small">{msg}</p>}
      <div className="editor-actions">
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving\u2026" : "Save hours"}
        </button>
      </div>
    </section>
  );
}

function TimeOffEditor({ providerId }: { providerId: string }) {
  const [items, setItems] = useState<TimeOff[] | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api<{ timeOff: TimeOff[] }>(`/staff/${providerId}/time-off`).then((r) => setItems(r.timeOff)).catch((e) => setErr((e as Error).message));
  useEffect(() => {
    void load();
  }, [providerId]);

  const add = async () => {
    if (!startDate) return setErr("Pick a start date.");
    setBusy(true);
    setErr(null);
    try {
      await api(`/staff/${providerId}/time-off`, "POST", {
        startDate,
        endDate: endDate || startDate,
        allDay,
        startMinute: allDay ? null : toMin(startTime),
        endMinute: allDay ? null : toMin(endTime),
        reason: reason.trim() || null,
      });
      setStartDate("");
      setEndDate("");
      setReason("");
      setAllDay(true);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await api(`/staff/${providerId}/time-off/${id}`, "DELETE");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <section className="card">
      <h2>Time off</h2>
      <p className="muted small" style={{ marginTop: -4 }}>Block vacations or appointments so those times don&rsquo;t show as available.</p>
      <ul className="plain-list">
        {items?.map((t) => (
          <li key={t.id} className="list-row">
            <div>
              <div className="list-title">
                {fmtDate(t.startDate)}
                {t.endDate !== t.startDate ? ` – ${fmtDate(t.endDate)}` : ""}
              </div>
              <div className="muted small">
                {t.allDay ? "All day" : `${toHHMM(t.startMinute ?? 0)}–${toHHMM(t.endMinute ?? 0)}`}
                {t.reason ? ` · ${t.reason}` : ""}
              </div>
            </div>
            <button className="link-btn muted" onClick={() => void remove(t.id)}>Remove</button>
          </li>
        ))}
        {items && items.length === 0 && <li className="muted small">No time off scheduled.</li>}
      </ul>

      <div className="form-row">
        <label className="field" style={{ flex: 1 }}>
          <span>From</span>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>To (optional)</span>
          <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      <label className="checkline">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
        <span className="small">All day</span>
      </label>
      {!allDay && (
        <div className="form-row">
          <label className="field" style={{ maxWidth: 140 }}>
            <span>Start</span>
            <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className="field" style={{ maxWidth: 140 }}>
            <span>End</span>
            <input type="time" className="input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
      )}
      <input className="input" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginTop: 4 }} />
      {err && <p className="bad small">{err}</p>}
      <div className="editor-actions">
        <button className="btn" disabled={busy} onClick={() => void add()}>
          {busy ? "Adding\u2026" : "Add time off"}
        </button>
      </div>
    </section>
  );
}
