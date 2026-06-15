"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";

interface CartBadgeProps {
  itemCount: number;
  total: number;
}

/**
 * Full-width sticky "View cart" bar pinned just above the bottom nav.
 *
 * Replaces the old floating pill, which was anchored to the right edge and
 * overlapped each menu card's "Add to cart" button while scrolling (a customer
 * aiming at Add could hit the pill and get yanked to the cart). A full-width bar
 * spans the content column above the nav, so it can never sit on top of a card
 * CTA — the standard food-app pattern. `pb-32` on the menu <main> reserves the
 * scroll clearance (nav 48px + the ~52px pill + gap) so the last card stays
 * reachable beneath it.
 */
export function CartBadge({ itemCount, total }: CartBadgeProps) {
  const t = useTranslations("cart");
  const cfg = useConfig();

  if (itemCount <= 0) return null;

  const formattedTotal = formatMoneyWith(total, {
    currency: cfg.currency,
    decimals: cfg.decimals,
    locale: cfg.defaultLocale,
  });

  return (
    <div className="fixed inset-x-0 bottom-[calc(48px+env(safe-area-inset-bottom,0px))] z-40 px-4">
      <Link
        href="/cart"
        className="mx-auto flex min-h-[52px] max-w-lg items-center gap-3 rounded-full bg-primary-500 px-5 py-3 text-white shadow-lg transition-all hover:bg-primary-600 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
      >
        {/* Cart icon with count badge */}
        <span className="relative flex shrink-0 items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          <span className="absolute -right-2 -top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-primary-600">
            {itemCount > 99 ? "99+" : itemCount}
          </span>
        </span>

        <span className="text-sm font-semibold">{t("viewCart")}</span>

        <span className="ml-auto text-sm font-bold tabular-nums">
          {formattedTotal}
        </span>
      </Link>
    </div>
  );
}
