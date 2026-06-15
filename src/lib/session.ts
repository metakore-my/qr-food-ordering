import { prisma } from "./prisma";
import { verifyTableToken } from "./qr";
import { log } from "./logger";

const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Cookie lifetime, in seconds, mirroring SESSION_TTL_MS. The cookie is a
 * SLIDING window: it's re-set (via `setSessionCookie`) on every activity that
 * bumps `session.updatedAt` — add-to-cart and order placement — so the
 * browser-side expiry tracks the DB-side inactivity timer instead of being a
 * hard 4h-from-first-scan cap. Without the refresh, the cookie would silently
 * die mid-meal at hour 4 even for an actively-ordering party (the DB session
 * would still be valid, but the browser would stop sending the cookie → 401).
 */
export const SESSION_COOKIE_MAX_AGE = SESSION_TTL_MS / 1000; // 4 hours, in seconds

/**
 * Minimal shape shared by `next/headers` `cookies()` and a `NextResponse`'s
 * `.cookies` — both expose a compatible `.set(name, value, options)`.
 */
type CookieSetter = {
  set: (
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      sameSite: "lax";
      secure: boolean;
      maxAge: number;
    }
  ) => unknown;
};

/**
 * Set (or refresh) the `session_id` cookie with a fresh 4h sliding window.
 * Single source of truth for the cookie attributes — used at session creation
 * AND on every activity refresh, so the options can never drift between sites.
 */
export function setSessionCookie(store: CookieSetter, sessionId: string): void {
  store.set("session_id", sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
}

/**
 * True if an ACTIVE session has been idle past the 4h TTL. It's an INACTIVITY
 * timer — add-to-cart and order placement bump `updatedAt`, so an actively-
 * ordering party isn't locked out mid-meal.
 */
export function isSessionExpired(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > SESSION_TTL_MS;
}

export async function getOrCreateSession(signedToken: string) {
  const { tableId, tableToken } = verifyTableToken(signedToken);

  // Verify table exists and is active
  const table = await prisma.table.findFirst({
    where: { id: tableId, token: tableToken, isActive: true },
  });
  if (!table) {
    log.warn("Session", "Invalid or inactive table", { tableId });
    throw new Error("Invalid or inactive table");
  }

  // Lock the table row FOR UPDATE so two simultaneous QR scans serialize here —
  // otherwise both find no ACTIVE session and each create one, leaving two ACTIVE
  // sessions for one table (checkout would bill one, stranding the other's orders).
  const session = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tables WHERE id = ${table.id} FOR UPDATE`;

    const existing = await tx.session.findFirst({
      where: { tableId: table.id, status: "ACTIVE" },
    });

    if (existing) {
      log.info("Session", "Existing session reused", { sessionId: existing.id, tableId: table.id });
      return existing;
    }

    const created = await tx.session.create({
      data: { tableId: table.id },
    });
    log.info("Session", "New session created", { sessionId: created.id, tableId: table.id });
    return created;
  });

  return { session, table };
}
