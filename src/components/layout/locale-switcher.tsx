"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useConfig } from "@/components/providers/config-provider";
import { useTransition, useState, useEffect, useCallback } from "react";

// Keys must stay in sync with KNOWN_LOCALES (src/lib/deployment-config.ts).
// Each entry shows the language's own endonym + a short code in the switcher.
const localeConfig: Record<string, { name: string; code: string }> = {
  en: { name: "English", code: "EN" },
  th: { name: "ไทย", code: "TH" },
  vi: { name: "Tiếng Việt", code: "VN" },
  "zh-CN": { name: "简体中文", code: "CN" },
  "zh-TW": { name: "繁體中文", code: "TW" },
  ms: { name: "Bahasa Melayu", code: "MS" },
};

export function LocaleSwitcher() {
  const locale = useLocale();
  const cfg = useConfig();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const tCommon = useTranslations("common");
  const [isOpen, setIsOpen] = useState(false);

  const current = localeConfig[locale] ?? localeConfig.en;

  const handleSelect = useCallback(
    (nextLocale: string) => {
      setIsOpen(false);
      if (nextLocale === locale) return;
      startTransition(() => {
        router.replace(pathname, { locale: nextLocale });
      });
    },
    [locale, pathname, router, startTransition]
  );

  // Lock body scroll when open
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={isPending}
        // Accessible name must CONTAIN the visible text ({current.code}) so
        // voice-control users can activate it by what they see (WCAG 2.5.3
        // Label in Name), while still describing the action for screen readers.
        aria-label={`${tCommon("selectLanguage")} (${current.code})`}
        aria-haspopup="dialog"
        className="flex h-11 min-w-[44px] items-center justify-center rounded-lg border border-gray-200 bg-white/90 px-2.5 text-xs font-bold text-gray-600 shadow-sm backdrop-blur-sm transition-all hover:border-gray-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:ring-offset-1 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {current.code}
      </button>

      {/* Modal overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ animation: "fadeIn 150ms ease-out" }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />

          {/* Panel */}
          <div
            role="dialog"
            aria-label={tCommon("selectLanguage")}
            data-locale-switcher
            className="relative mx-3 w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-black/5 sm:mx-4 sm:p-5"
            style={{ animation: "scaleIn 150ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          >
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                {tCommon("selectLanguage")}
              </h3>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                aria-label={tCommon("close")}
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>

            {/* Full-width list of locales */}
            <div className="flex flex-col gap-1.5">
              {cfg.enabledLocales.map((loc) => {
                const config = localeConfig[loc];
                if (!config) return null;
                const isActive = loc === locale;

                return (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => handleSelect(loc)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors ${
                      isActive
                        ? "bg-primary-500 text-white shadow-sm"
                        : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        isActive
                          ? "bg-white/20 text-white"
                          : "bg-white text-gray-500 shadow-sm"
                      }`}
                    >
                      {config.code}
                    </span>
                    <span className="flex-1 text-sm font-medium">
                      {config.name}
                    </span>
                    {isActive && (
                      <svg
                        className="h-5 w-5 shrink-0 text-white"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Keyframes */}
      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </>
  );
}
