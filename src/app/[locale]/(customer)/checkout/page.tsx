import type { Metadata } from "next";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isSessionExpired } from "@/lib/session";
import { setRequestLocale, getTranslations, getLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { CheckoutQr } from "@/components/checkout/checkout-qr";
import { OrderSummary } from "@/components/checkout/order-summary";
import { Link } from "@/i18n/navigation";
import { signTableToken } from "@/lib/qr";
import { getSettings, resolveAppName } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const s = await getSettings();
  const locale = await getLocale();
  const appName = resolveAppName(s.appName, s.appNameI18n, locale);
  return { title: t("checkout", { appName }) };
}

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("checkout");
  const tCustomer = await getTranslations("customer");

  // 1. Read session_id from cookie
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session_id")?.value;

  // If no session, show message
  if (!sessionId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">
            {tCustomer("noSession")}
          </h1>
          <p className="mt-2 text-gray-600">
            {tCustomer("noSessionMessage")}
          </p>
        </div>
      </main>
    );
  }

  // 2. Verify session exists and is ACTIVE or CHECKED_OUT
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      table: { select: { id: true, number: true, token: true } },
    },
  });

  const isExpiredActive = session?.status === "ACTIVE" && isSessionExpired(session.updatedAt);
  if (!session || isExpiredActive || (session.status !== "ACTIVE" && session.status !== "CHECKED_OUT")) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">
            {tCustomer("sessionExpired")}
          </h1>
          <p className="mt-2 text-gray-600">
            {tCustomer("sessionExpiredMessage")}
          </p>
        </div>
      </main>
    );
  }

  // 3. Fetch all orders for the session with items and menu item details.
  // Only the active locale + canonical fallback are rendered below, so scope the
  // names include rather than hydrating all 6 locales for every order item.
  const { canonicalLocale } = await getSettings();
  const localeFilter = Array.from(new Set([locale, canonicalLocale]));
  const orders = await prisma.order.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    include: {
      items: {
        include: {
          menuItem: {
            include: {
              names: { where: { locale: { in: localeFilter } } },
            },
          },
        },
      },
    },
  });

  // 4. Serialize order data (grand total computed client-side, excludes declined)
  const serializedOrders = orders.map((order) => {
    const totalAmount = Number(order.totalAmount);

    return {
      id: order.id,
      status: order.status,
      totalAmount,
      createdAt: order.createdAt.toISOString(),
      items: order.items.map((item) => {
        // Live locale-matched name first (requested locale -> canonical); the
        // order-time snapshot (item.itemName) only backstops a deleted item /
        // missing translation (mirrors lib/report-utils getItemName).
        const names = item.menuItem?.names ?? [];
        const localeName = names.find((n) => n.locale === locale);
        const thName = names.find((n) => n.locale === canonicalLocale);
        const anyName = names[0];
        const menuItemName =
          localeName?.name || thName?.name || item.itemName || anyName?.name || `#${item.menuItemId ?? 0}`;

        return {
          id: item.id,
          menuItemId: item.menuItemId ?? 0,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          menuItemName,
          selectedOptions: JSON.parse(item.selectedOptions),
        };
      }),
    };
  });

  // 5. Generate signed table token for checkout QR (scanner expects this format)
  const signedTableToken = signTableToken(session.table.id, session.table.token);

  // 6. Pass data to client components
  return (
    <main className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="bg-white px-3 py-3 shadow-sm sm:px-4 sm:py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/menu"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
              aria-label={t("backToMenu")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-gray-900 sm:text-xl">{t("title")}</h1>
              <p className="truncate text-sm text-gray-500">{t("tableNumber", { number: session.table.number })}</p>
            </div>
          </div>
          <LocaleSwitcher />
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* QR Code section */}
        <div className="mb-6">
          <CheckoutQr tableToken={signedTableToken} />
        </div>

        {/* Order summary section */}
        <OrderSummary
          sessionId={sessionId}
          orders={serializedOrders}
          locale={locale}
        />
      </div>
    </main>
  );
}
