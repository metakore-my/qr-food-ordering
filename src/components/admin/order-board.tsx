"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { type OrderData } from "@/components/admin/order-card";
import {
  TableGroupCard,
  type TableGroup,
} from "@/components/admin/table-group-card";
import { OrderDetailModal } from "@/components/admin/order-detail-modal";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";

type BoardStatus = "PENDING" | "CONFIRMED";

interface OrderBoardProps {
  initialOrders: OrderData[];
}

function groupByTable(orders: OrderData[]): TableGroup[] {
  const map = new Map<
    string,
    { sessionId: string; tableNumber: number; orders: OrderData[] }
  >();

  for (const order of orders) {
    const key = order.sessionId;
    if (!map.has(key)) {
      map.set(key, {
        sessionId: order.sessionId,
        tableNumber: order.session.table.number,
        orders: [],
      });
    }
    map.get(key)!.orders.push(order);
  }

  return Array.from(map.values()).map((g) => ({
    ...g,
    totalAmount: g.orders.reduce((sum, o) => sum + o.totalAmount, 0),
  }));
}

export function OrderBoard({ initialOrders }: OrderBoardProps) {
  const [orders, setOrders] = useState<OrderData[]>(initialOrders);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [isPolling, setIsPolling] = useState(true);
  const knownOrderIds = useRef<Set<number>>(new Set(initialOrders.map((o) => o.id)));

  const locale = useLocale();
  const cfg = useConfig();
  const t = useTranslations("admin.dashboard");
  const tOrder = useTranslations("order");

  // Request browser notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Fetch all active orders from the API
  const fetchOrders = useCallback(() => {
    Promise.all([
      fetch("/api/admin/orders?status=PENDING").then((r) => r.json()),
      fetch("/api/admin/orders?status=CONFIRMED").then((r) => r.json()),
    ])
      .then(([pending, confirmed]: [OrderData[], OrderData[]]) => {
        const allOrders = [...pending, ...confirmed];

        // Detect new orders and fire desktop notifications
        if ("Notification" in window && Notification.permission === "granted") {
          const newOrders = allOrders.filter((o) => !knownOrderIds.current.has(o.id));
          for (const order of newOrders) {
            const tableNumber = order.session.table.number;
            const itemSummary = order.items
              .map((i) => {
                const names = i.menuItem?.names ?? [];
                const localeName = names.find((n) => n.locale === locale);
                const thName = names.find((n) => n.locale === cfg.defaultLocale);
                const name = localeName?.name || thName?.name || names[0]?.name || `#${i.menuItemId}`;
                return `${name} x${i.quantity}`;
              })
              .join(", ");
            const total = formatMoneyWith(order.totalAmount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });

            const notification = new Notification(
              t("newOrderNotification", { table: tableNumber }),
              {
                body: t("newOrderNotificationBody", { items: itemSummary, total }),
                tag: `order-${order.id}`,
              }
            );
            notification.onclick = () => {
              window.focus();
              setSelectedSessionId(order.sessionId);
              notification.close();
            };
          }
        }

        // Update known IDs
        knownOrderIds.current = new Set(allOrders.map((o) => o.id));

        setOrders(allOrders);
        setIsPolling(true);
      })
      .catch(() => {
        setIsPolling(false);
      });
  }, [t, locale, cfg.currency, cfg.decimals, cfg.defaultLocale]);

  // Fetch on mount + poll every 10s
  useEffect(() => {
    fetchOrders();
    const poll = setInterval(fetchOrders, 10_000);
    return () => clearInterval(poll);
  }, [fetchOrders]);

  const COLUMNS: {
    status: BoardStatus;
    labelKey: "pending" | "confirmed";
    color: string;
  }[] = [
    { status: "PENDING", labelKey: "pending", color: "bg-yellow-400" },
    { status: "CONFIRMED", labelKey: "confirmed", color: "bg-green-500" },
  ];

  // Handle local status change from order card button clicks
  const handleStatusChange = useCallback(
    (orderId: number, newStatus: string) => {
      setOrders((prev) =>
        prev
          .map((order) => {
            if (order.id === orderId) {
              if (newStatus === "COMPLETED" || newStatus === "DECLINED") {
                return null;
              }
              return { ...order, status: newStatus as BoardStatus };
            }
            return order;
          })
          .filter((o): o is OrderData => o !== null)
      );
    },
    []
  );

  // Handle checkout complete — remove all orders for that session
  const handleCheckoutComplete = useCallback((sessionId: string) => {
    setOrders((prev) => prev.filter((o) => o.sessionId !== sessionId));
  }, []);

  // Handle order updated (item quantity changed)
  const handleOrderUpdated = useCallback(
    (orderId: number, updatedOrder: OrderData) => {
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? updatedOrder : o))
      );
    },
    []
  );

  // Handle order removed (all items deleted)
  const handleOrderRemoved = useCallback((orderId: number) => {
    setOrders((prev) => prev.filter((o) => o.id !== orderId));
  }, []);

  // Group orders by status, then by table (memoized)
  const ordersByStatus = useMemo(() => {
    const result: Record<BoardStatus, OrderData[]> = {
      PENDING: [],
      CONFIRMED: [],
    };
    for (const order of orders) {
      const s = order.status as string;
      if (s in result) {
        result[s as BoardStatus].push(order);
      }
    }
    return result;
  }, [orders]);

  // Compute active group for modal (keeps in sync with polling updates)
  const activeGroup = useMemo(() => {
    if (!selectedSessionId) return null;
    const sessionOrders = orders.filter(
      (o) => o.sessionId === selectedSessionId
    );
    if (sessionOrders.length === 0) return null;
    return {
      sessionId: selectedSessionId,
      tableNumber: sessionOrders[0].session.table.number,
      orders: sessionOrders,
      totalAmount: sessionOrders.reduce((sum, o) => sum + o.totalAmount, 0),
    };
  }, [selectedSessionId, orders]);

  return (
    <div className="p-4">
      {/* Polling status */}
      <div className="mb-4 flex items-center gap-2" role="status" aria-live="polite">
        <span
          className={`inline-block h-2 w-2 rounded-full ${isPolling ? "bg-green-500" : "bg-red-500"}`}
          aria-hidden="true"
        />
        <span className="text-xs text-gray-500">
          {isPolling ? t("liveUpdatesActive") : t("reconnecting")}
        </span>
      </div>

      {/* Kanban board */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {COLUMNS.map(({ status, labelKey, color }) => {
          const columnOrders = ordersByStatus[status];
          const groups = groupByTable(columnOrders);
          return (
            <div
              key={status}
              className="rounded-lg bg-gray-100 p-3 lg:flex-1"
            >
              {/* Column header */}
              <div className="mb-3 flex items-center gap-2">
                <span className={`h-3 w-3 rounded-full ${color}`} />
                <h2 className="text-sm font-semibold text-gray-700">
                  {tOrder(labelKey)}
                </h2>
                <span className="ml-auto rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {groups.length}
                </span>
              </div>

              {/* Table group cards */}
              <div className="space-y-3">
                {groups.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-400">
                    {tOrder("noOrders")}
                  </p>
                ) : (
                  groups.map((group) => (
                    <TableGroupCard
                      key={group.sessionId}
                      group={group}
                      onClick={(g) => setSelectedSessionId(g.sessionId)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Order detail modal */}
      {activeGroup && (
        <OrderDetailModal
          group={activeGroup}
          onClose={() => setSelectedSessionId(null)}
          onStatusChange={handleStatusChange}
          onCheckoutComplete={(sid) => {
            handleCheckoutComplete(sid);
            setSelectedSessionId(null);
          }}
          onOrderUpdated={handleOrderUpdated}
          onOrderRemoved={handleOrderRemoved}
        />
      )}
    </div>
  );
}
