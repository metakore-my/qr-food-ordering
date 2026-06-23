import { prisma } from "./prisma";
import {
  KNOWN_LOCALES,
  currencyDecimals,
} from "./deployment-config";

/** Setting keys persisted in the SystemSetting table. */
export const SETTING_KEYS = [
  "app_name",
  "app_name_i18n",
  "currency",
  "default_locale",
  "canonical_locale",
  "enabled_locales",
  "brand_theme",
  "brand_color",
  "logo_url",
  "takeaway_enabled",
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
  appNameI18n: Record<string, string>;
  currency: string;
  decimals: number;
  timezone: string;
  defaultLocale: string;
  canonicalLocale: string;
  enabledLocales: string[];
  brandTheme: string;
  brandColor: string | null;
  logoUrl: string | null;
  takeawayEnabled: boolean;
  setupComplete: boolean;
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

  let appNameI18n: Record<string, string> = {};
  const i18nRaw = db.app_name_i18n?.trim();
  if (i18nRaw) {
    try {
      const parsed = JSON.parse(i18nRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") appNameI18n[k] = v;
        }
      }
    } catch {
      appNameI18n = {};
    }
  }

  const currency = pick("currency", DEFAULTS.currency).toUpperCase();
  const enabledRaw = db.enabled_locales?.trim() ?? "";
  const enabledLocales = enabledRaw
    ? enabledRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [...DEFAULTS.enabledLocales];
  const defaultLocale = pick("default_locale", DEFAULTS.defaultLocale);
  const canonicalLocale = pick("canonical_locale", DEFAULTS.canonicalLocale);
  const brandTheme = pick("brand_theme", DEFAULTS.brandTheme);
  // `setup_completed` is not a SettingKey (it's not an editable setting), so
  // read it via a widened cast — getSettings() includes it in the findMany.
  const setupComplete =
    (db as Record<string, string | undefined>).setup_completed === "true";
  const takeawayEnabled = db.takeaway_enabled?.trim() === "true";

  return {
    appName,
    appNameI18n,
    currency,
    decimals: currencyDecimals(currency),
    timezone: CURRENCY_TIMEZONE[currency] ?? DEFAULT_TIMEZONE,
    defaultLocale,
    canonicalLocale,
    enabledLocales,
    brandTheme,
    brandColor: db.brand_color?.trim() || null,
    logoUrl: db.logo_url?.trim() || null,
    takeawayEnabled,
    setupComplete,
  };
}

// Per-locale app-name helpers live in the client-safe `app-name.ts` (this module
// top-level-imports `prisma`, so client components can't import from here). Re-
// exported so the existing `@/lib/settings` server-side import paths keep working.
export {
  resolveAppName,
  pruneAppNameI18n,
  swapDefaultLocaleName,
} from "./app-name";

export interface ValidationResult {
  ok: boolean;
  error?: string;
  code?: string;
}

/**
 * Validate an admin-supplied PARTIAL settings patch before persisting.
 *
 * `current` is the PERSISTED raw state (the same key→value map `resolveSettings`
 * consumes) — pass it from the settings PATCH route so a single-field patch is
 * validated against what will actually be in the DB after the upsert, not
 * against the hardcoded defaults. Without it, `{default_locale: "vi"}` against
 * a persisted `enabled_locales: "en,th"` validated against the all-6 default
 * set and persisted a default locale outside the enabled set (and the reverse:
 * shrinking `enabled_locales` could strand a persisted default/canonical
 * outside it). The setup wizard writes a fresh DB and may omit `current`.
 */
