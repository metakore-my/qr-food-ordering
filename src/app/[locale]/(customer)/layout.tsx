import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { isMaintenanceMode } from "@/lib/maintenance";
import { prisma } from "@/lib/prisma";
import { isSessionExpired } from "@/lib/session";
import { CustomerLayoutClient } from "@/components/layout/customer-layout-client";
import { BackToTopButton } from "@/components/layout/back-to-top-button";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const maintenance = await isMaintenanceMode();

  if (maintenance) {
    const t = await getTranslations("maintenance");
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <div className="flex justify-end p-3">
          <LocaleSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="w-full max-w-xs text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 sm:mb-6 sm:h-20 sm:w-20 sm:rounded-full">
              <svg
                className="h-7 w-7 text-amber-600 sm:h-10 sm:w-10"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z"
                />
              </svg>
            </div>
            <h1 className="mb-1.5 text-lg font-bold text-gray-900 sm:mb-2 sm:text-2xl">
              {t("title")}
            </h1>
            <p className="text-sm text-gray-500 sm:text-base">
              {t("message")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Read session_id from cookie to determine if we should show nav.
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session_id")?.value;

  // The mobile nav (Menu / Cart / Checkout) is an ordering surface, so only show
  // it while the session can still order — i.e. ACTIVE and not expired. A settled
  // (CHECKED_OUT) or expired session is terminal: hiding the nav keeps the
  // thank-you/receipt screen a dead end (Menu/Cart would only bounce to "Session
  // Expired"). Mirrors the ACTIVE-only guard on the menu/cart pages.
  let showNav = false;
  if (sessionId) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true, updatedAt: true },
    });
    showNav = !!session && session.status === "ACTIVE" && !isSessionExpired(session.updatedAt);
  }

  return (
    <div id="main-content" className="min-h-screen bg-gray-50">
      {children}
      <BackToTopButton />
      {/* Only show mobile nav when the session can still order (ACTIVE, unexpired). */}
      {sessionId && showNav && (
        <CustomerLayoutClient sessionId={sessionId} />
      )}
    </div>
  );
}
