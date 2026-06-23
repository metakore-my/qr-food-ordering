"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useConfig } from "@/components/providers/config-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { formatMoneyWith } from "@/lib/money-client";
import { resolveOptionName, type LocalizedName } from "@/lib/option-utils";

interface MenuItemName {
  locale: string;
  name: string;
}

interface OptionSnapshot {
  groupName?: LocalizedName;
  choiceName: LocalizedName;
  priceAdjustment?: number;
}

interface OrderItem {
  id: number;
  itemName?: string | null;
  quantity: number;
  unitPrice: number;
  selectedOptions?: OptionSnapshot[];
  menuItem: {
    id: number;
    names: MenuItemName[];
  } | null;
}

interface Order {
  id: number;
  status: string;
  totalAmount: number;
  createdAt: string;
  items: OrderItem[];
}

interface SessionData {
  id: string;
  status: string;
  createdAt: string;
  // Null for a takeaway (table-less) session. The scanner is reached by a
  // table-QR scan so it's dine-in in practice, but guard the deref so a
  // table-less session never renders "Table undefined".
  table: { id: number; number: number } | null;
  grandTotal: number;
  orders: Order[];
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  CONFIRMED: "bg-green-100 text-green-800",
  DECLINED: "bg-red-100 text-red-800",
};

