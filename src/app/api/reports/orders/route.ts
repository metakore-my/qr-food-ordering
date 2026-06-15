import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatDeploymentDateTime } from "@/lib/date";
import { resolveRange, RangeError, getItemName, parseSelectedOptions, loadReportMessages } from "@/lib/report-utils";
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
  const locale = searchParams.get("locale") || s.canonicalLocale;
  // For the localized "(Deleted items)" fallback label on a legacy order line
  // that has no itemName snapshot AND whose menuItem was deleted (names empty) —
  // matches how the export routes label such lines instead of a raw "Unknown".
  const tShared = await loadReportMessages(locale);

  let window;
  try {
    window = resolveRange(searchParams, s.timezone);
  } catch (e) {
    if (e instanceof RangeError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    throw e;
  }
  const { cutoff, until } = window;

  // Must match the order-history export cap (reports/orders/export/route.ts) so
  // the JSON list and the downloaded file truncate at the same point.
  const MAX_ORDERS = 15_000;
  const where = { createdAt: { gte: cutoff, lt: until } };
  const totalCount = await prisma.order.count({ where });

  const localeScope = Array.from(new Set([locale, s.canonicalLocale]));
  const orders = await prisma.order.findMany({
    where,
    // Project only what the response renders — `include` would also hydrate the
    // 500-char menuItem translation `description` and every unused menuItem scalar
    // (×10k rows = a needless heap inflator). selectedOptions IS rendered, so keep it.
    select: {
      id: true,
      sessionId: true,
      status: true,
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
              // Scope to active locale + canonical — never all 6 locales (RSS driver).
              names: { where: { locale: { in: localeScope } }, select: { locale: true, name: true } },
            },
          },
        },
      },
      session: { select: { table: { select: { number: true } } } },
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
    items: order.items.map((item) => {
      const names = item.menuItem?.names ?? [];
      return {
      // A legacy line with no snapshot AND a deleted menuItem (empty names) gets
      // the localized "(Deleted items)" label instead of getItemName's raw
      // English "Unknown" fallback — matches the export routes.
      name:
        names.length || item.itemName
          ? getItemName(names, locale, s.canonicalLocale, item.itemName)
          : tShared("deletedItem"),
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      // Defensive parse — a malformed snapshot must not 500 the whole list.
      selectedOptions: parseSelectedOptions(item.selectedOptions),
      };
    }),
  }));

  return NextResponse.json(
    {
      orders: result,
      // truncated from the real count() (not page length): cap hit → newest
      // MAX_ORDERS kept, oldest dropped; surface it so the history isn't silently
      // incomplete (matches the analytics endpoint).
      truncated: totalCount > MAX_ORDERS,
      total: totalCount,
      limit: MAX_ORDERS,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
