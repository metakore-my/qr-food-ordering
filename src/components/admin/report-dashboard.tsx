"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { AnalyticsDashboard, type ReportData } from "./analytics-dashboard";
import { OrderHistoryTab } from "./order-history-tab";

const RANGES = ["1h", "3h", "12h", "1d", "7d", "30d"] as const;

type Tab = "analytics" | "history";

export function ReportDashboard() {
  const t = useTranslations("admin.reports");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [range, setRange] = useState<string>("1d");
  const [activeTab, setActiveTab] = useState<Tab>("analytics");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>("ALL");

  const fetchReport = useCallback(async (selectedRange: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/reports?range=${selectedRange}&locale=${locale}`);
      if (!res.ok) throw new Error(t("failedToFetch"));
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }, [t, tCommon, locale]);

  // Only fetch analytics data when the analytics tab is active
  useEffect(() => {
    if (activeTab === "analytics") {
      fetchReport(range);
    }
  }, [range, activeTab, fetchReport]);

  async function handleExport() {
    setExporting(true);
    try {
      const statusParam = historyStatusFilter !== "ALL" ? `&status=${historyStatusFilter}` : "";
      const endpoint = activeTab === "analytics"
        ? `/api/reports/export?range=${range}&locale=${locale}`
        : `/api/reports/orders/export?range=${range}&locale=${locale}${statusParam}`;
      const filename = activeTab === "analytics"
        ? `report-${range}.xlsx`
        : `order-history-${range}.xlsx`;

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

      {/* Time range selector and export */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
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
        <button
          onClick={handleExport}
          disabled={exporting || (activeTab === "analytics" && loading)}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-green-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {exporting ? t("exporting") : t("downloadExcel")}
        </button>
      </div>

      {/* Tab bar */}
      <div className="mb-6 border-b border-gray-200">
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
        <OrderHistoryTab range={range} statusFilter={historyStatusFilter} onStatusFilterChange={setHistoryStatusFilter} />
      )}
    </div>
  );
}
