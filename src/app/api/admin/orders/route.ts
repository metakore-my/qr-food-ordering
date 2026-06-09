import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { localeFilterFromCookie } from "@/lib/locale-filter";
import { getSettings } from "@/lib/settings";

const VALID_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "DECLINED"] as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "orders")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const tableId = searchParams.get("tableId");

  // Build filter conditions
  const where: Prisma.OrderWhereInput = {};

  if (status) {
    if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    where.status = status as (typeof VALID_STATUSES)[number];
  }

  if (tableId) {
    const tid = parseInt(tableId, 10);
    if (isNaN(tid)) {
      return NextResponse.json({ error: "Invalid tableId" }, { status: 400 });
    }
    where.session = { tableId: tid };
  }

  // Scope names to the admin's active locale + canonical fallback (the order
  // board renders one locale) — never all 6 (RSS driver). This list is polled.
  const settings = await getSettings();
  const localeFilter = localeFilterFromCookie(
    req.cookies.get("NEXT_LOCALE")?.value,
    settings.canonicalLocale
  );

  const orders = await prisma.order.findMany({
    where,
    take: 200,
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
          table: {
            select: { id: true, number: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Serialize Decimal fields
  const serialized = orders.map((order) => ({
    id: order.id,
    sessionId: order.sessionId,
    status: order.status,
    totalAmount: Number(order.totalAmount),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      menuItemId: item.menuItemId,
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
      id: order.session.id,
      tableId: order.session.tableId,
      status: order.session.status,
      table: order.session.table,
    },
  }));

  return NextResponse.json(serialized, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
