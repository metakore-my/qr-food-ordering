"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Pagination, paginate } from "@/components/ui/pagination";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";

interface OrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
  selectedOptions?: Array<{ choiceName: string }>;
}

interface OrderRecord {
  id: number;
  sessionId: string;
  tableNumber: number;
  status: string;
  totalAmount: number;
  createdAt: string;
  items: OrderItem[];
}

interface SessionGroup {
  sessionId: string;
  tableNumber: number;
  orders: OrderRecord[];
  sessionTotal: number;
  firstOrderTime: string;
}

const STATUSES = ["ALL", "COMPLETED", "PENDING", "CONFIRMED", "DECLINED"] as const;
const PAGE_SIZE = 10;
const ITEMS_PREVIEW = 3;

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "bg-blue-100 text-blue-800",
  PENDING: "bg-yellow-100 text-yellow-800",
  CONFIRMED: "bg-green-100 text-green-800",
  DECLINED: "bg-red-100 text-red-800",
};

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

function formatItem(item: OrderItem, money: (amount: number) => string) {
  const opts =
    item.selectedOptions && item.selectedOptions.length > 0
      ? ` (${formatOptionSnapshot(item.selectedOptions, money)})`
      : "";
  return `${item.name}${opts} x${item.quantity}`;
}

function groupBySession(orders: OrderRecord[]): SessionGroup[] {
  const map = new Map<string, OrderRecord[]>();
  // Preserve original order (desc by createdAt from API)
  for (const o of orders) {
    const arr = map.get(o.sessionId) || [];
    arr.push(o);
    map.set(o.sessionId, arr);
  }
  const groups: SessionGroup[] = [];
  for (const [sessionId, sessionOrders] of map) {
    groups.push({
      sessionId,
      tableNumber: sessionOrders[0].tableNumber,
      orders: sessionOrders,
      sessionTotal: sessionOrders.reduce((s, o) => s + o.totalAmount, 0),
      firstOrderTime: sessionOrders[sessionOrders.length - 1].createdAt,
    });
  }
  return groups;
}

export function OrderHistoryTab({
  range,
  statusFilter,
  onStatusFilterChange,
}: {
  range: string;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
}) {
  const t = useTranslations("admin.reports");
  const tH = useTranslations("admin.reports.orderHistory");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const cfg = useConfig();
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });
  const boundFormatItem = (item: OrderItem) => formatItem(item, money);

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [truncated, setTruncated] = useState<{ limit: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());

  const toggleExpanded = (id: number) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/orders?range=${range}&locale=${locale}`);
      if (!res.ok) throw new Error(t("failedToFetch"));
      const json = await res.json();
      setOrders(json.orders);
      setTruncated(json.truncated ? { limit: json.limit } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }, [range, locale, t, tCommon]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    setPage(1);
    setExpandedOrders(new Set());
  }, [range, statusFilter]);

  // Build per-session order number map from ALL orders (before status filter)
  // so numbers stay consistent regardless of which status filter is active
  const globalOrderNumberMap = useMemo(() => {
    const map = new Map<number, number>();
    const bySession = new Map<string, OrderRecord[]>();
    for (const o of orders) {
      const arr = bySession.get(o.sessionId) || [];
      arr.push(o);
      bySession.set(o.sessionId, arr);
    }
    for (const sessionOrders of bySession.values()) {
      sessionOrders.sort((a, b) => a.id - b.id).forEach((o, i) => map.set(o.id, i + 1));
    }
    return map;
  }, [orders]);

  const filtered = statusFilter === "ALL"
    ? orders
    : orders.filter((o) => o.status === statusFilter);

  const groups = useMemo(() => groupBySession(filtered), [filtered]);
  const pagedGroups = paginate(groups, page, PAGE_SIZE);

  const statusLabel = (s: string) => {
    const key = `status${s.charAt(0) + s.slice(1).toLowerCase()}` as
      | "statusAll"
      | "statusCompleted"
      | "statusPending"
      | "statusConfirmed"
      | "statusDeclined";
    return tH(key);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Truncation notice — the API caps results; oldest orders are dropped */}
      {truncated && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          {t("truncatedNotice", { limit: truncated.limit })}
        </div>
      )}

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => onStatusFilterChange(s)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
              statusFilter === s
                ? "bg-primary-500 text-white"
                : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
            }`}
          >
            {statusLabel(s)}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-500">
          {tH("noOrders")}
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {pagedGroups.map((group) => (
              <SessionGroupCard
                key={group.sessionId}
                group={group}
                orderNumberMap={globalOrderNumberMap}
                expandedOrders={expandedOrders}
                toggleExpanded={toggleExpanded}
                formatItem={boundFormatItem}
                money={money}
                statusLabel={statusLabel}
                tH={tH}
              />
            ))}
          </div>

          <Pagination
            currentPage={page}
            totalItems={groups.length}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

