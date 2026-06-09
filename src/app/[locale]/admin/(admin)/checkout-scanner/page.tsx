import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CheckoutScanner } from "@/components/admin/checkout-scanner";
import { getSettings } from "@/lib/settings";

export async function generateMetadata() {
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
