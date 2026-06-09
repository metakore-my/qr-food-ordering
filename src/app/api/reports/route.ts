import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { RANGE_MS, loadReportMessages } from "@/lib/report-utils";
import { getSettings } from "@/lib/settings";
import { hourlyBucketFormatter } from "@/lib/date";

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
  const t = await loadReportMessages(locale);

  const MAX_ORDERS = 10_000;
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: cutoff },
      status: "COMPLETED",
    },
    include: {
      items: {
        include: {
          menuItem: {
            include: {
              // Scope to active locale + canonical — never all 6 locales (RSS driver).
              names: { where: { locale: { in: Array.from(new Set([locale, s.canonicalLocale])) } } },
              category: { include: { names: { where: { locale: { in: Array.from(new Set([locale, s.canonicalLocale])) } } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ORDERS,
  });

  // Total orders count
  const totalOrders = orders.length;

  // Total revenue
  const totalRevenue = orders.reduce(
    (sum, order) => sum + Number(order.totalAmount),
    0
  );

  // Average order value
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Top 10 items by quantity sold
  const itemQuantities: Record<
    number,
    { name: string; quantity: number; revenue: number }
  > = {};
  for (const order of orders) {
    for (const item of order.items) {
      const key = item.menuItemId ?? 0;
      if (!itemQuantities[key]) {
        const locName = item.menuItem?.names.find((n) => n.locale === locale);
        const thName = item.menuItem?.names.find((n) => n.locale === s.canonicalLocale);
        // menuItemId is null when the source menu item was deleted (SetNull);
        // group all such lines under one labelled bucket instead of "Item 0".
        const name =
          locName?.name ||
          thName?.name ||
          item.menuItem?.names[0]?.name ||
          t("deletedItem");
        itemQuantities[key] = { name, quantity: 0, revenue: 0 };
      }
      itemQuantities[key].quantity += item.quantity;
      itemQuantities[key].revenue += Number(item.unitPrice) * item.quantity;
    }
  }

  const topItems = Object.values(itemQuantities)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);

  // Revenue by category
  const categoryRevMap: Record<
    number,
    { name: string; revenue: number }
  > = {};
  for (const order of orders) {
    for (const item of order.items) {
      const catId = item.menuItem?.categoryId ?? 0;
      if (!categoryRevMap[catId]) {
        const catNames = item.menuItem?.category.names ?? [];
        const locName = catNames.find((n) => n.locale === locale);
        const thName = catNames.find((n) => n.locale === s.canonicalLocale);
        // categoryId is null only when the menu item itself was deleted (SetNull
        // nulls menuItemId, so the category relation is gone too).
        const name =
          locName?.name ||
          thName?.name ||
          catNames[0]?.name ||
          t("deletedCategory");
        categoryRevMap[catId] = { name, revenue: 0 };
      }
      categoryRevMap[catId].revenue +=
        Number(item.unitPrice) * item.quantity;
    }
  }

  const totalCategoryRevenue = Object.values(categoryRevMap).reduce(
    (sum, c) => sum + c.revenue,
    0
  );
  const revenueByCategory = Object.values(categoryRevMap)
    .sort((a, b) => b.revenue - a.revenue)
    .map((c) => ({
      name: c.name,
      revenue: Math.round(c.revenue * 100) / 100,
      percentage:
        totalCategoryRevenue > 0
          ? Math.round((c.revenue / totalCategoryRevenue) * 1000) / 10
          : 0,
    }));

  // Orders grouped by hour (for chart data) in the deployment timezone.
  const ordersByHour: Record<string, number> = {};
  const hourFormatter = hourlyBucketFormatter(s.timezone);
  for (const order of orders) {
    const parts = hourFormatter.formatToParts(order.createdAt);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "00";
    const hourKey = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:00`;
    ordersByHour[hourKey] = (ordersByHour[hourKey] || 0) + 1;
  }

  // Sort hourly data
  const sortedHourlyData = Object.entries(ordersByHour)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, count]) => ({ hour, count }));

  // Highlight: top category by revenue and top item by quantity
  const topCategory = revenueByCategory[0] ?? null;
  const topItem = topItems[0] ?? null;

  return NextResponse.json(
    {
      totalOrders,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      topCategory,
      topItem,
      topItems,
      revenueByCategory,
      ordersByHour: sortedHourlyData,
      range,
      cutoff: cutoff.toISOString(),
      // The query is capped at MAX_ORDERS (oldest dropped); when we hit the cap
      // the figures undercount, so tell the client to warn instead of silently
      // showing a partial picture.
      truncated: totalOrders >= MAX_ORDERS,
      limit: MAX_ORDERS,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
