import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { routing } from "@/i18n/routing";

export default async function RootPage() {
  const cookieStore = await cookies();
  const saved = cookieStore.get("NEXT_LOCALE")?.value;
  const locale =
    saved && (routing.locales as readonly string[]).includes(saved)
      ? saved
      : routing.defaultLocale;
  redirect(`/${locale}`);
}
