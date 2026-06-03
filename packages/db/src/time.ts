/**
 * Timezone-correct conversion of a wall-clock time in an IANA timezone to UTC.
 *
 * The server generates protocol appointments, so it must turn "2026-06-10 10:00 in
 * America/Los_Angeles" into the right UTC instant — accounting for DST. We use Intl
 * to read the zone's offset at a candidate instant, then correct (twice, to settle
 * DST boundary cases).
 */

function offsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === "24" ? "00" : map.hour;
  const asIfUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(hour),
    Number(map.minute),
    Number(map.second)
  );
  return asIfUtc - utcMs;
}

/**
 * @param dateStr 'YYYY-MM-DD'
 * @param timeStr 'HH:MM' (24h)
 * @param timeZone IANA zone, e.g. 'America/Los_Angeles'
 * @returns ISO-8601 UTC string for that wall-clock moment in the zone
 */
export function zonedWallTimeToUtc(dateStr: string, timeStr: string, timeZone: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  let utc = guess - offsetMs(guess, timeZone);
  const refined = guess - offsetMs(utc, timeZone);
  if (refined !== utc) utc = refined;
  return new Date(utc).toISOString();
}

/** Add a whole number of days to a 'YYYY-MM-DD' string, returning 'YYYY-MM-DD'. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}


const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Convert a UTC instant into local wall-clock parts for an IANA zone. */
export function utcToZonedParts(utcIso: string, timeZone: string): { date: string; minutes: number; dayOfWeek: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcIso))) map[p.type] = p.value;
  const hour = map.hour === "24" ? "00" : map.hour;
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    minutes: Number(hour) * 60 + Number(map.minute),
    dayOfWeek: WEEKDAY_INDEX[map.weekday] ?? 0,
  };
}

/** Day-of-week (0=Sun..6=Sat) of a local calendar date in the given zone. */
export function dayOfWeekFor(dateStr: string, timeZone: string): number {
  return utcToZonedParts(zonedWallTimeToUtc(dateStr, "12:00", timeZone), timeZone).dayOfWeek;
}
