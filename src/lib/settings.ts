import { prisma } from "./prisma";
import {
  KNOWN_LOCALES,
  currencyDecimals,
} from "./deployment-config";

/** Setting keys persisted in the SystemSetting table. */
export const SETTING_KEYS = [
  "app_name",
  "currency",
  "default_locale",
  "canonical_locale",
  "enabled_locales",
  "brand_theme",
  "brand_color",
  "logo_url",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

const CURRENCY_TIMEZONE: Record<string, string> = {
  THB: "Asia/Bangkok",
  MYR: "Asia/Kuala_Lumpur",
  SGD: "Asia/Singapore",
  VND: "Asia/Ho_Chi_Minh",
};
const DEFAULT_TIMEZONE = "Asia/Bangkok";

export interface ResolvedSettings {
  appName: string;
  currency: string;
  decimals: number;
  timezone: string;
  defaultLocale: string;
  canonicalLocale: string;
  enabledLocales: string[];
  brandTheme: string;
  brandColor: string | null;
  logoUrl: string | null;
}

const DEFAULTS = {
  appName: "Restaurant",
  currency: "MYR",
  defaultLocale: "en",
  canonicalLocale: "en",
  enabledLocales: [...KNOWN_LOCALES] as string[],
  brandTheme: "green",
};

function isValidCurrencyCode(code: string): boolean {
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure resolver: DB row map → hardcoded default. Used by getSettings + tests.
 *
 * There is NO env tier for these config values: all NEXT_PUBLIC_* config vars
 * were dropped (config lives in the DB only). The sole surviving config env var,
 * NEXT_PUBLIC_DEFAULT_LOCALE, is consumed by routing.ts at the edge — NOT here.
 */
export function resolveSettings(
  db: Partial<Record<SettingKey, string>>
): ResolvedSettings {
  const pick = (key: SettingKey, dflt: string): string => db[key]?.trim() || dflt;

  const appName = pick("app_name", DEFAULTS.appName);
  const currency = pick("currency", DEFAULTS.currency).toUpperCase();
  const enabledRaw = db.enabled_locales?.trim() ?? "";
  const enabledLocales = enabledRaw
    ? enabledRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [...DEFAULTS.enabledLocales];
  const defaultLocale = pick("default_locale", DEFAULTS.defaultLocale);
  const canonicalLocale = pick("canonical_locale", DEFAULTS.canonicalLocale);
  const brandTheme = pick("brand_theme", DEFAULTS.brandTheme);

  return {
    appName,
    currency,
    decimals: currencyDecimals(currency),
    timezone: CURRENCY_TIMEZONE[currency] ?? DEFAULT_TIMEZONE,
    defaultLocale,
    canonicalLocale,
    enabledLocales,
    brandTheme,
    brandColor: db.brand_color?.trim() || null,
    logoUrl: db.logo_url?.trim() || null,
  };
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/** Validate an admin-supplied PARTIAL settings patch before persisting. */
export function validateSettingsInput(
  patch: Partial<Record<SettingKey, string>>
): ValidationResult {
  const known = new Set<string>(KNOWN_LOCALES);

  if (patch.currency && !isValidCurrencyCode(patch.currency.toUpperCase())) {
    return { ok: false, error: `Invalid currency code "${patch.currency}"` };
  }

  // If any locale field is in the patch, validate the resulting trio together.
  if (patch.enabled_locales || patch.default_locale || patch.canonical_locale) {
    const enabled = (patch.enabled_locales ?? DEFAULTS.enabledLocales.join(","))
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (enabled.length === 0) return { ok: false, error: "enabled_locales is empty" };
    for (const l of enabled) {
      if (!known.has(l)) return { ok: false, error: `Unknown locale "${l}"` };
    }
    const def = patch.default_locale ?? enabled[0];
    if (!enabled.includes(def)) return { ok: false, error: `default_locale "${def}" not in enabled set` };
    const canon = patch.canonical_locale ?? enabled[0];
    if (!enabled.includes(canon)) return { ok: false, error: `canonical_locale "${canon}" not in enabled set` };
  }

  if (patch.brand_theme && !["green", "terracotta", "indigo", "custom"].includes(patch.brand_theme)) {
    return { ok: false, error: `Unknown brand_theme "${patch.brand_theme}"` };
  }
  if (patch.brand_color && !/^#[0-9a-fA-F]{6}$/.test(patch.brand_color)) {
    return { ok: false, error: `brand_color must be a 6-digit hex` };
  }
  return { ok: true };
}

// --- Cached DB-backed reader (mirrors maintenance.ts) ---
const globalForSettings = globalThis as unknown as {
  settingsCache?: { value: ResolvedSettings; expires: number } | null;
};
const TTL_MS = 10_000;

export async function getSettings(): Promise<ResolvedSettings> {
  const now = Date.now();
  const cached = globalForSettings.settingsCache;
  if (cached && cached.expires > now) return cached.value;

  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [...SETTING_KEYS] } },
  });
  const db: Partial<Record<SettingKey, string>> = {};
  for (const r of rows) db[r.key as SettingKey] = r.value;

  const value = resolveSettings(db);
  globalForSettings.settingsCache = { value, expires: now + TTL_MS };
  return value;
}

/** Bust the cache immediately after an admin write. */
export function invalidateSettingsCache(): void {
  globalForSettings.settingsCache = null;
}
