import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);
const HAS_EXTENSION = /\.\w+$/;

function checkCsrf(request: NextRequest): NextResponse | null {
  const method = request.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  // CSRF skip limited to the Bearer-authed cron endpoint.
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ") && request.nextUrl.pathname === "/api/cron/cleanup") {
    return null;
  }

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!host) {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  // Origin/Referer must be present and match the host.
  const sourceUrl = origin || request.headers.get("referer");
  if (!sourceUrl) {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  try {
    const sourceHost = new URL(sourceUrl).host;
    if (sourceHost !== host) {
      return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  return null;
}

export default function proxy(request: NextRequest) {
  const csrfResponse = checkCsrf(request);
  if (csrfResponse) return csrfResponse;

  // next-intl runs only on non-API, non-asset routes.
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api") && !pathname.startsWith("/_next") && !HAS_EXTENSION.test(pathname)) {
    // No locale prefix → honor the saved cookie preference.
    const locales = routing.locales as readonly string[];
    const hasLocalePrefix = locales.some(
      (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`)
    );
    if (!hasLocalePrefix) {
      const saved = request.cookies.get("NEXT_LOCALE")?.value;
      if (saved && locales.includes(saved) && saved !== routing.defaultLocale) {
        const url = request.nextUrl.clone();
        url.pathname = `/${saved}${pathname}`;
        return NextResponse.redirect(url);
      }
    }

    return intlMiddleware(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
