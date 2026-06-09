import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { SettingsForm } from "@/components/admin/settings-form";
import { getTranslations, setRequestLocale } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("metadata");
  const { appName } = await getSettings();
  return { title: t("settings", { appName }) };
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session) {
    redirect(`/${locale}/admin/login`);
  }

  // SUPERADMIN-only — non-superadmins are bounced to the dashboard.
  if (session.user.role !== "SUPERADMIN") {
    redirect(`/${locale}/admin/dashboard`);
  }

  const settings = await getSettings();
  const t = await getTranslations("admin.settings");

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-gray-600">{t("subtitle")}</p>
      </div>
      <div className="p-4 md:p-6">
        <SettingsForm
          initial={{
            appName: settings.appName,
            currency: settings.currency,
            defaultLocale: settings.defaultLocale,
            canonicalLocale: settings.canonicalLocale,
            enabledLocales: settings.enabledLocales,
            brandTheme: settings.brandTheme,
            brandColor: settings.brandColor,
            logoUrl: settings.logoUrl,
          }}
        />
      </div>
    </main>
  );
}
