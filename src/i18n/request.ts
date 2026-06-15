import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale;
  }

  let messages;
  try {
    messages = (await import(`./messages/${locale}.json`)).default;
  } catch {
    // Fallback to default locale if the requested locale file doesn't exist
    messages = (await import(`./messages/${routing.defaultLocale}.json`)).default;
  }

  return {
    locale,
    messages,
  };
});
