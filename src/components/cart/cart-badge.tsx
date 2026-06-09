"use client";

import { Link } from "@/i18n/navigation";

interface CartBadgeProps {
  itemCount: number;
}

export function CartBadge({ itemCount }: CartBadgeProps) {
  if (itemCount <= 0) return null;

  return (
    <Link
      href="/cart"
      className="fixed bottom-[calc(9rem+env(safe-area-inset-bottom,0px))] right-4 z-40 flex items-center gap-2 rounded-full bg-primary-500 px-5 py-3 text-white shadow-lg transition-all hover:bg-primary-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 sm:bottom-32 sm:right-6"
    >
      {/* Cart icon */}
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

      {/* Count badge */}
      <span className="text-sm font-bold">{itemCount}</span>

      {/* Animated ping for new items */}
      <span className="absolute -right-1 -top-1 flex h-4 w-4">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-300 opacity-75" />
        <span className="relative inline-flex h-4 w-4 rounded-full bg-primary-400" />
      </span>
    </Link>
  );
}
