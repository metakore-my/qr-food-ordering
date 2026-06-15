import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { MenuList } from "@/components/admin/menu-list";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const { appName } = await getSettings();
  return { title: t("menuManagement", { appName }) };
}

export default async function MenuPage({
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

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "menu")) {
    redirect(`/${locale}/admin/dashboard`);
  }
  const t = await getTranslations("admin.menuManagement");

  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      names: true,
    },
  });

  const menuItems = await prisma.menuItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      names: true,
      category: {
        include: { names: true },
      },
      optionGroups: {
        orderBy: { sortOrder: "asc" },
        include: {
          names: true,
          choices: {
            orderBy: { sortOrder: "asc" },
            include: { names: true },
          },
        },
      },
    },
  });

  // Serialize Decimal fields to numbers for client components
  const serializedItems = menuItems.map((item) => ({
    ...item,
    price: Number(item.price),
    comboBasePrice: item.comboBasePrice != null ? Number(item.comboBasePrice) : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    category: {
      ...item.category,
      createdAt: item.category.createdAt.toISOString(),
      updatedAt: item.category.updatedAt.toISOString(),
    },
    optionGroups: item.optionGroups.map((g) => ({
      ...g,
      choices: g.choices.map((c) => ({
        ...c,
        priceAdjustment: Number(c.priceAdjustment),
      })),
    })),
  }));

  const serializedCategories = categories.map((cat) => ({
    ...cat,
    createdAt: cat.createdAt.toISOString(),
    updatedAt: cat.updatedAt.toISOString(),
  }));

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
        <div className="mx-auto max-w-6xl">
          <MenuList
            initialCategories={serializedCategories}
            initialMenuItems={serializedItems}
          />
        </div>
      </div>
    </main>
  );
}
