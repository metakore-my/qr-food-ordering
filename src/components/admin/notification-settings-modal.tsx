"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { NotificationSettings } from "@/components/admin/notification-settings";

interface NotificationSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Sidebar-opened modal exposing the per-device notification (sound) settings to
 * ALL admins — the same `<NotificationSettings />` rendered on the SUPERADMIN
 * Settings page, so there is no duplicated logic. Closes on ESC or backdrop
 * click. The settings apply instantly (localStorage) so there is no Save action.
 */
export function NotificationSettingsModal({ open, onClose }: NotificationSettingsModalProps) {
  const t = useTranslations("admin.sidebar");
  const tCommon = useTranslations("common");

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-settings-title"
        className="mx-4 w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl sm:p-6"
        style={{ maxHeight: "calc(100dvh - 2rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 id="notification-settings-title" className="text-lg font-semibold text-gray-900">
            {t("notificationSettings")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-md text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            aria-label={tCommon("close")}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <NotificationSettings />
      </div>
    </div>
  );
}
