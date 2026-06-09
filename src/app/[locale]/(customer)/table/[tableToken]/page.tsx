import { prisma } from "@/lib/prisma";
import { verifyTableToken } from "@/lib/qr";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { getSettings } from "@/lib/settings";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; tableToken: string }>;
}) {
  const { tableToken } = await params;
  const t = await getTranslations("metadata");
  const { appName } = await getSettings();

  try {
    const decoded = decodeURIComponent(tableToken);
    const { tableId, tableToken: token } = verifyTableToken(decoded);
    const table = await prisma.table.findFirst({
      where: { id: tableId, token, isActive: true },
      select: { number: true },
    });
    if (table) {
      return { title: t("tableLanding", { number: table.number, appName }) };
    }
  } catch {
    // Fall through to generic title
  }

  return { title: t("appTitle", { appName }) };
}

export default async function TableLandingPage({
  params,
}: {
  params: Promise<{ locale: string; tableToken: string }>;
}) {
  const { locale, tableToken } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("customer");

  try {
    const decoded = decodeURIComponent(tableToken);
    const { tableId, tableToken: token } = verifyTableToken(decoded);

    // Verify table exists and is active (read-only, no cookie needed)
    const table = await prisma.table.findFirst({
      where: { id: tableId, token, isActive: true },
    });
    if (!table) throw new Error("Invalid or inactive table");

    // Build the session start URL — this route handler sets the cookie
    const startUrl = `/api/sessions/start?token=${encodeURIComponent(decoded)}&locale=${locale}`;

    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-primary-50 to-white px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lg sm:p-8">
          <div className="mb-6 flex justify-end">
            <LocaleSwitcher />
          </div>

          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-100">
              <svg
                className="h-8 w-8 text-primary-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 3h18v18H3V3zm3 3v12h12V6H6z"
                />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-gray-900">{t("tableNumber", { number: table.number })}</h1>
            <p className="mt-2 text-gray-600">{t("welcomeSubtitle")}</p>

            <a
              href={startUrl}
              className="mt-8 inline-flex w-full items-center justify-center rounded-xl bg-primary-500 px-6 py-3 text-lg font-semibold text-white shadow-md transition-colors hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              {t("browseMenu")}
            </a>
          </div>
        </div>
      </main>
    );
  } catch {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-8 w-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">
            {t("invalidTable")}
          </h1>
          <p className="mt-2 text-gray-600">{t("invalidTableMessage")}</p>
        </div>
      </main>
    );
  }
}
