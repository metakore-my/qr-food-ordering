import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isSessionExpired } from "@/lib/session";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { CartSheet } from "@/components/cart/cart-sheet";
import { Link } from "@/i18n/navigation";
import { getSettings } from "@/lib/settings";

export async function generateMetadata() {
  const t = await getTranslations("metadata");
  const { appName } = await getSettings();
  return { title: t("cart", { appName }) };
}

export default async function CartPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("customer");
  const tCart = await getTranslations("cart");
  const tCommon = await getTranslations("common");
  const tNav = await getTranslations("nav");
  const tOrder = await getTranslations("order");

  // Read session_id from cookie
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session_id")?.value;

  // If no session, show message
  if (!sessionId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">
            {t("noSession")}
          </h1>
          <p className="mt-2 text-gray-600">{t("noSessionMessage")}</p>
        </div>
      </main>
    );
  }

  // Verify session exists and is ACTIVE
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, updatedAt: true },
  });

  if (!session || session.status !== "ACTIVE" || isSessionExpired(session.updatedAt)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">
            {t("sessionExpired")}
          </h1>
          <p className="mt-2 text-gray-600">{t("sessionExpiredMessage")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="bg-white px-3 py-3 shadow-sm sm:px-4 sm:py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/menu"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
              aria-label={tCommon("backToMenu")}
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
            <h1 className="text-lg font-bold text-gray-900 sm:text-xl">
              {tCart("title")}
            </h1>
          </div>
          <LocaleSwitcher />
        </div>
      </header>

      {/* Cart content */}
      <div className="mx-auto max-w-2xl px-4 py-6">
        <CartSheet
          sessionId={sessionId}
          locale={locale}
          translations={{
            title: tCart("title"),
            empty: tCart("empty"),
            total: tCart("total"),
            placeOrder: tCart("placeOrder"),
            backToMenu: tNav("menu"),
            orderPlaced: tOrder("placed"),
            ordering: tCart("ordering"),
          }}
        />
      </div>
    </main>
  );
}
