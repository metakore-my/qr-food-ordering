"use client";

import { useTranslations } from "next-intl";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";
import type { OrderData } from "@/components/admin/order-card";

export interface TableGroup {
  sessionId: string;
  tableNumber: number | null;
  orderType: "DINE_IN" | "TAKEAWAY";
  customerName: string | null;
  orders: OrderData[];
  totalAmount: number;
}

interface TableGroupCardProps {
  group: TableGroup;
  onClick: (group: TableGroup) => void;
  /** Called with the single CONFIRMED order's id to "Mark collected" (table-less only). */
  onCollect?: (orderId: number) => void;
}

export function TableGroupCard({ group, onClick, onCollect }: TableGroupCardProps) {
  const t = useTranslations("order");
  const tDash = useTranslations("admin.dashboard");
  const cfg = useConfig();

  // A table-less counter takeaway is one-shot (one order per session); offer
  // "Mark collected" on its single CONFIRMED order. Table-bound groups settle
  // via the table-QR checkout, so no button there.
  const confirmedOrderId =
    group.tableNumber == null
      ? group.orders.find((o) => o.status === "CONFIRMED")?.id
      : undefined;
  const showCollect = onCollect != null && confirmedOrderId != null;

  return (
    <button
      type="button"
      onClick={() => onClick(group)}
      className="w-full rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-primary-500/10 px-2 py-1 text-sm font-bold text-primary-500">
            {group.tableNumber != null
              ? t("tableNumber", { number: group.tableNumber })
              : group.customerName
                ? tDash("takeawayNamed", { name: group.customerName })
                : tDash("takeawayUnnamed", { id: group.orders[0]?.id ?? 0 })}
          </span>
          {group.orders.some((o) => o.orderType === "TAKEAWAY") && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              {tDash("takeawayBadge")}
            </span>
          )}
        </div>
        <span className="text-sm font-bold text-gray-900">
          {formatMoneyWith(group.totalAmount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale })}
        </span>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {tDash("tableOrders", { count: group.orders.length })}
      </p>
      {showCollect && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onCollect!(confirmedOrderId!);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onCollect!(confirmedOrderId!);
            }
          }}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-primary-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          {tDash("markCollected")}
        </span>
      )}
    </button>
  );
}
