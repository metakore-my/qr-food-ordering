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
    // Accept a comma-separated list (e.g. `status=PENDING,CONFIRMED`) so the kitchen
    // board fetches both active columns in ONE polled request instead of two — half
    // the per-tick auth + query work, ×8,640 polls/day. A single status still works.
    const statuses = status.split(",").map((x) => x.trim()).filter(Boolean);
    const invalid = statuses.find(
      (x) => !VALID_STATUSES.includes(x as (typeof VALID_STATUSES)[number])
    );
    if (statuses.length === 0 || invalid) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    where.status =
      statuses.length === 1
        ? (statuses[0] as (typeof VALID_STATUSES)[number])
        : { in: statuses as (typeof VALID_STATUSES)[number][] };
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
    // Project only what the serializer below ships — `include` would also hydrate
    // the 500-char menuItem translation `description` and every unused menuItem /
    // session scalar on EVERY 10s poll (the one continuously-allocating hot path).
    select: {
      id: true,
      sessionId: true,
      status: true,
      orderType: true,
      customerName: true,
      totalAmount: true,
      createdAt: true,
      updatedAt: true,
      items: {
        select: {
          id: true,
          menuItemId: true,
          itemName: true,
          quantity: true,
          unitPrice: true,
          selectedOptions: true,
          menuItem: {
            select: {
              id: true,
              imageUrl: true,
              names: {
                where: { locale: { in: localeFilter } },
                select: { locale: true, name: true },
              },
            },
          },
        },
      },
      session: {
        select: {
          id: true,
          tableId: true,
          status: true,
          table: { select: { id: true, number: true } },
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
    orderType: order.orderType,
    customerName: order.customerName,
    totalAmount: Number(order.totalAmount),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map((item) => ({
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
