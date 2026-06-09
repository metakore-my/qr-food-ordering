import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatDeploymentDateTime } from "@/lib/date";
import { RANGE_MS, getItemName, parseSelectedOptions } from "@/lib/report-utils";
import { getSettings } from "@/lib/settings";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "reports")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const s = await getSettings();
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "1d";
  const locale = searchParams.get("locale") || s.canonicalLocale;

  const ms = RANGE_MS[range];
  if (!ms) {
    return NextResponse.json(
      { error: "Invalid range. Use: 1h, 3h, 12h, 1d, 7d, 30d" },
      { status: 400 }
    );
  }

  const cutoff = new Date(Date.now() - ms);

  const MAX_ORDERS = 10_000;

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: cutoff },
    },
    include: {
      items: {
        include: {
          menuItem: {
            include: {
              // Scope to active locale + canonical — never all 6 locales (RSS driver).
              names: { where: { locale: { in: Array.from(new Set([locale, s.canonicalLocale])) } } },
            },
          },
        },
      },
      session: {
        include: {
          table: { select: { number: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ORDERS,
  });

  const result = orders.map((order) => ({
    id: order.id,
    sessionId: order.sessionId,
    tableNumber: order.session.table.number,
    status: order.status,
    totalAmount: Number(order.totalAmount),
    createdAt: formatDeploymentDateTime(order.createdAt, s.timezone),
    items: order.items.map((item) => ({
      name: getItemName(item.menuItem?.names ?? [], locale, s.canonicalLocale),
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      // Defensive parse — a malformed snapshot must not 500 the whole list.
      selectedOptions: parseSelectedOptions(item.selectedOptions),
    })),
  }));

  return NextResponse.json(
    {
      orders: result,
      // Cap hit → oldest orders dropped; surface it so the history isn't
      // silently incomplete (matches the analytics endpoint).
      truncated: result.length >= MAX_ORDERS,
      limit: MAX_ORDERS,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
