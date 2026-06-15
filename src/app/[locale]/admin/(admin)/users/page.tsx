import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { UserForm } from "@/components/admin/user-form";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const { appName } = await getSettings();
  return { title: t("users", { appName }) };
}

export default async function UsersPage({
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

  if (session.user.role !== "SUPERADMIN") {
    redirect(`/${locale}/admin/dashboard`);
  }

  const t = await getTranslations("admin.users");

  return (
    <main className="min-h-screen">
      <div className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t("subtitle")}
        </p>
      </div>
      <div className="p-4 md:p-6">
        <UserForm currentUserId={session.user?.id ?? ""} />
      </div>
    </main>
  );
}
