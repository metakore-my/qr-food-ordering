"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { KNOWN_LOCALES } from "@/lib/deployment-config";
import { resolveThemeRamp, themeCssVars } from "@/lib/themes";
import { useConfig } from "@/components/providers/config-provider";
import { ImageUpload } from "@/components/ui/image-upload";
import { useOrderAlertSound } from "@/hooks/use-order-alert-sound";
import { ORDER_ALERT_SOUNDS } from "@/lib/order-alert-prefs";
import { swapDefaultLocaleName } from "@/lib/app-name";

const CURRENCIES = ["MYR", "SGD", "THB", "VND"] as const;
const PRESET_THEMES = ["green", "terracotta", "indigo", "amber"] as const;
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
  appNameI18n: Record<string, string>;
  currency: string;
  defaultLocale: string;
  canonicalLocale: string;
  enabledLocales: string[];
  brandTheme: string;
  brandColor: string | null;
  logoUrl: string | null;
}

type Tab = "general" | "branding" | "notifications";

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
export function SettingsForm({
  initial,
  setupComplete,
}: {
  initial: InitialSettings;
  setupComplete: boolean;
}) {
  const t = useTranslations("admin.settings");
  const { capabilities } = useConfig();

  const [tab, setTab] = useState<Tab>("general");

  // General
  const [appName, setAppName] = useState(initial.appName);
  const [appNameI18n, setAppNameI18n] = useState<Record<string, string>>(initial.appNameI18n ?? {});
  const [currency, setCurrency] = useState(initial.currency);
  const [defaultLocale, setDefaultLocale] = useState(initial.defaultLocale);
  // canonical_locale is a hidden internal anchor (set once at setup, locked).
  // Kept in state only to force-enable its locale in the checklist — no select edits it.
  const [canonicalLocale] = useState(initial.canonicalLocale);
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
  // True when the LAST logo upload attempt failed (e.g. R2 CORS). Blocks the
  // "Saved" success toast so we never report success while the logo silently
  // didn't update — surfaced from <ImageUpload onError>.
  const [logoUploadFailed, setLogoUploadFailed] = useState(false);

  function toggleEnabledLocale(loc: string, checked: boolean) {
    // The default locale AND the canonical (main-language) anchor must always stay enabled.
    if (loc === defaultLocale || loc === canonicalLocale) return;
    setEnabledLocales((prev) =>
      checked ? [...new Set([...prev, loc])] : prev.filter((l) => l !== loc)
    );
  }

  function changeDefaultLocale(next: string) {
    if (next === defaultLocale) return;
    // Re-home the app name: `app_name` holds the DEFAULT locale's name and the
    // per-locale inputs only cover `loc !== defaultLocale`, so on a default
    // switch the new default's name must move OUT of the map INTO the main
    // field, and the old default's main name must move INTO the map. Without
    // this the old main name is lost and the new default's name is dropped on
    // save. See swapDefaultLocaleName.
    const swapped = swapDefaultLocaleName(appName, appNameI18n, defaultLocale, next);
    setAppName(swapped.appName);
    setAppNameI18n(swapped.appNameI18n);
    setDefaultLocale(next);
    // Ensure the default locale is always part of the enabled set.
    setEnabledLocales((prev) => (prev.includes(next) ? prev : [...prev, next]));
  }

  // Live preview swatch follows the current theme selection.
  const previewRamp = resolveThemeRamp(
    brandTheme,
    brandTheme === "custom" ? brandColor : null
  );

  // FULL LIVE PREVIEW: apply the selected theme's primary ramp to the whole page
  // by overriding the `--color-primary-*` CSS vars on <html> (the same vars the
  // root layout injects). This is preview-only — it touches the DOM of THIS tab,
  // never the DB. The cleanup restores the original vars, so navigating away
  // WITHOUT saving reverts the theme; on save, the persisted value becomes the
  // real one (config refetch). XSS-safe: themeCssVars drops any non-hex shade.
  useEffect(() => {
    const root = document.documentElement;
    // Snapshot the inline overrides we're about to set, so cleanup restores exactly.
    const shades = [
      "50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950",
    ] as const;
    const prev = shades.map(
      (s) => [s, root.style.getPropertyValue(`--color-primary-${s}`)] as const
    );
    // themeCssVars emits "--color-primary-500: #..; ...". Parse + apply each.
    for (const decl of themeCssVars(previewRamp).split(";")) {
      const [name, value] = decl.split(":").map((x) => x.trim());
      if (name && value) root.style.setProperty(name, value);
    }
    return () => {
      // Restore the prior inline values (empty string removes our override so the
      // server-injected <style> takes back over).
      for (const [s, val] of prev) {
        if (val) root.style.setProperty(`--color-primary-${s}`, val);
        else root.style.removeProperty(`--color-primary-${s}`);
      }
    };
    // Depend on the stable inputs, not the freshly-derived ramp object (which is a
    // new reference each render and would re-run this effect needlessly).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandTheme, brandColor]);

  async function handleSave() {
    // Don't report success while an embedded logo upload is unresolved — saving the
    // other settings with a green "Saved" toast would mask the failed image upload.
    if (logoUploadFailed) {
      setSuccess(false);
      setError(t("logoUploadFailed"));
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);

    const i18nClean: Record<string, string> = {};
    for (const [loc, name] of Object.entries(appNameI18n)) {
      const v = name.trim();
      if (v && loc !== defaultLocale && enabledLocales.includes(loc)) i18nClean[loc] = v;
    }
    const patch: Record<string, string> = {
      app_name: appName,
      app_name_i18n: JSON.stringify(i18nClean),
      default_locale: defaultLocale,
      enabled_locales: enabledLocales.join(","),
      brand_theme: brandTheme,
    };
    if (!setupComplete) {
      patch.currency = currency;
    }
    // canonical_locale is never sent from this form (hidden + locked).
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
        if (data.code === "SETTING_LOCKED") {
          setError(t("errorSettingLocked"));
          return;
        }
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
    { id: "notifications", label: t("tabNotifications") },
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

      {/* Segmented tab control — pill rail, clear active state. Horizontally
          scrollable so long translated labels can't overflow at 320px. */}
      <div className="mb-6 flex max-w-full overflow-x-auto rounded-xl border border-gray-200 bg-gray-100/80 p-1">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setTab(tabItem.id)}
            aria-pressed={tab === tabItem.id}
            className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-lg px-5 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
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

              {/* Per-locale restaurant name — one input per OTHER enabled locale. */}
              {enabledLocales
                .filter((loc) => loc !== defaultLocale)
                .map((loc) => (
                  <div key={loc}>
                    <label htmlFor={`settings-appname-${loc}`} className={labelClass}>
                      {t("appNameFor", { language: LOCALE_LABELS[loc] ?? loc })}
                    </label>
                    <input
                      id={`settings-appname-${loc}`}
                      type="text"
                      className={inputClass}
                      value={appNameI18n[loc] ?? ""}
                      onChange={(e) => setAppNameI18n((prev) => ({ ...prev, [loc]: e.target.value }))}
                      placeholder={t("appNameForPlaceholder")}
                    />
                  </div>
                ))}

              {/* Currency */}
              <div>
                <label htmlFor="settings-currency" className={labelClass}>
                  {t("currency")}
                </label>
                <select
                  id="settings-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  disabled={setupComplete}
                  className={inputClass}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {setupComplete && (
                  <p className={hintClass}>{t("lockedAfterSetup")}</p>
                )}
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

              {/* Enabled locales */}
              <fieldset>
                <legend className={labelClass}>{t("enabledLocales")}</legend>
                <p className={hintClass}>{t("enabledLocalesHint")}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {KNOWN_LOCALES.map((loc) => {
                    const isLocked = loc === defaultLocale || loc === canonicalLocale;
                    const checked = enabledLocales.includes(loc);
                    return (
                      <label
                        key={loc}
                        className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          checked
                            ? "border-primary-300 bg-primary-50 text-primary-800"
                            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                        } ${isLocked ? "opacity-80" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isLocked}
                          onChange={(e) => toggleEnabledLocale(loc, e.target.checked)}
                          className="h-5 w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-60"
                        />
                        <span>{LOCALE_LABELS[loc] ?? loc}</span>
                        {isLocked && (
                          <span className="ml-auto rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700">
                            {loc === defaultLocale ? t("defaultLocale") : t("requiredLanguage")}
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
                onUpload={(url) => {
                  setLogoUrl(url);
                  setLogoUploadFailed(false);
                }}
                onRemove={() => {
                  setLogoUrl(null);
                  setLogoUploadFailed(false);
                }}
                onError={setLogoUploadFailed}
                className="max-w-sm"
              />
            ) : (
              <p className="text-sm text-gray-600">{t("logoR2Hint")}</p>
            )}
          </section>
        </div>
      )}

      {/* Notifications tab — PER-DEVICE order-alert sound. Stored in this
          browser's localStorage (not the DB), applies instantly, and is
          independent on every device. No Save button: it is not part of the
          server PATCH. */}
      {tab === "notifications" && <NotificationsTab />}

      {/* Sticky save bar — only for server-persisted tabs. The Notifications
          tab applies instantly and has no Save action.
          OPAQUE background (not bg-white/95 + backdrop-blur): a translucent
          sticky bar lets the fields it floats over while scrolling — e.g. the
          Currency field above it — bleed through, which reads as an overlap
          glitch. A solid bar cleanly hides whatever scrolls beneath it. The
          page wrapper's bottom padding reserves room so the last card can
          still scroll fully clear of the pinned bar. */}
      {tab !== "notifications" && (
        <div className="sticky bottom-0 z-10 mt-6 flex items-center justify-end gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-lg">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Per-device order-alert sound controls. State lives in localStorage via
 * `useOrderAlertSound`, so this configures only the browser it runs in (a
 * kitchen tablet chimes; a manager's laptop need not). Toggling "enable" also
 * performs the autoplay unlock gesture (this click), and fires a test chime so
 * staff immediately hear what an order sounds like and at what volume.
 */
function NotificationsTab() {
  const t = useTranslations("admin.settings");
  const {
    enabled,
    overrideMute,
    volume,
    sound,
    unlocked,
    unlock,
    play,
    setEnabled,
    setOverrideMute,
    setVolume,
    setSound,
  } = useOrderAlertSound();

  async function handleToggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    if (next) {
      // This click is the user gesture — arm audio, then play a test chime.
      const ok = await unlock();
      if (ok) play();
    }
  }

  // Switch the selected sound and immediately preview it (the click is the
  // autoplay gesture; arm first if this is the first interaction on the page).
  async function handleSelectSound(id: string) {
    setSound(id);
    if (!unlocked) await unlock();
    // setSound writes to the store synchronously; play() reads it back and
    // reloads the new asset before playing, so the preview matches the choice.
    play();
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <SectionHeading title={t("soundSection")} />
        <p className="mb-5 text-sm text-gray-600">{t("soundSectionHint")}</p>

        {/* Master enable */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">{t("soundEnable")}</p>
            <p className="mt-0.5 text-sm text-gray-600">{t("soundEnableHint")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={handleToggleEnabled}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors before:absolute before:inset-x-0 before:-inset-y-[8px] before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
              enabled ? "bg-primary-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {enabled && (
          <>
            {/* Sound picker — choose which chime this device plays. Selecting
                one previews it. Stored per-device in localStorage. */}
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-semibold text-gray-900">
                {t("soundChoose")}
              </legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {ORDER_ALERT_SOUNDS.map((s) => {
                  const selected = sound === s.id;
                  return (
                    <label
                      key={s.id}
                      className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition-all ${
                        selected
                          ? "border-primary-500 bg-primary-50 text-primary-800 shadow-sm"
                          : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="order-alert-sound"
                        value={s.id}
                        checked={selected}
                        onChange={() => handleSelectSound(s.id)}
                        className="sr-only"
                      />
                      <span aria-hidden="true">🔔</span>
                      <span>{t(s.labelKey)}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1.5 text-sm text-gray-600">{t("soundChooseHint")}</p>
            </fieldset>

            {/* Override mute */}
            <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {t("soundOverrideMute")}
                </p>
                <p className="mt-0.5 text-sm text-gray-600">
                  {t("soundOverrideMuteHint")}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={overrideMute}
                onClick={() => setOverrideMute(!overrideMute)}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors before:absolute before:inset-x-0 before:-inset-y-[8px] before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
                  overrideMute ? "bg-primary-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    overrideMute ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Volume slider — per-device, defaults to MAX for the noisy F&B
                floor. Plays a test chime on release so staff hear the level.
                The range input itself is the user gesture, so we arm on change. */}
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="sound-volume" className="text-sm font-semibold text-gray-900">
                  {t("soundVolume")}
                </label>
                <span className="text-sm font-medium text-gray-600">
                  {Math.round(volume * 100)}%
                </span>
              </div>
              <input
                id="sound-volume"
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(volume * 100)}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
                onPointerUp={async () => {
                  // Preview the chosen level on release (arm first if needed).
                  if (!unlocked) await unlock();
                  play();
                }}
                onKeyUp={async (e) => {
                  if (e.key.startsWith("Arrow")) {
                    if (!unlocked) await unlock();
                    play();
                  }
                }}
                aria-describedby="sound-volume-hint"
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-300 accent-primary-600"
              />
              <p id="sound-volume-hint" className="mt-1.5 text-sm text-gray-600">
                {t("soundVolumeHint")}
              </p>
            </div>

            {/* Test row — the button self-arms audio on click (autoplay
                gesture), so no separate "tap to allow" instruction is needed. */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  if (!unlocked) await unlock();
                  play();
                }}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 shadow-sm transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <span aria-hidden="true">🔔</span>
                {t("soundTest")}
              </button>
            </div>

            <p className="mt-5 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
              {t("soundDeviceNote")}
            </p>
          </>
        )}
      </section>
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
