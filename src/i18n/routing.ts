import { defineRouting } from "next-intl/routing";
import { KNOWN_LOCALES } from "@/lib/deployment-config";

type KnownLocale = (typeof KNOWN_LOCALES)[number];

// URL-root locale at the edge. The admin "default locale" SETTING drives the
// UI/display language; this only governs which locale `/` canonicalizes to.
const ROOT_LOCALE = process.env.NEXT_PUBLIC_DEFAULT_LOCALE?.trim() || "en";
const DEFAULT_LOCALE: KnownLocale = (KNOWN_LOCALES as readonly string[]).includes(
  ROOT_LOCALE
)
  ? (ROOT_LOCALE as KnownLocale)
  : "en";

export const routing = defineRouting({
  locales: KNOWN_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localeDetection: false,
  localeCookie: { name: "NEXT_LOCALE", maxAge: 60 * 60 * 24 * 365 },
});
