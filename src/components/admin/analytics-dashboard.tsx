"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";

export interface ReportData {
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  topCategory: { name: string; revenue: number; percentage: number } | null;
  topItem: { name: string; quantity: number; revenue: number } | null;
  topItems: { name: string; quantity: number; revenue: number }[];
  revenueByCategory: { name: string; revenue: number; percentage: number }[];
  ordersByHour: { hour: string; count: number }[];
  range: string;
  cutoff: string;
  truncated?: boolean;
  limit?: number;
}

const DONUT_COLORS = [
  "var(--color-primary-500)",
  "#16a34a",
  "#84cc16",
  "#eab308",
  "#f97316",
  "#ef4444",
];

/* ── Interactive Donut Chart ─────────────────────────────── */

function DonutChart({
  data,
  totalLabel,
}: {
  data: { name: string; revenue: number; percentage: number }[];
  totalLabel: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const cfg = useConfig();
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });
  const totalRevenue = data.reduce((s, c) => s + c.revenue, 0);

  // Build SVG arc segments for proper hit-testing
  const segments: {
    path: string;
    color: string;
    startAngle: number;
    endAngle: number;
  }[] = [];
  let cumAngle = -90; // start at top
  for (let i = 0; i < data.length; i++) {
    const angle = (data[i].percentage / 100) * 360;
    const startAngle = cumAngle;
    const endAngle = cumAngle + angle;
    const r = 90;
    const cx = 100;
    const cy = 100;

    // Clamp to 359.99° so the SVG arc renders (360° arc has identical start/end points = invisible)
    const drawAngle = Math.min(angle, 359.99);
    const drawEnd = startAngle + drawAngle;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (drawEnd * Math.PI) / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const largeArc = drawAngle > 180 ? 1 : 0;

    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    segments.push({
      path,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      startAngle,
      endAngle,
    });
    cumAngle = endAngle;
  }

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
      {/* SVG Donut */}
      <div className="relative h-48 w-48 shrink-0">
        <svg viewBox="0 0 200 200" className="h-full w-full">
          {segments.map((seg, i) => (
            <path
              key={i}
              d={seg.path}
              fill={seg.color}
              className="transition-opacity duration-150"
              opacity={hovered === null || hovered === i ? 1 : 0.35}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer" }}
            />
          ))}
          {/* Inner white circle */}
          <circle cx="100" cy="100" r="50" fill="white" className="pointer-events-none" />
        </svg>
        {/* Center text */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            {hovered !== null ? (
              <>
                <p className="max-w-[90px] truncate text-xs font-medium text-gray-700">
                  {data[hovered].name}
                </p>
                <p className="text-sm font-bold text-gray-900">
                  {data[hovered].percentage}%
                </p>
                <p className="text-xs text-gray-500">
                  {money(data[hovered].revenue)}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-500">{totalLabel}</p>
                <p className="text-sm font-bold text-gray-900">
                  {money(totalRevenue)}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
      {/* Legend */}
      <div className="min-w-0 flex-1 space-y-1.5">
        {data.map((cat, i) => (
          <div
            key={cat.name}
            className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-gray-50"
            style={{
              opacity: hovered === null || hovered === i ? 1 : 0.4,
            }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <div
              className="h-3 w-3 shrink-0 rounded-full"
              style={{
                backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length],
              }}
            />
            <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
              {cat.name}
            </span>
            <span className="shrink-0 text-sm font-medium text-gray-500">
              {cat.percentage}%
            </span>
            <span className="shrink-0 text-sm font-semibold text-gray-900">
              {money(cat.revenue)}
            </span>
          </div>
        ))}
      </div>
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

/* ── Analytics Dashboard Content ─────────────────────────── */

export function AnalyticsDashboard({ data }: { data: ReportData }) {
  const t = useTranslations("admin.reports");
  const cfg = useConfig();
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });

  const multiDay = data.range === "7d" || data.range === "30d";

  return (
    <div className="space-y-6">
      {/* Truncation notice — figures undercount when the row cap is hit */}
      {data.truncated && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          {t("truncatedNotice", { limit: data.limit ?? 10000 })}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="text-sm font-medium text-gray-500">{t("totalOrders")}</p>
          <p className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
            {data.totalOrders}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="text-sm font-medium text-gray-500">{t("revenue")}</p>
          <p className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
            {money(data.totalRevenue)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="text-sm font-medium text-gray-500">
            {t("avgOrderValue")}
          </p>
          <p className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
            {money(data.avgOrderValue)}
          </p>
        </div>
      </div>

      {/* Top Highlights */}
      {(data.topItem || data.topCategory) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

      {/* Revenue by Category (interactive donut) */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          {t("revenueByCategory")}
        </h3>
        {data.revenueByCategory.length > 0 ? (
          <DonutChart
            data={data.revenueByCategory}
            totalLabel={t("total")}
          />
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

      {/* Hourly Orders (interactive bar chart) */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          {t("ordersByHour")}
        </h3>
        {data.ordersByHour.length > 0 ? (
          <HourlyBarChart data={data.ordersByHour} multiDay={multiDay} />
        ) : (
          <p className="py-8 text-center text-sm text-gray-500">
            {t("noHourlyData")}
          </p>
        )}
      </div>
    </div>
  );
}
