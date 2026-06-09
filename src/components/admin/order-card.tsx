"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";
import { formatDeploymentDayMonth } from "@/lib/date";

function formatOptionSnapshot(
  opts: Array<{ groupName?: string; choiceName: string; priceAdjustment?: number }>,
  money: (amount: number) => string
): string {
  if (!opts.length) return "";
  const grouped = new Map<string, string[]>();
  for (const o of opts) {
    const key = o.groupName || "";
    const arr = grouped.get(key) || [];
    const label = o.priceAdjustment ? `${o.choiceName} +${money(o.priceAdjustment)}` : o.choiceName;
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
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: number;
    menuItemId: number | null;
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
    tableId: number;
    status: string;
    table: {
      id: number;
      number: number;
    };
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
  const locale = useLocale();
  const cfg = useConfig();
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });
  const [isLoading, setIsLoading] = useState(false);

  const STATUS_TRANSITIONS: Record<
    string,
    { nextStatus: string; label: string; color: string }
  > = {
    PENDING: {
      nextStatus: "CONFIRMED",
      label: t("confirm"),
      color: "bg-blue-600 hover:bg-blue-700",
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

    try {
      const res = await fetch(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: transition.nextStatus }),
      });

      if (res.ok) {
        onStatusChange(order.id, transition.nextStatus);
      }
    } catch {
      // Silently handle network errors
    } finally {
      setIsLoading(false);
    }
  };

  const getItemName = (
    names: Array<{ locale: string; name: string }>
  ): string => {
    const loc = names.find((n) => n.locale === locale);
    const th = names.find((n) => n.locale === cfg.defaultLocale);
    return loc?.name || th?.name || names[0]?.name || tCart("unknownItem");
  };

  const statusColors: Record<string, string> = {
    PENDING: "border-l-yellow-400",
    CONFIRMED: "border-l-green-500",
  };

  return (
    <div
      className={`rounded-lg border border-gray-200 border-l-4 ${statusColors[order.status] || "border-l-gray-300"} bg-white p-4 shadow-sm transition-shadow hover:shadow-md`}
    >
      {/* Header: Table name and time */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-1">
        {!hideTableBadge && (
          <span className="rounded-md bg-primary-500/10 px-2 py-1 text-sm font-bold text-primary-500">
            {t("tableNumber", { number: order.session.table.number })}
          </span>
        )}
        <span className={`text-xs text-gray-400 ${hideTableBadge ? "ml-auto" : ""}`}>
          {getRelativeTime(order.createdAt)}
        </span>
      </div>

      {/* Order ID */}
      <p className="mb-2 text-xs text-gray-400">{t("orderNumber", { id: sessionOrderNumber })}</p>

      {/* Order items */}
      <div className="mb-3 space-y-1">
        {order.items.map((item) => {
          const opts: Array<{ choiceName: string }> = item.selectedOptions
            ? (typeof item.selectedOptions === "string"
                ? JSON.parse(item.selectedOptions)
                : item.selectedOptions)
            : [];
          const optionText = formatOptionSnapshot(opts, money);
          return (
            <div key={item.id}>
              <div className="flex items-center justify-between text-sm">
                <span className="min-w-0 text-gray-700">
                  <span className="mr-1 font-medium text-gray-900">
                    {item.quantity}x
                  </span>
                  {getItemName(item.menuItem?.names ?? [])}
                </span>
                <span className="whitespace-nowrap text-gray-500">
                  {money(item.unitPrice * item.quantity)}
                </span>
              </div>
              {optionText && (
                <p className="ml-5 text-xs text-gray-400">{optionText}</p>
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