function formatOptionSnapshot(
  opts: OptionSnapshot[],
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

export function CheckoutScanner() {
  const locale = useLocale();
  const cfg = useConfig();
  const money = useCallback(
    (amount: number) =>
      formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale }),
    [cfg.currency, cfg.decimals, cfg.defaultLocale]
  );
  const t = useTranslations("admin.checkoutScanner");
  const tOrder = useTranslations("order");
  const tCommon = useTranslations("common");
  const tCart = useTranslations("cart");
  const confirm = useConfirm();

  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [scannerActive, setScannerActive] = useState(false);

  // Order management state (matching order-detail-modal)
  const [loadingOrderId, setLoadingOrderId] = useState<number | null>(null);
  const [decliningOrderId, setDecliningOrderId] = useState<number | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);

  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrScannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);

  // Live locale-matched name first; the order-time snapshot only backstops a
  // deleted item / missing translation (mirrors lib/report-utils getItemName).
  function getItemName(names: MenuItemName[], snapshot?: string | null): string {
    const localized = names.find((n) => n.locale === locale);
    if (localized) return localized.name;
    const fallback = names.find((n) => n.locale === cfg.canonicalLocale);
    if (fallback) return fallback.name;
    return snapshot || names[0]?.name || tCart("unknownItem");
  }

  /**
   * Extract the signed table token from a QR code value.
   * QR codes encode a URL like: https://host/[locale]/table/SIGNED_TOKEN
   */
  function extractTokenFromQr(qrValue: string): string | null {
    const trimmed = qrValue.trim();
    const match = /\/table\/([A-Za-z0-9_-]+)/.exec(trimmed);
    if (match) return decodeURIComponent(match[1]);
    return null;
  }

  const lookupSession = useCallback(
    async (qrValue: string) => {
      const token = extractTokenFromQr(qrValue);
      if (!token) {
        setError(t("invalidSession"));
        return;
      }

      setLoading(true);
      setError(null);
      setSuccess(null);
      setSessionData(null);

      try {
        const res = await fetch(
          `/api/admin/sessions/by-token/${encodeURIComponent(token)}`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (res.status === 404) {
            setError(body?.error ?? t("invalidSession"));
          } else if (res.status === 400) {
            setError(t("invalidSession"));
          } else {
            setError(body?.error ?? tCommon("error"));
          }
          return;
        }

        const data: SessionData = await res.json();

        if (data.status === "CHECKED_OUT") {
          setError(t("alreadyCheckedOut"));
          setSessionData(data);
          return;
        }

        if (data.status === "EXPIRED") {
          setError(t("sessionExpired"));
          return;
        }

        setSessionData(data);
      } catch {
        setError(tCommon("error"));
      } finally {
        setLoading(false);
      }
    },
    [t, tCommon]
  );

  // ── Order management handlers (same as order-detail-modal) ──

  const handleConfirmOrder = useCallback(async (orderId: number) => {
    setLoadingOrderId(orderId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CONFIRMED" }),
      });
      if (res.ok) {
        setSessionData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            orders: prev.orders.map((o) =>
              o.id === orderId ? { ...o, status: "CONFIRMED" } : o
            ),
          };
        });
      } else {
        setError(tOrder("editFailed"));
      }
    } catch {
      setError(tOrder("editFailed"));
    } finally {
      setLoadingOrderId(null);
    }
  }, [tOrder]);

  const handleDeclineOrder = useCallback(async (orderId: number) => {
    // Declining is irreversible — require explicit confirmation (mirrors the
    // dashboard modal and the delete-confirmation invariant).
    if (!(await confirm({ message: tOrder("confirmDecline") }))) return;
    setDecliningOrderId(orderId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DECLINED" }),
      });
      if (res.ok) {
        setSessionData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            orders: prev.orders.map((o) =>
              o.id === orderId ? { ...o, status: "DECLINED" } : o
            ),
          };
        });
      } else {
        setError(tOrder("editFailed"));
      }
    } catch {
      setError(tOrder("editFailed"));
    } finally {
      setDecliningOrderId(null);
    }
  }, [tOrder, confirm]);

  const handleConfirmAll = useCallback(async () => {
    if (!sessionData) return;
    const pending = sessionData.orders.filter((o) => o.status === "PENDING");
    setConfirmingAll(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        pending.map((order) =>
          fetch(`/api/admin/orders/${order.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "CONFIRMED" }),
          })
        )
      );
      // Promise.allSettled never rejects (the catch can't see HTTP failures), and
      // the scanner doesn't poll — so a silently-skipped non-ok PATCH would leave
      // the board wrong until re-scan. Count the failures and surface them.
      const confirmedIds = new Set<number>();
      let failed = 0;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled" && result.value.ok) {
          confirmedIds.add(pending[i].id);
        } else {
          failed++;
        }
      }
      setSessionData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          orders: prev.orders.map((o) =>
            confirmedIds.has(o.id) ? { ...o, status: "CONFIRMED" } : o
          ),
        };
      });
      if (failed > 0) {
        setError(tOrder("confirmAllPartial", { failed, total: pending.length }));
      }
    } catch {
      setError(tOrder("editFailed"));
    } finally {
      setConfirmingAll(false);
    }
  }, [sessionData, tOrder]);

  const handleItemUpdate = useCallback(async (
    orderId: number,
    itemId: number,
    newQuantity: number
  ) => {
    const key = `${orderId}-${itemId}`;
    setEditingItem(key);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/orders/${orderId}/items/${itemId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: newQuantity }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.deleted) {
          // Order was deleted (all items removed)
          setSessionData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              orders: prev.orders.filter((o) => o.id !== orderId),
            };
          });
        } else {
          // Order updated
          setSessionData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              orders: prev.orders.map((o) =>
                o.id === orderId
                  ? {
                      ...o,
                      totalAmount: Number(data.order.totalAmount),
                      items: data.order.items.map((item: OrderItem) => ({
                        id: item.id,
                        itemName: item.itemName,
                        quantity: item.quantity,
                        unitPrice: Number(item.unitPrice),
                        selectedOptions: item.selectedOptions,
                        menuItem: item.menuItem,
                      })),
                    }
                  : o
              ),
            };
          });
        }
      } else {
        setError(tOrder("editFailed"));
      }
    } catch {
      setError(tOrder("editFailed"));
    } finally {
      setEditingItem(null);
    }
  }, [tOrder]);

  const handleCheckout = useCallback(async () => {
    if (!sessionData) return;

    setCheckoutLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/sessions/${sessionData.id}/checkout`,
        { method: "POST" }
      );

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // Map the server's stable machine code to a localized message — never
        // render the raw English `body.error` (admins use all 6 locales too).
        const codeMessages: Record<string, string> = {
          SESSION_NOT_FOUND: t("invalidSession"),
          SESSION_INACTIVE: t("errorSessionInactive"),
          ORDERS_PENDING: t("errorOrdersPending"),
          NO_CONFIRMED_ORDERS: t("errorNoConfirmed"),
        };
        setError(
          (body?.code && codeMessages[body.code]) || tCommon("error")
        );
        return;
      }

      const result = await res.json();
      setSuccess(
        t("checkoutSuccess", {
          // tableNumber is null for a table-less (takeaway) session — fall back
          // to the localized takeaway label so the message never reads "Table ".
          table: result.tableNumber ?? tOrder("takeawayLabel"),
          total: money(result.grandTotal),
        })
      );
      setSessionData(null);
    } catch {
      setError(tCommon("error"));
    } finally {
      setCheckoutLoading(false);
    }
  }, [sessionData, t, tCommon, tOrder, money]);

  // Force-close an ACTIVE table without a checkout. The settlement flow needs at
  // least one CONFIRMED order, so a session where every order was DECLINED (or
  // the only order was) can't be checked out and would otherwise sit ACTIVE
  // until the 4h inactivity timer + daily cron sweep it. This gives staff a
  // direct ACTIVE→EXPIRED close (also useful for a walkout with pending orders).
  // The server (PATCH /api/sessions/[sessionId], orders-permission-gated)
  // DECLINES all open orders in the same transaction — they can never be
  // settled once the session ends — so the confirm dialog must state how many
  // unpaid orders the close cancels (delete-confirmation invariant).
  const handleCloseTable = useCallback(async () => {
    if (!sessionData) return;
    const openOrders = sessionData.orders.filter(
      (o) => o.status === "PENDING" || o.status === "CONFIRMED"
    ).length;
    if (!(await confirm({ message: t("confirmCloseTable", { count: openOrders }) }))) return;

    setCheckoutLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/sessions/${sessionData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "EXPIRED" }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // Localized per machine code. The only invalid transition reachable
        // from the UI is closing an already-EXPIRED session (double-close, or
        // a race with the cron sweep) — say "already closed", not the raw
        // English transition string.
        const codeMessages: Record<string, string> = {
          SESSION_NOT_FOUND: t("invalidSession"),
          INVALID_TRANSITION: t("errorAlreadyClosed"),
        };
        setError(
          (body?.code && codeMessages[body.code]) || tCommon("error")
        );
        return;
      }

      setSuccess(
        t("closeTableSuccess", {
          table: sessionData.table?.number ?? tOrder("takeawayLabel"),
        })
      );
      setSessionData(null);
    } catch {
      setError(tCommon("error"));
    } finally {
      setCheckoutLoading(false);
    }
  }, [sessionData, t, tCommon, tOrder, confirm]);

  // Start/stop QR scanner
  const toggleScanner = useCallback(async () => {
    if (scannerActive) {
      // Stop
      try {
        await html5QrScannerRef.current?.stop();
      } catch {
        // Ignore stop errors
      }
      html5QrScannerRef.current = null;
      setScannerActive(false);
      return;
    }

    // Start
    setScannerActive(true);
    setError(null);
    setSuccess(null);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-reader");
      html5QrScannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          // QR scanned successfully
          scanner.stop().catch(() => {});
          html5QrScannerRef.current = null;
          setScannerActive(false);
          lookupSession(decodedText);
        },
        () => {
          // Scan failure - ignore (happens every frame without QR)
        }
      );
    } catch {
      setScannerActive(false);
      setError(t("cameraError"));
    }
  }, [scannerActive, lookupSession, t]);

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      html5QrScannerRef.current?.stop().catch(() => {});
    };
  }, []);

  // Derived state
  const pendingOrders = sessionData?.orders.filter((o) => o.status === "PENDING") ?? [];
  const confirmedOrders = sessionData?.orders.filter((o) => o.status === "CONFIRMED") ?? [];
  const nonDeclinedOrders = sessionData?.orders.filter((o) => o.status !== "DECLINED") ?? [];
  // Map order.id → per-session sequential number (1-based)
  const orderNumberMap = new Map<number, number>();
  sessionData?.orders.forEach((o, i) => orderNumberMap.set(o.id, i + 1));
  const allConfirmed = sessionData
    ? pendingOrders.length === 0 && confirmedOrders.length > 0
    : false;

  // Grand total from confirmed orders only
  const confirmedTotal = confirmedOrders.reduce(
    (sum, order) => sum + order.totalAmount,
    0
  );

  const handleReset = useCallback(() => {
    setSessionData(null);
    setError(null);
    setSuccess(null);
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
      {/* QR Scanner Section */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          {t("scanQr")}
        </h2>

        <button
          type="button"
          onClick={toggleScanner}
          className={`mb-4 flex w-full min-h-[44px] items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
            scannerActive
              ? "bg-red-50 text-red-700 hover:bg-red-100"
              : "bg-primary-500 text-white hover:bg-primary-600"
          }`}
        >
          {scannerActive ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              {t("stopScanner")}
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
              </svg>
              {t("startScanner")}
            </>
          )}
        </button>

        {/* QR reader container */}
        <div
          ref={scannerRef}
          id="qr-reader"
          className={`mx-auto max-w-sm overflow-hidden rounded-lg ${scannerActive ? "" : "hidden"}`}
        />
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg
              className="h-8 w-8 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <p className="text-lg font-semibold text-gray-900">{success}</p>
          <button
            type="button"
            onClick={handleReset}
            className="mt-4 rounded-lg bg-primary-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {t("scanAnother")}
          </button>
        </div>
      )}

      {/* Stuck table — ACTIVE session whose every order was declined (or it has
          no orders). Settlement needs a CONFIRMED order, so there's nothing to
          check out; without this panel the scanner would show nothing and the
          table could only clear via the 4h timer + daily cron. Give staff a
          direct close. */}
      {sessionData && sessionData.status === "ACTIVE" && nonDeclinedOrders.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-4 py-4">
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-primary-500/10 px-2 py-1 text-sm font-bold text-primary-500">
                {sessionData.table ? tOrder("tableNumber", { number: sessionData.table.number }) : tOrder("takeawayLabel")}
              </span>
              <span className="text-sm text-gray-500">
                {t("sessionId")}: {sessionData.id.slice(0, 8)}...
              </span>
            </div>
          </div>
          <div className="px-4 py-6">
            <p className="mb-4 text-sm text-gray-600">
              {/* Zero orders ≠ "all orders were declined" — say which it is. */}
              {sessionData.orders.length === 0
                ? t("noOrdersOnTable")
                : t("noConfirmableOrders")}
            </p>
            <button
              type="button"
              onClick={handleCloseTable}
              disabled={checkoutLoading}
              className="w-full rounded-lg bg-red-600 py-3 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkoutLoading ? t("processing") : t("closeTable")}
            </button>
          </div>
        </div>
      )}

      {/* Session Details — full order management */}
      {sessionData && sessionData.status === "ACTIVE" && nonDeclinedOrders.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          {/* Session header */}
          <div className="border-b border-gray-200 px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-primary-500/10 px-2 py-1 text-sm font-bold text-primary-500">
                  {sessionData.table ? tOrder("tableNumber", { number: sessionData.table.number }) : tOrder("takeawayLabel")}
                </span>
                <span className="text-sm text-gray-500">
                  {t("sessionId")}: {sessionData.id.slice(0, 8)}...
                </span>
              </div>
              <p className="text-sm text-gray-500">
                {t("orderCount", { count: nonDeclinedOrders.length })}
              </p>
            </div>
          </div>

          {/* Orders list */}
          <div className="space-y-4 px-4 py-4">
            {nonDeclinedOrders.map((order) => (
              <div
                key={order.id}
                className="rounded-lg border border-gray-200 p-3"
              >
                {/* Order header */}
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">
                      {tOrder("orderNumber", { id: orderNumberMap.get(order.id) ?? order.id })}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-800"}`}
                    >
                      {tOrder(order.status.toLowerCase() as "pending" | "confirmed" | "declined")}
                    </span>
                  </div>
                  {order.status === "PENDING" && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleDeclineOrder(order.id)}
                        disabled={decliningOrderId === order.id || loadingOrderId === order.id}
                        className="inline-flex min-h-[44px] items-center rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 disabled:opacity-50"
                      >
                        {decliningOrderId === order.id
                          ? tOrder("updating")
                          : tOrder("decline")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmOrder(order.id)}
                        disabled={loadingOrderId === order.id || decliningOrderId === order.id}
                        className="inline-flex min-h-[44px] items-center rounded-md bg-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:opacity-50"
                      >
                        {loadingOrderId === order.id
                          ? tOrder("updating")
                          : tOrder("confirm")}
                      </button>
                    </div>
                  )}
                </div>

                {/* Order items with inline editing */}
                <div className="space-y-1.5">
                  {order.items.map((item) => {
                    const isEditing =
                      editingItem === `${order.id}-${item.id}`;
                    const optionText = formatOptionSnapshot(item.selectedOptions ?? [], money, locale, cfg.canonicalLocale);
                    return (
                      <div key={item.id}>
                      <div
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="min-w-0 flex-1 text-gray-700">
                          {getItemName(item.menuItem?.names ?? [], item.itemName)}
                        </span>
                        <div className="ml-2 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              if (item.quantity === 1) {
                                if (!(await confirm({ message: tOrder("confirmRemoveItem", { name: getItemName(item.menuItem?.names ?? [], item.itemName) }) }))) {
                                  return;
                                }
                              }
                              handleItemUpdate(
                                order.id,
                                item.id,
                                item.quantity - 1
                              );
                            }}
                            disabled={isEditing}
                            className="flex h-11 w-11 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50"
                          >
                            {item.quantity === 1 ? (
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            ) : (
                              "−"
                            )}
                          </button>
                          <span className="w-6 text-center font-medium text-gray-900">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleItemUpdate(
                                order.id,
                                item.id,
                                item.quantity + 1
                              )
                            }
                            disabled={isEditing}
                            className="flex h-11 w-11 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50"
                          >
                            +
                          </button>
                          <span className="ml-1 w-20 text-right text-gray-500">
                            {money(item.unitPrice * item.quantity)}
                          </span>
                        </div>
                      </div>
                      {optionText && (
                        <p className="ml-1 text-xs text-gray-600">{optionText}</p>
                      )}
                      </div>
                    );
                  })}
                </div>

                {/* Order total */}
                <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                  <span className="text-xs font-medium text-gray-500">
                    {tOrder("total")}
                  </span>
                  <span className="text-sm font-bold text-gray-900">
                    {money(order.totalAmount)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Footer — Confirm All or Checkout */}
          <div className="border-t border-gray-200 px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">
                {t("grandTotal")}
              </span>
              <span className="text-lg font-bold text-gray-900">
                {money(confirmedTotal)}
              </span>
            </div>
            {allConfirmed ? (
              <button
                type="button"
                onClick={handleCheckout}
                disabled={checkoutLoading}
                className="w-full rounded-lg bg-primary-500 py-3 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checkoutLoading ? t("processing") : t("confirmCheckout")}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConfirmAll}
                disabled={confirmingAll}
                className="w-full rounded-lg bg-primary-500 py-3 text-sm font-medium text-white hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirmingAll
                  ? t("processing")
                  : tOrder("confirmAll", { count: pendingOrders.length })}
              </button>
            )}
            {/* Escape hatch: close the table without settling (walkout, or a
                session that can't reach checkout). Secondary styling so it's
                clearly not the primary action. */}
            <button
              type="button"
              onClick={handleCloseTable}
              disabled={checkoutLoading || confirmingAll}
              className="mt-2 w-full rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("closeTable")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
