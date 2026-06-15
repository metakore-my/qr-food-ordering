"use client";

import { useTranslations } from "next-intl";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";
import type { OrderData } from "@/components/admin/order-card";

export interface TableGroup {
  sessionId: string;
  tableNumber: number;
  orders: OrderData[];
  totalAmount: number;
}

interface TableGroupCardProps {
  group: TableGroup;
  onClick: (group: TableGroup) => void;
}

export function TableGroupCard({ group, onClick }: TableGroupCardProps) {
  const t = useTranslations("order");
  const tDash = useTranslations("admin.dashboard");
  const cfg = useConfig();

  return (
    <button
      type="button"
      onClick={() => onClick(group)}
      className="w-full rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
    >
      <div className="flex items-center justify-between">
        <span className="rounded-md bg-primary-500/10 px-2 py-1 text-sm font-bold text-primary-500">
          {t("tableNumber", { number: group.tableNumber })}
        </span>
        <span className="text-sm font-bold text-gray-900">
          {formatMoneyWith(group.totalAmount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale })}
        </span>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {tDash("tableOrders", { count: group.orders.length })}
      </p>
    </button>
  );
}
