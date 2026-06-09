import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSessionExpired } from "@/lib/session";
import { auth } from "@/lib/auth";
import { log } from "@/lib/logger";
import { getSettings } from "@/lib/settings";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const adminSession = await auth();
  if (!adminSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        Array<{ id: string; status: string; updatedAt: Date }>
      >`SELECT id, status, updatedAt FROM sessions WHERE id = ${sessionId} FOR UPDATE`;
      if (!locked[0]) {
        throw new Error("Session not found");
      }
      if (locked[0].status !== "ACTIVE" || isSessionExpired(locked[0].updatedAt)) {
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

    if (message === "Session not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    if (message === "Session is not active") {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (message === "All orders must be confirmed before checkout" || message === "No confirmed orders to checkout") {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
