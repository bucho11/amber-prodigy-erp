import { query, withTransaction } from "./index";
import { zonedWallTimeToUtc, addDays, utcToZonedParts, dayOfWeekFor } from "./time";
import type { WorkingHour, TimeOff, DayAvailability, BusyBlock } from "@prodigy/contracts";

const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dateOnly = (v: string | Date): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// ---------- working hours ----------
export async function getHours(tenantId: string, providerId: string): Promise<WorkingHour[]> {
  const rows = await query<{ day_of_week: number; start_minute: number; end_minute: number }>(
    `SELECT day_of_week, start_minute, end_minute FROM provider_hours
     WHERE tenant_id = $1 AND provider_id = $2 ORDER BY day_of_week, start_minute`,
    [tenantId, providerId]
  );
  return rows.map((r) => ({ dayOfWeek: r.day_of_week, startMinute: r.start_minute, endMinute: r.end_minute }));
}

export async function setHours(tenantId: string, providerId: string, hours: WorkingHour[]): Promise<WorkingHour[]> {
  await withTransaction(async (q) => {
    await q(`DELETE FROM provider_hours WHERE tenant_id = $1 AND provider_id = $2`, [tenantId, providerId]);
    for (const h of hours) {
      await q(
        `INSERT INTO provider_hours (tenant_id, provider_id, day_of_week, start_minute, end_minute)
         VALUES ($1, $2::bigint, $3, $4, $5)`,
        [tenantId, providerId, h.dayOfWeek, h.startMinute, h.endMinute]
      );
    }
  });
  return getHours(tenantId, providerId);
}

// ---------- time off ----------
interface TimeOffRow {
  id: string;
  start_date: string | Date;
  end_date: string | Date;
  all_day: boolean;
  start_minute: number | null;
  end_minute: number | null;
  reason: string | null;
}
function mapTimeOff(r: TimeOffRow): TimeOff {
  return {
    id: r.id,
    startDate: dateOnly(r.start_date),
    endDate: dateOnly(r.end_date),
    allDay: r.all_day,
    startMinute: r.start_minute,
    endMinute: r.end_minute,
    reason: r.reason,
  };
}

export async function listTimeOff(tenantId: string, providerId: string): Promise<TimeOff[]> {
  const rows = await query<TimeOffRow>(
    `SELECT id::text AS id, start_date, end_date, all_day, start_minute, end_minute, reason
     FROM provider_time_off WHERE tenant_id = $1 AND provider_id = $2
     ORDER BY start_date DESC LIMIT 200`,
    [tenantId, providerId]
  );
  return rows.map(mapTimeOff);
}

export interface TimeOffInput {
  startDate: string;
  endDate: string;
  allDay: boolean;
  startMinute: number | null;
  endMinute: number | null;
  reason: string | null;
}
export async function addTimeOff(tenantId: string, providerId: string, input: TimeOffInput): Promise<TimeOff> {
  const rows = await query<{ id: string }>(
    `INSERT INTO provider_time_off (tenant_id, provider_id, start_date, end_date, all_day, start_minute, end_minute, reason)
     VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, $8) RETURNING id::text AS id`,
    [tenantId, providerId, input.startDate, input.endDate, input.allDay, input.startMinute, input.endMinute, input.reason]
  );
  const all = await listTimeOff(tenantId, providerId);
  return all.find((t) => t.id === rows[0].id) ?? mapTimeOff({ ...(input as unknown as TimeOffRow), id: rows[0].id });
}

export async function removeTimeOff(tenantId: string, providerId: string, id: string): Promise<boolean> {
  const rows = await query(
    `DELETE FROM provider_time_off WHERE tenant_id = $1 AND provider_id = $2 AND id = $3 RETURNING id`,
    [tenantId, providerId, id]
  );
  return rows.length > 0;
}

