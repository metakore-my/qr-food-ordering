"use client";

import { useState, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";
import { formatClockHour, formatWeekday } from "@/lib/clock-format";

interface PeakWindow {
  startHour: number;
  endHour: number;
  count: number;
  percentage: number;
}

export interface ReportData {
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  itemsPerOrder: number;
  // ▲/▼ vs the immediately-preceding equal-length window.
  comparison: {
    ordersDelta: number | null;
    revenueDelta: number | null;
    aovDelta: number | null;
    prevOrders: number;
    prevRevenue: number;
  };
  topCategory: { name: string; revenue: number; percentage: number } | null;
  topItem: { name: string; quantity: number; revenue: number } | null;
  topItems: { name: string; quantity: number; revenue: number; revenueShare: number }[];
  // Pareto headline: top N dishes = X% of sales.
  pareto: { topCount: number; totalItemsWithSales: number; sharePercent: number } | null;
  revenueByCategory: { id: number; name: string; revenue: number; percentage: number }[];
  ordersByHour: { hour: string; count: number }[];
  // 24h clock profile (all days summed onto a 0–23 axis), each bucket carrying
  // orders/items/revenue so the chart can toggle the metric.
  hourProfile: { hour: number; orders: number; items: number; revenue: number; percentage: number }[];
  peakWindow: PeakWindow | null;
  secondPeakWindow: PeakWindow | null;
  quietestWindow: PeakWindow | null;
  steadyDay: boolean;
  // Day-of-week profile (Mon=1…Sun=7) with orders/items/revenue per weekday.
  dayProfile: { weekday: number; orders: number; items: number; revenue: number; percentage: number }[];
  busiestWeekday: number | null;
  quietestWeekday: number | null;
  // Frequently-ordered-together, stated directionally with attach rate + lift.
  topPairs: {
    anchor: string;
    withItem: string;
    bothCount: number;
    anchorCount: number;
    attachRate: number;
    lift: number;
  }[];
  // Dine-in vs takeaway channel split (orders/revenue + each channel's share).
  channels: {
    dineIn: { orders: number; revenue: number; orderShare: number; revenueShare: number };
    takeaway: { orders: number; revenue: number; orderShare: number; revenueShare: number };
    totalOrders: number;
    totalRevenue: number;
  };
  // Slow/dead available items (the cut decision) + the zero-seller headline.
  deadItems: { name: string; quantity: number }[];
  zeroSellerCount: number;
  range: string;
  cutoff: string;
  truncated?: boolean;
  limit?: number;
}

/** A ▲+12% / ▼8% / "new" delta badge for the period-over-period cards. */
function DeltaBadge({ delta }: { delta: number | null }) {
  const t = useTranslations("admin.reports");
  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-gray-400">
        {t("deltaNew")}
      </span>
    );
  }
  const up = delta >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
        up ? "text-green-600" : "text-red-600"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(delta)}% {t("vsPrev")}
    </span>
  );
}


/* ── Category Revenue Bars ───────────────────────────────── */

