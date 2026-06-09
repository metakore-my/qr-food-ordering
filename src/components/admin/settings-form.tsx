"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { KNOWN_LOCALES } from "@/lib/deployment-config";
import { resolveThemeRamp } from "@/lib/themes";
import { useConfig } from "@/components/providers/config-provider";
import { ImageUpload } from "@/components/ui/image-upload";

const CURRENCIES = ["MYR", "SGD", "THB", "VND"] as const;
const PRESET_THEMES = ["green", "terracotta", "indigo"] as const;
type ThemeKey = (typeof PRESET_THEMES)[number] | "custom";

/** Human-readable language names for the locale pickers (mirrors setup-wizard). */
const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  th: "ไทย",
  vi: "Tiếng Việt",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ms: "Bahasa Melayu",
};

const DEFAULT_CUSTOM_COLOR = "#005A2A";

export interface InitialSettings {
  appName: string;
  currency: string;
  defaultLocale: string;
  canonicalLocale: string;
  enabledLocales: string[];
  brandTheme: string;
  brandColor: string | null;
  logoUrl: string | null;
}

type Tab = "general" | "branding";

/**
 * SUPERADMIN-only runtime settings editor. Two tabs:
 * - General: app name, currency, default/canonical locale, enabled-locale subset.
 * - Branding: theme preset swatches + custom color picker, optional logo upload
 *   (only when R2 is configured).
 *
 * Saving PATCHes /api/admin/settings; on 400 the server's validation message is
 * surfaced inline. Some changes (currency/locale/theme) apply on next page load
 * because they are read in server components — the success note says so.
 */
