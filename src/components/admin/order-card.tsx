"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";
import { formatDeploymentDayMonth } from "@/lib/date";
import { resolveOptionName, type LocalizedName } from "@/lib/option-utils";

function formatOptionSnapshot(
  opts: Array<{ groupName?: LocalizedName; choiceName: LocalizedName; priceAdjustment?: number }>,
  money: (amount: number) => string,
  locale: string,
  canonical: string
): string {
  if (!opts.length) return "";
  const grouped = new Map<string, string[]>();
  for (const o of opts) {
    const key = resolveOptionName(o.groupName ?? "", locale, canonical);
    const arr = grouped.get(key) || [];
    const cName = resolveOptionName(o.choiceName, locale, canonical);
    const label = o.priceAdjustment ? `${cName} +${money(o.priceAdjustment)}` : cName;
    arr.push(label);
    grouped.set(key, arr);
  }
  return Array.from(grouped.entries())
    .map(([group, choices]) =>
      group ? `${group}: ${choices.join(", ")}` : choices.join(", ")
    )
    .join(" · ");
}

export interface OrderData {
  id: number;
  sessionId: string;
  status: "PENDING" | "CONFIRMED" | "DECLINED";
  orderType: "DINE_IN" | "TAKEAWAY";
  customerName: string | null;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: number;
    menuItemId: number | null;
    itemName?: string | null;
    quantity: number;
    unitPrice: number;
    selectedOptions?: unknown;
    menuItem: {
      id: number;
      imageUrl: string | null;
      names: Array<{
        locale: string;
        name: string;
        description: string | null;
      }>;
    } | null;
  }>;
  session: {
    id: string;
    tableId: number | null;
    status: string;
    table: { id: number; number: number } | null;
  };
}

interface OrderCardProps {
  order: OrderData;
  sessionOrderNumber: number;
  onStatusChange: (orderId: number, newStatus: string) => void;
  hideTableBadge?: boolean;
}

export function OrderCard({ order, sessionOrderNumber, onStatusChange, hideTableBadge }: OrderCardProps) {
  const t = useTranslations("order");
  const tCart = useTranslations("cart");
  const tDash = useTranslations("admin.dashboard");
  const locale = useLocale();
  const cfg = useConfig();
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const STATUS_TRANSITIONS: Record<
    string,
    { nextStatus: string; label: string; color: string }
  > = {
    PENDING: {
      nextStatus: "CONFIRMED",
      label: t("confirm"),
      color: "bg-primary-500 hover:bg-primary-600",
    },
  };

  const getRelativeTime = (dateStr: string): string => {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);

    if (diffSec < 60) return t("justNow");
    if (diffMin < 60) return t("minutesAgo", { minutes: diffMin });
    if (diffHour < 24) return t("hoursAgo", { hours: diffHour });
    return formatDeploymentDayMonth(dateStr);
  };

  const transition = STATUS_TRANSITIONS[order.status];

  const handleStatusChange = async () => {
    if (!transition || isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: transition.nextStatus }),
      });

      if (res.ok) {
        onStatusChange(order.id, transition.nextStatus);
      } else {
        // Surface the failure instead of swallowing it — e.g. INVALID_TRANSITION
        // if the order was already declined elsewhere. The 10s board poll will
        // re-sync the true state, but staff need to know the tap didn't take.
        setError(t("editFailed"));
      }
    } catch {
      setError(t("editFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  // Live locale-matched name first; the order-time snapshot only backstops a
  // deleted item / missing translation (mirrors lib/report-utils getItemName).
  const getItemName = (
    names: Array<{ locale: string; name: string }>,
    snapshot?: string | null
  ): string => {
    const loc = names.find((n) => n.locale === locale);
    const th = names.find((n) => n.locale === cfg.canonicalLocale);
    return loc?.name || th?.name || snapshot || names[0]?.name || tCart("unknownItem");
  };

  const statusColors: Record<string, string> = {
    PENDING: "border-l-yellow-400",
    CONFIRMED: "border-l-green-500",
  };

  return (
    <div
      className={`rounded-lg border border-gray-200 border-l-4 ${statusColors[order.status] || "border-l-gray-300"} bg-white p-4 shadow-sm transition-shadow hover:shadow-md`}
    >
      {/* Header: Table / takeaway label, takeaway badge, and time */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {!hideTableBadge && (
            <span className="rounded-md bg-primary-500/10 px-2 py-1 text-sm font-bold text-primary-500">
              {order.session.table
                ? t("tableNumber", { number: order.session.table.number })
                : order.customerName
                  ? tDash("takeawayNamed", { name: order.customerName })
                  : tDash("takeawayUnnamed", { id: order.id })}
            </span>
          )}
          {order.orderType === "TAKEAWAY" && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              {tDash("takeawayBadge")}
            </span>
          )}
        </div>
        <span className={`text-xs text-gray-600 ${hideTableBadge ? "ml-auto" : ""}`}>
          {getRelativeTime(order.createdAt)}
        </span>
      </div>

      {/* Order ID */}
      <p className="mb-2 text-xs text-gray-600">{t("orderNumber", { id: sessionOrderNumber })}</p>

      {/* Order items */}
      <div className="mb-3 space-y-1">
        {order.items.map((item) => {
          const opts: Array<{ groupName?: LocalizedName; choiceName: LocalizedName }> = item.selectedOptions
            ? (typeof item.selectedOptions === "string"
                ? JSON.parse(item.selectedOptions)
                : item.selectedOptions)
            : [];
          const optionText = formatOptionSnapshot(opts, money, locale, cfg.canonicalLocale);
          return (
            <div key={item.id}>
              <div className="flex items-center justify-between text-sm">
                <span className="min-w-0 text-gray-700">
                  <span className="mr-1 font-medium text-gray-900">
                    {item.quantity}x
                  </span>
                  {getItemName(item.menuItem?.names ?? [], item.itemName)}
                </span>
                <span className="whitespace-nowrap text-gray-500">
                  {money(item.unitPrice * item.quantity)}
                </span>
              </div>
              {optionText && (
                <p className="ml-5 text-xs text-gray-600">{optionText}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Total */}
      <div className="mb-3 flex items-center justify-between border-t border-gray-100 pt-2">
        <span className="text-sm font-semibold text-gray-700">{t("total")}</span>
        <span className="text-sm font-bold text-gray-900">
          {money(order.totalAmount)}
        </span>
      </div>

      {/* Error banner — a failed status change must not be silent */}
      {error && (
        <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          {error}
        </div>
      )}

      {/* Action button */}
      {transition && (
        <button
          onClick={handleStatusChange}
          disabled={isLoading}
          className={`w-full rounded-md px-3 py-2.5 text-sm font-medium text-white transition-colors ${transition.color} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              {t("updating")}
            </span>
          ) : (
            transition.label
          )}
        </button>
      )}
    </div>
  );
}
