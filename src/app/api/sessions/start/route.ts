import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getOrCreateSession } from "@/lib/session";
import { isMaintenanceMode } from "@/lib/maintenance";
import { routing } from "@/i18n/routing";

function validLocale(value: string | null): string {
  return value && (routing.locales as readonly string[]).includes(value)
    ? value
    : routing.defaultLocale;
}

function setLocaleCookie(response: NextResponse, locale: string) {
  response.cookies.set("NEXT_LOCALE", locale, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}

function baseUrl(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("host");
  if (forwarded && host) return `${forwarded}://${host}`;
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  if (await isMaintenanceMode()) {
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
  }

  const origin = baseUrl(req);
  const token = req.nextUrl.searchParams.get("token");
  const locale = validLocale(req.nextUrl.searchParams.get("locale"));

  if (!token) {
    const response = NextResponse.redirect(new URL(`/${locale}`, origin));
    setLocaleCookie(response, locale);
    return response;
  }

  try {
    const { session } = await getOrCreateSession(token);

    const response = NextResponse.redirect(
      new URL(`/${locale}/menu`, origin)
    );
    response.cookies.set("session_id", session.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 4, // 4 hours
    });
    // Set device_id cookie if not already present (persists across sessions)
    if (!req.cookies.get("device_id")?.value) {
      response.cookies.set("device_id", randomUUID(), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365, // 1 year
      });
    }
    setLocaleCookie(response, locale);

    return response;
  } catch {
    const errorUrl = new URL(
      `/${locale}/table/${encodeURIComponent(token)}`,
      origin
    );
    errorUrl.searchParams.set("error", "1");
    const response = NextResponse.redirect(errorUrl);
    setLocaleCookie(response, locale);
    return response;
  }
}