export function SettingsForm({ initial }: { initial: InitialSettings }) {
  const t = useTranslations("admin.settings");
  const { capabilities } = useConfig();

  const [tab, setTab] = useState<Tab>("general");

  // General
  const [appName, setAppName] = useState(initial.appName);
  const [currency, setCurrency] = useState(initial.currency);
  const [defaultLocale, setDefaultLocale] = useState(initial.defaultLocale);
  const [canonicalLocale, setCanonicalLocale] = useState(initial.canonicalLocale);
  const [enabledLocales, setEnabledLocales] = useState<string[]>(
    initial.enabledLocales.length > 0 ? initial.enabledLocales : [...KNOWN_LOCALES]
  );

  // Branding
  const isPreset = (PRESET_THEMES as readonly string[]).includes(initial.brandTheme);
  const [brandTheme, setBrandTheme] = useState<ThemeKey>(
    isPreset ? (initial.brandTheme as ThemeKey) : initial.brandTheme === "custom" ? "custom" : "green"
  );
  const [brandColor, setBrandColor] = useState<string>(
    initial.brandColor ?? DEFAULT_CUSTOM_COLOR
  );
  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logoUrl);

  // Submission state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function toggleEnabledLocale(loc: string, checked: boolean) {
    // The default locale must always stay enabled.
    if (loc === defaultLocale) return;
    setEnabledLocales((prev) =>
      checked ? [...new Set([...prev, loc])] : prev.filter((l) => l !== loc)
    );
  }

  function changeDefaultLocale(next: string) {
    setDefaultLocale(next);
    // Ensure the default locale is always part of the enabled set.
    setEnabledLocales((prev) => (prev.includes(next) ? prev : [...prev, next]));
  }

  // Live preview swatch follows the current theme selection.
  const previewRamp = resolveThemeRamp(
    brandTheme,
    brandTheme === "custom" ? brandColor : null
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);

    const patch: Record<string, string> = {
      app_name: appName,
      currency,
      default_locale: defaultLocale,
      canonical_locale: canonicalLocale,
      enabled_locales: enabledLocales.join(","),
      brand_theme: brandTheme,
    };
    if (brandTheme === "custom") {
      patch.brand_color = brandColor;
    }
    // logo_url is sent as an explicit value (possibly empty to clear it).
    patch.logo_url = logoUrl ?? "";

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("saveError"));
        return;
      }

      setSuccess(true);
    } catch {
      setError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  // High-contrast field styling: dark text, defined border, primary focus ring.
  const inputClass =
    "w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-base text-gray-900 shadow-sm transition-colors placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30";
  const labelClass = "mb-1.5 block text-sm font-semibold text-gray-900";
  const hintClass = "mb-2 text-sm text-gray-600";

  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: t("tabGeneral") },
    { id: "branding", label: t("tabBranding") },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      {/* Status banners */}
      {error && (
        <div
          role="alert"
          className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800 shadow-sm"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 rounded-md px-2 py-0.5 text-red-600 hover:bg-red-100 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            {t("dismiss")}
          </button>
        </div>
      )}
      {success && (
        <div
          role="status"
          className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 shadow-sm"
        >
          <span>{t("saveSuccess")}</span>
          <button
            type="button"
            onClick={() => setSuccess(false)}
            className="shrink-0 rounded-md px-2 py-0.5 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            {t("dismiss")}
          </button>
        </div>
      )}

      {/* Segmented tab control — pill rail, clear active state */}
      <div className="mb-6 inline-flex rounded-xl border border-gray-200 bg-gray-100/80 p-1">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setTab(tabItem.id)}
            aria-pressed={tab === tabItem.id}
            className={`min-h-[44px] rounded-lg px-5 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
              tab === tabItem.id
                ? "bg-white text-primary-700 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {/* General tab */}
      {tab === "general" && (
        <div className="space-y-5">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeading title={t("appName")} />
            <div className="space-y-5">
              {/* App name */}
              <div>
                <label htmlFor="settings-appname" className={labelClass}>
                  {t("appName")}
                </label>
                <input
                  id="settings-appname"
                  type="text"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  className={inputClass}
                />
              </div>

              {/* Currency */}
              <div>
                <label htmlFor="settings-currency" className={labelClass}>
                  {t("currency")}
                </label>
                <select
                  id="settings-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className={inputClass}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeading title={t("enabledLocales")} />
            <div className="space-y-5">
              {/* Default locale */}
              <div>
                <label htmlFor="settings-default-locale" className={labelClass}>
                  {t("defaultLocale")}
                </label>
                <select
                  id="settings-default-locale"
                  value={defaultLocale}
                  onChange={(e) => changeDefaultLocale(e.target.value)}
                  className={inputClass}
                >
                  {KNOWN_LOCALES.map((loc) => (
                    <option key={loc} value={loc}>
                      {LOCALE_LABELS[loc] ?? loc}
                    </option>
                  ))}
                </select>
              </div>

              {/* Canonical locale */}
              <div>
                <label htmlFor="settings-canonical-locale" className={labelClass}>
                  {t("canonicalLocale")}
                </label>
                <p className={hintClass}>{t("canonicalLocaleHint")}</p>
                <select
                  id="settings-canonical-locale"
                  value={canonicalLocale}
                  onChange={(e) => setCanonicalLocale(e.target.value)}
                  className={inputClass}
                >
                  {KNOWN_LOCALES.map((loc) => (
                    <option key={loc} value={loc}>
                      {LOCALE_LABELS[loc] ?? loc}
                    </option>
                  ))}
                </select>
              </div>

              {/* Enabled locales */}
              <fieldset>
                <legend className={labelClass}>{t("enabledLocales")}</legend>
                <p className={hintClass}>{t("enabledLocalesHint")}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {KNOWN_LOCALES.map((loc) => {
                    const isDefault = loc === defaultLocale;
                    const checked = enabledLocales.includes(loc);
                    return (
                      <label
                        key={loc}
                        className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          checked
                            ? "border-primary-300 bg-primary-50 text-primary-800"
                            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                        } ${isDefault ? "opacity-80" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isDefault}
                          onChange={(e) => toggleEnabledLocale(loc, e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-60"
                        />
                        <span>{LOCALE_LABELS[loc] ?? loc}</span>
                        {isDefault && (
                          <span className="ml-auto rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700">
                            {t("defaultLocale")}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          </section>
        </div>
      )}

      {/* Branding tab */}
      {tab === "branding" && (
        <div className="space-y-5">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeading title={t("theme")} />
            <fieldset>
              <legend className="sr-only">{t("theme")}</legend>
              <div className="flex flex-wrap gap-3">
                {PRESET_THEMES.map((th) => {
                  const ramp = resolveThemeRamp(th, null);
                  const selected = brandTheme === th;
                  return (
                    <label
                      key={th}
                      className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition-all ${
                        selected
                          ? "border-primary-500 bg-primary-50 text-primary-800 shadow-sm"
                          : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="settings-theme"
                        value={th}
                        checked={selected}
                        onChange={() => setBrandTheme(th)}
                        className="sr-only"
                      />
                      <span
                        className="h-6 w-6 rounded-full border border-black/10 shadow-inner"
                        style={{ backgroundColor: ramp[500] }}
                        aria-hidden="true"
                      />
                      <span>
                        {t(`theme${th[0].toUpperCase()}${th.slice(1)}` as `theme${string}`)}
                      </span>
                    </label>
                  );
                })}
                {/* Custom */}
                <label
                  className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition-all ${
                    brandTheme === "custom"
                      ? "border-primary-500 bg-primary-50 text-primary-800 shadow-sm"
                      : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="settings-theme"
                    value="custom"
                    checked={brandTheme === "custom"}
                    onChange={() => setBrandTheme("custom")}
                    className="sr-only"
                  />
                  <span
                    className="h-6 w-6 rounded-full border border-black/10 shadow-inner"
                    style={{ backgroundColor: brandColor }}
                    aria-hidden="true"
                  />
                  <span>{t("themeCustom")}</span>
                </label>
              </div>

              {/* Custom color picker — only when "custom" is selected */}
              {brandTheme === "custom" && (
                <div className="mt-5 flex flex-wrap items-end gap-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div>
                    <label htmlFor="settings-brand-color" className={labelClass}>
                      {t("brandColor")}
                    </label>
                    <input
                      id="settings-brand-color"
                      type="color"
                      value={brandColor}
                      onChange={(e) => setBrandColor(e.target.value)}
                      className="h-11 w-16 cursor-pointer rounded-lg border border-gray-300 bg-white p-1"
                    />
                  </div>
                  {/* Live preview swatch using the derived ramp */}
                  <div>
                    <span className={labelClass}>{t("preview")}</span>
                    <div className="flex overflow-hidden rounded-lg border border-gray-300 shadow-sm">
                      {[300, 400, 500, 600, 700].map((shade) => (
                        <span
                          key={shade}
                          className="h-9 w-9"
                          style={{
                            backgroundColor:
                              previewRamp[shade as keyof typeof previewRamp],
                          }}
                          aria-hidden="true"
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </fieldset>
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              {t("themeApplyHint")}
            </p>
          </section>

          {/* Logo upload — only when R2 is configured */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeading title={t("logo")} />
            {capabilities.hasR2 ? (
              <ImageUpload
                value={logoUrl ?? undefined}
                onUpload={(url) => setLogoUrl(url)}
                onRemove={() => setLogoUrl(null)}
                className="max-w-sm"
              />
            ) : (
              <p className="text-sm text-gray-600">{t("logoR2Hint")}</p>
            )}
          </section>
        </div>
      )}

      {/* Sticky save bar */}
      <div className="sticky bottom-0 z-10 mt-6 flex items-center justify-end gap-4 rounded-2xl border border-gray-200 bg-white/95 px-5 py-4 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? t("saving") : t("save")}
        </button>
      </div>
    </div>
  );
}

/** Section header with a primary accent bar — also a live proof of the theme color. */
function SectionHeading({ title }: { title: string }) {
  return (
    <div className="mb-5 flex items-center gap-2.5">
      <span className="h-5 w-1 rounded-full bg-primary-500" aria-hidden="true" />
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
    </div>
  );
}
