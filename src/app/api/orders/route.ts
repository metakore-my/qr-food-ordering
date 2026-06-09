import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSessionExpired } from "@/lib/session";
import { cookies } from "next/headers";
import { isMaintenanceMode } from "@/lib/maintenance";
import { log } from "@/lib/logger";
import { computeUnitPrice, computeOrderTotal } from "@/lib/order-utils";
import { getSettings } from "@/lib/settings";

const placeOrderSchema = z.object({
  sessionId: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

// globalThis-guarded so dev HMR reuses these Maps instead of leaking one per reload.
const globalForOrders = globalThis as unknown as {
  idempotencyStore?: Map<string, { orderId: number; timestamp: number }>;
  orderRateMap?: Map<string, number[]>;
};

// Idempotency store: key -> { orderId, timestamp }
const idempotencyStore =
  globalForOrders.idempotencyStore ??
  (globalForOrders.idempotencyStore = new Map<
    string,
    { orderId: number; timestamp: number }
  >());

const IDEMPOTENCY_TTL_MS = 60_000; // 60 seconds
const MAX_IDEMPOTENCY_STORE_SIZE = 1_000;

// Rate limiter: max 5 orders per session per minute
const orderRateMap =
  globalForOrders.orderRateMap ??
  (globalForOrders.orderRateMap = new Map<string, number[]>());
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

function cleanupIdempotencyStore() {
  const now = Date.now();
  for (const [key, value] of idempotencyStore.entries()) {
    if (now - value.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyStore.delete(key);
    }
  }
  // Safety valve: evict oldest half if store grows too large
  if (idempotencyStore.size > MAX_IDEMPOTENCY_STORE_SIZE) {
    const sorted = Array.from(idempotencyStore.entries())
      .sort(([, a], [, b]) => a.timestamp - b.timestamp);
    const toEvict = sorted.slice(0, Math.floor(sorted.length / 2));
    for (const [key] of toEvict) {
      idempotencyStore.delete(key);
    }
  }
}

export async function POST(req: NextRequest) {
  if (await isMaintenanceMode()) {
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
  }

  // Hoisted for the outer catch's error log (assigned once the body is parsed).
  let sessionIdForLog: string | undefined;

  try {
    // Parse and validate body
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const parsed = placeOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { sessionId, idempotencyKey } = parsed.data;
    sessionIdForLog = sessionId;

    // Validate session_id cookie matches
    const cookieStore = await cookies();
    const cookieSessionId = cookieStore.get("session_id")?.value;

    if (!cookieSessionId || cookieSessionId !== sessionId) {
      return NextResponse.json(
        { error: "Unauthorized: session mismatch" },
        { status: 401 }
      );
    }

    const deviceId = cookieStore.get("device_id")?.value;
    if (!deviceId) {
      return NextResponse.json(
        { error: "Missing device_id" },
        { status: 400 }
      );
    }

    // Validate session is ACTIVE
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Session not found", code: "SESSION_INACTIVE" },
        { status: 404 }
      );
    }

    if (session.status !== "ACTIVE" || isSessionExpired(session.updatedAt)) {
      return NextResponse.json(
        { error: "Session is not active", code: "SESSION_INACTIVE" },
        { status: 400 }
      );
    }

    // canonical locale → option/name snapshots; decimals → total rounding.
    const s = await getSettings();

    // Idempotency BEFORE rate limit, so a duplicate same-key submission returns
    // the existing result without burning a rate-limit slot.
    cleanupIdempotencyStore();
    const existingEntry = idempotencyStore.get(idempotencyKey);
    if (existingEntry) {
      // orderId === -1 is the in-flight placeholder: a same-key request is still
      // mid-transaction. Reject with 409 — must NOT fall through to create another
      // order (the original bug: findUnique({id:-1}) → null → duplicate).
      if (existingEntry.orderId === -1) {
        log.info("Order", "Idempotent in-flight reject", { idempotencyKey });
        return NextResponse.json(
          { error: "An order with this request is already being processed.", code: "ORDER_IN_PROGRESS" },
          { status: 409 }
        );
      }

      log.info("Order", "Idempotent hit", { idempotencyKey, orderId: existingEntry.orderId });
      const existingOrder = await prisma.order.findUnique({
        where: { id: existingEntry.orderId },
        include: {
          items: {
            include: {
              // Canonical name only — the success screen ignores these names.
              menuItem: {
                include: { names: { where: { locale: s.canonicalLocale } } },
              },
            },
          },
        },
      });

      if (existingOrder) {
        return NextResponse.json({
          order: serializeOrder(existingOrder),
          idempotent: true,
        });
      }
    }

    // Rate limit (5/session/min). Recorded eagerly to prevent TOCTOU bypass;
    // rolled back on tx failure (catch below).
    const now = Date.now();
    const timestamps = orderRateMap.get(sessionId) ?? [];
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: "Too many orders. Please wait before placing another.", code: "RATE_LIMITED" },
        { status: 429 }
      );
    }
    recent.push(now);
    orderRateMap.set(sessionId, recent);

    // Reserve the key with the -1 placeholder so a concurrent same-key request
    // gets a 409 above. Replaced with the real ID on commit, released on failure.
    idempotencyStore.set(idempotencyKey, { orderId: -1, timestamp: Date.now() });

    // Create order in a transaction
    let order;
    try {
    order = await prisma.$transaction(async (tx) => {
      // Lock the session row FOR UPDATE so placement serializes against a
      // concurrent checkout (which also locks it) — otherwise a PENDING order can
      // land on a just-CHECKED_OUT session and escape the grand total (free food).
      // Re-validate from the locked read, not the REPEATABLE-READ snapshot.
      const lockedSession = await tx.$queryRaw<
        Array<{ id: string; status: string; updatedAt: Date }>
      >`SELECT id, status, updatedAt FROM sessions WHERE id = ${sessionId} FOR UPDATE`;
      const txSession = lockedSession[0];
      if (!txSession || txSession.status !== "ACTIVE" || isSessionExpired(txSession.updatedAt)) {
        throw new Error("Session is not active");
      }

      // Read this device's cart. Scope name includes to the canonical locale —
      // snapshots use only that name, and fetching all 6 bloats the heap per order.
      const cartItems = await tx.cartItem.findMany({
        where: { sessionId, deviceId },
        include: {
          menuItem: {
            include: {
              optionGroups: {
                include: {
                  names: { where: { locale: s.canonicalLocale } },
                  choices: {
                    include: { names: { where: { locale: s.canonicalLocale } } },
                  },
                },
              },
            },
          },
        },
      });

      if (cartItems.length === 0) {
        throw new Error("Cart is empty");
      }

      // CLAIM the cart by deleting it: the DELETE's exclusive row locks serialize
      // concurrent placements, so exactly one wins (count > 0) and the rest bail —
      // this is what stops a double-tapped "Place Order" from charging N×. The
      // claim MUST be the write: under REPEATABLE READ a FOR UPDATE select's
      // follow-up read still saw the pre-delete snapshot.
      const claim = await tx.cartItem.deleteMany({
        where: { sessionId, deviceId, id: { in: cartItems.map((ci) => ci.id) } },
      });
      if (claim.count === 0) {
        // Another request already claimed this cart.
        throw new Error("Cart is empty");
      }

      // Re-check availability inside the tx.
      const unavailable = cartItems.filter((ci) => !ci.menuItem.isAvailable);
      if (unavailable.length > 0) {
        throw new Error("Some items are no longer available");
      }

      // Build order items with option snapshots
      const orderItemsData = cartItems.map((ci) => {
        const selectedOpts: Array<{ groupId: number; choiceIds: number[] }> =
          JSON.parse(ci.selectedOptions);

        // Build human-readable snapshot and compute price adjustments
        let optionPriceTotal = 0;
        const optionSnapshot: Array<{
          groupName: string;
          choiceName: string;
          priceAdjustment: number;
        }> = [];

        for (const sel of selectedOpts) {
          const group = ci.menuItem.optionGroups.find(
            (g) => g.id === sel.groupId
          );
          if (!group) continue;

          // Canonical-locale name, fallback to first.
          const groupNameTh = group.names.find((n) => n.locale === s.canonicalLocale);
          const groupName =
            groupNameTh?.name || group.names[0]?.name || `Group ${group.id}`;

          for (const choiceId of sel.choiceIds) {
            const choice = group.choices.find((c) => c.id === choiceId);
            if (!choice) continue;

            const choiceNameTh = choice.names.find((n) => n.locale === s.canonicalLocale);
            const choiceName =
              choiceNameTh?.name ||
              choice.names[0]?.name ||
              `Choice ${choice.id}`;

            const adj = Number(choice.priceAdjustment);
            optionPriceTotal += adj;
            optionSnapshot.push({
              groupName,
              choiceName,
              priceAdjustment: adj,
            });
          }
        }

        const unitPrice = computeUnitPrice(
          {
            isCombo: ci.menuItem.isCombo,
            comboBasePrice:
              ci.menuItem.comboBasePrice != null
                ? Number(ci.menuItem.comboBasePrice)
                : null,
            price: Number(ci.menuItem.price),
          },
          optionPriceTotal,
          s.decimals
        );

        return {
          menuItemId: ci.menuItemId,
          quantity: ci.quantity,
          unitPrice,
          selectedOptions: JSON.stringify(optionSnapshot),
        };
      });

      // Calculate total (round once at the end to avoid floating-point drift)
      const totalAmount = computeOrderTotal(orderItemsData, s.decimals);

      // Create order with items
      const newOrder = await tx.order.create({
        data: {
          sessionId,
          totalAmount,
          items: {
            create: orderItemsData,
          },
        },
        include: {
          items: {
            include: {
              // Canonical name only — the success screen ignores these names.
              menuItem: {
                include: { names: { where: { locale: s.canonicalLocale } } },
              },
            },
          },
        },
      });

      // Touch the session (cart already claimed above) so the 4h TTL stays an
      // INACTIVITY timer — placing an order extends it via @updatedAt.
      await tx.session.update({ where: { id: sessionId }, data: {} });

      return newOrder;
    });
    } catch (txError) {
      // Tx failed — release the idempotency reservation and the eager rate-limit slot.
      idempotencyStore.delete(idempotencyKey);
      const ts = orderRateMap.get(sessionId);
      if (ts) {
        const idx = ts.indexOf(now);
        if (idx !== -1) ts.splice(idx, 1);
        if (ts.length === 0) orderRateMap.delete(sessionId);
        else orderRateMap.set(sessionId, ts);
      }
      throw txError;
    }

    // Committed — record the real order ID against the idempotency key.
    idempotencyStore.set(idempotencyKey, {
      orderId: order.id,
      timestamp: Date.now(),
    });

    // Prune stale rate-limit entries for other sessions.
    for (const [key, ts] of orderRateMap.entries()) {
      if (key === sessionId) continue;
      const filtered = ts.filter((t) => Date.now() - t < RATE_LIMIT_WINDOW_MS);
      if (filtered.length === 0) orderRateMap.delete(key);
      else orderRateMap.set(key, filtered);
    }
    // Safety valve: evict oldest half (preserves active sessions).
    if (orderRateMap.size > 10_000) {
      const sorted = Array.from(orderRateMap.entries())
        .map(([key, ts]) => [key, Math.max(...ts)] as const)
        .sort(([, a], [, b]) => a - b);
      const toEvict = sorted.slice(0, Math.floor(sorted.length / 2));
      for (const [key] of toEvict) {
        orderRateMap.delete(key);
      }
    }

    log.info("Order", "Order placed", {
      orderId: order.id,
      sessionId,
      itemCount: order.items.length,
      total: Number(order.totalAmount),
    });

    return NextResponse.json(
      { order: serializeOrder(order), idempotent: false },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to place order";

    // Map known business errors to a stable client-localized `code`; never leak
    // a raw internal error.message.
    const businessErrors: Record<string, { code: string; status: number }> = {
      "Cart is empty": { code: "CART_EMPTY", status: 400 },
      "Some items are no longer available": { code: "ITEM_UNAVAILABLE", status: 400 },
      "Session is not active": { code: "SESSION_INACTIVE", status: 400 },
    };
    const known = businessErrors[message];
    if (known) {
      return NextResponse.json({ error: message, code: known.code }, { status: known.status });
    }

    // Unknown failure: log server-side, return a generic message (no internals).
    log.error("Order", "Order placement failed", { error: message, sessionId: sessionIdForLog });
    return NextResponse.json(
      { error: "Failed to place order", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

// Helper to serialize order for JSON response
function serializeOrder(order: {
  id: number;
  sessionId: string;
  status: string;
  totalAmount: unknown;
  createdAt: Date;
  items: Array<{
    id: number;
    menuItemId: number | null;
    quantity: number;
    unitPrice: unknown;
    selectedOptions: string;
    menuItem: {
      id: number;
      imageUrl: string | null;
      names: Array<{
        locale: string;
        name: string;
        description: string | null;
      }>;
    } | null;
  }>;
}) {
  return {
    id: order.id,
    sessionId: order.sessionId,
    status: order.status,
    totalAmount: Number(order.totalAmount),
    createdAt: order.createdAt,
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
            names: item.menuItem.names.map((n) => ({
              locale: n.locale,
              name: n.name,
              description: n.description,
            })),
          }
        : null,
    })),
  };
}
