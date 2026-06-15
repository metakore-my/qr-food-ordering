"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { signOut } from "next-auth/react";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { ChangePasswordModal } from "@/components/admin/change-password-modal";
import { useSidebar } from "@/components/layout/admin-layout-client";
import { useConfig } from "@/components/providers/config-provider";
import { APP_VERSION } from "@/lib/version";

interface AdminSidebarProps {
  role: string;
  permissions: string[];
  username: string;
}

type NavLabelKey = "dashboard" | "checkoutScanner" | "placeOrder" | "menuAdmin" | "tables" | "users" | "reports" | "settings";

interface NavItem {
  href: string;
  labelKey: NavLabelKey;
  icon: React.ReactNode;
  superadminOnly?: boolean;
  requiredPermission?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/admin/dashboard",
    labelKey: "dashboard",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z"
        />
      </svg>
    ),
  },
  {
    href: "/admin/checkout-scanner",
    labelKey: "checkoutScanner",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5M20.25 16.5V18A2.25 2.25 0 0118 20.25h-1.5M3.75 16.5V18A2.25 2.25 0 006 20.25h1.5M8.25 12h7.5M12 8.25v7.5"
        />
      </svg>
    ),
  },
  {
    href: "/admin/order-entry",
    labelKey: "placeOrder",
    requiredPermission: "orders",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    ),
  },
  {
    href: "/admin/menu-management",
    labelKey: "menuAdmin",
    requiredPermission: "menu",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
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
    href: "/admin/tables",
    labelKey: "tables",
    requiredPermission: "tables",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M10.875 12h-7.5"
        />
      </svg>
    ),
  },
  {
    href: "/admin/users",
    labelKey: "users",
    superadminOnly: true,
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
        />
      </svg>
    ),
  },
  {
    href: "/admin/reports",
    labelKey: "reports",
    requiredPermission: "reports",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
        />
      </svg>
    ),
  },
  {
    href: "/admin/settings",
    labelKey: "settings",
    superadminOnly: true,
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
];

