"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { KNOWN_LOCALES } from "@/lib/deployment-config";
import { resolveThemeRamp, themeCssVars } from "@/lib/themes";
import { swapDefaultLocaleName } from "@/lib/app-name";
import { useConfig } from "@/components/providers/config-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { APP_VERSION } from "@/lib/version";

const CURRENCIES = ["MYR", "SGD", "THB", "VND"] as const;
const THEMES = ["green", "terracotta", "indigo", "amber"] as const;

/** Human-readable language names for the locale pickers. */
const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  th: "ไทย",
  vi: "Tiếng Việt",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ms: "Bahasa Melayu",
};

/**
 * First-run setup wizard. Two steps: (1) admin account, (2) restaurant config.
 * Posts to POST /api/admin/setup. The Turnstile widget renders ONLY when the
 * deployment has CAPTCHA configured (capabilities.hasTurnstile); otherwise it is
 * omitted and no token is sent (matches the server, which skips verification
 * when unconfigured — see /api/admin/setup).
 */
export function SetupWizard() {
  const t = useTranslations("admin.setup");
  const locale = useLocale();
  const { capabilities } = useConfig();
  // Renamed to avoid colliding with the confirm-password field state (`confirm`).
  const confirmDialog = useConfirm();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — account
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Step 2 — restaurant
  const [appName, setAppName] = useState("");
  // Per-locale app names for NON-default enabled locales (the default locale's
  // name is `appName`). Blank → falls back to the main name.
  const [appNameI18n, setAppNameI18n] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("MYR");
  const [defaultLocale, setDefaultLocale] = useState("en");
  const [enabledLocales, setEnabledLocales] = useState<string[]>([
    ...KNOWN_LOCALES,
  ]);
  const [theme, setTheme] = useState<(typeof THEMES)[number]>("green");

  // FULL LIVE PREVIEW: apply the selected theme's primary ramp to the whole page
  // by overriding the `--color-primary-*` CSS vars on <html> (the same vars the
  // root layout injects). Preview-only — touches THIS tab's DOM, never the DB.
  // Cleanup restores the prior vars, so leaving the wizard without finishing (or
  // it unmounting on success) reverts the theme; the chosen theme is persisted
  // only when setup completes. The wizard offers presets only (no custom color).
  // Mirrors the same effect in settings-form.tsx. XSS-safe: themeCssVars drops
  // any non-hex shade.
  useEffect(() => {
    const root = document.documentElement;
    const shades = [
      "50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950",
    ] as const;
    const prev = shades.map(
      (s) => [s, root.style.getPropertyValue(`--color-primary-${s}`)] as const
    );
    const ramp = resolveThemeRamp(theme, null);
    for (const decl of themeCssVars(ramp).split(";")) {
      const [name, value] = decl.split(":").map((x) => x.trim());
      if (name && value) root.style.setProperty(name, value);
    }
    return () => {
      for (const [s, val] of prev) {
        if (val) root.style.setProperty(`--color-primary-${s}`, val);
        else root.style.removeProperty(`--color-primary-${s}`);
      }
    };
  }, [theme]);

  // Turnstile
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance | null>(null);

  // Submission state
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // Set when the server reports setup is already complete (403).
  const [alreadyDone, setAlreadyDone] = useState(false);

  function validateStep1(): boolean {
    if (!username.trim()) {
      setError(t("errorUsernameRequired"));
      return false;
    }
    // Client-side validation mirrors passwordSchema (8–16 chars, upper, lower,
    // digit) so a weak password fails inline at step 1 instead of via a server
    // 400 on final submit. The server zod schema stays authoritative.
    if (password.length < 8) {
      setError(t("errorPasswordLength"));
      return false;
    }
    if (password.length > 16) {
      setError(t("errorPasswordMaxLength"));
      return false;
    }
    if (!/[A-Z]/.test(password)) {
      setError(t("errorPasswordUppercase"));
      return false;
    }
    if (!/[a-z]/.test(password)) {
      setError(t("errorPasswordLowercase"));
      return false;
    }
    if (!/[0-9]/.test(password)) {
      setError(t("errorPasswordDigit"));
      return false;
    }
    if (password !== confirm) {
      setError(t("errorPasswordMismatch"));
      return false;
    }
    return true;
  }

  function validateStep2(): boolean {
    if (!appName.trim()) {
      setError(t("errorAppNameRequired"));
      return false;
    }
    if (enabledLocales.length === 0) {
      setError(t("errorEnabledEmpty"));
      return false;
    }
    if (!enabledLocales.includes(defaultLocale)) {
      setError(t("errorDefaultNotEnabled"));
      return false;
    }
    return true;
  }

  function goNext() {
    setError(null);
    if (validateStep1()) setStep(2);
  }

  function goBack() {
    setError(null);
    setStep(1);
  }

  function toggleEnabledLocale(loc: string, checked: boolean) {
    setEnabledLocales((prev) => {
      if (checked) return prev.includes(loc) ? prev : [...prev, loc];
      // Never allow unchecking the default locale.
      if (loc === defaultLocale) return prev;
      return prev.filter((l) => l !== loc);
    });
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError(null);

    if (!validateStep2()) return;
    if (capabilities.hasTurnstile && !turnstileToken) {
      setError(t("errorCaptcha"));
      return;
    }

    const i18nClean: Record<string, string> = {};
    for (const [loc, name] of Object.entries(appNameI18n)) {
      const v = name.trim();
      if (v && loc !== defaultLocale && enabledLocales.includes(loc)) i18nClean[loc] = v;
    }

    const ok = await confirmDialog({
      tone: "default",
      message: t("confirmFinish", {
        appName: appName.trim(),
        currency,
        mainLanguage: LOCALE_LABELS[defaultLocale] ?? defaultLocale,
      }),
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          settings: {
            app_name: appName.trim(),
            app_name_i18n: JSON.stringify(i18nClean),
            currency,
            default_locale: defaultLocale,
            canonical_locale: defaultLocale,
            enabled_locales: enabledLocales.join(","),
            brand_theme: theme,
          },
          ...(capabilities.hasTurnstile && turnstileToken
            ? { turnstileToken }
            : {}),
        }),
      });

      if (res.status === 201) {
        setDone(true);
        // Full reload so the new theme/config (and re-evaluated setup gate) take
        // effect on the login page.
        setTimeout(() => {
          window.location.href = `/${locale}/admin/login`;
        }, 1200);
        return;
      }

      if (res.status === 403) {
        setAlreadyDone(true);
        return;
      }

      // 400 (validation) or other error — surface a useful message.
      const data = await res.json().catch(() => null);
      if (data?.details) {
        // zod fieldErrors: { username?: string[], password?: string[] }
        const first =
          (Object.values(data.details).flat().filter(Boolean) as string[])[0];
        setError(first ?? t("errorGeneric"));
      } else {
        setError(data?.error ?? t("errorGeneric"));
      }
      // Reset the CAPTCHA so the owner can retry.
      if (capabilities.hasTurnstile) {
        setTurnstileToken(null);
        turnstileRef.current?.reset();
      }
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }

  // High-contrast field styling — matches the admin settings form.
  const inputClass =
    "w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-base text-gray-900 shadow-sm transition-colors placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:bg-gray-100";
  const labelClass = "mb-1.5 block text-sm font-semibold text-gray-900";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-primary-600">{t("title")}</h1>
          <p className="mt-2 text-gray-600">{t("subtitle")}</p>
        </div>

        {/* Step indicator */}
        <div className="mb-6 flex items-center justify-center gap-3 text-sm">
          <span
            className={`flex items-center gap-2 font-medium ${
              step === 1 ? "text-primary-600" : "text-gray-400"
            }`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                step === 1
                  ? "bg-primary-500 text-white"
                  : "bg-gray-200 text-gray-500"
              }`}
            >
              1
            </span>
            {t("stepAccountLabel")}
          </span>
          <span className="h-px w-8 bg-gray-300" aria-hidden="true" />
          <span
            className={`flex items-center gap-2 font-medium ${
              step === 2 ? "text-primary-600" : "text-gray-400"
            }`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                step === 2
                  ? "bg-primary-500 text-white"
                  : "bg-gray-200 text-gray-500"
              }`}
            >
              2
            </span>
            {t("stepRestaurantLabel")}
          </span>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-lg sm:p-8">
          {alreadyDone ? (
            <div className="space-y-4 text-center">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
                {t("alreadyCompleted")}
              </div>
              <Link
                href={`/${locale}/admin/login`}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
              >
                {t("goToLogin")}
              </Link>
            </div>
          ) : done ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center text-sm font-medium text-emerald-800">
              {t("success")}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {step === 1 ? (
                <>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">
                      {t("accountTitle")}
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">
                      {t("accountSubtitle")}
                    </p>
                  </div>

                  {/* Username */}
                  <div>
                    <label htmlFor="setup-username" className={labelClass}>
                      {t("username")}
                    </label>
                    <input
                      id="setup-username"
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={t("usernamePlaceholder")}
                      className={inputClass}
                    />
                  </div>

                  {/* Password */}
                  <div>
                    <label htmlFor="setup-password" className={labelClass}>
                      {t("password")}
                    </label>
                    <div className="relative">
                      <input
                        id="setup-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t("passwordPlaceholder")}
                        className={`${inputClass} pr-10`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((p) => !p)}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus-visible:text-gray-900 focus-visible:outline-none"
                      >
                        {showPassword ? (
                          <svg
                            className="h-5 w-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
                            />
                          </svg>
                        ) : (
                          <svg
                            className="h-5 w-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                            />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Confirm password */}
                  <div>
                    <label htmlFor="setup-confirm" className={labelClass}>
                      {t("confirmPassword")}
                    </label>
                    <input
                      id="setup-confirm"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder={t("confirmPasswordPlaceholder")}
                      className={inputClass}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">
                      {t("restaurantTitle")}
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">
                      {t("restaurantSubtitle")}
                    </p>
                  </div>

                  {/* App name */}
                  <div>
                    <label htmlFor="setup-appname" className={labelClass}>
                      {t("appName")}
                    </label>
                    <input
                      id="setup-appname"
                      type="text"
                      value={appName}
                      onChange={(e) => setAppName(e.target.value)}
                      placeholder={t("appNamePlaceholder")}
                      className={inputClass}
                    />
                  </div>

                  {/* Per-language app names (optional, for non-default enabled locales) */}
                  {enabledLocales
                    .filter((loc) => loc !== defaultLocale)
                    .map((loc) => (
                      <div key={loc}>
                        <label htmlFor={`setup-appname-${loc}`} className={labelClass}>
                          {t("appNameFor", { language: LOCALE_LABELS[loc] ?? loc })}
                        </label>
                        <input
                          id={`setup-appname-${loc}`}
                          type="text"
                          value={appNameI18n[loc] ?? ""}
                          onChange={(e) =>
                            setAppNameI18n((prev) => ({ ...prev, [loc]: e.target.value }))
                          }
                          placeholder={t("appNameForPlaceholder")}
                          className={inputClass}
                        />
                      </div>
                    ))}

                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {t("permanentNotice")}
                  </p>

                  {/* Currency */}
                  <div>
                    <label htmlFor="setup-currency" className={labelClass}>
                      {t("currency")}
                    </label>
                    <select
                      id="setup-currency"
                      value={currency}
                      onChange={(e) =>
                        setCurrency(
                          e.target.value as (typeof CURRENCIES)[number]
                        )
                      }
                      className={inputClass}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Default locale */}
                  <div>
                    <label htmlFor="setup-default-locale" className={labelClass}>
                      {t("defaultLocale")}
                    </label>
                    <select
                      id="setup-default-locale"
                      value={defaultLocale}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === defaultLocale) return;
                        // Re-home the app name when the default language changes:
                        // `app_name` holds the default locale's name and per-locale
                        // inputs cover only `loc !== defaultLocale`, so swap slots
                        // (see swapDefaultLocaleName) to avoid losing a typed name.
                        const swapped = swapDefaultLocaleName(
                          appName,
                          appNameI18n,
                          defaultLocale,
                          next
                        );
                        setAppName(swapped.appName);
                        setAppNameI18n(swapped.appNameI18n);
                        setDefaultLocale(next);
                        // The default locale must always be enabled.
                        setEnabledLocales((prev) =>
                          prev.includes(next) ? prev : [...prev, next]
                        );
                      }}
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
                    <p className="mb-2 text-sm text-gray-600">
                      {t("enabledLocalesHint")}
                    </p>
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
                              onChange={(e) =>
                                toggleEnabledLocale(loc, e.target.checked)
                              }
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

                  {/* Theme preset */}
                  <fieldset>
                    <legend className={labelClass}>{t("theme")}</legend>
                    <div className="flex flex-wrap gap-3">
                      {THEMES.map((th) => {
                        const ramp = resolveThemeRamp(th, null);
                        const selected = theme === th;
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
                              name="setup-theme"
                              value={th}
                              checked={selected}
                              onChange={() => setTheme(th)}
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
                    </div>
                  </fieldset>

                  {/* Turnstile — only when CAPTCHA is configured */}
                  {capabilities.hasTurnstile && (
                    <div className="flex justify-center">
                      <Turnstile
                        ref={turnstileRef}
                        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
                        onSuccess={setTurnstileToken}
                        onError={() => setTurnstileToken(null)}
                        onExpire={() => {
                          setTurnstileToken(null);
                          turnstileRef.current?.reset();
                        }}
                        options={{
                          theme: "light",
                          size: "flexible",
                          language: locale,
                        }}
                      />
                    </div>
                  )}
                </>
              )}

              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800"
                >
                  {error}
                </div>
              )}

              {/* Navigation buttons */}
              <div className="flex items-center justify-between gap-3 pt-1">
                {step === 2 ? (
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={submitting}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:opacity-60"
                  >
                    {t("back")}
                  </button>
                ) : (
                  <span />
                )}

                {step === 1 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
                  >
                    {t("next")}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={
                      submitting ||
                      (capabilities.hasTurnstile && !turnstileToken)
                    }
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? t("submitting") : t("finish")}
                  </button>
                )}
              </div>
            </form>
          )}

          {/* App version — source of truth is package.json (see lib/version.ts) */}
          <p className="mt-6 border-t border-gray-100 pt-4 text-center text-[11px] text-gray-400">
            v{APP_VERSION}
          </p>
        </div>
      </div>
    </main>
  );
}
