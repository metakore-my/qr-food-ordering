import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations, getLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { hasAnyAdmin } from "@/lib/first-admin";
import { LoginForm } from "@/components/admin/login-form";
import { getSettings, resolveAppName } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const s = await getSettings();
  const locale = await getLocale();
  const appName = resolveAppName(s.appName, s.appNameI18n, locale);
  return { title: t("login", { appName }) };
}

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Fresh deploy with no admin yet: send the owner to the setup wizard rather
  // than the login form (they have no credentials to log in with).
  if (!(await hasAnyAdmin())) {
    redirect(`/${locale}/admin/setup`);
  }

  const session = await auth();
  if (session) {
    redirect(`/${locale}/admin/dashboard`);
  }
  const tLogin = await getTranslations("admin.login");
  const settings = await getSettings();
  const { logoUrl } = settings;
  // Show the viewer-locale app name (English name on /en, etc.), matching the
  // [locale] layout's ConfigProvider + customer page titles — not the bare
  // main-language `appName`, which would render the canonical name on every locale.
  const appName = resolveAppName(settings.appName, settings.appNameI18n, locale);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Frosted backing on the brand title so it stays legible over the
            animated cuisine background (the form below has its own white card).
            Kept translucent + blurred rather than solid so the auth screen still
            reads as one composition, not two stacked blocks. */}
        <div className="mb-6 rounded-lg border border-white/60 bg-white/70 px-6 py-6 text-center shadow-sm backdrop-blur-sm">
          {/* Logo above the title when set; the app name always shows below. */}
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={appName}
              className="mx-auto mb-4 h-14 w-auto max-w-[220px] object-contain"
            />
          )}
          <h1 className="text-3xl font-bold text-primary-500">
            {appName}
          </h1>
          <p className="mt-2 text-gray-600">
            {tLogin("subtitle")}
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
