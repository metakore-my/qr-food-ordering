import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { notFound } from "next/navigation";
import { getSettings, resolveAppName } from "@/lib/settings";
import { getCapabilities } from "@/lib/integrations";
import { resolveThemeRamp, themeCssVars } from "@/lib/themes";
import {
  ConfigProvider,
  type PublicConfig,
} from "@/components/providers/config-provider";
import { ConfirmProvider } from "@/components/providers/confirm-provider";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/700.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Theme + config are runtime DB settings injected here, so this layout must not
// be statically cached — otherwise a changed brand color/theme won't take effect.
export const dynamic = "force-dynamic";

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  const settings = await getSettings();
  const capabilities = getCapabilities();
  const ramp = resolveThemeRamp(settings.brandTheme, settings.brandColor);

  const publicConfig: PublicConfig = {
    appName: resolveAppName(settings.appName, settings.appNameI18n, locale),
    currency: settings.currency,
    decimals: settings.decimals,
    defaultLocale: settings.defaultLocale,
    canonicalLocale: settings.canonicalLocale,
    enabledLocales: settings.enabledLocales,
    logoUrl: settings.logoUrl,
    takeawayEnabled: settings.takeawayEnabled,
    capabilities,
  };

  return (
    <NextIntlClientProvider messages={messages}>
      {/*
        XSS-safe by construction: themeCssVars() drops any shade that is not a
        strict 6-digit hex, so no setting value can close the <style> tag or
        inject markup. Do NOT interpolate any other value into this <style>.
      */}
      <style
        dangerouslySetInnerHTML={{ __html: `:root{${themeCssVars(ramp)}}` }}
      />
      <ConfigProvider value={publicConfig}>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ConfigProvider>
    </NextIntlClientProvider>
  );
}