// ---------- interval math ----------
type Iv = [number, number];
function merge(ivs: Iv[]): Iv[] {
  const sorted = [...ivs].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Iv[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
/** allowed minus blocked → free intervals. */
function subtract(allowed: Iv[], blocked: Iv[]): Iv[] {
  const blk = merge(blocked);
  const out: Iv[] = [];
  for (const [a0, b0] of merge(allowed)) {
    let cursor = a0;
    for (const [ba, bb] of blk) {
      if (bb <= cursor || ba >= b0) continue;
      if (ba > cursor) out.push([cursor, Math.min(ba, b0)]);
      cursor = Math.max(cursor, bb);
      if (cursor >= b0) break;
    }
    if (cursor < b0) out.push([cursor, b0]);
  }
  return out.filter(([a, b]) => b > a);
}

// ---------- availability ----------
export async function computeAvailability(
  tenantId: string,
  providerId: string,
  dateStr: string,
  durationMinutes: number,
  timeZone: string,
  stepMinutes = 15
): Promise<DayAvailability> {
  const dow = dayOfWeekFor(dateStr, timeZone);

  // 1) working windows for this weekday
  const hours = await getHours(tenantId, providerId);
  const windows: Iv[] = merge(hours.filter((h) => h.dayOfWeek === dow).map((h) => [h.startMinute, h.endMinute] as Iv));

  // 2) time off intersecting this date → blocked intervals
  const offRows = await query<TimeOffRow>(
    `SELECT id::text AS id, start_date, end_date, all_day, start_minute, end_minute, reason
     FROM provider_time_off
     WHERE tenant_id = $1 AND provider_id = $2 AND start_date <= $3 AND end_date >= $3`,
    [tenantId, providerId, dateStr]
  );
  const busy: BusyBlock[] = [];
  const blocked: Iv[] = [];
  for (const r of offRows) {
    const a = r.all_day || r.start_minute === null ? 0 : r.start_minute;
    const b = r.all_day || r.end_minute === null ? 1440 : r.end_minute;
    blocked.push([a, b]);
    busy.push({ start: hhmm(a), end: hhmm(b), label: r.reason ? `Time off — ${r.reason}` : "Time off" });
  }

  // 3) existing appointments for this provider on this date
  const dayStart = zonedWallTimeToUtc(dateStr, "00:00", timeZone);
  const dayEnd = zonedWallTimeToUtc(addDays(dateStr, 1), "00:00", timeZone);
  const appts = await query<{ starts_at: string; ends_at: string; client_name: string | null }>(
    `SELECT a.starts_at, a.ends_at, c.display_name AS client_name
     FROM appointments a LEFT JOIN clients c ON c.id = a.client_id
     WHERE a.tenant_id = $1 AND a.provider_id = $2
       AND a.status NOT IN ('cancelled', 'no_show')
       AND a.starts_at < $4 AND a.ends_at > $3
     ORDER BY a.starts_at`,
    [tenantId, providerId, dayStart, dayEnd]
  );
  for (const ap of appts) {
    const sp = utcToZonedParts(new Date(ap.starts_at).toISOString(), timeZone);
    const ep = utcToZonedParts(new Date(ap.ends_at).toISOString(), timeZone);
    const a = sp.date < dateStr ? 0 : sp.minutes;
    const b = ep.date > dateStr ? 1440 : ep.minutes;
    if (b <= a) continue;
    blocked.push([a, b]);
    busy.push({ start: hhmm(a), end: hhmm(b), label: ap.client_name || "Appointment" });
  }

  // 4) free = windows − blocked; then slots where the service fits
  const free = subtract(windows, blocked);
  const openSlots: string[] = [];
  for (const [a, b] of free) {
    let t = Math.ceil(a / stepMinutes) * stepMinutes;
    while (t + durationMinutes <= b) {
      openSlots.push(hhmm(t));
      t += stepMinutes;
    }
  }

  busy.sort((x, y) => x.start.localeCompare(y.start));
  return {
    date: dateStr,
    dayOfWeek: dow,
    timezone: timeZone,
    durationMinutes,
    workingWindows: windows.map(([a, b]) => ({ start: hhmm(a), end: hhmm(b) })),
    busy,
    openSlots,
  };
}
