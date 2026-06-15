import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSettings, isSettingsLockActive } from "@/lib/settings";
import { hasAnyAdmin } from "@/lib/first-admin";
import { prisma } from "@/lib/prisma";
import { SettingsForm } from "@/components/admin/settings-form";
import { MenuBackupCard } from "@/components/admin/menu-backup-card";
import { getTranslations, setRequestLocale } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
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
  // Derive the lock state the SAME way the authoritative PATCH route does:
  // isSettingsLockActive(hasAnyAdmin, sentinel) = hasAdmin || sentinel==="true".
  // settings.setupComplete is sentinel-ONLY (cached), which leaves a SEEDED
  // deploy (admin from boot, sentinel never written) showing an editable
  // currency/locale field that the API then rejects with SETTING_LOCKED — the
  // exact seeded-deploy hole isSettingsLockActive was written to close. Read the
  // sentinel live (uncached) to match the route.
  const setupRow = await prisma.systemSetting.findUnique({
    where: { key: "setup_completed" },
  });
  const setupComplete = isSettingsLockActive(await hasAnyAdmin(), setupRow?.value);
  const t = await getTranslations("admin.settings");

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-gray-600">{t("subtitle")}</p>
      </div>
      <div className="space-y-6 p-4 md:p-6">
        <SettingsForm
          initial={{
            appName: settings.appName,
            appNameI18n: settings.appNameI18n,
            currency: settings.currency,
            defaultLocale: settings.defaultLocale,
            canonicalLocale: settings.canonicalLocale,
            enabledLocales: settings.enabledLocales,
            brandTheme: settings.brandTheme,
            brandColor: settings.brandColor,
            logoUrl: settings.logoUrl,
          }}
          setupComplete={setupComplete}
        />
        <MenuBackupCard />
      </div>
    </main>
  );
}
