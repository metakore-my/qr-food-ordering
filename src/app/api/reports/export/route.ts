import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatDeploymentDateTime, hourlyBucketFormatter } from "@/lib/date";
import { RANGE_MS, getItemName, formatOptions, loadReportMessages } from "@/lib/report-utils";
import { getSettings } from "@/lib/settings";
import { formatMoney, currencyCode, type MoneyOptions } from "@/lib/money";
import { log } from "@/lib/logger";

// ExcelJS can serialize up to MAX_ORDERS rows + workbook in memory; cap the
// request duration under the platform limit (matches the OpenRouter 60s cap).
export const maxDuration = 60;

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

  // Runtime currency/decimals/locale for money formatting, and the canonical
  // locale code used in Excel column-header labels.
  const money: MoneyOptions = {
    currency: s.currency,
    decimals: s.decimals,
    locale: s.defaultLocale,
  };
  const code = currencyCode(money);

  try {
  const t = await loadReportMessages(locale, "excel.");
  const tShared = await loadReportMessages(locale);

  const cutoff = new Date(Date.now() - ms);

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
      session: {
        include: {
          table: { select: { number: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ORDERS,
  });

  // Calculate summary data
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce(
    (sum, o) => sum + Number(o.totalAmount),
    0
  );
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Calculate item-level data
  const itemMap: Record<
    number,
    { name: string; category: string; quantity: number; revenue: number }
  > = {};
  for (const order of orders) {
    for (const item of order.items) {
      const key = item.menuItemId ?? 0;
      if (!itemMap[key]) {
        const names = item.menuItem?.names ?? [];
        const catNames = item.menuItem?.category.names ?? [];
        itemMap[key] = {
          // Deleted menu item (menuItemId null → no names): label the bucket
          // instead of letting getItemName fall back to "Unknown".
          name: names.length ? getItemName(names, locale, s.canonicalLocale) : tShared("deletedItem"),
          category: catNames.length
            ? getItemName(catNames, locale, s.canonicalLocale)
            : tShared("deletedCategory"),
          quantity: 0,
          revenue: 0,
        };
      }
      itemMap[key].quantity += item.quantity;
      itemMap[key].revenue += Number(item.unitPrice) * item.quantity;
    }
  }

  // Calculate category-level data (used for both highlight and sheet)
  const categoryRevMap: Record<
    number,
    { name: string; revenue: number }
  > = {};
  for (const order of orders) {
    for (const item of order.items) {
      const catId = item.menuItem?.categoryId ?? 0;
      if (!categoryRevMap[catId]) {
        const catNames = item.menuItem?.category.names ?? [];
        categoryRevMap[catId] = {
          name: catNames.length
            ? getItemName(catNames, locale, s.canonicalLocale)
            : tShared("deletedCategory"),
          revenue: 0,
        };
      }
      categoryRevMap[catId].revenue +=
        Number(item.unitPrice) * item.quantity;
    }
  }

  const sortedItems = Object.values(itemMap).sort(
    (a, b) => b.quantity - a.quantity
  );
  const totalCatRevenue = Object.values(categoryRevMap).reduce(
    (sum, c) => sum + c.revenue,
    0
  );
  const sortedCategories = Object.values(categoryRevMap).sort(
    (a, b) => b.revenue - a.revenue
  );

  // Orders grouped by hour in the deployment timezone.
  const ordersByHour: Record<string, number> = {};
  const hourFormatter = hourlyBucketFormatter(s.timezone);
  for (const order of orders) {
    const parts = hourFormatter.formatToParts(order.createdAt);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "00";
    const hourKey = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:00`;
    ordersByHour[hourKey] = (ordersByHour[hourKey] || 0) + 1;
  }
  const sortedHourlyData = Object.entries(ordersByHour)
    .sort(([a], [b]) => a.localeCompare(b));

  // Create workbook (dynamic import to reduce cold start bundle size)
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${s.appName} Food Ordering`;
  workbook.created = new Date();

  // --- Summary Sheet ---
  const summarySheet = workbook.addWorksheet(t("sheetSummary"));
  summarySheet.columns = [
    { header: t("metric"), key: "metric", width: 25 },
    { header: t("value"), key: "value", width: 30 },
  ];
  summarySheet.addRow({ metric: t("reportRange"), value: range });
  summarySheet.addRow({
    metric: t("from"),
    value: formatDeploymentDateTime(cutoff, s.timezone),
  });
  summarySheet.addRow({
    metric: t("to"),
    value: formatDeploymentDateTime(new Date(), s.timezone),
  });
  summarySheet.addRow({ metric: t("totalOrders"), value: totalOrders });
  summarySheet.addRow({
    metric: t("totalRevenue").replace("{currencyCode}", code),
    value: Math.round(totalRevenue * 100) / 100,
  });
  summarySheet.addRow({
    metric: t("avgOrderValue").replace("{currencyCode}", code),
    value: Math.round(avgOrderValue * 100) / 100,
  });

  // Top highlights
  if (sortedItems[0]) {
    summarySheet.addRow({
      metric: t("topItemByQty"),
      value: `${sortedItems[0].name} (${sortedItems[0].quantity} ${t("sold")})`,
    });
  }
  if (sortedCategories[0]) {
    summarySheet.addRow({
      metric: t("topCategoryByRevenue"),
      value: `${sortedCategories[0].name} (${formatMoney(Math.round(sortedCategories[0].revenue * 100) / 100, money)})`,
    });
  }

  // Style header row and right-align all Value cells
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.getColumn("value").alignment = { horizontal: "right" };

  // --- Orders Sheet ---
  const ordersSheet = workbook.addWorksheet(t("sheetOrders"));
  ordersSheet.columns = [
    { header: t("orderId"), key: "id", width: 12 },
    { header: t("table"), key: "table", width: 20 },
    { header: t("sessionId"), key: "sessionId", width: 18 },
    { header: t("items"), key: "items", width: 60 },
    { header: t("total").replace("{currencyCode}", code), key: "total", width: 15 },
    { header: t("timestamp"), key: "timestamp", width: 25 },
    { header: t("status"), key: "status", width: 15 },
  ];

  for (const order of orders) {
    const itemNames = order.items
      .map((item) => {
        const name = getItemName(item.menuItem?.names ?? [], locale, s.canonicalLocale);
        const opts = formatOptions(item.selectedOptions, money);
        return opts ? `${name} (${opts}) x${item.quantity}` : `${name} x${item.quantity}`;
      })
      .join(", ");

    ordersSheet.addRow({
      id: order.id,
      table: t("tableNumber").replace("{number}", String(order.session.table.number)),
      sessionId: order.sessionId.slice(-8),
      items: itemNames,
      total: Number(order.totalAmount),
      timestamp: formatDeploymentDateTime(order.createdAt, s.timezone),
      status: order.status,
    });
  }

  ordersSheet.getRow(1).font = { bold: true };

  // --- Items Sheet ---
  const itemsSheet = workbook.addWorksheet(t("sheetItems"));
  itemsSheet.columns = [
    { header: t("itemName"), key: "name", width: 35 },
    { header: t("category"), key: "category", width: 25 },
    { header: t("quantitySold"), key: "quantity", width: 15 },
    { header: t("revenue").replace("{currencyCode}", code), key: "revenue", width: 15 },
  ];

  for (const item of sortedItems) {
    itemsSheet.addRow({
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      revenue: Math.round(item.revenue * 100) / 100,
    });
  }

  itemsSheet.getRow(1).font = { bold: true };

  // --- Category Revenue Sheet ---
  const categorySheet = workbook.addWorksheet(t("sheetCategoryRevenue"));
  categorySheet.columns = [
    { header: t("category"), key: "category", width: 30 },
    { header: t("revenue").replace("{currencyCode}", code), key: "revenue", width: 18 },
    { header: t("percentage"), key: "percentage", width: 15 },
  ];

  for (const cat of sortedCategories) {
    const pct =
      totalCatRevenue > 0
        ? Math.round((cat.revenue / totalCatRevenue) * 1000) / 10
        : 0;
    categorySheet.addRow({
      category: cat.name,
      revenue: Math.round(cat.revenue * 100) / 100,
      percentage: `${pct}%`,
    });
  }

  categorySheet.getRow(1).font = { bold: true };

  // --- Orders by Hour Sheet ---
  const hourlySheet = workbook.addWorksheet(t("sheetOrdersByHour"));
  hourlySheet.columns = [
    { header: t("hour"), key: "hour", width: 22 },
    { header: t("orderCount"), key: "count", width: 15 },
  ];

  for (const [hour, count] of sortedHourlyData) {
    hourlySheet.addRow({ hour, count });
  }

  hourlySheet.getRow(1).font = { bold: true };

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="report-${range}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
  } catch (err) {
    log.error("Reports", "Analytics Excel export failed", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Export failed", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