export function AdminSidebar({ role, permissions, username }: AdminSidebarProps) {
  const locale = useLocale();
  const cfg = useConfig();
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tSidebar = useTranslations("admin.sidebar");
  const pathname = usePathname();
  const { collapsed, setCollapsed } = useSidebar();
  const [collapsedByModal, setCollapsedByModal] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // On tablet (md–lg), auto-collapse sidebar when any modal opens
  const isTablet = useCallback(() => {
    return window.innerWidth >= 768 && window.innerWidth < 1280;
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const hasModal = document.querySelector("[role='dialog']:not([data-locale-switcher])") !== null;
      if (hasModal && isTablet() && !collapsed) {
        setCollapsed(true);
        setCollapsedByModal(true);
      } else if (!hasModal && collapsedByModal) {
        setCollapsed(false);
        setCollapsedByModal(false);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [collapsed, collapsedByModal, isTablet, setCollapsed]);

  const visibleItems = NAV_ITEMS.filter((item) => {
    // SUPERADMIN-only items (e.g. users)
    if (item.superadminOnly && role !== "SUPERADMIN") return false;
    // Permission-gated items
    if (item.requiredPermission) {
      if (role === "SUPERADMIN") return true;
      return permissions.includes(item.requiredPermission);
    }
    return true;
  });

  function isActive(href: string) {
    // Match /admin/dashboard, /admin/menu-management, etc. in the admin context
    return pathname === href || pathname.startsWith(href + "/");
  }

  function handleLogout() {
    signOut({ callbackUrl: `/${locale}/admin/login` });
  }

  return (
    <>
      {/* Desktop sidebar - hidden on mobile */}
      <aside
        className={`hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:z-40 md:border-r md:border-gray-200 md:bg-white transition-all duration-200 ${
          collapsed ? "md:w-16" : "md:w-56"
        }`}
      >
        {/* Header / logo — show the uploaded logo when set, else the app name. */}
        <div className="flex h-14 items-center justify-between border-b border-gray-200 px-3">
          {!collapsed &&
            (cfg.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cfg.logoUrl}
                alt={cfg.appName}
                className="h-8 max-w-[150px] object-contain"
              />
            ) : (
              <span className="text-lg font-bold text-primary-500 truncate">
                {cfg.appName}
              </span>
            ))}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-11 w-11 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            aria-label={collapsed ? tSidebar("expandSidebar") : tSidebar("collapseSidebar")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-5 w-5 transition-transform ${collapsed ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5L8.25 12l7.5-7.5"
              />
            </svg>
          </button>
        </div>
        {!collapsed && (
          <div className="border-b border-gray-200 px-3 py-3">
            <LocaleSwitcher />
          </div>
        )}

        {/* Navigation links */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-3">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                isActive(item.href)
                  ? "bg-primary-50 text-primary-600"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              } ${collapsed ? "justify-center" : ""}`}
              title={collapsed ? t(item.labelKey) : undefined}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {!collapsed && <span>{t(item.labelKey)}</span>}
            </Link>
          ))}
        </nav>

        {/* User info + Change Password + Logout at bottom */}
        <div className="border-t border-gray-200 px-2 py-3 space-y-1">
          {!collapsed && (
            <p className="truncate px-3 pb-1 text-xs text-gray-500" title={tSidebar("loggedInAs", { username })}>
              {tSidebar("loggedInAs", { username })}
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowChangePassword(true)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
              collapsed ? "justify-center" : ""
            }`}
            title={collapsed ? tSidebar("changePassword") : undefined}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
              />
            </svg>
            {!collapsed && <span>{tSidebar("changePassword")}</span>}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
              collapsed ? "justify-center" : ""
            }`}
            title={collapsed ? t("logout") : undefined}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
              />
            </svg>
            {!collapsed && <span>{t("logout")}</span>}
          </button>
          {/* App version — single source of truth is package.json (see lib/version.ts) */}
          <p className="px-3 pt-1 text-center text-[11px] text-gray-400" title={`v${APP_VERSION}`}>
            v{APP_VERSION}
          </p>
        </div>
      </aside>

      {/* Mobile bottom tabs - visible only on mobile */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* More menu popover */}
        {showMoreMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} onKeyDown={(e) => { if (e.key === "Escape") setShowMoreMenu(false); }} />
            <div className="absolute bottom-full right-2 z-50 mb-2 max-h-[70vh] w-56 overflow-y-auto rounded-xl border border-gray-200 bg-white py-2 shadow-lg">
              {/* Overflow nav items (5th+) */}
              {visibleItems.slice(4).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setShowMoreMenu(false)}
                  className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                    isActive(item.href)
                      ? "bg-primary-50 text-primary-600"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {item.icon}
                  <span>{t(item.labelKey)}</span>
                </Link>
              ))}
              {/* Locale switcher */}
              <div className="px-4 py-2">
                <LocaleSwitcher />
              </div>
              {/* Change password */}
              <button
                type="button"
                onClick={() => {
                  setShowMoreMenu(false);
                  setShowChangePassword(true);
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
                  />
                </svg>
                <span>{tSidebar("changePassword")}</span>
              </button>
              {/* Logout */}
              <button
                type="button"
                onClick={() => {
                  setShowMoreMenu(false);
                  handleLogout();
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-sm text-gray-700 transition-colors hover:bg-red-50 hover:text-red-600"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
                  />
                </svg>
                <span>{t("logout")}</span>
              </button>
              {/* App version (mobile) — mirrors the desktop sidebar badge, which
                  lives in the hidden-on-mobile aside. Source: package.json. */}
              <p className="border-t border-gray-100 px-4 pt-2 text-center text-[11px] text-gray-400">
                v{APP_VERSION}
              </p>
            </div>
          </>
        )}
        <div className="flex items-center justify-around">
          {/* Show first 4 nav items directly in the tab bar */}
          {visibleItems.slice(0, 4).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[48px] min-w-[44px] flex-1 items-center justify-center px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 ${
                isActive(item.href)
                  ? "text-primary-500"
                  : "text-gray-500 hover:text-gray-700"
              }`}
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
            >
              {item.icon}
            </Link>
          ))}
          {/* "More" button — contains overflow nav items + locale + password + logout */}
          <button
            type="button"
            onClick={() => setShowMoreMenu((p) => !p)}
            className={`flex min-h-[48px] min-w-[44px] flex-1 items-center justify-center px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 ${
              showMoreMenu ? "text-primary-500" : "text-gray-500 hover:text-gray-700"
            }`}
            title={tCommon("more")}
            aria-label={tCommon("more")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
              />
            </svg>
          </button>
        </div>
      </nav>

      {/* Change Password Modal */}
      <ChangePasswordModal
        open={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        username={username}
      />
    </>
  );
}
