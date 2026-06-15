import { routing } from "@/i18n/routing";

/**
 * Build the locale filter for Prisma translation includes from a raw NEXT_LOCALE
 * cookie value. Validates against the routable `KNOWN_LOCALES` superset (via
 * `routing.locales`), falling back to the deployment default for an
 * unknown/missing value, then returns the deduped set `[activeLocale,
 * canonicalLocale]`.
 *
 * Note: this validates against the 6-locale routable superset, NOT the
 * deployment's currently-*enabled* subset. That's intentional and safe — the
 * superset is a fixed allowlist of known-safe strings (no injection into the
 * Prisma `where`), and a still-routable-but-disabled locale simply returns no
 * rows for that locale and falls through to the canonical fallback. Tightening
 * to the enabled set would require threading `enabledLocales` through every
 * call site for no security or correctness gain.
 *
 * The canonical locale is supplied by the caller (from the runtime
 * `(await getSettings()).canonicalLocale`) — config is now DB-backed, so this
 * helper no longer reads a build-time singleton.
 *
 * Use this for the `names: { where: { locale: { in: ... } } }` filter on any
 * READ/display path — never `names: true` (all 6 locales), which hydrates a huge
 * object graph into the heap and is the #1 RSS-growth driver. The consumer only
 * ever renders the active locale with a canonical fallback, so two locales suffice.
 */
export function localeFilterFromCookie(
  rawLocale: string | undefined,
  canonicalLocale: string
): string[] {
  const locale = (routing.locales as readonly string[]).includes(rawLocale ?? "")
    ? (rawLocale as string)
    : routing.defaultLocale;
  return Array.from(new Set([locale, canonicalLocale]));
}
