import { formatMoney, type MoneyOptions } from "./money";
import { resolveOptionName, type SelectedOption } from "@/lib/option-utils";
export type { LocalizedName, SelectedOption } from "@/lib/option-utils";
import { routing } from "@/i18n/routing";
import { startOfDayInZone, endOfDayInZone, formatDeploymentDate } from "./date";

export const RANGE_MS: Record<string, number> = {
  "1h": 1 * 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  // 90d matches the COMPLETED-order retention window (cron cleanup Group 1) — the
  // longest range a merchant can query is the longest we keep settled-sale records.
  "90d": 90 * 24 * 60 * 60 * 1000,
};

/** Resolved query window: [cutoff, until) plus a human label for sheets/UI. */
export interface ResolvedRange {
  cutoff: Date; // inclusive start (createdAt >= cutoff)
  until: Date; // exclusive end   (createdAt <  until)
  label: string; // friendly text, e.g. "Last 90 days" or "1 Jan 2025 – 31 Mar 2025"
  mode: "preset" | "custom";
}

/** Thrown by resolveRange on bad input → caller returns 400 with this code. */
export class RangeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "RangeError";
  }
}

// Custom ranges are capped to the COMPLETED-order retention horizon — querying
// further back is pointless (the data was reaped) and bounds the worst-case scan.
const MAX_CUSTOM_RANGE_DAYS = 90;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a `YYYY-MM-DD` string to a UTC midnight Date, rejecting calendar-invalid
 * dates. `new Date("2026-02-30")` does NOT return Invalid Date — JS silently
 * overflows the day into the next month (→ Mar 2), so an `isNaN` check alone
 * lets bogus dates through and snaps the report window to the wrong day. We
 * round-trip the parsed components back to the input and reject any mismatch, so
 * Feb-30 / Apr-31 style overflows are caught. (The `ISO_DATE_RE` shape check
 * runs at the call site before this.) Returns null on any invalid date.
 */
function parseIsoDateUtc(s: string): Date | null {
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null; // overflowed (e.g. 2026-02-30) or otherwise invalid
  }
  return date;
}

/**
 * Resolve a report time window from query params, in the deployment timezone.
 * Two modes (single source of truth for all three report endpoints so they can't
 * drift): a rolling **preset** (`range=1h|3h|12h|1d|7d|30d|90d`, window = now-N),
 * or a **custom** explicit window (`from`/`to` as `YYYY-MM-DD`, snapped to
 * local-day boundaries: `from` 00:00 inclusive → `to` next-midnight exclusive,
 * so the whole `to` day is included). Custom takes precedence when `from`+`to`
 * are both present. Throws `RangeError` (→ 400) on a bad preset, malformed dates,
 * `from > to`, or a span beyond the 90-day retention horizon.
 */
export function resolveRange(
  params: URLSearchParams,
  timeZone: string,
  now: Date = new Date()
): ResolvedRange {
  const from = params.get("from");
  const to = params.get("to");

  // Custom mode — both bounds required.
  if (from || to) {
    if (!from || !to) {
      throw new RangeError("INVALID_RANGE", "Both from and to are required for a custom range");
    }
    if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
      throw new RangeError("INVALID_RANGE", "Dates must be YYYY-MM-DD");
    }
    const fromDate = parseIsoDateUtc(from);
    const toDate = parseIsoDateUtc(to);
    if (!fromDate || !toDate) {
      throw new RangeError("INVALID_RANGE", "Unparseable or invalid calendar date");
    }
    if (fromDate.getTime() > toDate.getTime()) {
      throw new RangeError("INVALID_RANGE", "from must be on or before to");
    }
    const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
    if (spanDays > MAX_CUSTOM_RANGE_DAYS) {
      throw new RangeError(
        "RANGE_TOO_LARGE",
        `Custom range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days`
      );
    }
    const cutoff = startOfDayInZone(fromDate, timeZone);
    const until = endOfDayInZone(toDate, timeZone);
    return {
      cutoff,
      until,
      label: `${formatDeploymentDate(cutoff, timeZone)} – ${formatDeploymentDate(toDate, timeZone)}`,
      mode: "custom",
    };
  }

  // Preset mode (default 1d).
  const range = params.get("range") || "1d";
  const ms = RANGE_MS[range];
  if (!ms) {
    throw new RangeError(
      "INVALID_RANGE",
      "Invalid range. Use: 1h, 3h, 12h, 1d, 7d, 30d, 90d — or from/to dates"
    );
  }
  return {
    cutoff: new Date(now.getTime() - ms),
    until: now,
    label: range,
    mode: "preset",
  };
}

