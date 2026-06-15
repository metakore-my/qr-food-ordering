"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { AnalyticsDashboard, type ReportData } from "./analytics-dashboard";
import { OrderHistoryTab } from "./order-history-tab";

const RANGES = ["1h", "3h", "12h", "1d", "7d", "30d", "90d"] as const;

type Tab = "analytics" | "history";

export function ReportDashboard() {
  const t = useTranslations("admin.reports");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [range, setRange] = useState<string>("1d");
  // N1: "custom" range mode with explicit from/to dates, alongside the presets.
  const [rangeMode, setRangeMode] = useState<"preset" | "custom">("preset");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [activeTab, setActiveTab] = useState<Tab>("analytics");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>("ALL");

  // Build the range query string shared by the analytics fetch + both exports.
  // Custom mode requires both dates; otherwise falls back to the preset.
  const customActive = rangeMode === "custom" && !!fromDate && !!toDate;
  const rangeQuery = useCallback(() => {
    return customActive
      ? `from=${fromDate}&to=${toDate}`
      : `range=${range}`;
  }, [customActive, fromDate, toDate, range]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/reports?${rangeQuery()}&locale=${locale}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.code === "RANGE_TOO_LARGE") throw new Error(t("rangeTooLarge"));
        if (body?.code === "INVALID_RANGE") throw new Error(t("invalidRange"));
        throw new Error(t("failedToFetch"));
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }, [t, tCommon, locale, rangeQuery]);

  // Refetch analytics on range/mode/date change (only while the tab is active).
  // In custom mode, wait until BOTH dates are set to avoid a 400 on a half-entry.
  useEffect(() => {
    if (activeTab !== "analytics") return;
    if (rangeMode === "custom" && !customActive) return;
    fetchReport();
  }, [activeTab, rangeMode, customActive, range, fromDate, toDate, fetchReport]);

  // Clear the custom from/to dates but STAY on the custom tab so the user can pick
  // a new range without being bounced back to presets. With both dates cleared,
  // `customActive` is false, so the analytics effect holds the last data and waits
  // for a complete new range rather than firing a 400 on an empty query.
  function resetFilters() {
    setFromDate("");
    setToDate("");
  }

  // Custom mode selected but only one of from/to entered: `rangeQuery()` would
  // silently fall back to the PRESET window, so an export would download a
  // range the admin didn't choose (and the filename would say `range` too).
  // Block it — the buttons are disabled in this state and this guards a
  // programmatic call.
  const incompleteCustomRange = rangeMode === "custom" && !customActive;

  // Export is order-history only — the raw, oldest-first transaction trail an
  // accountant reconciles from. Analytics is on-screen only (no export); a
  // pre-aggregated BI summary isn't what an auditor wants for tax filing.
  async function handleExport(format: "xlsx" | "csv" = "xlsx") {
    if (incompleteCustomRange) return;
    setExporting(true);
    try {
      const statusParam = historyStatusFilter !== "ALL" ? `&status=${historyStatusFilter}` : "";
      const fmtParam = format === "csv" ? "&format=csv" : "";
      const endpoint = `/api/reports/orders/export?${rangeQuery()}&locale=${locale}${statusParam}${fmtParam}`;
      const ext = format === "csv" ? "csv" : "xlsx";
      const filename = `order-history-${customActive ? `${fromDate}_${toDate}` : range}.${ext}`;

      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(t("failedToExport"));

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      {/* Retention notice — always on (a standing fact, not a dismissible alert).
          The system keeps only 90 days of records; the owner needs years for tax/
          audit, and the product won't store them, so it must tell them to export.
          See the 90-day cleanup in api/cron/cleanup (COMPLETED retention). */}
      <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        <span>{t("retentionNotice")}</span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 flex items-center justify-between rounded-md bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:rounded"
          >
            {tCommon("dismiss")}
          </button>
        </div>
      )}

      {/* Time range selector (export lives on the Order History tab) */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:gap-4">
        {/* Date-range card: mode toggle + preset pills / custom date pickers */}
        <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
          {/* Preset / Custom mode toggle */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
              {(["preset", "custom"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setRangeMode(m)}
                  className={`inline-flex min-h-[44px] items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                    rangeMode === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {m === "preset" ? t("rangePreset") : t("rangeCustom")}
                </button>
              ))}
            </div>
          </div>

          {rangeMode === "preset" ? (
            <div className="flex flex-wrap gap-2">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`min-h-[44px] rounded-full px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                    range === r
                      ? "bg-primary-500 text-white"
                      : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col text-xs font-medium text-gray-600">
                {t("fromDate")}
                <input
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="mt-1 min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </label>
              <label className="flex flex-col text-xs font-medium text-gray-600">
                {t("toDate")}
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  className="mt-1 min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </label>
              {/* Reset: clear the custom dates, staying on the custom tab. */}
              <button
                type="button"
                onClick={resetFilters}
                disabled={!fromDate && !toDate}
                className="min-h-[44px] rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("resetFilters")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tab bar — frosted card backing so the tab labels stay legible over the
          animated cuisine background instead of floating on it bare. */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white px-4 shadow-sm">
        <div className="-mb-px flex gap-6">
          <button
            onClick={() => setActiveTab("analytics")}
            className={`inline-flex min-h-[44px] items-end justify-center border-b-2 px-1 pb-3 text-sm font-medium transition-colors focus-visible:outline-none ${
              activeTab === "analytics"
                ? "border-primary-500 text-primary-600"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            {t("tabAnalytics")}
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`inline-flex min-h-[44px] items-end justify-center border-b-2 px-1 pb-3 text-sm font-medium transition-colors focus-visible:outline-none ${
              activeTab === "history"
                ? "border-primary-500 text-primary-600"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            {t("tabOrderHistory")}
          </button>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "analytics" ? (
        loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
          </div>
        ) : data ? (
          <AnalyticsDashboard data={data} />
        ) : null
      ) : (
        <>
          {/* Export controls — order history only (the tax/audit transaction
              trail). Analytics is on-screen only. */}
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              onClick={() => handleExport("xlsx")}
              disabled={exporting || incompleteCustomRange}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-green-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {exporting ? t("exporting") : t("downloadExcel")}
            </button>
            <button
              onClick={() => handleExport("csv")}
              disabled={exporting || incompleteCustomRange}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-green-600 bg-white px-4 py-2.5 text-sm font-medium text-green-700 transition-colors hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {t("downloadCsv")}
            </button>
          </div>
          <OrderHistoryTab rangeQuery={rangeQuery()} statusFilter={historyStatusFilter} onStatusFilterChange={setHistoryStatusFilter} />
        </>
      )}
    </div>
  );
}
