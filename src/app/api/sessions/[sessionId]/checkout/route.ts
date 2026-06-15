import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { log } from "@/lib/logger";
import { getSettings } from "@/lib/settings";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  // Settlement completes orders — same `orders` permission as the admin order
  // endpoints (auth alone would let a zero-permission admin settle tables).
  const adminSession = await auth();
  if (!adminSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    !hasPermission(
      adminSession.user.role,
      adminSession.user.permissions ?? [],
      "orders"
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sessionId } = await params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the session row FOR UPDATE so checkout serializes against a
      // concurrent order placement on the same table (which also locks this
      // row). Without the lock, a final order placed at the same instant staff
      // checks out could land as PENDING on a now-CHECKED_OUT session and be
      // excluded from the grand total (free food). Validate status from the
      // locked read (current, not a REPEATABLE-READ snapshot).
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`SELECT id, status FROM sessions WHERE id = ${sessionId} FOR UPDATE`;
      if (!locked[0]) {
        throw new Error("Session not found");
      }
      // Status check only — deliberately NO isSessionExpired() here. The 4h
      // inactivity TTL guards CUSTOMER endpoints; staff scanning a table to
      // collect payment is exactly how an idle-past-TTL (but still ACTIVE)
      // session gets settled. Rejecting it left CONFIRMED orders permanently
      // un-completable (missing from all revenue reports) with no admin
      // recovery path.
      if (locked[0].status !== "ACTIVE") {
        throw new Error("Session is not active");
      }

      // Detail fetch for validation + response — no menu item names needed yet
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        include: {
          table: { select: { number: true } },
          orders: {
            select: { id: true, status: true, totalAmount: true },
          },
        },
      });

      if (!session) {
        throw new Error("Session not found");
      }

      // Only allow checkout when all non-declined orders are CONFIRMED
      const hasPending = session.orders.some((o) => o.status === "PENDING");
      if (hasPending) {
        throw new Error("All orders must be confirmed before checkout");
      }

      // Must have at least one confirmed order to checkout
      const hasConfirmed = session.orders.some((o) => o.status === "CONFIRMED");
      if (!hasConfirmed) {
        throw new Error("No confirmed orders to checkout");
      }

      // Mark current session as CHECKED_OUT
      await tx.session.update({
        where: { id: sessionId },
        data: { status: "CHECKED_OUT" },
      });

      // Mark CONFIRMED orders as COMPLETED
      await tx.order.updateMany({
        where: { sessionId, status: "CONFIRMED" },
        data: { status: "COMPLETED" },
      });

      // Clear any remaining cart items
      await tx.cartItem.deleteMany({ where: { sessionId } });

      return { session };
    });

    // Calculate grand total from confirmed orders only
    const grandTotal = result.session.orders
      .filter((o) => o.status === "CONFIRMED")
      .reduce((sum, order) => sum + Number(order.totalAmount), 0);

    // Full fetch with item names for response serialization (outside transaction).
    // The scanner client only uses tableNumber + grandTotal from this response, so
    // scope names to the canonical locale instead of hydrating all 6.
    const { canonicalLocale } = await getSettings();
    const fullOrders = await prisma.order.findMany({
      where: { sessionId },
      include: {
        items: {
          include: {
            menuItem: { include: { names: { where: { locale: canonicalLocale } } } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Serialize the response
    const serialized = {
      tableNumber: result.session.table.number,
      sessionId,
      grandTotal,
      orders: fullOrders.map((order) => ({
        id: order.id,
        status: order.status,
        totalAmount: Number(order.totalAmount),
        createdAt: order.createdAt.toISOString(),
        items: order.items.map((item) => ({
          id: item.id,
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          itemName: item.itemName,
          menuItem: item.menuItem
            ? {
                id: item.menuItem.id,
                names: item.menuItem.names,
              }
            : null,
        })),
      })),
    };

    log.info("Checkout", "Session checked out", { sessionId, grandTotal });

    return NextResponse.json(serialized);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Checkout failed";

    // Stable machine `code` per business error so the scanner can localize
    // (it must never render these raw English strings); unknown failures are
    // logged server-side and returned generic (error response hygiene).
    const businessErrors: Record<string, { code: string; status: number }> = {
      "Session not found": { code: "SESSION_NOT_FOUND", status: 404 },
      "Session is not active": { code: "SESSION_INACTIVE", status: 400 },
      "All orders must be confirmed before checkout": { code: "ORDERS_PENDING", status: 400 },
      "No confirmed orders to checkout": { code: "NO_CONFIRMED_ORDERS", status: 400 },
    };
    const known = businessErrors[message];
    if (known) {
      return NextResponse.json(
        { error: message, code: known.code },
        { status: known.status }
      );
    }

    log.error("Checkout", "Checkout failed", { sessionId, error: message });
    return NextResponse.json(
      { error: "Checkout failed", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