function SessionGroupCard({
  group,
  orderNumberMap,
  expandedOrders,
  toggleExpanded,
  formatItem,
  money,
  statusLabel,
  tH,
}: {
  group: SessionGroup;
  orderNumberMap: Map<number, number>;
  expandedOrders: Set<number>;
  toggleExpanded: (id: number) => void;
  formatItem: (item: OrderItem) => string;
  money: (amount: number) => string;
  statusLabel: (s: string) => string;
  tH: ReturnType<typeof useTranslations>;
}) {
  const isSingleOrder = group.orders.length === 1;

  if (isSingleOrder) {
    const order = group.orders[0];
    return <SingleOrderCard order={order} orderNumber={orderNumberMap.get(order.id) ?? order.id} expandedOrders={expandedOrders} toggleExpanded={toggleExpanded} formatItem={formatItem} money={money} statusLabel={statusLabel} tH={tH} />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Session header */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-primary-500/10 px-2.5 py-1 text-sm font-bold text-primary-500">
            {tH("tableNumber", { number: group.tableNumber })}
          </span>
          <span className="text-sm text-gray-500">
            {tH("ordersCount", { count: group.orders.length })}
          </span>
        </div>
        <div className="text-right">
          <span className="text-xs text-gray-400">{tH("sessionTotal")}</span>
          <span className="ml-2 text-sm font-bold text-gray-900">
            {money(group.sessionTotal)}
          </span>
        </div>
      </div>

      {/* Stacked orders */}
      <div className="divide-y divide-gray-100">
        {group.orders.map((order) => {
          const expanded = expandedOrders.has(order.id);
          const hasMore = order.items.length > ITEMS_PREVIEW;
          const visibleItems = expanded ? order.items : order.items.slice(0, ITEMS_PREVIEW);

          return (
            <div key={order.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">#{orderNumberMap.get(order.id) ?? order.id}</span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-800"}`}>
                    {statusLabel(order.status)}
                  </span>
                  <span className="text-xs text-gray-400">{order.createdAt}</span>
                </div>
                <span className="whitespace-nowrap text-sm font-medium text-gray-900">
                  {money(order.totalAmount)}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                {visibleItems.map(formatItem).join(", ")}
              </p>
              {hasMore && (
                <button
                  onClick={() => toggleExpanded(order.id)}
                  className="mt-0.5 text-xs font-medium text-primary-600 hover:text-primary-700 focus-visible:outline-none focus-visible:underline"
                >
                  {expanded
                    ? tH("showLess")
                    : tH("viewAll", { count: order.items.length })}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SingleOrderCard({
  order,
  orderNumber,
  expandedOrders,
  toggleExpanded,
  formatItem,
  money,
  statusLabel,
  tH,
}: {
  order: OrderRecord;
  orderNumber: number;
  expandedOrders: Set<number>;
  toggleExpanded: (id: number) => void;
  formatItem: (item: OrderItem) => string;
  money: (amount: number) => string;
  statusLabel: (s: string) => string;
  tH: ReturnType<typeof useTranslations>;
}) {
  const expanded = expandedOrders.has(order.id);
  const hasMore = order.items.length > ITEMS_PREVIEW;
  const visibleItems = expanded ? order.items : order.items.slice(0, ITEMS_PREVIEW);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-primary-500/10 px-2.5 py-1 text-sm font-bold text-primary-500">
            {tH("tableNumber", { number: order.tableNumber })}
          </span>
          <span className="text-sm font-medium text-gray-900">#{orderNumber}</span>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-800"}`}>
            {statusLabel(order.status)}
          </span>
        </div>
        <span className="text-xs text-gray-400">{order.createdAt}</span>
      </div>
      <p className="mt-2 text-sm text-gray-600">
        {visibleItems.map(formatItem).join(", ")}
      </p>
      {hasMore && (
        <button
          onClick={() => toggleExpanded(order.id)}
          className="mt-1 text-xs font-medium text-primary-600 hover:text-primary-700 focus-visible:outline-none focus-visible:underline"
        >
          {expanded
            ? tH("showLess")
            : tH("viewAll", { count: order.items.length })}
        </button>
      )}
      <div className="mt-2 flex items-center justify-end">
        <span className="text-sm font-bold text-gray-900">
          {money(order.totalAmount)}
        </span>
      </div>
    </div>
  );
}
