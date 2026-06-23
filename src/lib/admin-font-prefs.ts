/**
 * Per-device ADMIN-CONSOLE font-size preference (client-safe, no server/DB).
 *
 * Like the order-alert sound (`order-alert-prefs.ts`) and the sticky admin-UI
 * prefs (`admin-ui-prefs.ts`), text size is a PER-DEVICE choice stored in
 * `localStorage`, not a deployment-wide `SystemSetting`: a shared kitchen tablet
 * may want large text while a manager's laptop stays at the default. There is
 * intentionally no API/DB path here.
 *
 * The catalog + clamp + sanitize logic is pure and unit-tested; the store is
 * built with the shared `createPersistedPrefs` factory (SSR-safe, hydration-safe,
 * cross-tab, HMR-guarded). The applier component reads this store.
 */
import { createPersistedPrefs } from "./persisted-prefs";

/**
 * Selectable admin font sizes. `px` is the base font-size set on the admin shell
 * wrapper; because the UI is rem/`text-*`-based, this scales text + spacing
 * proportionally. `medium` is 16px = the current baseline, so existing devices
 * see no change. `labelKey` resolves to `admin.sidebar.<labelKey>`.
 */
export const ADMIN_FONT_SIZES = [
  { id: "small", px: 15, labelKey: "fontSizeSmall" },
  { id: "medium", px: 16, labelKey: "fontSizeMedium" },
  { id: "large", px: 18, labelKey: "fontSizeLarge" },
] as const;

export type AdminFontSize = (typeof ADMIN_FONT_SIZES)[number]["id"];

/** Default size for a fresh device — medium (= today's 16px baseline). */
export const DEFAULT_ADMIN_FONT_SIZE: AdminFontSize = "medium";

export interface AdminFontPrefs {
  size: AdminFontSize;
}

export const DEFAULT_ADMIN_FONT_PREFS: AdminFontPrefs = { size: DEFAULT_ADMIN_FONT_SIZE };

export const ADMIN_FONT_STORAGE_KEY = "admin.fontSize.v1";

/** Validate a stored size id, falling back to the default if unknown. */
export function clampFontSize(v: unknown): AdminFontSize {
  return ADMIN_FONT_SIZES.some((s) => s.id === v)
    ? (v as AdminFontSize)
    : DEFAULT_ADMIN_FONT_SIZE;
}

/** Resolve a size id to its base px, falling back to the default size's px. */
export function pxForFontSize(id: AdminFontSize): number {
  const found = ADMIN_FONT_SIZES.find((s) => s.id === id);
  return (found ?? ADMIN_FONT_SIZES.find((s) => s.id === DEFAULT_ADMIN_FONT_SIZE)!).px;
}

/**
 * Coerce an arbitrary parsed value into valid prefs, filling any
 * missing/invalid field from defaults. Total — never throws.
 */
export function sanitizeFontPrefs(parsed: unknown, defaults: AdminFontPrefs): AdminFontPrefs {
  if (typeof parsed !== "object" || parsed === null) return { ...defaults };
  const obj = parsed as Record<string, unknown>;
  return { size: clampFontSize(obj.size) };
}

/**
 * Per-device font-size store. Read via `useSyncExternalStore` in
 * `admin-font-scale.tsx`; written by the sidebar S/M/L toggle.
 */
export const adminFontPrefsStore = createPersistedPrefs(
  ADMIN_FONT_STORAGE_KEY,
  DEFAULT_ADMIN_FONT_PREFS,
  sanitizeFontPrefs,
);
