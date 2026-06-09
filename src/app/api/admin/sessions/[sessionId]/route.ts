import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
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

  // All authenticated admins can perform checkout (core counter operation)
  const user = adminSession.user as { role?: string };
  if (user.role !== "SUPERADMIN" && user.role !== "ADMIN") {
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
