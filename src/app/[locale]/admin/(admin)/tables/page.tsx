import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { TableManager } from "@/components/admin/table-manager";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const { appName } = await getSettings();
  return { title: t("tables", { appName }) };
}

export default async function TablesPage({
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

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "tables")) {
    redirect(`/${locale}/admin/dashboard`);
  }
  const t = await getTranslations("admin.tables");

  const tables = await prisma.table.findMany({
    orderBy: { id: "asc" },
  });

  return (
    <main className="min-h-screen">
      {/* White header bar — matches dashboard/settings so the title stays legible
          over the animated cuisine background instead of floating on it bare. */}
      <div className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
          {t("title")}
        </h1>
      </div>
      <div className="p-4 md:p-6">
        <div className="mx-auto max-w-4xl">
          <TableManager initialTables={tables} />
        </div>
      </div>
    </main>
  );
}
