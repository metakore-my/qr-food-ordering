import { routing } from "@/i18n/routing";

/**
 * Build the locale filter for Prisma translation includes from a raw NEXT_LOCALE
 * cookie value. Validates against the enabled locales (falling back to the
 * deployment default for an unknown/missing value), then returns the deduped
 * set `[activeLocale, canonicalLocale]`.
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
