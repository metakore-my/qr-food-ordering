import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";

export default async function MgmtEntryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (session) {
    redirect(`/${locale}/admin/dashboard`);
  }

  redirect(`/${locale}/admin/login`);
}
