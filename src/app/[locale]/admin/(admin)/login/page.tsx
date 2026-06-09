import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { hasAnyAdmin } from "@/lib/first-admin";
import { LoginForm } from "@/components/admin/login-form";
import { getSettings } from "@/lib/settings";

export async function generateMetadata() {
  const t = await getTranslations("metadata");
  const { appName } = await getSettings();
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
  const { appName } = await getSettings();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
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
