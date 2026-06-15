/**
 * Client-safe locale-aware clock-hour and weekday formatters for the analytics
 * dashboard charts. These render in the LOCALE THEY ARE GIVEN — pass the viewer's
 * active UI locale (next-intl `useLocale()`), NOT the deployment default, so an
 * English-viewing admin doesn't see Bahasa "5 PTG" labels. Pure + unit-tested in
 * `clock-format.test.ts`.
 *
 * Distinct from `date.ts` (server-side, timeZone-parameterized export formatting):
 * these are browser `Intl`-bound chart-axis helpers where only the hour/weekday
 * matters, not a real timestamp.
 */

/**
 * Format a clock hour (0–23) as a friendly localized time like "6 PM" / "18:00".
 * Uses a fixed UTC reference date so only the hour matters; the locale decides
 * 12h vs 24h presentation.
 */
export function formatClockHour(hour: number, locale: string): string {
  const d = new Date(Date.UTC(2000, 0, 1, hour % 24, 0, 0));
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * Localized weekday name from an ISO weekday (1=Mon…7=Sun). 2001-01-01 was a
 * Monday, so Date.UTC(2001,0,iso) lands on the right day for iso 1–7.
 * `short` = "Mon"/"จ."/"周一"; `long` = "Monday" for the highlight card.
 */
export function formatWeekday(
  iso: number,
  locale: string,
  style: "short" | "long" = "short"
): string {
  const d = new Date(Date.UTC(2001, 0, iso)); // iso 1 → Mon Jan 1 2001
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(d);
}