export function validateSettingsInput(
  patch: Partial<Record<SettingKey, string>>,
  current: Partial<Record<SettingKey, string>> = {},
  opts: { setupComplete?: boolean } = {}
): ValidationResult {
  const known = new Set<string>(KNOWN_LOCALES);

  // Locked after setup: currency + canonical_locale. Both anchor stored order
  // data (money precision / itemName snapshots), so they can't change once setup
  // is done. default_locale is NOT locked (display-only — which language paints
  // first; touches no stored data). A no-op re-submit of the same value is
  // allowed; only a CHANGE to a different value is rejected. The setup endpoint
  // passes no opts → setupComplete=false → not enforced (that's when these are
  // established). App name is NOT locked (display-only).
  if (opts.setupComplete) {
    const LOCKED_AFTER_SETUP = ["currency", "canonical_locale"] as const;
    for (const key of LOCKED_AFTER_SETUP) {
      if (patch[key] !== undefined && patch[key] !== current[key]) {
        return {
          ok: false,
          error: `${key} cannot be changed after setup`,
          code: "SETTING_LOCKED",
        };
      }
    }
  }

  // app_name ships to every client via ConfigProvider and renders on every page
  // (header, <title>). Every other setting is length/format-bounded; cap this one
  // too so an unbounded string can't bloat every response. 100 chars is generous
  // for any restaurant name.
  if (patch.app_name !== undefined) {
    const name = patch.app_name.trim();
    if (name.length === 0) {
      return { ok: false, error: "app_name is empty" };
    }
    if (name.length > 100) {
      return { ok: false, error: "app_name must be at most 100 characters" };
    }
  }

  // Per-locale app names: a JSON object keyed by enabled locale → name string.
  // Each value bounded like app_name; keys must be enabled locales (the main
  // language's name lives in `app_name`, not here). An empty object is valid.
  if (patch.app_name_i18n !== undefined) {
    let map: unknown;
    try {
      map = JSON.parse(patch.app_name_i18n);
    } catch {
      return { ok: false, error: "app_name_i18n must be valid JSON" };
    }
    if (typeof map !== "object" || map === null || Array.isArray(map)) {
      return { ok: false, error: "app_name_i18n must be a JSON object" };
    }
    const enabledForNames = (
      patch.enabled_locales ??
      current.enabled_locales ??
      DEFAULTS.enabledLocales.join(",")
    ).split(",").map((s) => s.trim()).filter(Boolean);
    for (const [loc, val] of Object.entries(map as Record<string, unknown>)) {
      if (!enabledForNames.includes(loc)) {
        return { ok: false, error: `app_name_i18n locale "${loc}" is not enabled` };
      }
      if (typeof val !== "string") {
        return { ok: false, error: `app_name_i18n["${loc}"] must be a string` };
      }
      if (val.trim().length > 100) {
        return { ok: false, error: `app_name_i18n["${loc}"] must be at most 100 characters` };
      }
    }
  }

  if (patch.currency && !isValidCurrencyCode(patch.currency.toUpperCase())) {
    return { ok: false, error: `Invalid currency code "${patch.currency}"` };
  }

  // If any locale field is in the patch, validate the trio as it will exist
  // AFTER the patch is applied: patched value → persisted value → default.
  if (patch.enabled_locales || patch.default_locale || patch.canonical_locale) {
    const enabled = (
      patch.enabled_locales ??
      current.enabled_locales ??
      DEFAULTS.enabledLocales.join(",")
    )
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (enabled.length === 0) return { ok: false, error: "enabled_locales is empty" };
    for (const l of enabled) {
      if (!known.has(l)) return { ok: false, error: `Unknown locale "${l}"` };
    }
    const def = patch.default_locale ?? current.default_locale ?? enabled[0];
    if (!enabled.includes(def)) return { ok: false, error: `default_locale "${def}" not in enabled set` };
    const canon = patch.canonical_locale ?? current.canonical_locale ?? enabled[0];
    if (!enabled.includes(canon)) return { ok: false, error: `canonical_locale "${canon}" not in enabled set` };
  }

  if (patch.brand_theme && !["green", "terracotta", "indigo", "amber", "custom"].includes(patch.brand_theme)) {
    return { ok: false, error: `Unknown brand_theme "${patch.brand_theme}"` };
  }
  if (patch.brand_color && !/^#[0-9a-fA-F]{6}$/.test(patch.brand_color)) {
    return { ok: false, error: `brand_color must be a 6-digit hex` };
  }
  // logo_url lands in an <img src> and is delivered to every client via
  // ConfigProvider. Today it's set via the R2 upload flow (so always an http(s)
  // URL) and SUPERADMIN-gated, but the value is otherwise free-form — validate it
  // so a stray `javascript:`/`data:` scheme (inert in <img> but a trap if the
  // logo is ever rendered into an href/CSS context) or a megabyte data: blob
  // can't reach the DB/clients. Empty string clears the logo and is allowed.
  if (patch.logo_url) {
    if (patch.logo_url.length > 500) {
      return { ok: false, error: `logo_url must be at most 500 characters` };
    }
    let parsed: URL;
    try {
      parsed = new URL(patch.logo_url);
    } catch {
      return { ok: false, error: `logo_url must be a valid URL` };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: `logo_url must be an http(s) URL` };
    }
  }

  // takeaway_enabled is a boolean-as-string toggle. It is NOT locked after setup
  // (unlike currency/canonical_locale — it anchors no stored order data), so this
  // check lives OUTSIDE the lock block and is always enforced.
  if (patch.takeaway_enabled !== undefined) {
    const v = patch.takeaway_enabled.trim();
    if (v !== "true" && v !== "false") {
      return { ok: false, error: "takeaway_enabled must be 'true' or 'false'" };
    }
  }
  return { ok: true };
}

/**
 * True if the post-setup settings lock (currency + canonical_locale) should be
 * enforced. The settings PATCH route passes the result as `setupComplete` to
 * `validateSettingsInput`. Pure (no DB) so it's unit-testable; the route does the
 * I/O (hasAnyAdmin + the sentinel read).
 *
 * The lock is active once configuration is ESTABLISHED, which holds on BOTH
 * install paths:
 *  - **seed path** (`SEED_SUPERADMIN_PASSWORD` set): an admin exists from boot and
 *    the seed wrote currency/canonical → `hasAdmin` true → locked. The seed does
 *    NOT write the `setup_completed` sentinel, so deriving the lock from the
 *    sentinel ALONE was a bug that left seeded production deploys permanently
 *    UNLOCKED (a SUPERADMIN could then change currency/canonical post-setup,
 *    corrupting stored money precision + historical-order name snapshots).
 *  - **wizard path** (`SEED_*` empty): no admin until the operator finishes
 *    `/admin/setup`, which writes both the admin AND the sentinel → locked then.
 *
 * `hasAdmin` is the authoritative signal (the same one the setup gate uses); the
 * sentinel is OR'd in as a defensive backstop. The lock guards only the settings
 * PATCH — the setup endpoint establishes these values before any admin exists.
 */
export function isSettingsLockActive(
  hasAdmin: boolean,
  setupSentinel: string | undefined
): boolean {
  return hasAdmin || setupSentinel === "true";
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
    where: { key: { in: [...SETTING_KEYS, "setup_completed"] } },
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
