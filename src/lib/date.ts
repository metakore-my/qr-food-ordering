// Single source of truth for date display + report bucketing in the deployment's
// timezone. Callers pass `(await getSettings()).timezone`; the param default is a
// fallback for legacy sync callers. Never inline a `timeZone` literal elsewhere.
const DEFAULT_TIMEZONE = "Asia/Bangkok";

/** Format a date to "5 Feb 2026, 14:30" in the given timezone (24h). */
export function formatDeploymentDateTime(
  date: string | Date,
  timeZone = DEFAULT_TIMEZONE
): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
}

/** Format a date to "5 Feb 2026" (no time) in the given timezone. */
export function formatDeploymentDate(
  date: string | Date,
  timeZone = DEFAULT_TIMEZONE
): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

/** Format a date to "5 Feb" (day + short month) in the given timezone. */
export function formatDeploymentDayMonth(
  date: string | Date,
  timeZone = DEFAULT_TIMEZONE
): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
  }).format(new Date(date));
}

/**
 * Per-hour bucket formatter for the given timezone. Use `.formatToParts(date)` to
 * assemble a `YYYY-MM-DD HH:00` key. Shared so reports + exports bucket alike.
 */
export function hourlyBucketFormatter(
  timeZone = DEFAULT_TIMEZONE
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Minutes `timeZone`'s wall clock is ahead of UTC at `date` (Bangkok → +420).
 * Diffs the zone's wall-clock fields against the same instant read as UTC, so
 * it's DST-correct.
 */
function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Hour can come back as "24" at midnight in some engines; normalize to 0.
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second")
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * UTC `Date` for local midnight of `date`'s calendar day in `timeZone` — the
 * correct "start of today" query boundary. `setHours(0,0,0,0)` on a UTC server
 * yields UTC midnight (07:00 Bangkok), wrongly excluding early-morning orders.
 */
export function startOfDayInZone(date: Date, timeZone: string): Date {
  // Calendar Y/M/D as seen in the target zone (may differ from the UTC date).
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const y = get("year");
  const m = get("month");
  const d = get("day");

  // Treat local midnight as UTC, then shift back by the zone offset to get the
  // true UTC instant. Exact for the whole-hour, DST-free zones (TH/MY/SG/VN).
  const wallMidnightAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const offset = zoneOffsetMinutes(new Date(wallMidnightAsUtc), timeZone);
  return new Date(wallMidnightAsUtc - offset * 60000);
}

/** Start of today (local midnight) in the given timezone, as a UTC `Date`. */
export function startOfTodayInDeploymentZone(
  timeZone = DEFAULT_TIMEZONE
): Date {
  return startOfDayInZone(new Date(), timeZone);
}

/** @deprecated Alias for `formatDeploymentDateTime`; remove after callers migrate. */
export const formatBangkokDateTime = formatDeploymentDateTime;
