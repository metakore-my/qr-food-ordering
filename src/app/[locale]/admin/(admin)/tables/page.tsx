import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { TableManager } from "@/components/admin/table-manager";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSettings } from "@/lib/settings";

export async function generateMetadata() {
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
    <main className="min-h-screen p-4 md:p-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">
          {t("title")}
        </h1>
        <TableManager initialTables={tables} />
      </div>
    </main>
  );
}
