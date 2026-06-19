"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { KNOWN_LOCALES, localesDefaultFirst } from "@/lib/deployment-config";
import { useConfig } from "@/components/providers/config-provider";

const LOCALE_CODES = KNOWN_LOCALES;

interface CategoryTranslation {
  id: number;
  categoryId: number;
  locale: string;
  name: string;
}

interface Category {
  id: number;
  sortOrder: number;
  isActive: boolean;
  names: CategoryTranslation[];
  createdAt: string;
  updatedAt: string;
}

interface CategoryFormProps {
  category?: Category | null;
  onSave: (category: Category) => void;
  onClose: () => void;
}

export function CategoryForm({ category, onSave, onClose }: CategoryFormProps) {
  const t = useTranslations("admin.categoryForm");
  const tCommon = useTranslations("common");
  const tLocales = useTranslations("locales");
  const cfg = useConfig();

  // Open the locale tab on the deployment's default language, not a hardcoded
  // locale — mirrors the menu-item form so a non-Thai deployment (ms/vi/zh-CN)
  // doesn't land the operator on a Thai tab.
  const [activeLocale, setActiveLocale] = useState(cfg.defaultLocale);
  // Tabs ordered default/primary-locale first (rest in canonical order) — mirrors
  // the menu-item form so the operator's authoring language reads as primary.
  const localeTabs = localesDefaultFirst(LOCALE_CODES, cfg.defaultLocale);
  const [sortOrder, setSortOrder] = useState(category?.sortOrder ?? 0);
  const [translations, setTranslations] = useState<Record<string, string>>(
    () => {
      const initial: Record<string, string> = {};
      if (category) {
        for (const t of category.names) {
          initial[t.locale] = t.name;
        }
      }
      return initial;
    }
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleTranslationChange(locale: string, value: string) {
    setTranslations((prev) => ({ ...prev, [locale]: value }));
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();

    // Filter out empty translations
    const filteredTranslations: Record<string, string> = {};
    for (const [locale, name] of Object.entries(translations)) {
      if (name.trim()) {
        filteredTranslations[locale] = name.trim();
      }
    }

    if (Object.keys(filteredTranslations).length === 0) {
      setError(t("translationRequired"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = category
        ? `/api/categories/${category.id}`
        : "/api/categories";
      const method = category ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sortOrder,
          translations: filteredTranslations,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("failedToSave"));
      }

      const saved = await res.json();
      onSave(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="category-form-title" className="flex max-h-[95dvh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl sm:max-h-[90vh]">
        {/* Sticky header */}
        <div className="shrink-0 border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4">
          <h2 id="category-form-title" className="text-lg font-semibold text-gray-900">
            {category ? t("editCategory") : t("addCategory")}
          </h2>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            {error && (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Sort Order */}
            <div className="mb-4">
              <label
                htmlFor="sortOrder"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                {t("sortOrder")}
              </label>
              <input
                id="sortOrder"
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
                className="w-24 rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>

            {/* Locale Tabs */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("categoryNameByLocale")}
              </label>
              <div className="mb-3 flex flex-wrap gap-1 border-b border-gray-200">
                {localeTabs.map((loc) => {
                  const hasValue = !!translations[loc]?.trim();
                  return (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setActiveLocale(loc)}
                      className={`relative inline-flex min-h-[44px] items-center px-3 py-2 text-sm font-medium transition-colors ${
                        activeLocale === loc
                          ? "border-b-2 border-primary-500 text-primary-500"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {loc}
                      {hasValue && (
                        <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary-500" />
                      )}
                    </button>
                  );
                })}
              </div>

              {LOCALE_CODES.map((loc) => (
                <div
                  key={loc}
                  className={activeLocale === loc ? "block" : "hidden"}
                >
                  <label className="mb-1 block text-xs text-gray-500">
                    {tLocales(loc)}
                  </label>
                  <input
                    type="text"
                    value={translations[loc] ?? ""}
                    onChange={(e) =>
                      handleTranslationChange(loc, e.target.value)
                    }
                    placeholder={t("categoryNamePlaceholder", { locale: tLocales(loc) })}
                    maxLength={100}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Sticky footer */}
          <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:opacity-60"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {loading ? tCommon("saving") : tCommon("save")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
