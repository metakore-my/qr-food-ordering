import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { routing } from "@/i18n/routing";
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/logger";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    // Validate session_id cookie matches
    const cookieStore = await cookies();
    const cookieSessionId = cookieStore.get("session_id")?.value;

    // Resolve the active locale so we only fetch the names the client renders
    // (active locale + canonical fallback), not all 6 locales of every item —
    // this payload is polled every 10s and grows with each order placed.
    const { canonicalLocale } = await getSettings();
    const rawLocale = cookieStore.get("NEXT_LOCALE")?.value;
    const locale = (routing.locales as readonly string[]).includes(rawLocale ?? "")
      ? (rawLocale as string)
      : routing.defaultLocale;
    const localeFilter = Array.from(new Set([locale, canonicalLocale]));

    if (!cookieSessionId || cookieSessionId !== sessionId) {
      return NextResponse.json(
        { error: "Unauthorized: session mismatch" },
        { status: 401 }
      );
    }

    // Fetch session status + orders
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const orders = await prisma.order.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      include: {
        items: {
          include: {
            menuItem: {
              include: { names: { where: { locale: { in: localeFilter } } } },
            },
          },
        },
      },
    });

    const serializedOrders = orders.map((order) => ({
      id: order.id,
      status: order.status,
      totalAmount: Number(order.totalAmount),
      createdAt: order.createdAt.toISOString(),
      items: order.items.map((item) => ({
        id: item.id,
        menuItemId: item.menuItemId ?? 0,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        itemName: item.itemName,
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
    }));

    return NextResponse.json({
      orders: serializedOrders,
      sessionStatus: session.status,
    });
  } catch (error) {
    log.error("Orders", "Failed to get orders", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to get orders", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
