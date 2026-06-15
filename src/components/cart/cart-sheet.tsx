"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useCart } from "@/hooks/use-cart";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";
import { CartItemRow } from "./cart-item";
import { Link } from "@/i18n/navigation";

interface CartSheetProps {
  sessionId: string;
  locale: string;
  translations: {
    title: string;
    empty: string;
    total: string;
    placeOrder: string;
    backToMenu: string;
    orderPlaced: string;
    ordering: string;
  };
}

export function CartSheet({
  sessionId,
  locale,
  translations,
}: CartSheetProps) {
  const tCart = useTranslations("cart");
  const tCommon = useTranslations("common");
  const cfg = useConfig();
  const {
    items,
    total,
    hasUnavailable,
    loading,
    error,
    updateQuantity,
    removeItem,
    placeOrder,
  } = useCart(sessionId);

  const [isOrdering, setIsOrdering] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Synchronous re-entrancy lock. The `disabled={isOrdering}` prop on the button
  // can't stop a fast double-tap on its own: `setIsOrdering(true)` is async, so a
  // second tap in the same tick still sees the old DOM (button not yet disabled)
  // and fires handlePlaceOrder again with a FRESH idempotency key — the server's
  // cart-claim guard then absorbs the duplicate (one order wins, the other gets
  // CART_EMPTY), but a wasted second request still hits the DB transaction. A ref
  // flips synchronously, so the second invocation short-circuits before any fetch.
  const submittingRef = useRef(false);

  async function handlePlaceOrder() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setIsOrdering(true);
      setOrderError(null);
      await placeOrder();
      setOrderSuccess(true);
    } catch (err) {
      // Map the server's stable machine code to a localized message; fall back
      // to a generic localized string (never show the raw English server text).
      const code = (err as { code?: string } | null)?.code;

      // Price changed under the customer: the hook already refetched the cart, so
      // the rows + total below now show the new prices. Tell them to review and
      // tap again — the next placement sends the matching expectedTotal and goes
      // through. Interpolate the new total when the server provided it.
      if (code === "PRICE_CHANGED") {
        const newTotal = (err as { newTotal?: number } | null)?.newTotal;
        setOrderError(
          newTotal != null
            ? tCart("errorPriceChanged", {
                total: formatMoneyWith(newTotal, {
                  currency: cfg.currency,
                  decimals: cfg.decimals,
                  locale: cfg.defaultLocale,
                }),
              })
            : tCart("errorPriceChangedNoTotal")
        );
        return;
      }

      const codeMessages: Record<string, string> = {
        CART_EMPTY: tCart("errorCartEmpty"),
        ITEM_UNAVAILABLE: tCart("errorItemUnavailable"),
        SESSION_INACTIVE: tCart("errorSessionInactive"),
        RATE_LIMITED: tCart("errorRateLimited"),
        ORDER_IN_PROGRESS: tCart("errorOrderInProgress"),
        // The hook's 409 recovery detected that cart LINES vanished (deleted
        // menu item / another tab), not just a price tweak — different message.
        CART_CHANGED: tCart("errorCartChanged"),
        // A selected option no longer exists; the server pruned it and the hook
        // refetched, so the rows above already show the cart without it.
        OPTION_UNAVAILABLE: tCart("errorOptionUnavailable"),
      };
      setOrderError(
        (code && codeMessages[code]) || tCart("failedToPlaceOrder")
      );
    } finally {
      setIsOrdering(false);
      submittingRef.current = false;
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-500" />
        <p className="mt-3 text-sm text-gray-500">{tCommon("loading")}</p>
      </div>
    );
  }

  // Order success state
  if (orderSuccess) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-green-600"
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
        <h2 className="text-lg font-bold text-gray-900">
          {translations.orderPlaced}
        </h2>
        {/* Primary next step after ordering is tracking the order / showing the
            checkout QR (the receipt-icon nav tab is unlabeled, so surface it
            explicitly here). Back to menu stays as the secondary action. */}
        <div className="mt-5 flex w-full max-w-xs flex-col gap-2 px-6">
          <Link
            href="/checkout"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
          >
            {tCart("viewOrderStatus")}
          </Link>
          <Link
            href="/menu"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 px-6 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {translations.backToMenu}
          </Link>
        </div>
      </div>
    );
  }

  // Empty cart state
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
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
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"
          />
        </svg>
        <p className="mb-4 text-gray-500">{translations.empty}</p>
        <Link
          href="/menu"
          className="rounded-lg bg-primary-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
        >
          {translations.backToMenu}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Error banner */}
      {(error || orderError) && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error || orderError}
        </div>
      )}

      {/* Unavailable items warning */}
      {hasUnavailable && (
        <div className="mb-4 rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
          {tCart("hasUnavailableItems")}
        </div>
      )}

      {/* Cart items */}
      <div className="space-y-2">
        {items.map((item) => (
          <CartItemRow
            key={item.id}
            item={item}
            locale={locale}
            onUpdateQuantity={updateQuantity}
            onRemove={removeItem}
          />
        ))}
      </div>

      {/* Total and place order */}
      <div className="mt-6 space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-gray-700">
            {translations.total}
          </span>
          <span className="text-xl font-bold text-gray-900">
            {formatMoneyWith(total, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale })}
          </span>
        </div>

        <button
          type="button"
          onClick={handlePlaceOrder}
          disabled={isOrdering || items.length === 0 || hasUnavailable}
          className="w-full rounded-lg bg-primary-500 px-6 py-3 text-base font-bold text-white transition-colors hover:bg-primary-600 active:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isOrdering ? translations.ordering : translations.placeOrder}
        </button>

        <Link
          href="/menu"
          className="flex min-h-[44px] items-center justify-center rounded-md text-center text-sm text-primary-600 transition-colors hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          {translations.backToMenu}
        </Link>
      </div>
    </div>
  );
}
