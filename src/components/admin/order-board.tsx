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
import { useOrderAlertSound } from "@/hooks/use-order-alert-sound";

type BoardStatus = "PENDING" | "CONFIRMED";

interface OrderBoardProps {
  initialOrders: OrderData[];
}

function groupByTable(orders: OrderData[]): TableGroup[] {
  const map = new Map<
    string,
    { sessionId: string; tableNumber: number | null; orderType: "DINE_IN" | "TAKEAWAY"; customerName: string | null; orders: OrderData[] }
  >();

  for (const order of orders) {
    const key = order.sessionId;
    if (!map.has(key)) {
      map.set(key, {
        sessionId: order.sessionId,
        tableNumber: order.session.table?.number ?? null,
        orderType: order.orderType,
        customerName: order.customerName,
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
  // Guards the first poll: the initial fetch must not chime/notify for orders
  // that were already on the board at page load — only for genuinely-new ones.
  const knownInitializedRef = useRef(false);

  const locale = useLocale();
  const cfg = useConfig();
  const t = useTranslations("admin.dashboard");
  const tOrder = useTranslations("order");

  // Per-device new-order sound alert. Configured in Settings → Notifications;
  // this board is the consumer + the place audio is unlocked (autoplay policy
  // requires the unlock gesture to happen on the page that plays sound).
  const {
    enabled: soundEnabled,
    unlocked: soundUnlocked,
    unlock: unlockSound,
    play: playAlert,
  } = useOrderAlertSound();
  // Stable ref so the polling callback can call play() without re-subscribing.
  const playAlertRef = useRef(playAlert);
  useEffect(() => {
    playAlertRef.current = playAlert;
  }, [playAlert]);

  // Request browser notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Fetch all active orders from the API — ONE request for both active columns
  // (the endpoint accepts a comma-separated status list), halving the polled work
  // vs the old two-request fan-out. The board groups by status downstream.
  const fetchOrders = useCallback(() => {
    fetch("/api/admin/orders?status=PENDING,CONFIRMED")
      .then((r) => r.json())
      .then((allOrders: OrderData[]) => {
        // Detect new orders ONCE — used by BOTH the sound alert and the desktop
        // notification. Computed outside the Notification guard so the sound
        // path works even where Notifications are unavailable (mobile/tablet
        // Chrome blocks the `new Notification()` constructor entirely).
        const newOrders = allOrders.filter(
          (o) => !knownOrderIds.current.has(o.id)
        );

        // Sound alert — page-driven, so it reaches mobile/tablet kitchen
        // devices that OS notifications can't. No-op unless the device armed
        // and enabled sound (autoplay policy). Skipped on the very first fetch
        // so a fresh page load doesn't chime for the already-on-board orders.
        if (knownInitializedRef.current && newOrders.length > 0) {
          playAlertRef.current();
        }

        // Desktop notification — best-effort, desktop-only in practice. The
        // constructor THROWS on Android Chrome, so each call is wrapped: a
        // throw must not abort the loop or the surrounding fetch handler.
        if ("Notification" in window && Notification.permission === "granted") {
          for (const order of newOrders) {
            const itemSummary = order.items
              .map((i) => {
                const names = i.menuItem?.names ?? [];
                const localeName = names.find((n) => n.locale === locale);
                const thName = names.find((n) => n.locale === cfg.canonicalLocale);
                // Live locale-matched name first; snapshot backstops deletes.
                const name = localeName?.name || thName?.name || i.itemName || names[0]?.name || `#${i.menuItemId}`;
                return `${name} x${i.quantity}`;
              })
              .join(", ");
            const total = formatMoneyWith(order.totalAmount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });

            // Dine-in keeps the existing "New order from Table N" title; a
            // table-less takeaway has no table number, so its title is the
            // takeaway label (name, else order id) — the deref can't crash now.
            const notificationTitle = order.session.table
              ? t("newOrderNotification", { table: order.session.table.number })
              : order.customerName
                ? t("takeawayNamed", { name: order.customerName })
                : t("takeawayUnnamed", { id: order.id });

            try {
              const notification = new Notification(
                notificationTitle,
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
            } catch {
              /* constructor unsupported (e.g. Android Chrome) — sound covers it */
            }
          }
        }

        // Update known IDs
        knownOrderIds.current = new Set(allOrders.map((o) => o.id));
        knownInitializedRef.current = true;

        setOrders(allOrders);
        setIsPolling(true);
      })
      .catch(() => {
        setIsPolling(false);
      });
  }, [t, locale, cfg.currency, cfg.decimals, cfg.defaultLocale, cfg.canonicalLocale]);

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

  // "Mark collected" — settle a table-less counter-takeaway's single order.
  // POSTs the collect route (COMPLETED via updateMany), then refetches the board
  // so the now-COMPLETED order leaves the active columns on the next render.
  const handleCollect = useCallback(
    (orderId: number) => {
      fetch(`/api/admin/orders/${orderId}/collect`, { method: "POST" })
        .then((r) => {
          if (r.ok) {
            // Optimistically drop the collected order; the poll reconciles.
            setOrders((prev) => prev.filter((o) => o.id !== orderId));
          }
        })
        .catch(() => {
          /* leave it on the board; next poll reflects true state */
        })
        .finally(() => {
          fetchOrders();
        });
    },
    [fetchOrders]
  );

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
      tableNumber: sessionOrders[0].session.table?.number ?? null,
      orderType: sessionOrders[0].orderType,
      customerName: sessionOrders[0].customerName,
      orders: sessionOrders,
      totalAmount: sessionOrders.reduce((sum, o) => sum + o.totalAmount, 0),
    };
  }, [selectedSessionId, orders]);

  return (
    <div className="p-4">
      {/* Polling status */}
      <div className="mb-4 flex flex-wrap items-center gap-2" role="status" aria-live="polite">
        {/* On an opaque chip so the status reads against any slideshow frame
            behind the board (the bg veil is weakest at the bottom). */}
        <span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 shadow-sm ring-1 ring-gray-200 backdrop-blur-sm">
          <span
            className={`inline-block h-2 w-2 rounded-full ${isPolling ? "bg-green-500" : "bg-red-500"}`}
            aria-hidden="true"
          />
          <span className="text-xs font-medium text-gray-700">
            {isPolling ? t("liveUpdatesActive") : t("reconnecting")}
          </span>
        </span>

        {/* Sound-arm prompt: sound is enabled for this device but the browser
            autoplay policy requires one user gesture per page load to start
            playing. Shown only when enabled-but-not-yet-armed; tapping it is
            the gesture. Hidden once armed and after a fresh-load re-arm. */}
        {soundEnabled && !soundUnlocked && (
          <button
            type="button"
            onClick={() => {
              void unlockSound();
            }}
            className="ml-auto inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <span aria-hidden="true">🔔</span>
            {t("tapToEnableSound")}
          </button>
        )}
        {soundEnabled && soundUnlocked && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <span aria-hidden="true">🔔</span>
            {t("soundArmed")}
          </span>
        )}
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
                  <p className="py-8 text-center text-sm text-gray-600">
                    {tOrder("noOrders")}
                  </p>
                ) : (
                  groups.map((group) => (
                    <TableGroupCard
                      key={group.sessionId}
                      group={group}
                      onClick={(g) => setSelectedSessionId(g.sessionId)}
                      onCollect={handleCollect}
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
