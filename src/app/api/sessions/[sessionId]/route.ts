import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { cookies } from "next/headers";
import { log } from "@/lib/logger";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  // Validate the session_id cookie matches the requested session
  const cookieStore = await cookies();
  const cookieSessionId = cookieStore.get("session_id")?.value;

  if (!cookieSessionId || cookieSessionId !== sessionId) {
    return NextResponse.json(
      { error: "Unauthorized: session mismatch" },
      { status: 401 }
    );
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      table: {
        select: { id: true, number: true },
      },
      orders: {
        include: {
          items: {
            include: {
              menuItem: {
                select: { id: true, price: true, imageUrl: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      cartItems: {
        include: {
          menuItem: {
            select: { id: true, price: true, imageUrl: true },
          },
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Serialize an explicit field allowlist rather than returning the raw Prisma
  // object. The cookie holder is a table-mate by design (carts/orders are
  // table-shared), but the raw row would also expose every device's `deviceId`
  // (the cart-ownership token) and internal fields. Project only what a caller
  // legitimately needs. (No client currently calls this GET; the allowlist
  // keeps it safe if one ever does.)
  return NextResponse.json({
    id: session.id,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    table: session.table,
    orders: session.orders.map((order) => ({
      id: order.id,
      status: order.status,
      totalAmount: Number(order.totalAmount),
      createdAt: order.createdAt.toISOString(),
      items: order.items.map((item) => ({
        id: item.id,
        menuItemId: item.menuItemId,
        itemName: item.itemName,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        selectedOptions: item.selectedOptions,
        menuItem: item.menuItem
          ? {
              id: item.menuItem.id,
              price: Number(item.menuItem.price),
              imageUrl: item.menuItem.imageUrl,
            }
          : null,
      })),
    })),
    cartItems: session.cartItems.map((ci) => ({
      id: ci.id,
      menuItemId: ci.menuItemId,
      quantity: ci.quantity,
      selectedOptions: ci.selectedOptions,
      menuItem: ci.menuItem
        ? {
            id: ci.menuItem.id,
            price: Number(ci.menuItem.price),
            imageUrl: ci.menuItem.imageUrl,
          }
        : null,
    })),
  });
}

const updateSessionSchema = z.object({
  status: z.enum(["CHECKED_OUT", "EXPIRED"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  // Admin auth + `orders` permission: force-closing a table is an order-
  // lifecycle action (it declines open orders), so it carries the same
  // permission as the admin order endpoints.
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

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateSessionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const targetStatus = parsed.data.status;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the session row FOR UPDATE so a force-close serializes against a
      // concurrent order placement / checkout (both lock this row too).
      // Without the lock, an order placed at the same instant staff closes the
      // table would land PENDING on a now-EXPIRED session — invisible to
      // settlement (by-token only returns ACTIVE sessions) and stuck forever.
      // Validate the transition from the locked read, not the REPEATABLE-READ
      // snapshot.
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`SELECT id, status FROM sessions WHERE id = ${sessionId} FOR UPDATE`;
      if (!locked[0]) {
        throw new Error("NOT_FOUND");
      }

      // Validate status transition
      const VALID_TRANSITIONS: Record<string, string[]> = {
        ACTIVE: ["CHECKED_OUT", "EXPIRED"],
        CHECKED_OUT: ["EXPIRED"],
      };
      const allowed = VALID_TRANSITIONS[locked[0].status];
      if (!allowed || !allowed.includes(targetStatus)) {
        throw new Error(`INVALID_TRANSITION:${locked[0].status}`);
      }

      // A force-close (→ EXPIRED) ends the session WITHOUT settlement, so its
      // open orders can never reach COMPLETED — decline them in the same
      // transaction instead of orphaning them on the kitchen board (and in a
      // CONFIRMED-forever state excluded from every revenue report). Walkout
      // semantics: the money was never collected, so DECLINED is the honest
      // status. Leftover carts are cleared like the checkout flow does.
      let declinedOrders = 0;
      if (targetStatus === "EXPIRED") {
        const declined = await tx.order.updateMany({
          where: { sessionId, status: { in: ["PENDING", "CONFIRMED"] } },
          data: { status: "DECLINED" },
        });
        declinedOrders = declined.count;
        await tx.cartItem.deleteMany({ where: { sessionId } });
      }

      const session = await tx.session.update({
        where: { id: sessionId },
        data: { status: targetStatus },
        include: {
          table: {
            select: { id: true, number: true },
          },
        },
      });

      return { session, declinedOrders };
    });

    if (result.declinedOrders > 0) {
      log.info("Session", "Force-close declined open orders", {
        sessionId,
        declinedOrders: result.declinedOrders,
      });
    }

    return NextResponse.json({
      ...result.session,
      declinedOrders: result.declinedOrders,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "NOT_FOUND") {
      return NextResponse.json(
        { error: "Session not found", code: "SESSION_NOT_FOUND" },
        { status: 404 }
      );
    }
    if (msg.startsWith("INVALID_TRANSITION:")) {
      const fromStatus = msg.split(":")[1];
      // Stable `code` so the scanner can localize (e.g. a double-close races
      // the cron: EXPIRED→EXPIRED) instead of rendering this English string.
      return NextResponse.json(
        {
          error: `Cannot transition from ${fromStatus} to ${targetStatus}`,
          code: "INVALID_TRANSITION",
        },
        { status: 409 }
      );
    }
    throw error;
  }
}
