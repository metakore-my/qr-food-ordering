import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { hasAnyAdmin } from "@/lib/first-admin";
import { SetupWizard } from "@/components/admin/setup-wizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.setup");
  return { title: t("title") };
}

/**
 * First-run setup wizard. Lives OUTSIDE the (admin) route group — it is a
 * sibling, so the admin auth guard never wraps it (the first owner has no
 * credentials yet). Primary gate: if any user account already exists, setup is
 * closed and we send the visitor to the login form. The race-safe server-side
 * enforcement is the count-then-create inside POST /api/admin/setup.
 */
export default async function SetupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (await hasAnyAdmin()) {
    redirect(`/${locale}/admin/login`);
  }

  return <SetupWizard />;
}
