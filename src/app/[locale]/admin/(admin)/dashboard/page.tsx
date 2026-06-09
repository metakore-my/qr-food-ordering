import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isMaintenanceMode } from "@/lib/maintenance";
import { OrderBoard } from "@/components/admin/order-board";
import { MaintenanceToggle } from "@/components/admin/maintenance-toggle";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { startOfTodayInDeploymentZone } from "@/lib/date";
import { getSettings } from "@/lib/settings";
import { getCapabilities } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("metadata");
  const { appName } = await getSettings();
  return { title: t("dashboard", { appName }) };
}

export default async function DashboardPage({
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

  const settings = await getSettings();

  // Fetch today's orders (from start of today in the deployment timezone, not
  // the server's UTC clock — otherwise "today" would start at 07:00 Bangkok).
  const todayStart = startOfTodayInDeploymentZone(settings.timezone);

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: todayStart },
      status: { in: ["PENDING", "CONFIRMED"] },
    },
    include: {
      items: {
        include: {
          menuItem: {
            // Scope to active locale + canonical — never all 6 locales (RSS driver).
            // OrderBoard/OrderCard only ever render `locale` with a canonical fallback.
            include: {
              names: {
                where: {
                  locale: {
                    in: Array.from(
                      new Set([locale, settings.canonicalLocale])
                    ),
                  },
                },
              },
            },
          },
        },
      },
      session: {
        include: {
          table: {
            select: { id: true, number: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  // Serialize for client component
  const t = await getTranslations("admin.dashboard");

  const serializedOrders = orders.map((order) => ({
    id: order.id,
    sessionId: order.sessionId,
    status: order.status as "PENDING" | "CONFIRMED",
    totalAmount: Number(order.totalAmount),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      selectedOptions: JSON.parse(item.selectedOptions),
      menuItem: item.menuItem
        ? {
            id: item.menuItem.id,
            imageUrl: item.menuItem.imageUrl,
            names: item.menuItem.names.map((n) => ({
              locale: n.locale,
              name: n.name,
              description: n.description,
            })),
          }
        : null,
    })),
    session: {
      id: order.session.id,
      tableId: order.session.tableId,
      status: order.session.status,
      table: order.session.table,
    },
  }));

  const isSuperAdmin = session.user.role === "SUPERADMIN";
  const maintenanceEnabled = isSuperAdmin ? await isMaintenanceMode() : false;

  // Non-blocking notice when bot protection (Turnstile CAPTCHA) isn't wired on
  // this deployment — login still works (rate-limit + bcrypt), but admins
  // should know the extra layer is off.
  const botProtectionDisabled = !getCapabilities().hasTurnstile;

  return (
    <main className="min-h-screen">
      {botProtectionDisabled && (
        <div
          role="status"
          className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 sm:px-6"
        >
          {t("botProtectionDisabled")}
        </div>
      )}
      <div className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">{t("title")}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {t("subtitle")}
            </p>
          </div>
          {isSuperAdmin && (
            <div className="shrink-0">
              <MaintenanceToggle initialEnabled={maintenanceEnabled} />
            </div>
          )}
        </div>
      </div>
      <OrderBoard initialOrders={serializedOrders} />
    </main>
  );
}
