import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSessionExpired, setSessionCookie } from "@/lib/session";
import { cookies } from "next/headers";
import { isMaintenanceMode } from "@/lib/maintenance";
import { log } from "@/lib/logger";
import { getSettings } from "@/lib/settings";
import { placeOrder, PriceChangedError } from "@/lib/place-order";

const placeOrderSchema = z.object({
  // Bounded: sessionId is a cuid (~25 chars) and idempotencyKey a client UUID
  // (36). idempotencyKey becomes an in-memory Map key held for 60s — the store
  // caps entry COUNT but not entry SIZE, so without a length cap a flood of
  // megabyte keys is heap pressure. 128 covers any reasonable id.
  sessionId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(128),
  // The grand total the customer SAW in the cart when they tapped "Place Order".
  // The server recomputes the live total inside the transaction; if it differs
  // (an admin changed a price between cart-view and placement), the order is
  // rejected with 409 PRICE_CHANGED so the customer re-consents to the new
  // amount instead of being silently charged a price they never saw. Optional
  // for backward compatibility — an omitted value skips the check.
  expectedTotal: z.number().nonnegative().optional(),
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

  // Hoisted for the outer catch's error log + the dead-option-ref prune
  // (assigned once the body/cookies are parsed).
  let sessionIdForLog: string | undefined;
  let deviceIdForPrune: string | undefined;

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

    const { sessionId, idempotencyKey, expectedTotal } = parsed.data;
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
    deviceIdForPrune = deviceId;

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
              // Canonical-locale dish name → snapshotted onto the order line
              // (itemName) so a later rename/delete can't rewrite history.
              names: { where: { locale: s.canonicalLocale } },
              optionGroups: {
                include: {
                  names: { where: { locale: { in: s.enabledLocales } } },
                  choices: {
                    include: {
                      names: { where: { locale: { in: s.enabledLocales } } },
                    },
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

      // Snapshot + price + guard + create + touch are shared with the staff
      // order route via placeOrder(), so the two paths can't drift. It throws
      // PriceChangedError (→ 409 PRICE_CHANGED in the outer catch) on a price
      // mismatch and "Some options are no longer available" (→ dead-option
      // prune + OPTION_UNAVAILABLE) on a deleted option group/choice ref.
      const newOrder = await placeOrder(tx, {
        session: { id: sessionId },
        lines: cartItems.map((ci) => ({
          menuItem: ci.menuItem,
          quantity: ci.quantity,
          selectedOptions: ci.selectedOptions,
        })),
        expectedTotal,
        settings: s,
      });

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

    // Refresh the session_id cookie's 4h window — placing an order bumped
    // session.updatedAt (inside the tx), so the cookie's sliding expiry must
    // follow it. The session stays ACTIVE for more ordering after this; without
    // the refresh a long table is logged out at hour-4-from-scan. See
    // lib/session.ts.
    setSessionCookie(cookieStore, sessionId);

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
    // Price changed between cart-view and placement: return the new total so the
    // client can show it and ask the customer to re-confirm. Not a server error
    // and not an internal leak — the new total is the customer's own data.
    if (error instanceof PriceChangedError) {
      log.info("Order", "Price changed before placement", {
        sessionId: sessionIdForLog,
        newTotal: error.newTotal,
      });
      return NextResponse.json(
        { error: "Price changed", code: "PRICE_CHANGED", newTotal: error.newTotal },
        { status: 409 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to place order";

    // A cart line referenced a deleted option group/choice. The tx rolled back
    // (cart rows restored), so self-heal here: prune the dead refs from this
    // device's cart rows. The client refetches on OPTION_UNAVAILABLE and the
    // customer re-confirms the cart WITHOUT the vanished option — explicit
    // re-consent instead of a silently altered order (mirrors PRICE_CHANGED).
    if (
      message === "Some options are no longer available" &&
      sessionIdForLog &&
      deviceIdForPrune
    ) {
      try {
        await pruneDeadOptionRefs(sessionIdForLog, deviceIdForPrune);
      } catch (pruneError) {
        // Non-fatal: the next placement attempt just rejects again.
        log.warn("Order", "Dead-option-ref prune failed", {
          sessionId: sessionIdForLog,
          error: pruneError instanceof Error ? pruneError.message : "unknown",
        });
      }
    }

    // Map known business errors to a stable client-localized `code`; never leak
    // a raw internal error.message.
    const businessErrors: Record<string, { code: string; status: number }> = {
      "Cart is empty": { code: "CART_EMPTY", status: 400 },
      "Some items are no longer available": { code: "ITEM_UNAVAILABLE", status: 400 },
      "Some options are no longer available": { code: "OPTION_UNAVAILABLE", status: 400 },
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

/**
 * Remove references to deleted option groups/choices from a device's cart rows.
 * Called after a placement was rejected with OPTION_UNAVAILABLE (outside the
 * rolled-back transaction): without the prune, the stale refs in
 * `CartItem.selectedOptions` would make every subsequent placement reject too —
 * an unrecoverable loop. After it, the refetched cart renders without the
 * vanished option and the customer's next tap places the pruned cart.
 */
async function pruneDeadOptionRefs(
  sessionId: string,
  deviceId: string
): Promise<void> {
  const rows = await prisma.cartItem.findMany({
    where: { sessionId, deviceId },
    include: {
      menuItem: {
        include: {
          optionGroups: { include: { choices: { select: { id: true } } } },
        },
      },
    },
  });

  for (const row of rows) {
    let sels: unknown;
    try {
      sels = JSON.parse(row.selectedOptions);
    } catch {
      continue;
    }
    if (!Array.isArray(sels)) continue;

    const pruned = (sels as Array<{ groupId: number; choiceIds: number[] }>)
      .map((sel) => {
        const group = row.menuItem.optionGroups.find((g) => g.id === sel.groupId);
        if (!group) return null;
        const validChoiceIds = sel.choiceIds.filter((cid) =>
          group.choices.some((c) => c.id === cid)
        );
        return validChoiceIds.length > 0
          ? { groupId: sel.groupId, choiceIds: validChoiceIds }
          : null;
      })
      .filter((sel): sel is { groupId: number; choiceIds: number[] } => sel !== null);

    const next = JSON.stringify(pruned);
    if (next !== row.selectedOptions) {
      await prisma.cartItem.update({
        where: { id: row.id },
        data: { selectedOptions: next },
      });
    }
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
    itemName: string | null;
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
      itemName: item.itemName,
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