/**
 * Resolve an order line's display name. Prefers the live `menuItem.names` join
 * (active locale → canonical) so each viewer sees their own language; the
 * order-time `snapshot` (`OrderItem.itemName`, canonical locale) is the
 * fallback that keeps a line readable after a menu DELETE (live join gone) or
 * a missing translation — then any live name, then `"Unknown"`. Snapshot-first
 * was deliberately rejected: it rendered the canonical locale to every viewer
 * on every surface, losing localization for the common (undeleted) case. Pass
 * `snapshot` from `item.itemName` on every order-line read path.
 */
export function getItemName(
  names: { locale: string; name: string }[],
  locale: string,
  canonicalLocale: string,
  snapshot?: string | null
): string {
  const loc = names.find((n) => n.locale === locale);
  const canon = names.find((n) => n.locale === canonicalLocale);
  return loc?.name || canon?.name || snapshot || names[0]?.name || "Unknown";
}

/**
 * Parse an `OrderItem.selectedOptions` JSON snapshot defensively.
 * The column is free-form `@db.Text`; never let a malformed row throw and
 * 500 a whole report — fall back to an empty selection. Shared by every
 * report endpoint so the parse safety can't drift between them.
 */
export function parseSelectedOptions(selectedOptions: string): SelectedOption[] {
  try {
    const parsed = JSON.parse(selectedOptions);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Render an option snapshot as a single human-readable string for exports,
 * grouping choices by option group: `Size: Large +฿10 / Spice: Hot`.
 * Returns "" when there are no options. Shared by the Excel export routes.
 * `money` carries the runtime currency/decimals/locale for price formatting.
 */
export function formatOptions(
  selectedOptions: string,
  money: MoneyOptions,
  locale?: string,
  canonical?: string
): string {
  const loc = locale ?? canonical ?? "";
  const can = canonical ?? locale ?? "";
  const opts = parseSelectedOptions(selectedOptions);
  if (!opts.length) return "";
  const grouped = new Map<string, string[]>();
  for (const o of opts) {
    const key = resolveOptionName(o.groupName ?? "", loc, can);
    const cName = resolveOptionName(o.choiceName, loc, can);
    const arr = grouped.get(key) || [];
    const label = o.priceAdjustment
      ? `${cName} +${formatMoney(o.priceAdjustment, money)}`
      : cName;
    arr.push(label);
    grouped.set(key, arr);
  }
  return Array.from(grouped.entries())
    .map(([group, choices]) => (group ? `${group}: ${choices.join(", ")}` : choices.join(", ")))
    .join(" / ");
}

/**
 * Per-line gross revenue for an order item: `unitPrice × quantity`. Single source
 * of truth so the dashboard, the Excel/CSV export, and the unit tests credit a
 * "Large +RM10" upsell identically.
 *
 * **`unitPrice` is the option-INCLUSIVE snapshot.** Placement stores
 * `computeUnitPrice = roundMoney(effectiveBasePrice + optionPriceTotal)`
 * (`order-utils.ts`) verbatim as `OrderItem.unitPrice` (`place-order.ts`), so the
 * adjustment of every selected option is ALREADY baked into `unitPrice`. Therefore
 * revenue must NOT re-add the `selectedOptions` adjustments — doing so double-counts
 * every paid option and makes the per-item/category/Pareto revenue exceed the
 * headline order total (which is its own `unitPrice × qty` sum, `computeOrderTotal`).
 * `selectedOptions` is intentionally not read here. The figure is order-time-accurate
 * and immune to later menu edits because `unitPrice` is a write-once snapshot.
 * Negative (discount) adjustments are likewise already reflected in `unitPrice`.
 */
export function lineRevenue(item: {
  unitPrice: number | { toString(): string };
  quantity: number;
  // Accepted for call-site convenience (callers pass full OrderItem rows) but
  // deliberately NOT read — option adjustments are already inside `unitPrice`.
  selectedOptions?: string;
}): number {
  return Number(item.unitPrice) * item.quantity;
}

/**
 * Prepend a UTF-8 BOM (EF BB BF) to a CSV byte buffer. Excel-for-Windows opens a
 * BOM-less UTF-8 CSV in the system ANSI codepage and garbles Thai/Vietnamese/Chinese
 * text; the BOM tells it the file is UTF-8. Idempotent — if the buffer already starts
 * with a BOM, it's returned unchanged (so this is safe to apply to any CSV buffer).
 * The single source of truth for both CSV export routes so they can't drift.
 */
export function withUtf8Bom(buffer: Uint8Array | ArrayBuffer): Uint8Array {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes; // already has a BOM — don't double-add
  }
  const out = new Uint8Array(bytes.length + 3);
  out[0] = 0xef;
  out[1] = 0xbb;
  out[2] = 0xbf;
  out.set(bytes, 3);
  return out;
}

/** A single CSV cell value. `null`/`undefined` render as an empty field. */
export type CsvCell = string | number | null | undefined;

/**
 * Serialize a grid of rows to an RFC-4180 CSV string — WITHOUT loading exceljs.
 * The CSV export path used to spin up a full exceljs workbook just to call
 * `.csv.writeBuffer()`, which resident-loads ~30 MB of the exceljs module graph
 * for the life of the (always-awake) process. CSV rows are plain strings/numbers,
 * so build them directly: quote a field only when it contains a comma, double-quote,
 * CR or LF; escape embedded double-quotes by doubling; cells joined by `,`, rows by
 * CRLF (the RFC-4180 line terminator Excel expects). UTF-8 (Thai/CJK) needs no
 * escaping — pair with `withUtf8Bom` so Excel-for-Windows reads it correctly.
 */
export function toCsv(rows: CsvCell[][]): string {
  const escapeCell = (cell: CsvCell): string => {
    if (cell == null) return "";
    const str = String(cell);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

/** One clock-hour bucket: 0–23 with its order count and share of the total. */
export interface ClockHourBucket {
  hour: number; // 0–23 in the deployment timezone
  count: number;
  percentage: number; // share of all orders in the window, 1 decimal
}

/** A contiguous run of busy clock-hours, e.g. 18:00–20:00 ("6–8 PM"). */
export interface PeakWindow {
  startHour: number; // inclusive, 0–23
  endHour: number; // exclusive end-of-last-hour, 1–24 (so 18→20 means "18:00–20:00")
  count: number;
  percentage: number; // share of all orders, 1 decimal
}

export interface ClockHourProfile {
  buckets: ClockHourBucket[]; // always 24 entries, hour 0…23 ascending
  totalOrders: number;
  peak: PeakWindow | null; // busiest contiguous window, or null when no orders
  // A SECOND distinct rush (e.g. lunch when `peak` is dinner), present only when
  // the business is genuinely bimodal — see the detection rule below. null when
  // there's no clear second peak.
  secondPeak: PeakWindow | null;
  // The quietest contiguous window — the inverse of the peak, for promo targeting
  // ("Tuesdays 2–4 PM are dead → run an offer"). null when no orders.
  quietest: PeakWindow | null;
  // true when the day is broadly FLAT (no hour stands out as a real rush), so the
  // UI says "steady through the day" instead of manufacturing a misleading peak.
  steady: boolean;
}

/**
 * Collapse a window's orders into a 24-hour CLOCK profile (all days summed into
 * one 0–23 axis in the deployment timezone) and extract the busiest contiguous
 * window(s) — the *answer* to "when are we slammed?", not a 2160-bar wall the
 * merchant has to eyeball on a 90-day range.
 *
 * The peak window is grown greedily from the single busiest hour: include an
 * adjacent hour (on whichever side is busier) while that hour carries at least
 * `PEAK_NEIGHBOUR_FRACTION` of the busiest hour's volume, so "6–8 PM" reads as one
 * rush rather than three separate hours. Wrap-around (e.g. 23→0) is intentionally
 * NOT handled — F&B service windows don't straddle midnight for this product, and
 * a linear window keeps the label honest.
 *
 * Three additions over a single greedy window, because real F&B isn't unimodal:
 * - **secondPeak**: the common MY/SG/TH case is lunch + dinner with a dead
 *   afternoon between. A single greedy window reports only one rush and silently
 *   hides the other (an owner told "peak is dinner" understaffs lunch). After the
 *   first window we look OUTSIDE it for an hour ≥ `SECOND_PEAK_FRACTION` of the
 *   global peak hour and grow a second window from it.
 * - **steady**: a flat all-day stall (kopitiam) has no real rush; reporting any
 *   window oversells. When the peak hour is < `FLAT_PEAK_RATIO`× the mean hour
 *   (averaged over hours that actually have orders), we flag `steady` so the UI
 *   says "steady through the day" instead.
 * - **quietest**: the lowest contiguous run among hours that have at least one
 *   order — for promo targeting.
 */
const PEAK_NEIGHBOUR_FRACTION = 0.6;
const SECOND_PEAK_FRACTION = 0.7; // an out-of-window hour this fraction of the peak hour = a real 2nd rush
const FLAT_PEAK_RATIO = 1.5; // peak hour must beat the active-hour mean by this much to count as a rush
const FLAT_MIN_ACTIVE_HOURS = 4; // need this many active hours before "flat" is even meaningful

/** Grow a contiguous window outward from `seed`, including neighbours ≥ threshold. */
function growWindow(counts: number[], seed: number, threshold: number): { start: number; end: number } {
  let start = seed;
  let end = seed; // inclusive
  for (;;) {
    const left = start - 1;
    const right = end + 1;
    const leftVal = left >= 0 ? counts[left] : -1;
    const rightVal = right <= 23 ? counts[right] : -1;
    if (leftVal < threshold && rightVal < threshold) break;
    if (rightVal >= leftVal && rightVal >= threshold) end = right;
    else if (leftVal >= threshold) start = left;
    else break;
  }
  return { start, end };
}

/** Build a PeakWindow from an inclusive [start,end] hour range and total. */
function windowFrom(counts: number[], start: number, end: number, total: number): PeakWindow {
  let c = 0;
  for (let h = start; h <= end; h++) c += counts[h];
  return {
    startHour: start,
    endHour: end + 1, // exclusive end-of-last-hour
    count: c,
    percentage: total > 0 ? Math.round((c / total) * 1000) / 10 : 0,
  };
}

export function clockHourProfile(
  orders: { createdAt: Date }[],
  timeZone: string
): ClockHourProfile {
  const counts = new Array(24).fill(0) as number[];
  const hourFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  });
  for (const order of orders) {
    // "00".."23" in the deployment zone; en-GB hour12:false yields "24" at midnight
    // on some engines — normalise that to 0.
    const raw = Number(hourFmt.format(order.createdAt));
    const hour = Number.isFinite(raw) ? raw % 24 : 0;
    counts[hour] += 1;
  }

  const total = counts.reduce((a, b) => a + b, 0);
  const buckets: ClockHourBucket[] = counts.map((count, hour) => ({
    hour,
    count,
    percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
  }));

  if (total === 0) {
    return { buckets, totalOrders: 0, peak: null, secondPeak: null, quietest: null, steady: false };
  }

  // Global busiest hour.
  let peakHour = 0;
  for (let h = 1; h < 24; h++) {
    if (counts[h] > counts[peakHour]) peakHour = h;
  }
  const peakVal = counts[peakHour];

  // Flat detection: mean over ACTIVE hours (hours with ≥1 order). A day where the
  // busiest hour barely beats the average isn't a rush, it's just "open". Only
  // meaningful with a real spread of active hours — with just 2–3 active spikes the
  // mean is inflated and "flat" misfires (two equal lunch/dinner spikes are
  // BIMODAL, not flat), so require FLAT_MIN_ACTIVE_HOURS before declaring steady.
  const activeHours = counts.filter((c) => c > 0).length;
  const activeMean = total / Math.max(activeHours, 1);
  const steady = activeHours >= FLAT_MIN_ACTIVE_HOURS && peakVal < activeMean * FLAT_PEAK_RATIO;

  // Primary window.
  const primary = growWindow(counts, peakHour, peakVal * PEAK_NEIGHBOUR_FRACTION);
  const peak = windowFrom(counts, primary.start, primary.end, total);

  // Second peak: the busiest hour OUTSIDE the primary window, if it's a real rush
  // (≥ SECOND_PEAK_FRACTION of the global peak hour). Only meaningful when not flat.
  let secondPeak: PeakWindow | null = null;
  if (!steady) {
    let secondHour = -1;
    for (let h = 0; h < 24; h++) {
      if (h >= primary.start && h <= primary.end) continue;
      if (secondHour === -1 || counts[h] > counts[secondHour]) secondHour = h;
    }
    if (secondHour !== -1 && counts[secondHour] >= peakVal * SECOND_PEAK_FRACTION) {
      const sec = growWindow(counts, secondHour, counts[secondHour] * PEAK_NEIGHBOUR_FRACTION);
      // Clamp the second window so it can't overlap the primary one.
      const ss = Math.max(sec.start, sec.end <= primary.start - 1 ? sec.start : primary.end + 1);
      const se = sec.end >= primary.start ? Math.min(sec.end, primary.start - 1) : sec.end;
      if (ss <= se) secondPeak = windowFrom(counts, ss, se, total);
      else secondPeak = windowFrom(counts, secondHour, secondHour, total);
    }
  }

  // Quietest contiguous run among ACTIVE hours (ignore the long closed stretch of
  // zero-order hours overnight — "quietest" means quietest while open, not 4 AM).
  let quietHour = -1;
  for (let h = 0; h < 24; h++) {
    if (counts[h] === 0) continue;
    if (quietHour === -1 || counts[h] < counts[quietHour]) quietHour = h;
  }
  let quietest: PeakWindow | null = null;
  if (quietHour !== -1) {
    // Grow over adjacent ACTIVE hours that are within 130% of the quietest hour.
    const qThresh = counts[quietHour] * 1.3;
    let qs = quietHour;
    let qe = quietHour;
    while (qs - 1 >= 0 && counts[qs - 1] > 0 && counts[qs - 1] <= qThresh) qs--;
    while (qe + 1 <= 23 && counts[qe + 1] > 0 && counts[qe + 1] <= qThresh) qe++;
    quietest = windowFrom(counts, qs, qe, total);
  }

  return { buckets, totalOrders: total, peak, secondPeak, quietest, steady };
}

/** One weekday bucket (Mon…Sun) with orders, items, and revenue. */
export interface DayOfWeekBucket {
  weekday: number; // 1 = Monday … 7 = Sunday (ISO), stable across locales
  orders: number;
  items: number;
  revenue: number;
  percentage: number; // share of all orders, 1 decimal
}

export interface DayOfWeekProfile {
  buckets: DayOfWeekBucket[]; // always 7 entries, Monday(1)…Sunday(7)
  totalOrders: number;
  busiestWeekday: number | null; // 1–7, or null when no orders
  quietestWeekday: number | null; // 1–7 among weekdays that HAVE orders, or null
}

// Map a JS getDay() (0=Sun…6=Sat) to ISO weekday (1=Mon…7=Sun) so Monday leads
// and the number is locale-stable (the UI maps it to a localized day name).
const ISO_WEEKDAY = [7, 1, 2, 3, 4, 5, 6];

/**
 * Bucket a window's orders by DAY OF WEEK (Mon…Sun) in the deployment timezone —
 * the answer to "which days make money", which the 24-hour clock profile can't
 * give (it sums all days together). Drives staffing/opening-hour decisions as
 * much as peak hours do. Carries orders/items/revenue per weekday so the UI can
 * toggle the same three denominators as the clock chart.
 *
 * Weekday is resolved from the deployment-zone calendar date (not UTC): an order
 * at 01:00 Monday Bangkok that is 18:00 Sunday UTC must count as MONDAY. We derive
 * the local Y-M-D via Intl, then read its weekday with a UTC Date built from those
 * parts (so the host TZ can't shift it back).
 */
export function dayOfWeekProfile(
  // items only need what lineRevenue reads (unitPrice × quantity) — selectedOptions
  // is no longer required since revenue stopped re-adding option adjustments.
  orders: { createdAt: Date; items: { unitPrice: number | { toString(): string }; quantity: number }[] }[],
  timeZone: string
): DayOfWeekProfile {
  const orderCount = new Array(8).fill(0) as number[]; // index 1..7 (0 unused)
  const itemCount = new Array(8).fill(0) as number[];
  const revenue = new Array(8).fill(0) as number[];

  const dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  for (const order of orders) {
    // "YYYY-MM-DD" in the deployment zone → a UTC noon Date so getUTCDay() reads
    // the intended calendar day regardless of the host process timezone.
    const [y, m, d] = dateFmt.format(order.createdAt).split("-").map(Number);
    const jsDay = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0=Sun..6=Sat
    const iso = ISO_WEEKDAY[jsDay]; // 1=Mon..7=Sun
    orderCount[iso] += 1;
    for (const item of order.items) {
      itemCount[iso] += item.quantity;
      revenue[iso] += lineRevenue(item);
    }
  }

  const total = orderCount.reduce((a, b) => a + b, 0);
  const buckets: DayOfWeekBucket[] = [];
  for (let w = 1; w <= 7; w++) {
    buckets.push({
      weekday: w,
      orders: orderCount[w],
      items: itemCount[w],
      revenue: Math.round(revenue[w] * 100) / 100,
      percentage: total > 0 ? Math.round((orderCount[w] / total) * 1000) / 10 : 0,
    });
  }

  if (total === 0) {
    return { buckets, totalOrders: 0, busiestWeekday: null, quietestWeekday: null };
  }

  let busiest = 1;
  for (let w = 2; w <= 7; w++) if (orderCount[w] > orderCount[busiest]) busiest = w;
  // Quietest only among weekdays that actually had orders (a day with zero orders
  // in a short window is "we were closed", not "our slow day").
  let quietest: number | null = null;
  for (let w = 1; w <= 7; w++) {
    if (orderCount[w] === 0) continue;
    if (quietest === null || orderCount[w] < orderCount[quietest]) quietest = w;
  }

  return { buckets, totalOrders: total, busiestWeekday: busiest, quietestWeekday: quietest };
}

/** Per-channel (dine-in OR takeaway) stat with each channel's share of totals. */
export interface ChannelStat {
  orders: number;
  revenue: number; // rounded to 2 dp
  orderShare: number; // % of total orders, 1 dp, 0 when no orders
  revenueShare: number; // % of total revenue, 1 dp, 0 when no revenue
}

export interface ChannelBreakdown {
  dineIn: ChannelStat;
  takeaway: ChannelStat;
  totalOrders: number;
  totalRevenue: number; // rounded to 2 dp
}

/**
 * Split COMPLETED orders into dine-in vs takeaway with order counts, revenue
 * (option-inclusive via lineRevenue), and each channel's share of the totals.
 * Revenue is summed from order items (same basis as every other dashboard
 * figure) — NOT order.totalAmount — so it can't drift from lineRevenue.
 * Shares are 1-dp percentages; a zero denominator yields 0 (never NaN/∞).
 */
export function channelBreakdown(
  orders: Array<{
    orderType: "DINE_IN" | "TAKEAWAY";
    items: Array<{ unitPrice: number | { toString(): string }; quantity: number }>;
  }>
): ChannelBreakdown {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const acc = {
    DINE_IN: { orders: 0, revenue: 0 },
    TAKEAWAY: { orders: 0, revenue: 0 },
  };
  for (const o of orders) {
    const rev = o.items.reduce((s, it) => s + lineRevenue(it), 0);
    acc[o.orderType].orders += 1;
    acc[o.orderType].revenue += rev;
  }
  const totalOrders = acc.DINE_IN.orders + acc.TAKEAWAY.orders;
  const totalRevenue = acc.DINE_IN.revenue + acc.TAKEAWAY.revenue;
  const stat = (c: { orders: number; revenue: number }): ChannelStat => ({
    orders: c.orders,
    revenue: round2(c.revenue),
    orderShare: totalOrders > 0 ? round1((c.orders / totalOrders) * 100) : 0,
    revenueShare: totalRevenue > 0 ? round1((c.revenue / totalRevenue) * 100) : 0,
  });
  return {
    dineIn: stat(acc.DINE_IN),
    takeaway: stat(acc.TAKEAWAY),
    totalOrders,
    totalRevenue: round2(totalRevenue),
  };
}

/**
 * A decision-grade item pairing for "frequently ordered together".
 *
 * Stated DIRECTIONALLY (anchor → withItem) because that's the sentence an owner
 * acts on: "80% of <anchor> orders also got <withItem>" is a cross-sell cue;
 * the symmetric raw count is not. `attachRate` is that percentage; `lift` ranks
 * which pairs are worth surfacing (see topItemPairs).
 */
export interface ItemPair {
  anchor: string; // the "if they bought THIS" item (display name)
  withItem: string; // the "they also bought THIS" item (display name)
  bothCount: number; // orders containing BOTH
  anchorCount: number; // orders containing the anchor
  attachRate: number; // bothCount / anchorCount, as a percentage (1 decimal)
  lift: number; // P(A∧B) / (P(A)·P(B)); >1 = together more than chance (1 decimal)
}

const PAIR_MIN_ANCHOR_ORDERS = 5; // support floor: ignore anchors seen in <5 orders (noise)
const PAIR_MIN_LIFT = 1.3; // only surface pairs that co-occur meaningfully above chance

/**
 * Find item pairs that are genuinely "ordered together" — and present them so a
 * non-analyst owner can act on them.
 *
 * Why not raw co-occurrence count: in a stall where most orders include a popular
 * drink, EVERY food item's top "pair" is that drink — raw counts just re-surface
 * "the drink is popular" (which the Top Items table already says) and bury the one
 * genuinely sticky combo. So we:
 *  1. Count distinct-item co-occurrence per order (a repeated item counts once; no
 *     self-pairs) AND per-item order counts, in the same pass.
 *  2. Compute lift = P(A and B) / (P(A) * P(B)). A drink in 80% of orders has
 *     lift ~1 with everything (not special); two mid-popularity items that truly
 *     go together score high. We rank by lift and require lift >= PAIR_MIN_LIFT.
 *  3. Apply a support floor (anchorCount >= PAIR_MIN_ANCHOR_ORDERS) so a pair seen
 *     2-3 times can't hit 100% attach rate on noise.
 *  4. Pick the DIRECTION with the higher attach rate for display, so the owner
 *     reads "80% of Pad Thai orders also got Thai Tea" (the actionable sentence),
 *     never the word "lift".
 *
 * Honest scope (unchanged): co-occurrence is within ONE order, not across a
 * table's multi-device session — right grain for a stall; the UI tooltips it.
 * `keyOf` is a stable per-item identity (menuItemId, or a snapshot-name key for
 * deleted lines) so a rename can't split a pair; `nameOf` maps it to a display name.
 */
export function topItemPairs<I>(
  orders: { items: I[] }[],
  keyOf: (item: I) => string,
  nameOf: (item: I) => string,
  limit = 5
): ItemPair[] {
  const SEP = "\0"; // NUL — can't appear in a menuItemId or a display name
  const itemOrderCount = new Map<string, number>(); // key -> #orders containing it
  const pairCount = new Map<string, number>(); // "ka<SEP>kb" (ka<kb) -> #orders with both
  const nameByKey = new Map<string, string>();
  let totalOrders = 0;

  for (const order of orders) {
    const keys = new Set<string>();
    for (const item of order.items) {
      const k = keyOf(item);
      if (!nameByKey.has(k)) nameByKey.set(k, nameOf(item));
      keys.add(k);
    }
    if (keys.size === 0) continue;
    totalOrders++;
    for (const k of keys) itemOrderCount.set(k, (itemOrderCount.get(k) ?? 0) + 1);
    const sorted = Array.from(keys).sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const pk = `${sorted[i]}${SEP}${sorted[j]}`;
        pairCount.set(pk, (pairCount.get(pk) ?? 0) + 1);
      }
    }
  }

  if (totalOrders === 0) return [];

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const results: ItemPair[] = [];

  for (const [pk, both] of pairCount) {
    const [ka, kb] = pk.split(SEP);
    const ca = itemOrderCount.get(ka) ?? 0;
    const cb = itemOrderCount.get(kb) ?? 0;
    if (ca === 0 || cb === 0) continue;
    // lift is symmetric; compute once.
    const lift = (both * totalOrders) / (ca * cb);
    if (lift < PAIR_MIN_LIFT) continue;
    // Choose the anchor as the direction with the higher attach rate.
    const rateAtoB = both / ca; // P(B|A)
    const rateBtoA = both / cb; // P(A|B)
    let anchorKey: string;
    let withKey: string;
    let anchorCount: number;
    let attach: number;
    if (rateAtoB >= rateBtoA) {
      anchorKey = ka; withKey = kb; anchorCount = ca; attach = rateAtoB;
    } else {
      anchorKey = kb; withKey = ka; anchorCount = cb; attach = rateBtoA;
    }
    // Support floor on the chosen anchor; fall back to the other direction if it
    // qualifies, else drop the pair.
    if (anchorCount < PAIR_MIN_ANCHOR_ORDERS) {
      const altKey = anchorKey === ka ? kb : ka;
      const altCount = altKey === ka ? ca : cb;
      if (altCount < PAIR_MIN_ANCHOR_ORDERS) continue;
      withKey = anchorKey;
      anchorKey = altKey;
      anchorCount = altCount;
      attach = both / altCount;
    }
    results.push({
      anchor: nameByKey.get(anchorKey) ?? anchorKey,
      withItem: nameByKey.get(withKey) ?? withKey,
      bothCount: both,
      anchorCount,
      attachRate: round1(attach * 100),
      lift: round1(lift),
    });
  }

  return results
    .sort((x, y) => y.lift - x.lift || y.attachRate - x.attachRate || x.anchor.localeCompare(y.anchor))
    .slice(0, limit);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getNestedKey(obj: any, path: string): string {
  const val = path.split(".").reduce((o, k) => o?.[k], obj);
  return typeof val === "string" ? val : path;
}

/**
 * Server-side translation loader for report routes (which have no React
 * `useTranslations`). Validates the locale against the enabled set, falls
 * back to the default locale, and returns a `t(key)` reading from
 * `admin.reports.<prefix><key>` in that locale's message bundle. Pass
 * `prefix: "excel."` for the Excel sheet labels. Shared so every report
 * route resolves labels identically (and the dynamic import path stays
 * locale-validated — no traversal).
 */
export async function loadReportMessages(locale: string, prefix = "") {
  const validLocale = (routing.locales as readonly string[]).includes(locale)
    ? locale
    : routing.defaultLocale;

  let messages;
  try {
    messages = (await import(`@/i18n/messages/${validLocale}.json`)).default;
  } catch {
    messages = (await import(`@/i18n/messages/${routing.defaultLocale}.json`))
      .default;
  }

  return (key: string) =>
    getNestedKey(messages, `admin.reports.${prefix}${key}`);
}
