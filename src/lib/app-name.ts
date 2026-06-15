/**
 * Client-safe pure helpers for the per-locale app name.
 *
 * Split out of `settings.ts` (which top-level-imports `prisma` and is therefore
 * server-only) so client components — the settings form and the setup wizard —
 * can use them without pulling the Prisma client into the browser bundle.
 * `settings.ts` re-exports these for the existing server-side importers, so the
 * `@/lib/settings` import path keeps working unchanged.
 *
 * Model: `app_name` holds the DEFAULT locale's name (the main/fallback string);
 * `app_name_i18n` is a `{ locale: name }` map for the OTHER enabled locales.
 */

/**
 * Resolve the app name for a viewer's locale: the per-locale name if set and
 * non-empty, otherwise the main-language name. Used by the root layout (→
 * ConfigProvider → all clients) and customer-facing page titles. `getSettings()`
 * itself stays locale-agnostic (returns the main `appName`).
 */
export function resolveAppName(
  appName: string,
  appNameI18n: Record<string, string>,
  locale: string
): string {
  const localized = appNameI18n?.[locale]?.trim();
  return localized || appName;
}

/**
 * Drop per-locale app-name entries for locales that are no longer enabled.
 * Called by the settings PATCH route when `enabled_locales` shrinks so a name
 * for a just-disabled locale doesn't linger in the DB (and keep rendering on its
 * still-routable `/<locale>/...` URL — `resolveAppName` is an ungated map
 * lookup). The main-language name lives in `app_name` (not this map), so it's
 * unaffected.
 */
export function pruneAppNameI18n(
  appNameI18n: Record<string, string>,
  enabledLocales: string[]
): Record<string, string> {
  const enabled = new Set(enabledLocales);
  const pruned: Record<string, string> = {};
  for (const [loc, name] of Object.entries(appNameI18n)) {
    if (enabled.has(loc)) pruned[loc] = name;
  }
  return pruned;
}

/**
 * Re-home the app name when the operator switches the default locale.
 *
 * `app_name` always holds the DEFAULT locale's name; `app_name_i18n` holds the
 * OTHER enabled locales' names — and the settings form only renders/persists
 * per-locale inputs for `loc !== defaultLocale`. So when the default flips
 * `oldLocale → newLocale`, the slots must SWAP:
 *   - the new default's name moves OUT of the map INTO `app_name`, and
 *   - the old default's `app_name` moves INTO the map under `oldLocale`.
 *
 * Without this, switching default en→zh-CN would (a) leave the English
 * "Oriental Kopi" in `app_name` mislabelled as the zh-CN main name, (b) drop
 * "华阳" on save (filtered as the new default), and (c) lose "Oriental Kopi"
 * entirely (never written to `app_name_i18n["en"]`). An empty old-default name
 * is NOT stored (no blank map entry). Does not mutate its inputs.
 */
export function swapDefaultLocaleName(
  appName: string,
  appNameI18n: Record<string, string>,
  oldLocale: string,
  newLocale: string
): { appName: string; appNameI18n: Record<string, string> } {
  if (oldLocale === newLocale) {
    return { appName, appNameI18n: { ...appNameI18n } };
  }
  const next = { ...appNameI18n };
  // The new default's name (if any) becomes the main string; remove it from the map.
  const newMain = next[newLocale]?.trim() ?? "";
  delete next[newLocale];
  // The old default's main name moves into the map under its own locale (if non-empty).
  const oldName = appName.trim();
  if (oldName) {
    next[oldLocale] = appName;
  } else {
    delete next[oldLocale];
  }
  return { appName: newMain, appNameI18n: next };
}
