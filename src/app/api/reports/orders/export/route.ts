import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatDeploymentDateTime } from "@/lib/date";
import { getSettings } from "@/lib/settings";
import { currencyCode, type MoneyOptions } from "@/lib/money";
import { RANGE_MS, getItemName, formatOptions, loadReportMessages } from "@/lib/report-utils";
import { log } from "@/lib/logger";

// ExcelJS streams up to MAX_ORDERS rows; cap duration under the platform limit.
export const maxDuration = 60;

const VALID_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "DECLINED"];

// Cap exported rows to bound memory on small/serverless instances (matches the
// other report endpoints; see .claude/rules/security-hardening.md "Reports").
const MAX_ORDERS = 10_000;

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
  const statusFilter = searchParams.get("status") || null;

  const ms = RANGE_MS[range];
  if (!ms) {
    return NextResponse.json(
      { error: "Invalid range. Use: 1h, 3h, 12h, 1d, 7d, 30d" },
      { status: 400 }
    );
  }

  // Runtime currency/decimals/locale for money formatting; `code` feeds the
  // Excel column-header labels.
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { createdAt: { gte: cutoff } };
  if (statusFilter && VALID_STATUSES.includes(statusFilter)) {
    where.status = statusFilter;
  }

  const orders = await prisma.order.findMany({
    where,
    take: MAX_ORDERS,
    include: {
      items: {
        include: {
          menuItem: {
            include: {
              // Resolvers (getItemName) read only the active locale + canonical,
              // so scope the include — never `names: true` (all 6 locales is the
              // #1 RSS driver on the small instance).
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
  });

  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${s.appName} Food Ordering`;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(t("sheetOrderHistory"));
  sheet.columns = [
    { header: t("orderId"), key: "id", width: 12 },
    { header: t("table"), key: "table", width: 20 },
    { header: t("sessionId"), key: "sessionId", width: 18 },
    { header: t("items"), key: "items", width: 60 },
    { header: t("total").replace("{currencyCode}", code), key: "total", width: 15 },
    { header: t("timestamp"), key: "timestamp", width: 25 },
    { header: t("status"), key: "status", width: 15 },
  ];

  const itemName = (item: { menuItem?: { names: { locale: string; name: string }[] } | null }) => {
    const names = item.menuItem?.names ?? [];
    return names.length ? getItemName(names, locale, s.canonicalLocale) : tShared("deletedItem");
  };

  for (const order of orders) {
    const itemNames = order.items
      .map((item) => {
        const name = itemName(item);
        const opts = formatOptions(item.selectedOptions, money);
        return opts ? `${name} (${opts}) x${item.quantity}` : `${name} x${item.quantity}`;
      })
      .join(", ");

    sheet.addRow({
      id: order.id,
      table: t("tableNumber").replace("{number}", String(order.session?.table?.number ?? "?")),
      sessionId: order.sessionId.slice(-8),
      items: itemNames,
      total: Number(order.totalAmount),
      timestamp: formatDeploymentDateTime(order.createdAt, s.timezone),
      status: order.status,
    });
  }

  sheet.getRow(1).font = { bold: true };

  // --- Item Details Sheet ---
  const detailSheet = workbook.addWorksheet(t("sheetItemDetails"));
  detailSheet.columns = [
    { header: t("orderId"), key: "orderId", width: 12 },
    { header: t("itemName"), key: "name", width: 35 },
    { header: t("options"), key: "options", width: 40 },
    { header: t("quantity"), key: "quantity", width: 12 },
    { header: t("unitPrice").replace("{currencyCode}", code), key: "unitPrice", width: 15 },
    { header: t("subtotal").replace("{currencyCode}", code), key: "subtotal", width: 15 },
  ];

  for (const order of orders) {
    for (const item of order.items) {
      const name = itemName(item);
      const opts = formatOptions(item.selectedOptions, money);
      const price = Number(item.unitPrice);
      detailSheet.addRow({
        orderId: order.id,
        name,
        options: opts,
        quantity: item.quantity,
        unitPrice: price,
        subtotal: Math.round(price * item.quantity * 100) / 100,
      });
    }
  }

  detailSheet.getRow(1).font = { bold: true };

  // Stream the Excel file instead of buffering entirely in memory
  const { PassThrough } = await import("stream");
  const passthrough = new PassThrough();

  const stream = new ReadableStream({
    start(controller) {
      passthrough.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      passthrough.on("end", () => {
        controller.close();
      });
      passthrough.on("error", (err) => {
        controller.error(err);
      });
    },
  });

  workbook.xlsx
    .write(passthrough)
    .then(() => passthrough.end())
    .catch((err) => {
      // Surface a serialization failure to the stream (errors the response)
      // and log it server-side rather than hanging the download.
      log.error("Reports", "Order-history Excel stream failed", {
        error: err instanceof Error ? err.message : "Unknown error",
      });
      passthrough.destroy(err instanceof Error ? err : new Error("stream error"));
    });

  return new Response(stream, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="order-history-${range}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
  } catch (err) {
    log.error("Reports", "Order-history export failed", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Export failed", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
