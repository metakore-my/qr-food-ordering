import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { isValidOrderTransition } from "@/lib/order-utils";
import { settlementMode } from "@/lib/takeaway-settlement";
import { localeFilterFromCookie } from "@/lib/locale-filter";
import { getSettings } from "@/lib/settings";

// COMPLETED is intentionally NOT accepted here — an order is completed only via
// the /checkout settlement flow (scanner + dashboard both call it), so the admin
// order-PATCH can confirm or decline but never mint a settled-sale record without
// a checkout. See ORDER_STATUS_TRANSITIONS in order-utils.ts.
const updateStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "DECLINED"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "orders")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { orderId } = await params;
  const orderIdNum = parseInt(orderId, 10);

  if (isNaN(orderIdNum)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = updateStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // Scope names to the admin's active locale + canonical fallback (the order
  // detail renders one locale) — never all 6 (RSS driver).
  const settings = await getSettings();
  const localeFilter = localeFilterFromCookie(
    req.cookies.get("NEXT_LOCALE")?.value,
    settings.canonicalLocale
  );

  // Validate and update status atomically in a transaction to prevent
  // two concurrent requests from racing (e.g. CONFIRM + DECLINE both reading PENDING)
  let updatedOrder;
  try {
    updatedOrder = await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({
        where: { id: orderIdNum },
        include: {
          session: {
            include: {
              table: { select: { number: true } },
            },
          },
        },
      });

      if (!existing) {
        throw new Error("NOT_FOUND");
      }

      // Validate status transition
      if (!isValidOrderTransition(existing.status, parsed.data.status)) {
        throw new Error(`INVALID_TRANSITION:${existing.status}`);
      }

      const updated = await tx.order.update({
        where: { id: orderIdNum },
        data: { status: parsed.data.status },
        include: {
          items: {
            include: {
              menuItem: {
                include: { names: { where: { locale: { in: localeFilter } } } },
              },
            },
          },
          session: {
            include: {
              table: { select: { id: true, number: true } },
            },
          },
        },
      });

      // Counter takeaway (table-less) is one-shot: when its only/last live order
      // is declined, expire the now-empty session immediately rather than leaving
      // it ACTIVE until the 4h cron sweep. Dine-in / seated (table-bound) sessions
      // are untouched — they settle via the table-QR checkout.
      if (parsed.data.status === "DECLINED" && settlementMode(existing.session) === "order") {
        const remaining = await tx.order.count({
          where: { sessionId: existing.sessionId, status: { in: ["PENDING", "CONFIRMED"] } },
        });
        if (remaining === 0) {
          await tx.session.update({ where: { id: existing.sessionId }, data: { status: "EXPIRED" } });
        }
      }

      return updated;
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    // Return a stable machine `code` (not just English) — the admin order board
    // runs in all 6 locales and maps codes to localized strings (mirrors the
    // sessions PATCH at the same path).
    if (msg === "NOT_FOUND") {
      return NextResponse.json(
        { error: "Order not found", code: "ORDER_NOT_FOUND" },
        { status: 404 }
      );
    }
    if (msg.startsWith("INVALID_TRANSITION:")) {
      const fromStatus = msg.split(":")[1];
      return NextResponse.json(
        {
          error: `Cannot transition from ${fromStatus} to ${parsed.data.status}`,
          code: "INVALID_TRANSITION",
        },
        { status: 409 }
      );
    }
    throw error;
  }

  // Serialize response
  const serialized = {
    id: updatedOrder.id,
    sessionId: updatedOrder.sessionId,
    status: updatedOrder.status,
    totalAmount: Number(updatedOrder.totalAmount),
    createdAt: updatedOrder.createdAt.toISOString(),
    updatedAt: updatedOrder.updatedAt.toISOString(),
    items: updatedOrder.items.map((item) => ({
      id: item.id,
      menuItemId: item.menuItemId,
      itemName: item.itemName,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      selectedOptions: JSON.parse(item.selectedOptions),
      menuItem: item.menuItem
        ? {
            id: item.menuItem.id,
            imageUrl: item.menuItem.imageUrl,
            names: item.menuItem.names,
          }
        : null,
    })),
    session: {
      id: updatedOrder.session.id,
      tableId: updatedOrder.session.tableId,
      status: updatedOrder.session.status,
      table: updatedOrder.session.table,
    },
  };

  return NextResponse.json(serialized);
}
