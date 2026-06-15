import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CheckoutScanner } from "@/components/admin/checkout-scanner";
import { getSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const { appName } = await getSettings();
  return { title: t("checkoutScanner", { appName }) };
}

export default async function CheckoutScannerPage({
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

  // Scanner = order settlement + force-close → `orders` permission (page-level
  // mirror of the API guard, same pattern as menu-management).
  if (!hasPermission(session.user.role, session.user.permissions ?? [], "orders")) {
    redirect(`/${locale}/admin/dashboard`);
  }

  const t = await getTranslations("admin.checkoutScanner");

  return (
    <main className="min-h-screen">
      <div className="border-b border-gray-200 bg-white px-4 py-4 md:px-6">
        <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("subtitle")}</p>
      </div>
      <CheckoutScanner />
    </main>
  );
}
