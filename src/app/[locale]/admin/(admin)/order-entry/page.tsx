import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSettings } from "@/lib/settings";
import { hasPermission } from "@/lib/permissions";
import { OrderEntry } from "@/components/admin/order-entry";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.orderEntry");
  const { appName } = await getSettings();
  return { title: `${t("title")} · ${appName}` };
}

export default async function OrderEntryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const authSession = await auth();
  if (!authSession) redirect(`/${locale}/admin/login`);

  if (!hasPermission(authSession.user.role, authSession.user.permissions ?? [], "orders")) {
    redirect(`/${locale}/admin/dashboard`);
  }

  const settings = await getSettings();
  const t = await getTranslations("admin.orderEntry");

  const localeFilter = locale === settings.canonicalLocale ? [settings.canonicalLocale] : [locale, settings.canonicalLocale];
  const nameFilter = { where: { locale: { in: localeFilter } } };

  const categoriesRaw = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    include: {
      names: nameFilter,
      items: {
        where: { isAvailable: true },
        orderBy: { sortOrder: "asc" },
        include: {
          names: nameFilter,
          optionGroups: {
            orderBy: { sortOrder: "asc" },
            include: {
              names: nameFilter,
              choices: { orderBy: { sortOrder: "asc" }, include: { names: nameFilter } },
            },
          },
        },
      },
    },
  });

  function resolveName(names: Array<{ locale: string; name: string; description?: string | null }>, id: number) {
    const loc = names.find((n) => n.locale === locale);
    if (loc?.name) return { name: loc.name, description: loc.description ?? undefined };
    const canon = names.find((n) => n.locale === settings.canonicalLocale);
    if (canon?.name) return { name: canon.name, description: canon.description ?? undefined };
    return { name: names[0]?.name ?? `#${id}`, description: names[0]?.description ?? undefined };
  }

  function mapItem(it: (typeof categoriesRaw)[number]["items"][number]) {
    const { name, description } = resolveName(it.names, it.id);
    return {
      id: it.id,
      name,
      description,
      price: Number(it.price),
      imageUrl: it.imageUrl ?? undefined,
      isAvailable: it.isAvailable,
      isCombo: it.isCombo,
      isFeatured: it.isFeatured,
      comboBasePrice: it.comboBasePrice != null ? Number(it.comboBasePrice) : null,
      optionGroups: it.optionGroups.map((g) => ({
        id: g.id,
        selectionType: g.selectionType as "SINGLE" | "MULTIPLE",
        isRequired: g.isRequired,
        sortOrder: g.sortOrder,
        names: g.names.map((n) => ({ locale: n.locale, name: n.name })),
        choices: g.choices.map((c) => ({
          id: c.id,
          priceAdjustment: Number(c.priceAdjustment),
          sortOrder: c.sortOrder,
          names: c.names.map((n) => ({ locale: n.locale, name: n.name })),
        })),
      })),
    };
  }

  // Drop categories that have no available items — they would render as dead chips.
  const categories = categoriesRaw
    .map((cat) => ({
      id: cat.id,
      name: resolveName(cat.names, cat.id).name,
      items: cat.items.map(mapItem),
    }))
    .filter((cat) => cat.items.length > 0);

  const activeTables = await prisma.table.findMany({
    where: { isActive: true },
    select: { id: true, number: true },
    orderBy: { number: "asc" },
  });

  return (
    <main className="min-h-screen">
      <div className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("subtitle")}</p>
      </div>
      <OrderEntry locale={locale} categories={categories} activeTables={activeTables} />
    </main>
  );
}
