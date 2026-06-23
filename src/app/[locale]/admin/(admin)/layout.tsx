import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getTranslations } from "next-intl/server";
import { isMaintenanceMode } from "@/lib/maintenance";
import { hasAnyAdmin } from "@/lib/first-admin";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminBackground } from "@/components/layout/admin-background";
import { AdminLayoutClient, AdminContent } from "@/components/layout/admin-layout-client";
import { AdminFontScale } from "@/components/layout/admin-font-scale";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // First-run gate: a fresh deploy with no admin yet sends the owner to the
  // setup wizard. The wizard lives at /admin/setup (a sibling of the (admin)
  // route group), so it is NOT under this guard — no redirect loop.
  if (!(await hasAnyAdmin())) {
    redirect(`/${locale}/admin/setup`);
  }

  const session = await auth();

  const role = session?.user?.role ?? "ADMIN";
  const permissions: string[] = session?.user?.permissions ?? [];
  const username = session?.user?.name ?? "";

  const maintenance = session ? await isMaintenanceMode() : false;
  const t = maintenance ? await getTranslations("maintenance") : null;

  if (!session) {
    return (
      <div className="relative min-h-screen bg-gray-50">
        <AdminBackground />
        <div className="fixed right-4 top-4 z-50">
          <LocaleSwitcher />
        </div>
        <div className="relative z-10">
          {children}
        </div>
      </div>
    );
  }

  return (
    <AdminLayoutClient>
      <AdminFontScale>
        <AdminBackground />
        <AdminSidebar role={role} permissions={permissions} username={username} />
        <AdminContent id="main-content">
          {maintenance && t && (
            <div className="sticky top-0 z-40 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-center text-xs font-medium text-amber-800 sm:px-4 sm:py-2 sm:text-sm">
              {t("banner")}
            </div>
          )}
          {children}
        </AdminContent>
      </AdminFontScale>
    </AdminLayoutClient>
  );
}
