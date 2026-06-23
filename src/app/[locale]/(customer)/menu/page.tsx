import type { Metadata } from "next";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isSessionExpired } from "@/lib/session";
import { setRequestLocale, getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { CategoryTabs } from "@/components/menu/category-tabs";
import { MenuPageClient } from "@/components/menu/menu-page-client";
import { getCached, setCache } from "@/lib/menu-cache";
import { getSettings, resolveAppName } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const s = await getSettings();
  const locale = await getLocale();
  const appName = resolveAppName(s.appName, s.appNameI18n, locale);
  return { title: t("menu", { appName }) };
}

// Type for cached category data
type CachedCategory = {
  id: number;
  name: string;
  items: Array<{
    id: number;
    name: string;
    description: string | undefined;
    price: number;
    imageUrl: string | undefined;
    isAvailable: boolean;
    isCombo: boolean;
    isFeatured: boolean;
    comboBasePrice: number | null;
    optionGroups: Array<{
      id: number;
      selectionType: "SINGLE" | "MULTIPLE";
      isRequired: boolean;
      sortOrder: number;
      names: Array<{ locale: string; name: string }>;
      choices: Array<{
        id: number;
        priceAdjustment: number;
        sortOrder: number;
        names: Array<{ locale: string; name: string }>;
      }>;
    }>;
  }>;
};

export default async function MenuPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("customer");
  const tNav = await getTranslations("nav");
  const tMenu = await getTranslations("menu");
  const tOrder = await getTranslations("order");
  const { canonicalLocale } = await getSettings();

  // 1. Read session_id from cookie
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session_id")?.value;

  // 2. If no session, show message
  if (!sessionId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">
            {t("noSession")}
          </h1>
          <p className="mt-2 text-gray-600">{t("noSessionMessage")}</p>
          <Link
            href="/"
            className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
          >
            {t("backToHome")}
          </Link>
        </div>
      </main>
    );
  }

  // 3. Verify session exists and is ACTIVE, get table info
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      table: { select: { id: true, number: true } },
    },
  });

  if (!session || session.status !== "ACTIVE" || isSessionExpired(session.updatedAt)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">
            {t("sessionExpired")}
          </h1>
          <p className="mt-2 text-gray-600">{t("sessionExpiredMessage")}</p>
          <Link
            href="/"
            className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
          >
            {t("backToHome")}
          </Link>
        </div>
      </main>
    );
  }

  // Helper: resolve name with locale fallback (locale -> th -> any -> generic)
  function resolveName(
    names: Array<{ locale: string; name: string; description?: string | null }>,
    fallbackId: number
  ): { name: string; description: string | undefined } {
    const loc = names.find((n) => n.locale === locale);
    if (loc?.name) return { name: loc.name, description: loc.description ?? undefined };
    const th = names.find((n) => n.locale === canonicalLocale);
    if (th?.name) return { name: th.name, description: th.description ?? undefined };
    const any = names[0];
    if (any?.name) return { name: any.name, description: any.description ?? undefined };
    return { name: `#${fallbackId}`, description: undefined };
  }

  // 4. Check cache first
  const cacheKey = `menu:${locale}`;
  let categoriesWithFallback = getCached<CachedCategory[]>(cacheKey);

  if (!categoriesWithFallback) {
    // Cache miss - fetch from database
    const localeFilter =
      locale === canonicalLocale
        ? [canonicalLocale]
        : [locale, canonicalLocale];
    const nameFilter = { where: { locale: { in: localeFilter } } };

    const categoriesRaw = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        names: nameFilter,
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            names: nameFilter,
            optionGroups: {
              orderBy: { sortOrder: "asc" },
              include: {
                names: nameFilter,
                choices: {
                  orderBy: { sortOrder: "asc" },
                  include: { names: nameFilter },
                },
              },
            },
          },
        },
      },
    });

    // Resolve translations in-memory and split available/unavailable
    categoriesWithFallback = categoriesRaw.map((cat) => {
      const { name: categoryName } = resolveName(cat.names, cat.id);

      const items = cat.items.map((item) => {
        const { name: itemName, description: itemDescription } = resolveName(item.names, item.id);
        return {
          id: item.id,
          name: itemName,
          description: itemDescription || undefined,
          price: Number(item.price),
          imageUrl: item.imageUrl ?? undefined,
          isAvailable: item.isAvailable,
          isCombo: item.isCombo,
          isFeatured: item.isFeatured,
          comboBasePrice: item.comboBasePrice != null ? Number(item.comboBasePrice) : null,
          optionGroups: item.optionGroups.map((g) => ({
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
      });

      // Sort: available items first, then unavailable (preserving sortOrder within each group)
      items.sort((a, b) => (a.isAvailable === b.isAvailable ? 0 : a.isAvailable ? -1 : 1));

      return { id: cat.id, name: categoryName, items };
    });

    // Store in cache
    setCache(cacheKey, categoriesWithFallback);
  }

  // Collect featured items across all categories
  const featuredItems = categoriesWithFallback
    .flatMap((cat) => cat.items)
    .filter((item) => item.isFeatured);

  // Build tab data (only categories that have items)
  const tabCategories = [
    ...(featuredItems.length > 0 ? [{ id: -1, name: tMenu("recommended") }] : []),
    ...categoriesWithFallback
      .filter((cat) => cat.items.length > 0)
      .map((cat) => ({ id: cat.id, name: cat.name })),
  ];

  // Filter out empty categories for the grid too
  const gridCategories = categoriesWithFallback.filter(
    (cat) => cat.items.length > 0
  );

  // pb-32 reserves clearance for the bottom nav (48px) + the sticky "View cart"
  // bar above it, so the last card's CTA always scrolls clear.
  return (
    <main className="min-h-screen bg-gray-50 pb-32">
      {/* Header */}
      <header className="bg-white px-3 py-3 shadow-sm sm:px-4 sm:py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          {/* Section label, not the page heading — the brand <h1> (app name)
              lives in the menu content below (menu-page-client.tsx). Demoted to
              <p> to avoid two <h1>s on one page. */}
          <p className="text-lg font-bold text-gray-900 sm:text-xl">
            {tNav("menu")}
          </p>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="rounded-lg bg-primary-100 px-2.5 py-1.5 text-xs font-medium text-primary-700 sm:px-3 sm:text-sm">
              {session.table ? tMenu("tableNumber", { number: session.table.number }) : tOrder("takeawayLabel")}
            </span>
            <LocaleSwitcher />
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-4 py-4">
        {/* Category Tabs */}
        <CategoryTabs
          categories={tabCategories}
          allLabel={tMenu("allCategories")}
        />

        {/* Menu Grid wrapped in client component for add-to-cart */}
        <div className="mt-4">
          <MenuPageClient
            sessionId={sessionId}
            categories={gridCategories}
            featuredItems={featuredItems}
            addToCartLabel={tMenu("addToCart")}
            outOfStockLabel={tMenu("outOfStock")}
            recommendedLabel={tMenu("recommended")}
          />
        </div>
      </div>
    </main>
  );
}
