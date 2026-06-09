import { prisma } from "./prisma";
import { verifyTableToken } from "./qr";
import { log } from "./logger";

const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

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
