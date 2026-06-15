import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { localeFilterFromCookie } from "@/lib/locale-filter";
import { getSettings } from "@/lib/settings";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const adminSession = await auth();
  if (!adminSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // This returns a table's session + order detail (totals, item names) and is
  // part of the checkout-scanner surface, so it carries the same `orders`
  // permission as its siblings (the by-token lookup GET and the force-close
  // PATCH at this path). A bare role check let EVERY admin — including
  // zero-permission ones — read any session's order data.
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

  // Scope names to the admin's active locale + canonical fallback (checkout view
  // renders one locale) — never all 6 (RSS driver).
  const settings = await getSettings();
  const localeFilter = localeFilterFromCookie(
    (await cookies()).get("NEXT_LOCALE")?.value,
    settings.canonicalLocale
  );

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
                include: { names: { where: { locale: { in: localeFilter } } } },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const grandTotal = session.orders
    .filter((o) => o.status === "CONFIRMED")
    .reduce((sum, order) => sum + Number(order.totalAmount), 0);

  return NextResponse.json({
    id: session.id,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    table: session.table,
    grandTotal,
    orders: session.orders.map((order) => ({
      id: order.id,
      status: order.status,
      totalAmount: Number(order.totalAmount),
      createdAt: order.createdAt.toISOString(),
      items: order.items.map((item) => ({
        id: item.id,
        itemName: item.itemName,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        menuItem: item.menuItem
          ? {
              id: item.menuItem.id,
              names: item.menuItem.names.map((n) => ({
                locale: n.locale,
                name: n.name,
              })),
            }
          : null,
      })),
    })),
  });
}
