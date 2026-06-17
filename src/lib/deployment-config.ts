/**
 * Pure locale + currency helpers reused by the settings resolver and unit tests.
 * Runtime config lives in the DB (`settings.ts`) — no build-time singleton here.
 */

/** The full universe of locales the product ships translations for. */
export const KNOWN_LOCALES = [
  "en",
  "th",
  "vi",
  "zh-CN",
  "zh-TW",
  "ms",
] as const;

export type KnownLocale = (typeof KNOWN_LOCALES)[number];

/**
 * Display timezone keyed off currency (each target market has a distinct one).
 * Unmapped-but-valid codes fall back to Asia/Bangkok; add a row for a new market.
 */
export const CURRENCY_TIMEZONE: Record<string, string> = {
  THB: "Asia/Bangkok",
  MYR: "Asia/Kuala_Lumpur",
  SGD: "Asia/Singapore",
  VND: "Asia/Ho_Chi_Minh",
};

const DEFAULT_TIMEZONE = "Asia/Bangkok";

export interface DeploymentConfig {
  /** UI default locale + URL root. */
  defaultLocale: string;
  /** ISO 4217 currency code used for all money display. */
  currency: string;
  /** IANA timezone for all date display + report bucketing, derived from currency. */
  timezone: string;
  /** Locales the deployment exposes (subset of KNOWN_LOCALES). */
  enabledLocales: readonly string[];
}

function isValidCurrencyCode(code: string): boolean {
  try {
    // Intl rejects malformed/unregistered ISO 4217 codes by throwing.
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/** Minor-unit digit count via Intl (2 for THB/MYR/SGD, 0 for VND; defaults to 2). */
export function currencyDecimals(code: string): number {
  try {
    const fmt = new Intl.NumberFormat("en", { style: "currency", currency: code });
    return fmt.resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Pure parser, retained ONLY for its unit test (never called at runtime —
 * runtime config is DB-backed via `getSettings()`/`resolveSettings`). It still
 * exercises the live `enabled-locale` / `currency` / `CURRENCY_TIMEZONE`
 * validation helpers, which is why it's kept. The ONLY config env var that
 * survives is `NEXT_PUBLIC_DEFAULT_LOCALE` (edge URL-root locale); the old
 * `NEXT_PUBLIC_CANONICAL_LOCALE` / `NEXT_PUBLIC_ENABLED_LOCALES` /
 * `NEXT_PUBLIC_CURRENCY` env vars were dropped. `NEXT_PUBLIC_ENABLED_LOCALES`
 * / `NEXT_PUBLIC_CURRENCY` are parsed here purely to drive the validation-path
 * test; do NOT treat them as live deployment config.
 */
export function parseDeploymentConfig(
  env: Record<string, string | undefined>
): DeploymentConfig {
  const known = new Set<string>(KNOWN_LOCALES);

  const enabledLocales = env.NEXT_PUBLIC_ENABLED_LOCALES?.trim()
    ? env.NEXT_PUBLIC_ENABLED_LOCALES.split(",").map((s) => s.trim()).filter(Boolean)
    : [...KNOWN_LOCALES];

  for (const loc of enabledLocales) {
    if (!known.has(loc)) {
      throw new Error(
        `[deployment-config] NEXT_PUBLIC_ENABLED_LOCALES contains unknown locale "${loc}". Known: ${[...KNOWN_LOCALES].join(", ")}`
      );
    }
  }
  if (enabledLocales.length === 0) {
    throw new Error("[deployment-config] NEXT_PUBLIC_ENABLED_LOCALES resolved to an empty set");
  }

  const defaultLocale = env.NEXT_PUBLIC_DEFAULT_LOCALE?.trim() || "en";
  if (!enabledLocales.includes(defaultLocale)) {
    throw new Error(
      `[deployment-config] NEXT_PUBLIC_DEFAULT_LOCALE "${defaultLocale}" is not in the enabled set [${enabledLocales.join(", ")}]`
    );
  }

  const currency = (env.NEXT_PUBLIC_CURRENCY?.trim() || "THB").toUpperCase();
  if (!isValidCurrencyCode(currency)) {
    throw new Error(
      `[deployment-config] NEXT_PUBLIC_CURRENCY "${currency}" is not a valid ISO 4217 currency code`
    );
  }

  const timezone = CURRENCY_TIMEZONE[currency] ?? DEFAULT_TIMEZONE;

  return Object.freeze({
    defaultLocale,
    currency,
    timezone,
    enabledLocales: Object.freeze(enabledLocales) as readonly string[],
  });
}
