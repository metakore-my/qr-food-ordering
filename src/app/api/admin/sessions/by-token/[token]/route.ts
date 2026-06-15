import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { verifyTableToken } from "@/lib/qr";
import { localeFilterFromCookie } from "@/lib/locale-filter";
import { getSettings } from "@/lib/settings";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const adminSession = await auth();
  if (!adminSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The scanner reads a table's order data and feeds the settle/close actions,
  // so it carries the same `orders` permission as the admin order endpoints
  // (a bare role check passed for EVERY admin, including zero-permission ones).
  if (
    !hasPermission(
      adminSession.user.role,
      adminSession.user.permissions ?? [],
      "orders"
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { token } = await params;

  // Verify the HMAC-signed table token
  let tableId: number;
  let tableToken: string;
  try {
    const decoded = decodeURIComponent(token);
    const result = verifyTableToken(decoded);
    tableId = result.tableId;
    tableToken = result.tableToken;
  } catch {
    return NextResponse.json({ error: "Invalid QR token" }, { status: 400 });
  }

  // Verify table exists and matches
  const table = await prisma.table.findFirst({
    where: { id: tableId, token: tableToken },
    select: { id: true, number: true },
  });

  if (!table) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }

  // Scope names to the admin's active locale + canonical fallback (the scanner
  // renders one locale) — never all 6 (RSS driver).
  const settings = await getSettings();
  const localeFilter = localeFilterFromCookie(
    (await cookies()).get("NEXT_LOCALE")?.value,
    settings.canonicalLocale
  );

  // Find the active session for this table
  const session = await prisma.session.findFirst({
    where: { tableId: table.id, status: "ACTIVE" },
    include: {
      table: { select: { id: true, number: true } },
      orders: {
        include: {
          items: {
            include: {
              menuItem: { include: { names: { where: { locale: { in: localeFilter } } } } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session) {
    return NextResponse.json(
      { error: "No active session for this table" },
      { status: 404 }
    );
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
        selectedOptions: JSON.parse(item.selectedOptions),
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
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
