import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatDeploymentDateTime, formatDeploymentDateKey } from "@/lib/date";
import { getSettings } from "@/lib/settings";
import { currencyCode, type MoneyOptions } from "@/lib/money";
import { resolveRange, RangeError, getItemName, formatOptions, loadReportMessages, withUtf8Bom, toCsv, type CsvCell } from "@/lib/report-utils";
import { log } from "@/lib/logger";

// ExcelJS streams up to MAX_ORDERS rows; cap duration under the platform limit.
export const maxDuration = 60;

const VALID_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "DECLINED"];

// Cap exported rows to bound memory on the single small instance (the whole
// ExcelJS workbook is built in memory before streaming, and sheet 2 expands to
// one row per order LINE — ~3-4× the order count). 15k validated against the
// production tier: the app idles ~46 MB / peaks ~127 MB at 10k, MySQL sits flat
// at ~300 MB (its 128M buffer pool is untouched by a sequential LIMIT read), so
// 15k (~1.5× the export delta, est. peak ~170 MB) stays well within a typical
// small-instance allowance. Must match the order-history JSON endpoint.
const MAX_ORDERS = 15_000;

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
  const locale = searchParams.get("locale") || s.canonicalLocale;
  const statusFilter = searchParams.get("status") || null;
  // Reject an unknown status rather than silently ignoring it — a typo'd
  // `?status=COMPLTED` would otherwise widen the export to ALL statuses while the
  // caller believes they filtered to one (a data-integrity trap on a financial
  // export). Absent status = no filter, still allowed.
  if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
    return NextResponse.json(
      { error: "Invalid status filter", code: "INVALID_STATUS" },
      { status: 400 }
    );
  }
  const format = searchParams.get("format") === "csv" ? "csv" : "xlsx";

  let window;
  try {
    window = resolveRange(searchParams, s.timezone);
  } catch (e) {
    if (e instanceof RangeError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    throw e;
  }
  const { cutoff, until, label: rangeLabel } = window;

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { createdAt: { gte: cutoff, lt: until } };
  if (statusFilter && VALID_STATUSES.includes(statusFilter)) {
    where.status = statusFilter;
  }

  // Real total so a capped export is flagged, never silently truncated (B2).
  const totalCount = await prisma.order.count({ where });
  const truncated = totalCount > MAX_ORDERS;

  const localeScope = Array.from(new Set([locale, s.canonicalLocale]));
  const orders = await prisma.order.findMany({
    where,
    take: MAX_ORDERS,
    // Project only the columns rendered — `include` would also hydrate the 500-char
    // menuItem translation `description` and unused menuItem scalars (×10k rows).
    // selectedOptions IS rendered (the items/options columns), so keep it.
    select: {
      id: true,
      sessionId: true,
      status: true,
      orderType: true,
      totalAmount: true,
      createdAt: true,
      items: {
        select: {
          itemName: true,
          quantity: true,
          unitPrice: true,
          selectedOptions: true,
          menuItem: {
            select: {
              // getItemName reads only the active locale + canonical — scope it.
              names: { where: { locale: { in: localeScope } }, select: { locale: true, name: true } },
            },
          },
        },
      },
      session: { select: { table: { select: { number: true } } } },
    },
    // B1: oldest-first so a truncated export keeps the START of the period.
    orderBy: { createdAt: "asc" },
  });

  // Live locale-matched name first (getItemName falls back to the order-time
  // snapshot); a deleted line without a snapshot gets the labelled string.
  const itemName = (item: { itemName?: string | null; menuItem?: { names: { locale: string; name: string }[] } | null }) => {
    const names = item.menuItem?.names ?? [];
    if (names.length || item.itemName) {
      return getItemName(names, locale, s.canonicalLocale, item.itemName);
    }
    return tShared("deletedItem");
  };

  // Compute the flat order-history rows ONCE (shared by both CSV and xlsx).
  // orderType label keys live at `admin.reports.*`, not under the `excel.`
  // prefix `t` is bound to — use `tShared` (no prefix) for them, else
  // getNestedKey emits the raw "admin.reports.excel.orderType" path.
  const historyHeader = [
    t("orderId"),
    // Sortable YYYY-MM-DD for month pivots/filters; human Timestamp kept too.
    t("dateKey"),
    t("table"),
    tShared("orderType"),
    t("sessionId"),
    t("items"),
    t("total").replace("{currencyCode}", code),
    t("timestamp"),
    t("status"),
  ];
  const historyRows = orders.map((order) => {
    const itemNames = order.items
      .map((item) => {
        const name = itemName(item);
        const opts = formatOptions(item.selectedOptions, money, locale, s.canonicalLocale);
        return opts ? `${name} (${opts}) x${item.quantity}` : `${name} x${item.quantity}`;
      })
      .join(", ");
    return {
      id: order.id,
      date: formatDeploymentDateKey(order.createdAt, s.timezone),
      // Null table = takeaway order (no table scanned) — label it as such
      // instead of the "?" placeholder.
      table:
        order.session?.table?.number != null
          ? t("tableNumber").replace("{number}", String(order.session.table.number))
          : tShared("orderTypeTakeaway"),
      orderType:
        order.orderType === "TAKEAWAY"
          ? tShared("orderTypeTakeaway")
          : tShared("orderTypeDineIn"),
      sessionId: order.sessionId.slice(-8),
      items: itemNames,
      total: Number(order.totalAmount),
      timestamp: formatDeploymentDateTime(order.createdAt, s.timezone),
      status: order.status,
    };
  });

  const safeRange = rangeLabel.replace(/[^a-zA-Z0-9-]+/g, "_");

  // N3: CSV export — flat order-level rows, built as a plain string. This path
  // must return BEFORE exceljs is imported: the CSV is the accountant/Sheets flat
  // record and loading exceljs here would resident-cost ~30 MB on the always-awake
  // instance for no reason (the item-details second sheet is xlsx-only).
  if (format === "csv") {
    const csvRows: CsvCell[][] = [historyHeader];
    // B2: never silently truncate — a loud warning row above the data when capped.
    if (truncated) {
      csvRows.push([
        t("truncatedWarning"),
        "",
        t("truncatedDetail")
          .replace("{shown}", String(orders.length))
          .replace("{total}", String(totalCount)),
      ]);
    }
    for (const r of historyRows) {
      csvRows.push([r.id, r.date, r.table, r.orderType, r.sessionId, r.items, r.total, r.timestamp, r.status]);
    }
    // Prepend a UTF-8 BOM so Excel-for-Windows opens Thai/CJK text correctly.
    return new Response(Buffer.from(withUtf8Bom(Buffer.from(toCsv(csvRows), "utf-8"))), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="order-history-${safeRange}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  // --- xlsx path: only from here on is exceljs loaded ---
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${s.appName} Food Ordering`;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(t("sheetOrderHistory"));
  sheet.columns = [
    { header: t("orderId"), key: "id", width: 12 },
    { header: t("dateKey"), key: "date", width: 14 },
    { header: t("table"), key: "table", width: 20 },
    { header: tShared("orderType"), key: "orderType", width: 14 },
    { header: t("sessionId"), key: "sessionId", width: 18 },
    { header: t("items"), key: "items", width: 60 },
    { header: t("total").replace("{currencyCode}", code), key: "total", width: 15 },
    { header: t("timestamp"), key: "timestamp", width: 25 },
    { header: t("status"), key: "status", width: 15 },
  ];

  // B2: never silently truncate — a loud warning row above the data when capped.
  if (truncated) {
    const warnRow = sheet.addRow({
      id: t("truncatedWarning"),
      table: t("truncatedDetail")
        .replace("{shown}", String(orders.length))
        .replace("{total}", String(totalCount)),
    });
    warnRow.font = { bold: true, color: { argb: "FFC00000" } };
  }

  for (const r of historyRows) {
    sheet.addRow(r);
  }

  sheet.getRow(1).font = { bold: true };

  // --- Item Details Sheet ---
  const detailSheet = workbook.addWorksheet(t("sheetItemDetails"));
  detailSheet.columns = [
    { header: t("orderId"), key: "orderId", width: 12 },
    { header: t("dateKey"), key: "date", width: 14 },
    { header: t("itemName"), key: "name", width: 35 },
    { header: t("options"), key: "options", width: 40 },
    { header: t("quantity"), key: "quantity", width: 12 },
    { header: t("unitPrice").replace("{currencyCode}", code), key: "unitPrice", width: 15 },
    { header: t("subtotal").replace("{currencyCode}", code), key: "subtotal", width: 15 },
  ];

  for (const order of orders) {
    const orderDate = formatDeploymentDateKey(order.createdAt, s.timezone);
    for (const item of order.items) {
      const name = itemName(item);
      const opts = formatOptions(item.selectedOptions, money, locale, s.canonicalLocale);
      const price = Number(item.unitPrice);
      detailSheet.addRow({
        orderId: order.id,
        date: orderDate,
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
      "Content-Disposition": `attachment; filename="order-history-${safeRange}.xlsx"`,
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
