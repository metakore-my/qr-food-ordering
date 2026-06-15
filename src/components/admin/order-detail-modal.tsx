"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { TableGroup } from "@/components/admin/table-group-card";
import type { OrderData } from "@/components/admin/order-card";
import { useConfig } from "@/components/providers/config-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { formatMoneyWith } from "@/lib/money-client";
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

interface OrderDetailModalProps {
  group: TableGroup;
  onClose: () => void;
  onStatusChange: (orderId: number, newStatus: string) => void;
  onCheckoutComplete: (sessionId: string) => void;
  onOrderUpdated: (orderId: number, updatedOrder: OrderData) => void;
  onOrderRemoved: (orderId: number) => void;
}

export function OrderDetailModal({
  group,
  onClose,
  onStatusChange,
  onCheckoutComplete,
  onOrderUpdated,
  onOrderRemoved,
}: OrderDetailModalProps) {
  const t = useTranslations("order");
  const tCart = useTranslations("cart");
  const tCommon = useTranslations("common");
  const tCheckout = useTranslations("admin.checkoutScanner");
  const locale = useLocale();
  const cfg = useConfig();
  const confirm = useConfirm();
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });

  const [loadingOrderId, setLoadingOrderId] = useState<number | null>(null);
  const [decliningOrderId, setDecliningOrderId] = useState<number | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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

  const statusBadgeColors: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-800",
    CONFIRMED: "bg-green-100 text-green-800",
    DECLINED: "bg-red-100 text-red-800",
  };

  const handleConfirmOrder = async (orderId: number) => {
    setLoadingOrderId(orderId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CONFIRMED" }),
      });
      if (res.ok) {
        onStatusChange(orderId, "CONFIRMED");
        // If this was the last pending order, close modal (same as Confirm All)
        if (pendingOrders.length <= 1) {
          onClose();
          return;
        }
      }
    } catch {
      // Silently handle
    } finally {
      setLoadingOrderId(null);
    }
  };

  const handleDeclineOrder = async (orderId: number) => {
    // Declining is irreversible (no transition back) and the red button sits
    // next to Confirm on touch devices — require explicit confirmation, like
    // every other destructive action.
    if (!(await confirm({ message: t("confirmDecline") }))) return;
    setDecliningOrderId(orderId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DECLINED" }),
      });
      if (res.ok) {
        onStatusChange(orderId, "DECLINED");
        if (pendingOrders.length <= 1) {
          onClose();
          return;
        }
      }
    } catch {
      // Silently handle
    } finally {
      setDecliningOrderId(null);
    }
  };

  const pendingOrders = group.orders.filter((o) => o.status === "PENDING");
  const allConfirmed = pendingOrders.length === 0;

  // Map order.id → per-session sequential number (1-based, by creation order)
  const orderNumberMap = new Map<number, number>();
  [...group.orders].sort((a, b) => a.id - b.id).forEach((o, i) => orderNumberMap.set(o.id, i + 1));

  const handleConfirmAll = async () => {
    setConfirmingAll(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        pendingOrders.map((order) =>
          fetch(`/api/admin/orders/${order.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "CONFIRMED" }),
          })
        )
      );
      // Promise.allSettled never rejects, so the catch below can't surface a
      // partial failure — count non-ok/rejected PATCHes explicitly. The
      // succeeded ones still flip to CONFIRMED; if any failed, keep the modal
      // open with a message rather than silently closing on a half-done confirm.
      let failed = 0;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled" && result.value.ok) {
          onStatusChange(pendingOrders[i].id, "CONFIRMED");
        } else {
          failed++;
        }
      }
      if (failed > 0) {
        setError(t("confirmAllPartial", { failed, total: pendingOrders.length }));
        return;
      }
      onClose();
    } catch {
      setError(t("editFailed"));
    } finally {
      setConfirmingAll(false);
    }
  };

  const handleCheckout = async () => {
    setCheckingOut(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${group.sessionId}/checkout`,
        { method: "POST" }
      );
      if (res.ok) {
        setCheckoutSuccess(true);
        onCheckoutComplete(group.sessionId);
      } else {
        const data = await res.json().catch(() => ({}));
        // Map the server's stable machine code to a localized message — never
        // render the raw English `data.error` (admins use all 6 locales too).
        // Mirrors checkout-scanner.tsx; reuses the same admin.checkoutScanner keys.
        const codeMessages: Record<string, string> = {
          SESSION_NOT_FOUND: tCheckout("invalidSession"),
          SESSION_INACTIVE: tCheckout("errorSessionInactive"),
          ORDERS_PENDING: tCheckout("errorOrdersPending"),
          NO_CONFIRMED_ORDERS: tCheckout("errorNoConfirmed"),
        };
        setError((data.code && codeMessages[data.code]) || t("editFailed"));
      }
    } catch {
      setError(t("editFailed"));
    } finally {
      setCheckingOut(false);
    }
  };

  const handleItemUpdate = async (
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
          onOrderRemoved(orderId);
        } else {
          onOrderUpdated(orderId, data.order);
        }
      } else {
        setError(t("editFailed"));
      }
    } catch {
      setError(t("editFailed"));
    } finally {
      setEditingItem(null);
    }
  };

  if (checkoutSuccess) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 pb-20 md:pb-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
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
          <p className="text-lg font-semibold text-gray-900">
            {tCheckout("checkoutSuccess", {
              table: group.tableNumber,
              total: money(group.totalAmount),
            })}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded-lg bg-primary-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {tCommon("ok")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 pb-20 md:pb-4"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-detail-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl md:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4 sm:px-6">
          <div>
            <span id="order-detail-title" className="rounded-md bg-primary-500/10 px-2 py-1 text-sm font-bold text-primary-500">
              {t("tableNumber", { number: group.tableNumber })}
            </span>
            <span className="ml-3 text-sm text-gray-500">
              {tCheckout("sessionId")}: {group.sessionId.slice(0, 8)}...
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            aria-label={tCommon("close")}
          >
            <svg className="h-5 w-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-4 mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:mx-6">
            {error}
          </div>
        )}

        {/* Orders list */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 sm:px-6">
          {group.orders.map((order) => (
            <div
              key={order.id}
              className="rounded-lg border border-gray-200 p-3"
            >
              {/* Order header */}
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">
                    {t("orderNumber", { id: orderNumberMap.get(order.id) ?? order.id })}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeColors[order.status] || "bg-gray-100 text-gray-800"}`}
                  >
                    {t(order.status.toLowerCase() as "pending" | "confirmed" | "declined")}
                  </span>
                </div>
                {order.status === "PENDING" && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleDeclineOrder(order.id)}
                      disabled={decliningOrderId === order.id || loadingOrderId === order.id}
                      className="flex min-h-[44px] items-center rounded-md bg-red-600 px-3 py-2.5 text-xs font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 disabled:opacity-50"
                    >
                      {decliningOrderId === order.id
                        ? t("updating")
                        : t("decline")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfirmOrder(order.id)}
                      disabled={loadingOrderId === order.id || decliningOrderId === order.id}
                      className="flex min-h-[44px] items-center rounded-md bg-primary-500 px-3 py-2.5 text-xs font-medium text-white hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:opacity-50"
                    >
                      {loadingOrderId === order.id
                        ? t("updating")
                        : t("confirm")}
                    </button>
                  </div>
                )}
              </div>

              {/* Order items */}
              <div className="space-y-1.5">
                {order.items.map((item) => {
                  const isEditing =
                    editingItem === `${order.id}-${item.id}`;
                  const opts: Array<{ groupName?: LocalizedName; choiceName: LocalizedName }> = item.selectedOptions
                    ? (typeof item.selectedOptions === "string"
                        ? JSON.parse(item.selectedOptions)
                        : item.selectedOptions)
                    : [];
                  const optionText = formatOptionSnapshot(opts, money, locale, cfg.canonicalLocale);
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
                              if (!(await confirm({ message: t("confirmRemoveItem", { name: getItemName(item.menuItem?.names ?? [], item.itemName) }) }))) {
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
                  {t("total")}
                </span>
                <span className="text-sm font-bold text-gray-900">
                  {money(order.totalAmount)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-4 py-4 sm:px-6">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">
              {tCheckout("grandTotal")}
            </span>
            <span className="text-lg font-bold text-gray-900">
              {money(group.totalAmount)}
            </span>
          </div>
          {allConfirmed ? (
            <button
              type="button"
              onClick={handleCheckout}
              disabled={checkingOut}
              className="w-full rounded-lg bg-primary-500 py-3 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkingOut
                ? tCheckout("processing")
                : tCheckout("confirmCheckout")}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirmAll}
              disabled={confirmingAll}
              className="w-full rounded-lg bg-primary-500 py-3 text-sm font-medium text-white hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmingAll
                ? tCheckout("processing")
                : t("confirmAll", { count: pendingOrders.length })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
