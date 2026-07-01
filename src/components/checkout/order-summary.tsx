"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";
import { resolveOptionName, type LocalizedName } from "@/lib/option-utils";
import { renderReceiptToPngBlob } from "@/lib/receipt-canvas";
import type { ReceiptData, ReceiptOrder } from "@/lib/receipt-layout";

interface OrderItemOptionSnapshot {
  groupName: LocalizedName;
  choiceName: LocalizedName;
  priceAdjustment: number;
}

function formatOptionSnapshot(
  opts: OrderItemOptionSnapshot[],
  money: (amount: number) => string,
  locale: string,
  canonical: string
): string {
  if (!opts.length) return "";
  const grouped = new Map<string, string[]>();
  for (const o of opts) {
    const key = resolveOptionName(o.groupName, locale, canonical);
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

interface OrderItemData {
  id: number;
  menuItemId: number;
  quantity: number;
  unitPrice: number;
  menuItemName: string;
  itemName?: string | null;
  selectedOptions?: OrderItemOptionSnapshot[];
}

interface OrderData {
  id: number;
  status: string;
  totalAmount: number;
  createdAt: string;
  items: OrderItemData[];
}

interface OrderSummaryProps {
  sessionId: string;
  orders: OrderData[];
  locale: string;
  /** "Table 5" or "Takeaway" — resolved server-side (client has no session.table). */
  locationLabel: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  CONFIRMED: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-gray-100 text-gray-800",
  DECLINED: "bg-red-100 text-red-800",
};

export function OrderSummary({
  sessionId,
  orders: initialOrders,
  locale,
  locationLabel,
}: OrderSummaryProps) {
  const t = useTranslations("checkout");
  const tOrder = useTranslations("order");
  const cfg = useConfig();
  // Memoized so it has a stable identity for the download callback's deps.
  const money = useCallback(
    (amount: number) =>
      formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale }),
    [cfg.currency, cfg.decimals, cfg.defaultLocale]
  );
  const [orders, setOrders] = useState<OrderData[]>(initialOrders);
  const grandTotal = useMemo(
    () => orders.filter((o) => o.status !== "DECLINED").reduce((sum, o) => sum + o.totalAmount, 0),
    [orders]
  );
  const [isCheckedOut, setIsCheckedOut] = useState(false);

  // Download-receipt state. The ref short-circuits a re-entrant click (setState is
  // async, so `disabled` alone can't gate a same-tick second tap — cf. cart-sheet).
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const downloadingRef = useRef(false);

  const handleDownloadReceipt = useCallback(async () => {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    setIsDownloading(true);
    setDownloadFailed(false);
    try {
      const kept = orders.filter((o) => o.status !== "DECLINED");
      const receiptOrders: ReceiptOrder[] = kept.map((order, index) => ({
        title: t("orderNumber", { number: index + 1 }),
        subtotal: money(order.totalAmount),
        items: order.items.map((item) => ({
          qty: item.quantity,
          name: item.menuItemName,
          options:
            item.selectedOptions && item.selectedOptions.length > 0
              ? formatOptionSnapshot(item.selectedOptions, money, locale, cfg.canonicalLocale)
              : "",
          price: money(item.unitPrice * item.quantity),
        })),
      }));

      // Date from the newest kept order; shown in the customer's own device locale.
      const newest = kept.reduce<string | null>(
        (max, o) => (max === null || o.createdAt > max ? o.createdAt : max),
        null
      );
      const dateLabel = newest
        ? new Date(newest).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })
        : new Date().toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

      const data: ReceiptData = {
        appName: cfg.appName,
        logoUrl: cfg.logoUrl,
        locationLabel,
        dateLabel,
        orders: receiptOrders,
        grandTotalLabel: t("grandTotal"),
        grandTotal: money(grandTotal),
        thankYouNote: t("thankYouMessage"),
        subtotalLabel: t("subtotal"),
      };

      const blob = await renderReceiptToPngBlob(data);
      const url = URL.createObjectURL(blob);
      const slug = cfg.appName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "receipt";
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipt-${slug}-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadFailed(true);
    } finally {
      downloadingRef.current = false;
      setIsDownloading(false);
    }
  }, [orders, t, money, locale, cfg.canonicalLocale, cfg.appName, cfg.logoUrl, locationLabel, grandTotal]);

  // Keep the latest locale in a ref so the polling callback can read it without
  // listing `locale` as a dependency (which would re-create the 10s interval).
  // Synced in an effect rather than during render to avoid mutating a ref mid-render.
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  // Poll for order status updates every 10s
  const pollOrders = useCallback(() => {
    fetch(`/api/sessions/${sessionId}/orders`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;

        if (data.sessionStatus === "CHECKED_OUT" || data.sessionStatus === "EXPIRED") {
          setIsCheckedOut(true);
        }

        if (data.orders) {
          const loc = localeRef.current;
          setOrders(
            data.orders.map((order: {
              id: number;
              status: string;
              totalAmount: number;
              createdAt: string;
              items: Array<{
                id: number;
                menuItemId: number;
                quantity: number;
                unitPrice: number;
                itemName?: string | null;
                selectedOptions: OrderItemOptionSnapshot[];
                menuItem: {
                  id: number;
                  names: Array<{ locale: string; name: string }>;
                } | null;
              }>;
            }) => ({
              id: order.id,
              status: order.status,
              totalAmount: order.totalAmount,
              createdAt: order.createdAt,
              items: order.items.map((item) => {
                // Live locale-matched name first; the order-time snapshot only
                // backstops a deleted item / missing translation.
                const names = item.menuItem?.names ?? [];
                const localeName = names.find((n) => n.locale === loc);
                const thName = names.find((n) => n.locale === cfg.canonicalLocale);
                const anyName = names[0];
                const menuItemName =
                  localeName?.name || thName?.name || item.itemName || anyName?.name || `#${item.menuItemId}`;

                return {
                  id: item.id,
                  menuItemId: item.menuItemId,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  menuItemName,
                  selectedOptions: item.selectedOptions,
                };
              }),
            }))
          );
        }
      })
      .catch(() => {});
  }, [sessionId, cfg.canonicalLocale]);

  useEffect(() => {
    // Once checked out, the session is terminal — the thank-you screen just waits
    // for the customer (e.g. to download the receipt), so stop polling: further
    // fetches only re-confirm the same CHECKED_OUT status.
    if (isCheckedOut) return;
    const poll = setInterval(pollOrders, 10_000);
    return () => clearInterval(poll);
  }, [pollOrders, isCheckedOut]);

  // Thank you screen after checkout
  if (isCheckedOut) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-10 w-10 text-green-600"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        <h2 className="mb-2 text-2xl font-bold text-gray-900">
          {t("thankYou")}
        </h2>
        <p className="mb-6 text-center text-gray-600">
          {t("thankYouMessage")}
        </p>

        {/* Grand total display */}
        <div className="mb-6 rounded-xl bg-white px-8 py-4 shadow-sm">
          <p className="text-sm text-gray-500">{t("grandTotal")}</p>
          <p className="text-3xl font-bold text-gray-900">
            {money(grandTotal)}
          </p>
        </div>

        {/* Download receipt — the itemized breakdown vanishes from screen at
            checkout, so this hands the customer a keep-able PNG copy. */}
        <button
          type="button"
          onClick={handleDownloadReceipt}
          disabled={isDownloading}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 3a1 1 0 011 1v6.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L9 10.586V4a1 1 0 011-1zM4 15a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1z"
              clipRule="evenodd"
            />
          </svg>
          {isDownloading ? t("downloadingReceipt") : t("downloadReceipt")}
        </button>
        {downloadFailed && (
          <p className="mt-3 text-sm text-red-600">{t("downloadError")}</p>
        )}

      </div>
    );
  }

  // No orders state
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="mb-4 h-16 w-16 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        <p className="mb-4 text-gray-500">{t("noOrders")}</p>
        <Link
          href="/menu"
          className="rounded-lg bg-primary-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
        >
          {t("backToMenu")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Order list */}
      {orders.map((order, index) => (
        <div
          key={order.id}
          className="overflow-hidden rounded-xl bg-white shadow-sm"
        >
          {/* Order header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-bold text-gray-900">
              {t("orderNumber", { number: index + 1 })}
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-800"}`}
            >
              {tOrder(order.status.toLowerCase() as "pending" | "confirmed" | "completed" | "declined")}
            </span>
          </div>

          {/* Order items */}
          <div className="px-4 py-3">
            <div className="space-y-2">
              {order.items.map((item) => {
                const optionText =
                  item.selectedOptions && item.selectedOptions.length > 0
                    ? formatOptionSnapshot(item.selectedOptions, money, locale, cfg.canonicalLocale)
                    : "";
                return (
                  <div key={item.id}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">
                        <span className="mr-1.5 font-medium text-gray-900">
                          {item.quantity}x
                        </span>
                        {item.menuItemName}
                      </span>
                      <span className="font-medium text-gray-600">
                        {money(item.unitPrice * item.quantity)}
                      </span>
                    </div>
                    {optionText && (
                      <p className="ml-7 line-clamp-2 text-xs text-gray-400">
                        {optionText}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Order subtotal */}
            <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2">
              <span className="text-xs font-medium text-gray-500">
                {t("subtotal")}
              </span>
              <span className="text-sm font-semibold text-gray-900">
                {money(order.totalAmount)}
              </span>
            </div>
          </div>
        </div>
      ))}

      {/* Grand total */}
      <div className="rounded-xl bg-primary-50 p-4">
        <div className="flex items-center justify-between">
          <span className="text-base font-bold text-gray-900">
            {t("grandTotal")}
          </span>
          <span className="text-xl font-bold text-primary-700">
            {money(grandTotal)}
          </span>
        </div>
      </div>

      {/* Back to menu link */}
      <div className="pt-2 text-center">
        <Link
          href="/menu"
          className="text-sm text-primary-600 transition-colors hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:rounded-md"
        >
          {t("backToMenu")}
        </Link>
      </div>
    </div>
  );
}
