"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

interface MobileNavProps {
  cartItemCount: number;
}

export function MobileNav({ cartItemCount }: MobileNavProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  const tabs = [
    {
      href: "/menu" as const,
      label: t("menu"),
      isActive: pathname === "/menu",
      icon: (
        // Book open icon (menu/catalog)
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
          />
        </svg>
      ),
    },
    {
      href: "/cart" as const,
      label: t("cart"),
      isActive: pathname === "/cart",
      badge: cartItemCount > 0 ? cartItemCount : undefined,
      icon: (
        // Shopping cart icon
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121 0 2.09-.773 2.21-1.886l.84-7.553A1.125 1.125 0 0015.86 3.75H6.106a1.125 1.125 0 00-1.11.947L3.856 12.56a1.125 1.125 0 001.11 1.303h0M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
          />
        </svg>
      ),
    },
    {
      href: "/checkout" as const,
      label: t("checkout"),
      isActive: pathname === "/checkout",
      icon: (
        // Receipt / document icon
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185zM9.75 9h.008v.008H9.75V9zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 4.5h.008v.008h-.008V13.5zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
          />
        </svg>
      ),
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex max-w-lg items-center justify-around">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative flex min-h-[48px] min-w-[44px] flex-1 items-center justify-center px-2 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 ${
              tab.isActive
                ? "text-primary-500"
                : "text-gray-500 hover:text-gray-700"
            }`}
            title={tab.label}
            aria-label={tab.label}
          >
            <span className="relative">
              {tab.icon}
              {tab.badge !== undefined && (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-bold text-white">
                  {tab.badge > 99 ? "99+" : tab.badge}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
