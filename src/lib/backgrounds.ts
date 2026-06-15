/**
 * Per-market background image sets for the landing-page and admin-shell
 * slideshows. The active set is chosen by the runtime currency (the same
 * currency-as-market discriminator used by CURRENCY_TIMEZONE in
 * deployment-config.ts). Single source of truth — both background components
 * import this rather than hardcoding their own lists. Client-safe and pure.
 */

export type Cuisine = "thai" | "malaysian" | "singaporean" | "vietnamese";

/** 5 optimized WebP paths per cuisine (served from public/images/backgrounds). */
export const CUISINE_BACKGROUNDS: Record<Cuisine, string[]> = {
  thai: [
    "/images/backgrounds/thai/01.webp",
    "/images/backgrounds/thai/02.webp",
    "/images/backgrounds/thai/03.webp",
    "/images/backgrounds/thai/04.webp",
    "/images/backgrounds/thai/05.webp",
  ],
  malaysian: [
    "/images/backgrounds/malaysian/01.webp",
    "/images/backgrounds/malaysian/02.webp",
    "/images/backgrounds/malaysian/03.webp",
    "/images/backgrounds/malaysian/04.webp",
    "/images/backgrounds/malaysian/05.webp",
  ],
  singaporean: [
    "/images/backgrounds/singaporean/01.webp",
    "/images/backgrounds/singaporean/02.webp",
    "/images/backgrounds/singaporean/03.webp",
    "/images/backgrounds/singaporean/04.webp",
    "/images/backgrounds/singaporean/05.webp",
  ],
  vietnamese: [
    "/images/backgrounds/vietnamese/01.webp",
    "/images/backgrounds/vietnamese/02.webp",
    "/images/backgrounds/vietnamese/03.webp",
    "/images/backgrounds/vietnamese/04.webp",
    "/images/backgrounds/vietnamese/05.webp",
  ],
};

/** Currency → cuisine. Mirrors CURRENCY_TIMEZONE in deployment-config.ts. */
const CURRENCY_CUISINE: Record<string, Cuisine> = {
  THB: "thai",
  MYR: "malaysian",
  SGD: "singaporean",
  VND: "vietnamese",
};

/**
 * Resolve the background image set for a runtime currency. Case-insensitive.
 * An unknown/empty/missing currency falls back to the Malaysian set (the
 * operator's home market). NOTE: the template's default currency is THB, so an
 * unconfigured deploy shows Thai — the Malaysian fallback only triggers for an
 * unrecognized currency.
 */
export function backgroundsForCurrency(currency: string): string[] {
  const cuisine = CURRENCY_CUISINE[(currency ?? "").toUpperCase()] ?? "malaysian";
  return CUISINE_BACKGROUNDS[cuisine];
}