// A horizontal bar list — easier to compare than a donut, and honest for the
// 2–4 categories a typical stall has. Each row: name, proportional bar, %, money.
function CategoryBars({
  data,
}: {
  data: { id: number; name: string; revenue: number; percentage: number }[];
}) {
  const cfg = useConfig();
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });
  const maxRevenue = Math.max(...data.map((c) => c.revenue), 1);

  return (
    <div className="space-y-2.5">
      {data.map((cat) => (
        <div key={cat.id} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-sm text-gray-700 sm:w-36">
            {cat.name}
          </span>
          <div className="relative h-5 min-w-0 flex-1 rounded bg-gray-100">
            <div
              className="h-5 rounded bg-primary-500"
              style={{ width: `${Math.max((cat.revenue / maxRevenue) * 100, 2)}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-sm font-medium text-gray-500">
            {cat.percentage}%
          </span>
          <span className="w-24 shrink-0 text-right text-sm font-semibold text-gray-900">
            {money(cat.revenue)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Interactive Bar Chart (Orders by Hour) ──────────────── */

// Multi-day ranges repeat the same clock-hour across days, so the bare "HH:00"
// label is ambiguous. For those, show "DD MMM HH:00"; for single-day ranges the
// time alone is unambiguous. Buckets arrive as "YYYY-MM-DD HH:00".
function barLabel(bucket: string, multiDay: boolean): string {
  const [date, time] = bucket.split(" ");
  if (!multiDay) return time || bucket;
  const [, mm, dd] = date.split("-");
  return dd && mm ? `${dd}/${mm} ${time}` : bucket;
}

function HourlyBarChart({
  data,
  multiDay,
}: {
  data: { hour: string; count: number }[];
  multiDay: boolean;
}) {
  const t = useTranslations("admin.reports");
  const [hovered, setHovered] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    hour: string;
    count: number;
  } | null>(null);

  const maxCount = Math.max(...data.map((e) => e.count));

  function handleMouseEnter(
    i: number,
    e: React.MouseEvent<HTMLDivElement>
  ) {
    setHovered(i);
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      setTooltip({
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.top - containerRect.top - 8,
        hour: data[i].hour,
        count: data[i].count,
      });
    }
  }

  function handleMouseLeave() {
    setHovered(null);
    setTooltip(null);
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-gray-800 px-3 py-1.5 text-xs text-white shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <p className="font-medium">{tooltip.hour}</p>
          <p>
            {t("orderCount", { count: tooltip.count })}
          </p>
          <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
        </div>
      )}
      <div
        className="flex items-end gap-px sm:gap-1"
        style={{ minHeight: 140 }}
      >
        {data.map((entry, i) => {
          const heightPx = Math.max(
            (entry.count / (maxCount || 1)) * 120,
            4
          );
          const isHovered = hovered === i;
          return (
            <div
              key={entry.hour}
              className="flex min-w-0 flex-1 flex-col items-center"
              onMouseEnter={(e) => handleMouseEnter(i, e)}
              onMouseLeave={handleMouseLeave}
            >
              <span
                className="mb-1 hidden text-xs transition-colors duration-100 sm:block"
                style={{
                  color: isHovered ? "var(--color-primary-500)" : "#4b5563",
                  fontWeight: isHovered ? 700 : 400,
                }}
              >
                {entry.count}
              </span>
              <div
                className="w-full max-w-6 rounded-t transition-all duration-150"
                style={{
                  height: `${heightPx}px`,
                  backgroundColor: isHovered ? "var(--color-primary-500)" : "#16a34a",
                  transform: isHovered ? "scaleX(1.25)" : "scaleX(1)",
                  cursor: "pointer",
                }}
              />
              <span
                className="mt-1 text-center text-[9px] leading-tight transition-colors duration-100 sm:text-xs"
                style={{
                  writingMode: "vertical-rl",
                  maxHeight: 48,
                  color: isHovered ? "var(--color-primary-500)" : "#9ca3af",
                  fontWeight: isHovered ? 600 : 400,
                }}
              >
                {barLabel(entry.hour, multiDay)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Clock-Hour Profile (24 bars, all days summed) ───────── */

type ClockMetric = "orders" | "items" | "revenue";

interface ClockBucket {
  hour: number;
  orders: number;
  items: number;
  revenue: number;
  percentage: number;
}

// For multi-day ranges, the per-day hourly chart is an unreadable wall (up to
// 2160 bars on 90d). This collapses every day onto a single 0–23 clock axis so
// "we're busiest at dinner" is legible at a glance. Highlights the peak window
// and toggles between three denominators (orders / items / revenue), which can
// peak at different hours: order-count for staffing, items for kitchen load,
// revenue for "when do we make money".
function ClockHourChart({
  data,
  peakStart,
  peakEnd,
  metric,
  locale,
}: {
  data: ClockBucket[];
  peakStart: number | null;
  peakEnd: number | null;
  metric: ClockMetric;
  locale: string;
}) {
  const cfg = useConfig();
  const [hovered, setHovered] = useState<number | null>(null);
  const valueOf = (b: ClockBucket) => b[metric];
  const maxVal = Math.max(...data.map(valueOf), 1);
  const fmtVal = (v: number) =>
    metric === "revenue"
      ? formatMoneyWith(v, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale })
      : String(v);

  const inPeak = (h: number) =>
    peakStart !== null && peakEnd !== null && h >= peakStart && h < peakEnd;

  return (
    <div className="flex items-end gap-px sm:gap-1" style={{ minHeight: 150 }}>
      {data.map((entry, i) => {
        const v = valueOf(entry);
        const heightPx = Math.max((v / maxVal) * 120, v > 0 ? 4 : 1);
        const isHovered = hovered === i;
        const peak = inPeak(entry.hour);
        // Peak hours use the brand primary; the rest a muted grey. Hover wins.
        const color = isHovered
          ? "var(--color-primary-600)"
          : peak
            ? "var(--color-primary-500)"
            : "#d1d5db";
        return (
          <div
            key={entry.hour}
            className="flex min-w-0 flex-1 flex-col items-center"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <div
              className="w-full max-w-5 rounded-t transition-all duration-150"
              style={{
                height: `${heightPx}px`,
                backgroundColor: color,
                cursor: "pointer",
              }}
              title={`${formatClockHour(entry.hour, locale)} · ${fmtVal(v)}`}
            />
            {/* Show every 3rd hour label on small screens to avoid crowding. */}
            <span
              className={`mt-1 text-center text-[9px] leading-tight text-gray-400 sm:text-[10px] ${
                entry.hour % 3 === 0 ? "" : "hidden sm:block"
              }`}
              style={{ fontWeight: peak ? 600 : 400, color: peak ? "var(--color-primary-600)" : undefined }}
            >
              {formatClockHour(entry.hour, locale)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Day-of-Week Chart (7 bars, Mon–Sun) ─────────────────── */

interface DayBucket {
  weekday: number;
  orders: number;
  items: number;
  revenue: number;
  percentage: number;
}

// Which DAYS make money — drives staffing/opening hours as much as which hours.
// Same metric toggle as the clock chart; busiest weekday highlighted in brand.
function DayOfWeekChart({
  data,
  busiest,
  metric,
  locale,
}: {
  data: DayBucket[];
  busiest: number | null;
  metric: ClockMetric;
  locale: string;
}) {
  const cfg = useConfig();
  const valueOf = (b: DayBucket) => b[metric];
  const maxVal = Math.max(...data.map(valueOf), 1);
  const fmtVal = (v: number) =>
    metric === "revenue"
      ? formatMoneyWith(v, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale })
      : String(v);

  return (
    <div className="flex items-end gap-1 sm:gap-2" style={{ minHeight: 160 }}>
      {data.map((entry) => {
        const v = valueOf(entry);
        const heightPx = Math.max((v / maxVal) * 120, v > 0 ? 4 : 1);
        const isBusiest = entry.weekday === busiest;
        return (
          <div key={entry.weekday} className="flex min-w-0 flex-1 flex-col items-center">
            <span
              className="mb-1 hidden text-[10px] sm:block"
              style={{
                color: isBusiest ? "var(--color-primary-600)" : "#9ca3af",
                fontWeight: isBusiest ? 700 : 400,
                opacity: v > 0 ? 1 : 0,
              }}
            >
              {fmtVal(v)}
            </span>
            <div
              className="w-full max-w-10 rounded-t transition-all duration-150"
              style={{
                height: `${heightPx}px`,
                backgroundColor: isBusiest ? "var(--color-primary-500)" : "#d1d5db",
              }}
              title={`${formatWeekday(entry.weekday, locale, "long")} · ${fmtVal(v)}`}
            />
            <span
              className="mt-1 text-center text-[10px] leading-tight sm:text-xs"
              style={{
                color: isBusiest ? "var(--color-primary-600)" : "#6b7280",
                fontWeight: isBusiest ? 600 : 400,
              }}
            >
              {formatWeekday(entry.weekday, locale, "short")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Analytics Dashboard Content ─────────────────────────── */

export function AnalyticsDashboard({ data }: { data: ReportData }) {
  const t = useTranslations("admin.reports");
  const cfg = useConfig();
  // Hour/weekday LABELS render in the viewer's active UI locale (not the
  // deployment default) — otherwise an English-viewing admin sees Bahasa "5 PTG".
  // Money keeps cfg.defaultLocale for deployment-consistent number grouping.
  const locale = useLocale();
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });

  const multiDay = data.range === "7d" || data.range === "30d" || data.range === "90d";
  const [clockMetric, setClockMetric] = useState<ClockMetric>("orders");
  const [dayMetric, setDayMetric] = useState<ClockMetric>("orders");

  return (
    <div className="space-y-6">
      {/* Truncation notice — figures undercount when the row cap is hit */}
      {data.truncated && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          {t("truncatedNotice", { limit: data.limit ?? 10000 })}
        </div>
      )}

      {/* Summary Cards — orders + revenue + AOV (each with a vs-prev-period
          delta) and items-per-order (basket size). Four across on desktop. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          {/* B3: the count is COMPLETED-only (the API filters status COMPLETED),
              so label it "Completed Orders" — not the ambiguous "Total Orders". */}
          <p className="text-sm font-medium text-gray-500">{t("completedOrders")}</p>
          <p className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
            {data.totalOrders}
          </p>
          <p className="mt-1"><DeltaBadge delta={data.comparison.ordersDelta} /></p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="text-sm font-medium text-gray-500">{t("revenue")}</p>
          <p className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
            {money(data.totalRevenue)}
          </p>
          <p className="mt-1"><DeltaBadge delta={data.comparison.revenueDelta} /></p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="text-sm font-medium text-gray-500">{t("avgOrderValue")}</p>
          <p className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
            {money(data.avgOrderValue)}
          </p>
          <p className="mt-1"><DeltaBadge delta={data.comparison.aovDelta} /></p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="text-sm font-medium text-gray-500">
            {t("itemsPerOrder")}
          </p>
          <p className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
            {data.itemsPerOrder}
          </p>
        </div>
      </div>

      {/* Top Highlights — the three "get to know your business" answers:
          hot item, peak hours, top category. */}
      {(data.topItem || data.peakWindow || data.topCategory) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.topItem && (
            <div className="flex items-start gap-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg">
                &#127942;
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-500">{t("topItemSold")}</p>
                <p className="mt-1 text-lg font-bold text-gray-900">{data.topItem.name}</p>
                <p className="text-sm text-gray-500">
                  {data.topItem.quantity} {t("qtySold").toLowerCase()} &middot; {money(data.topItem.revenue)}
                </p>
              </div>
            </div>
          )}
          {(data.peakWindow || data.steadyDay) && (
            <div className="flex items-start gap-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-lg">
                &#128336;
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-500">{t("busiestHours")}</p>
                {data.steadyDay ? (
                  <>
                    <p className="mt-1 text-lg font-bold text-gray-900">{t("steadyDay")}</p>
                    <p className="text-sm text-gray-500">{t("steadyDayHint")}</p>
                  </>
                ) : data.peakWindow ? (
                  <>
                    <p className="mt-1 text-lg font-bold text-gray-900">
                      {t("busiestHoursValue", {
                        start: formatClockHour(data.peakWindow.startHour, locale),
                        end: formatClockHour(data.peakWindow.endHour, locale),
                      })}
                    </p>
                    <p className="text-sm text-gray-500">
                      {t("busiestHoursShare", { percentage: data.peakWindow.percentage })}
                    </p>
                    {data.secondPeakWindow && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t("secondBusiest")}:{" "}
                        {t("busiestHoursValue", {
                          start: formatClockHour(data.secondPeakWindow.startHour, locale),
                          end: formatClockHour(data.secondPeakWindow.endHour, locale),
                        })}{" "}
                        ({data.secondPeakWindow.percentage}%)
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          )}
          {data.topCategory && (
            <div className="flex items-start gap-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-lg">
                &#128200;
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-500">{t("topCategoryRevenue")}</p>
                <p className="mt-1 text-lg font-bold text-gray-900">{data.topCategory.name}</p>
                <p className="text-sm text-gray-500">
                  {money(data.topCategory.revenue)} &middot; {data.topCategory.percentage}%
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Disclaimers */}
      <p className="text-xs text-gray-400">
        {t("completedOnly")}
      </p>

      {/* Revenue by Category (horizontal bars — clearer than a donut for the
          2–4 categories a typical stall has) */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          {t("revenueByCategory")}
        </h3>
        {data.revenueByCategory.length > 0 ? (
          <CategoryBars data={data.revenueByCategory} />
        ) : (
          <p className="py-8 text-center text-sm text-gray-500">
            {t("noCategoryData")}
          </p>
        )}
      </div>

      {/* Top Items */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-4 py-4 sm:px-6">
          <h3 className="text-lg font-semibold text-gray-900">
            {t("topItems")}
          </h3>
          {/* Pareto headline — where the money concentrates. */}
          {data.pareto && (
            <p className="mt-0.5 text-xs text-gray-500">
              {t("paretoNote", {
                count: data.pareto.topCount,
                total: data.pareto.totalItemsWithSales,
                percent: data.pareto.sharePercent,
              })}
            </p>
          )}
        </div>

        {data.topItems.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500 sm:px-6">
            {t("noItemsSold")}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("rankHeader")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("itemHeader")}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("qtySold")}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("revenueLabel", { currencyCode: cfg.currency })}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("bar")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.topItems.map((item, i) => {
                    const maxQty = data.topItems[0]?.quantity || 1;
                    const widthPct = Math.round(
                      (item.quantity / maxQty) * 100
                    );
                    return (
                      <tr
                        key={i}
                        className="group transition-colors hover:bg-primary-50/50"
                      >
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {i + 1}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                          {item.name}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-sm text-gray-900">
                          {item.quantity}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-sm text-gray-900">
                          {money(item.revenue)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="relative h-4 w-full rounded-full bg-gray-100">
                            <div
                              className="h-4 rounded-full bg-primary-500 transition-all duration-300 group-hover:bg-primary-600"
                              style={{ width: `${widthPct}%` }}
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] font-medium text-gray-400 opacity-0 transition-opacity group-hover:opacity-100">
                              {widthPct}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="space-y-3 p-4 md:hidden">
              {data.topItems.map((item, i) => {
                const maxQty = data.topItems[0]?.quantity || 1;
                const widthPct = Math.round(
                  (item.quantity / maxQty) * 100
                );
                return (
                  <div
                    key={i}
                    className="rounded-lg border border-gray-200 border-l-4 border-l-primary-500 bg-white p-4 shadow-sm transition-shadow active:shadow-md"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-700">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 text-sm font-medium text-gray-900">
                        {item.name}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-4 pl-11">
                      <div>
                        <p className="text-xs text-gray-500">{t("qtySold")}</p>
                        <p className="text-sm font-semibold text-gray-900">{item.quantity}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">{t("revenueLabel", { currencyCode: cfg.currency })}</p>
                        <p className="text-sm font-semibold text-gray-900">{money(item.revenue)}</p>
                      </div>
                    </div>
                    <div className="mt-2 pl-11">
                      <div className="h-3 w-full rounded-full bg-gray-100">
                        <div
                          className="h-3 rounded-full bg-primary-500"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Frequently Ordered Together — a compact pairs table (selling point:
          item combinations). Only shown when there's at least one pair. */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-4 py-4 sm:px-6">
          <h3 className="text-lg font-semibold text-gray-900">
            {t("frequentlyTogether")}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">{t("frequentlyTogetherHint")}</p>
        </div>
        {data.topPairs.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500 sm:px-6">
            {t("noPairsData")}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.topPairs.map((pair, i) => (
              <li
                key={i}
                className="flex items-center gap-3 px-4 py-3 sm:px-6"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {/* The actionable sentence — "80% of Pad Thai orders also get
                      Thai Tea" — not a raw symmetric count. */}
                  <p className="text-sm text-gray-900">
                    <span className="font-semibold text-primary-700">{pair.attachRate}%</span>{" "}
                    {t("pairSentence", {
                      anchor: pair.anchor,
                      withItem: pair.withItem,
                    })}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {t("pairSupport", { both: pair.bothCount, anchor: pair.anchorCount })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Dine-in vs Takeaway — order/revenue split by channel, with each
          channel's share of the totals. Only shown when there are orders. */}
      {data.channels.totalOrders > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-4 py-4 sm:px-6">
            <h3 className="text-lg font-semibold text-gray-900">{t("channelTitle")}</h3>
          </div>
          {/* overflow-x-auto so the 4-column table scrolls WITHIN the card on a
              narrow (≤320px) viewport instead of widening the page (mobile-first). */}
          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                  &nbsp;
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                  {t("channelOrders")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                  {t("channelRevenue")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                  {t("channelShare")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(
                [
                  { label: t("channelDineIn"), stat: data.channels.dineIn },
                  { label: t("channelTakeaway"), stat: data.channels.takeaway },
                ] as const
              ).map((row) => (
                <tr key={row.label}>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 sm:px-6">
                    {row.label}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900 sm:px-6">
                    {row.stat.orders}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900 sm:px-6">
                    {money(row.stat.revenue)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500 sm:px-6">
                    {row.stat.orderShare}% / {row.stat.revenueShare}%
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-semibold">
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900 sm:px-6">
                  {t("channelTotal")}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900 sm:px-6">
                  {data.channels.totalOrders}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900 sm:px-6">
                  {money(data.channels.totalRevenue)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500 sm:px-6">
                  100% / 100%
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Slow / Dead Items — the cut decision. Available menu items selling the
          least (zero-sellers flagged). Only shown when there are items. */}
      {data.deadItems.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-4 py-4 sm:px-6">
            <h3 className="text-lg font-semibold text-gray-900">{t("slowItems")}</h3>
            <p className="mt-0.5 text-xs text-gray-500">{t("slowItemsHint")}</p>
            {data.zeroSellerCount > 0 && (
              <p className="mt-1 text-xs font-medium text-red-600">
                {t("zeroSellers", { count: data.zeroSellerCount })}
              </p>
            )}
          </div>
          <ul className="divide-y divide-gray-100">
            {data.deadItems.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                  {it.name}
                </span>
                <span
                  className={`shrink-0 text-sm font-semibold ${
                    it.quantity === 0 ? "text-red-600" : "text-gray-600"
                  }`}
                >
                  {t("soldUnits", { count: it.quantity })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Orders by time of day. Single-day ranges show the literal hourly bars
          (unambiguous); multi-day ranges collapse onto a 24h clock profile so
          "peak hours" is readable instead of a 2160-bar wall. The clock profile
          toggles between orders / items / revenue per hour. */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-gray-900">
            {multiDay ? t("clockHourTitle") : t("ordersByHour")}
          </h3>
          {multiDay && data.totalOrders > 0 && (
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
              {(["orders", "items", "revenue"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setClockMetric(m)}
                  className={`inline-flex min-h-[44px] items-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                    clockMetric === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {m === "orders" ? t("clockMetricOrders") : m === "items" ? t("clockMetricItems") : t("clockMetricRevenue")}
                </button>
              ))}
            </div>
          )}
        </div>
        {multiDay ? (
          <>
            <p className="mb-4 mt-0.5 text-xs text-gray-500">{t("clockHourHint")}</p>
            {data.totalOrders > 0 ? (
              <ClockHourChart
                data={data.hourProfile}
                peakStart={data.peakWindow?.startHour ?? null}
                peakEnd={data.peakWindow?.endHour ?? null}
                metric={clockMetric}
                locale={locale}
              />
            ) : (
              <p className="py-8 text-center text-sm text-gray-500">
                {t("noHourlyData")}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="mb-4" />
            {data.ordersByHour.length > 0 ? (
              <HourlyBarChart data={data.ordersByHour} multiDay={multiDay} />
            ) : (
              <p className="py-8 text-center text-sm text-gray-500">
                {t("noHourlyData")}
              </p>
            )}
          </>
        )}
      </div>

      {/* Which days make money — only meaningful on a multi-day range (a 1-day
          range is a single weekday). Same orders/items/revenue toggle. Shows the
          busiest day in words above the bars. */}
      {multiDay && data.totalOrders > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-gray-900">{t("dayOfWeekTitle")}</h3>
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
              {(["orders", "items", "revenue"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setDayMetric(m)}
                  className={`inline-flex min-h-[44px] items-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                    dayMetric === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {m === "orders" ? t("clockMetricOrders") : m === "items" ? t("clockMetricItems") : t("clockMetricRevenue")}
                </button>
              ))}
            </div>
          </div>
          {data.busiestWeekday !== null && (
            <p className="mb-4 mt-0.5 text-xs text-gray-500">
              {t("busiestDayHint", { day: formatWeekday(data.busiestWeekday, locale, "long") })}
            </p>
          )}
          <DayOfWeekChart
            data={data.dayProfile}
            busiest={data.busiestWeekday}
            metric={dayMetric}
            locale={locale}
          />
        </div>
      )}
    </div>
  );
}
