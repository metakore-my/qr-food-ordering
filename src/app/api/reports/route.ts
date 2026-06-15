import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  resolveRange,
  RangeError,
  loadReportMessages,
  lineRevenue,
  clockHourProfile,
  dayOfWeekProfile,
  topItemPairs,
} from "@/lib/report-utils";
import { getSettings } from "@/lib/settings";
import { hourlyBucketFormatter } from "@/lib/date";

/** Percentage change a→b, rounded to 1 dp. null when there's no prior baseline
 *  (prev = 0) — the UI shows "new" rather than a divide-by-zero ∞%. */
function pctDelta(prev: number, curr: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

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

  const t = await loadReportMessages(locale);

  const MAX_ORDERS = 10_000;
  const completedWhere = {
    createdAt: { gte: cutoff, lt: until },
    status: "COMPLETED" as const,
  };
  // Real total so truncation is KNOWN, not guessed from the page length.
  const totalCount = await prisma.order.count({ where: completedWhere });
  // Project ONLY the columns the analytics below actually read — never `include`
  // (which hydrates the unused selectedOptions Text blob, menuItem Decimals/flags,
  // and the 500-char translation description, a ~10x transient-heap inflator at the
  // 10k-row cap). Scope translation locales to active + canonical (RSS driver).
  const localeScope = Array.from(new Set([locale, s.canonicalLocale]));
  const orders = await prisma.order.findMany({
    where: completedWhere,
    select: {
      createdAt: true,
      totalAmount: true,
      items: {
        select: {
          menuItemId: true,
          itemName: true,
          quantity: true,
          unitPrice: true,
          menuItem: {
            select: {
              categoryId: true,
              names: { where: { locale: { in: localeScope } }, select: { locale: true, name: true } },
              category: {
                select: {
                  names: { where: { locale: { in: localeScope } }, select: { locale: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ORDERS,
  });

  // True completed-order count for the window (not the capped page length), so a
  // truncated report still reports the honest order total. Aggregates below are
  // necessarily over the fetched page; the `truncated` flag tells the UI they undercount.
  const totalOrders = totalCount;
  const fetchedOrders = orders.length;

  // Total revenue (over the fetched page)
  const totalRevenue = orders.reduce(
    (sum, order) => sum + Number(order.totalAmount),
    0
  );

  // Average order value (over the fetched page — the data we actually summed)
  const avgOrderValue = fetchedOrders > 0 ? totalRevenue / fetchedOrders : 0;

  // Items per order — more intuitive for a stall than AOV (AOV's denominator is a
  // per-device cart, which is fuzzy on a shared table). Total units / orders.
  const totalItems = orders.reduce(
    (sum, order) => sum + order.items.reduce((s2, it) => s2 + it.quantity, 0),
    0
  );
  const itemsPerOrder = fetchedOrders > 0 ? totalItems / fetchedOrders : 0;

  // Top 10 items by quantity sold
  const itemQuantities: Record<
    string,
    { name: string; quantity: number; revenue: number }
  > = {};
  for (const order of orders) {
    for (const item of order.items) {
      // menuItemId is null when the source menu item was deleted (SetNull).
      // Deleted lines that carry an order-time name snapshot bucket PER NAME —
      // pooling them all under one key would attribute every deleted dish's
      // sales to whichever snapshot came first. Legacy deleted lines (no
      // snapshot) still pool under one labelled bucket instead of "Item 0".
      const key =
        item.menuItemId ?? (item.itemName ? `deleted:${item.itemName}` : 0);
      if (!itemQuantities[key]) {
        // Live locale-matched name first; the order-time snapshot only
        // backstops a deleted item / missing translation.
        const locName = item.menuItem?.names.find((n) => n.locale === locale);
        const thName = item.menuItem?.names.find((n) => n.locale === s.canonicalLocale);
        const name =
          locName?.name ||
          thName?.name ||
          item.itemName ||
          item.menuItem?.names[0]?.name ||
          t("deletedItem");
        itemQuantities[key] = { name, quantity: 0, revenue: 0 };
      }
      itemQuantities[key].quantity += item.quantity;
      // Revenue credits option adjustments (Large +RM10), not just base unitPrice —
      // see lineRevenue. Same helper backs the export so the two never drift.
      itemQuantities[key].revenue += lineRevenue(item);
    }
  }

  // Total item revenue across ALL items (not just the top 10) — the denominator
  // for each item's revenue-contribution %. Lets the UI show "top 5 = 78% of
  // sales" (Pareto), so the owner sees where the money concentrates.
  const totalItemRevenue = Object.values(itemQuantities).reduce(
    (sum, it) => sum + it.revenue,
    0
  );

  // Top 10 by QUANTITY (the kitchen-prep ranking), each carrying its share of
  // TOTAL item revenue so the table can footnote the Pareto concentration.
  const topItems = Object.values(itemQuantities)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)
    .map((it) => ({
      name: it.name,
      quantity: it.quantity,
      revenue: Math.round(it.revenue * 100) / 100,
      revenueShare:
        totalItemRevenue > 0
          ? Math.round((it.revenue / totalItemRevenue) * 1000) / 10
          : 0,
    }));

  // Pareto headline: how many of the TOP items (by revenue) make up ≥80% of sales.
  // "Your top N dishes = X% of revenue" — the concentration the owner protects.
  const itemsByRevenueDesc = Object.values(itemQuantities).sort(
    (a, b) => b.revenue - a.revenue
  );
  let paretoCum = 0;
  let paretoCount = 0;
  for (const it of itemsByRevenueDesc) {
    if (totalItemRevenue <= 0) break;
    paretoCum += it.revenue;
    paretoCount++;
    if (paretoCum / totalItemRevenue >= 0.8) break;
  }
  const pareto =
    totalItemRevenue > 0 && itemsByRevenueDesc.length > 0
      ? {
          topCount: paretoCount,
          totalItemsWithSales: itemsByRevenueDesc.length,
          sharePercent: Math.round((paretoCum / totalItemRevenue) * 1000) / 10,
        }
      : null;

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
      // Option-adjustment-inclusive, matching the per-item revenue above.
      categoryRevMap[catId].revenue += lineRevenue(item);
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

  // 24-hour CLOCK profile (all days summed onto one 0–23 axis) + the busiest
  // contiguous window — the readable "when are we slammed?" answer that the raw
  // per-day hourly chart can't give on a 30d/90d range. Single source of truth.
  const hourProfile = clockHourProfile(orders, s.timezone);

  // Per-clock-hour ITEMS and REVENUE, so the chart can toggle between three
  // denominators: orders (when are we busy), items (kitchen load), revenue (when
  // do we make money) — which can peak at different hours. The order-count axis
  // already lives in hourProfile.buckets; we add the other two here keyed 0–23.
  const itemsByClockHour = new Array(24).fill(0) as number[];
  const revenueByClockHour = new Array(24).fill(0) as number[];
  const clockHourFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: s.timezone,
    hour: "2-digit",
    hour12: false,
  });
  for (const order of orders) {
    const raw = Number(clockHourFmt.format(order.createdAt));
    const h = Number.isFinite(raw) ? raw % 24 : 0;
    for (const item of order.items) {
      itemsByClockHour[h] += item.quantity;
      revenueByClockHour[h] += lineRevenue(item);
    }
  }
  // Merge the three metrics into one bucket array the client toggles over.
  const clockBuckets = hourProfile.buckets.map((b) => ({
    hour: b.hour,
    orders: b.count,
    items: itemsByClockHour[b.hour],
    revenue: Math.round(revenueByClockHour[b.hour] * 100) / 100,
    percentage: b.percentage, // order-share, kept for backward compat
  }));

  // Day-of-week profile (which DAYS make money) — orders/items/revenue per
  // weekday + busiest/quietest day. Complements the clock profile (which hours).
  const weekProfile = dayOfWeekProfile(orders, s.timezone);

  // Frequently-ordered-together pairs (selling point: item combinations). Keys
  // mirror the itemQuantities bucketing — menuItemId, or a per-snapshot key for
  // deleted lines — so a rename can't split a pair and two deleted dishes don't
  // merge. Names resolve live-locale-first, same chain as the item table.
  const pairKeyOf = (item: (typeof orders)[number]["items"][number]) =>
    String(item.menuItemId ?? (item.itemName ? `deleted:${item.itemName}` : 0));
  const pairNameOf = (item: (typeof orders)[number]["items"][number]) => {
    const locName = item.menuItem?.names.find((n) => n.locale === locale);
    const canonName = item.menuItem?.names.find((n) => n.locale === s.canonicalLocale);
    return (
      locName?.name ||
      canonName?.name ||
      item.itemName ||
      item.menuItem?.names[0]?.name ||
      t("deletedItem")
    );
  };
  const topPairs = topItemPairs(orders, pairKeyOf, pairNameOf, 5);

  // ── Period-over-period: the owner's #1 question is "up or down?". Compare this
  // window against the immediately-preceding window of the SAME length. Counts
  // only (cheap aggregate queries, no row hydration) so the cards can show ▲/▼. ──
  const spanMs = until.getTime() - cutoff.getTime();
  const prevCutoff = new Date(cutoff.getTime() - spanMs);
  const prevWhere = {
    createdAt: { gte: prevCutoff, lt: cutoff },
    status: "COMPLETED" as const,
  };
  const [prevOrderCount, prevRevenueAgg] = await Promise.all([
    prisma.order.count({ where: prevWhere }),
    prisma.order.aggregate({ where: prevWhere, _sum: { totalAmount: true } }),
  ]);
  const prevRevenue = Number(prevRevenueAgg._sum.totalAmount ?? 0);
  const prevAov = prevOrderCount > 0 ? prevRevenue / prevOrderCount : 0;
  const comparison = {
    ordersDelta: pctDelta(prevOrderCount, totalOrders),
    revenueDelta: pctDelta(prevRevenue, totalRevenue),
    aovDelta: pctDelta(prevAov, avgOrderValue),
    prevOrders: prevOrderCount,
    prevRevenue: Math.round(prevRevenue * 100) / 100,
  };

  // ── Dead / slow items: the cut decision. Items the owner still has on the menu
  // (available) that sold little or nothing in this window. Needs the live menu
  // (orders alone can't show a ZERO-seller), so we list available items and
  // subtract what sold. Sold-quantity is keyed by menuItemId from itemQuantities. ──
  const soldQtyById = new Map<number, number>();
  for (const order of orders) {
    for (const item of order.items) {
      if (item.menuItemId != null) {
        soldQtyById.set(item.menuItemId, (soldQtyById.get(item.menuItemId) ?? 0) + item.quantity);
      }
    }
  }
  const availableMenuItems = await prisma.menuItem.findMany({
    where: { isAvailable: true },
    select: {
      id: true,
      names: { where: { locale: { in: Array.from(new Set([locale, s.canonicalLocale])) } } },
    },
  });
  const deadItems = availableMenuItems
    .map((mi) => ({
      name:
        mi.names.find((n) => n.locale === locale)?.name ||
        mi.names.find((n) => n.locale === s.canonicalLocale)?.name ||
        mi.names[0]?.name ||
        t("deletedItem"),
      quantity: soldQtyById.get(mi.id) ?? 0,
    }))
    // Slowest first; cap at 10 so the panel stays a glance, not a second menu.
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 10);
  // How many available items sold NOTHING at all — the headline cut signal.
  const zeroSellerCount = availableMenuItems.filter(
    (mi) => (soldQtyById.get(mi.id) ?? 0) === 0
  ).length;

  // Highlight: top category by revenue and top item by quantity
  const topCategory = revenueByCategory[0] ?? null;
  const topItem = topItems[0] ?? null;

  return NextResponse.json(
    {
      totalOrders,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      // Items per order — replaces AOV on the dashboard (kept AOV in the payload
      // for the export/back-compat).
      itemsPerOrder: Math.round(itemsPerOrder * 100) / 100,
      // ▲/▼ vs the immediately-preceding equal-length window.
      comparison,
      topCategory,
      topItem,
      topItems,
      // Pareto headline: top N dishes = X% of sales.
      pareto,
      revenueByCategory,
      ordersByHour: sortedHourlyData,
      // 24h clock profile with order/item/revenue per hour (toggle) + peak,
      // second peak (bimodal), quietest window, and the steady-day flag.
      hourProfile: clockBuckets,
      peakWindow: hourProfile.peak,
      secondPeakWindow: hourProfile.secondPeak,
      quietestWindow: hourProfile.quietest,
      steadyDay: hourProfile.steady,
      // Day-of-week profile (which days make money) + busiest/quietest weekday.
      dayProfile: weekProfile.buckets,
      busiestWeekday: weekProfile.busiestWeekday,
      quietestWeekday: weekProfile.quietestWeekday,
      // Frequently-ordered-together (selling point: item combinations).
      topPairs,
      // Slow/dead available items (the cut decision) + the zero-seller headline.
      deadItems,
      zeroSellerCount,
      range: rangeLabel,
      cutoff: cutoff.toISOString(),
      until: until.toISOString(),
      // truncated = true when the COMPLETED count exceeds the cap, so only the
      // newest MAX_ORDERS were summed and the figures undercount. Derived from the
      // real count() (totalCount), not the page length, so it's accurate.
      truncated: totalCount > MAX_ORDERS,
      limit: MAX_ORDERS,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
