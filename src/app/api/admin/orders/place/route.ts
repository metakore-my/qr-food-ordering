import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { isMaintenanceMode } from "@/lib/maintenance";
import { getSettings } from "@/lib/settings";
import { signTableToken } from "@/lib/qr";
import { getOrCreateSession, isSessionExpired } from "@/lib/session";
import { placeOrder, PriceChangedError } from "@/lib/place-order";
import { staffPlaceOrderSchema } from "@/lib/validations";
import { validateSelectedOptions } from "@/lib/option-utils";
import { log } from "@/lib/logger";

// Idempotency store, globalThis-guarded (single-instance model, same as the
// customer order route). Key reserved with -1 placeholder during the tx.
const globalForStaffOrders = globalThis as unknown as {
  staffOrderIdempotency?: Map<string, { orderId: number; timestamp: number }>;
};
const idempotencyStore =
  globalForStaffOrders.staffOrderIdempotency ??
  (globalForStaffOrders.staffOrderIdempotency = new Map<string, { orderId: number; timestamp: number }>());
const IDEMPOTENCY_TTL_MS = 60_000;
const MAX_STORE = 1_000;

function cleanupIdempotency() {
  const now = Date.now();
  for (const [k, v] of idempotencyStore.entries()) {
    if (now - v.timestamp > IDEMPOTENCY_TTL_MS) idempotencyStore.delete(k);
  }
  if (idempotencyStore.size > MAX_STORE) {
    const sorted = Array.from(idempotencyStore.entries()).sort(([, a], [, b]) => a.timestamp - b.timestamp);
    for (const [k] of sorted.slice(0, Math.floor(sorted.length / 2))) idempotencyStore.delete(k);
  }
}

export async function POST(req: NextRequest) {
  if (await isMaintenanceMode()) {
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
  }

  // AuthN + AuthZ: staff must be logged in and hold the `orders` permission
  // (same gate as the kitchen board + checkout scanner). No Turnstile and no
  // per-session rate-limit here by design — staff place several legit orders
  // fast, and the permission is the gate.
  const authSession = await auth();
  if (!authSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(authSession.user.role, authSession.user.permissions ?? [], "orders")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = staffPlaceOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }
  const { orderType, tableNumber, customerName, idempotencyKey, expectedTotal, lines } = parsed.data;

  const s = await getSettings();

  // Enforce the takeaway feature flag server-side, not just in the UI (the
  // order-entry toggle is hidden when off, but the API is the security boundary
  // — mirrors how R2/Turnstile/OpenRouter gate both surfaces). An `orders`
  // staffer must not be able to create a takeaway order on a deploy that hasn't
  // enabled the feature.
  if (orderType === "TAKEAWAY" && !s.takeawayEnabled) {
    return NextResponse.json(
      { error: "Takeaway orders are disabled", code: "TAKEAWAY_DISABLED" },
      { status: 403 }
    );
  }

  // Idempotency before any work — a same-key retry returns the original order.
  cleanupIdempotency();
  const existing = idempotencyStore.get(idempotencyKey);
  if (existing) {
    if (existing.orderId === -1) {
      log.info("StaffOrder", "Idempotent in-flight reject", { idempotencyKey });
      return NextResponse.json(
        { error: "An order with this request is already being processed.", code: "ORDER_IN_PROGRESS" },
        { status: 409 }
      );
    }
    log.info("StaffOrder", "Idempotent hit", { idempotencyKey, orderId: existing.orderId });
    return NextResponse.json({ orderId: existing.orderId, idempotent: true });
  }

  try {
    // Resolve the session. Two shapes:
    //  - table number given (dine-in OR a seated party's takeaway): reuse
    //    getOrCreateSession (verifies token, locks the tables row, find-or-creates
    //    the ACTIVE session) exactly as before.
    //  - no table number (counter takeaway): create a fresh table-LESS session.
    let session: { id: string };
    if (tableNumber != null) {
      const table = await prisma.table.findFirst({
        where: { number: tableNumber, isActive: true },
      });
      if (!table) {
        return NextResponse.json(
          { error: "Table not found or inactive", code: "TABLE_NOT_FOUND" },
          { status: 404 }
        );
      }
      const signedToken = signTableToken(table.id, table.token);
      ({ session } = await getOrCreateSession(signedToken));
    } else {
      // Counter takeaway: one-shot per ticket → a brand-new table-less session.
      // No tables row to lock (there is none) — nothing to serialize against.
      session = await prisma.session.create({ data: { tableId: null } });
    }

    // Reserve the idempotency key with the -1 placeholder. NOTE: this get/set is
    // NOT atomic — a genuine CONCURRENT same-key request in the window between the
    // earlier check and this set could slip through (TOCTOU). The customer order
    // route's authoritative duplicate guard is the DB cart-claim (deleteMany+count);
    // this route has NO cart to claim, so on a true concurrent double-submit both
    // requests can create orders (they serialize on the session FOR UPDATE lock, but
    // nothing makes the second bail). Accepted by design: staff placements are
    // deliberate single actions, the client adds a useRef submit-lock, and the
    // realistic case (a network retry, not true concurrency) is handled correctly by
    // the -1 / real-id lifecycle. Do NOT assume idempotency is airtight here.
    idempotencyStore.set(idempotencyKey, { orderId: -1, timestamp: Date.now() });

    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
        // (A) Lock + re-validate the session from the locked read (not the
        // REPEATABLE-READ snapshot) — same guard the customer route uses.
        const locked = await tx.$queryRaw<Array<{ id: string; status: string; updatedAt: Date }>>`
          SELECT id, status, updatedAt FROM sessions WHERE id = ${session.id} FOR UPDATE`;
        const txSession = locked[0];
        if (!txSession || txSession.status !== "ACTIVE" || isSessionExpired(txSession.updatedAt)) {
          throw new Error("Session is not active");
        }

        // Resolve each payload line to a full menu item with options + names.
        const menuItemIds = Array.from(new Set(lines.map((l) => l.menuItemId)));
        const items = await tx.menuItem.findMany({
          where: { id: { in: menuItemIds } },
          include: {
            names: { where: { locale: s.canonicalLocale } },
            optionGroups: {
              include: {
                names: { where: { locale: { in: s.enabledLocales } } },
                choices: { include: { names: { where: { locale: { in: s.enabledLocales } } } } },
              },
            },
          },
        });
        const itemMap = new Map(items.map((it) => [it.id, it]));

        // (C) Resolve + validate availability before placeOrder.
        const resolvedLines = lines.map((line) => {
          const menuItem = itemMap.get(line.menuItemId);
          if (!menuItem) throw new Error("Some items are no longer available");
          if (!menuItem.isAvailable) throw new Error("Some items are no longer available");

          // Same server-side option validation the customer cart-add route runs
          // (the API is the security boundary; the picker UI enforcing it is not
          // enough). Shared validator → the two paths can't drift.
          const check = validateSelectedOptions(menuItem.optionGroups, line.selectedOptions);
          if (!check.ok) throw new Error("INVALID_OPTIONS");

          // Dedup choiceIds (a repeated choice in a MULTIPLE group must count
          // once — else its priceAdjustment is summed N times). Mirrors the
          // customer cart-add route.
          const normalized = line.selectedOptions.map((sel) => ({
            groupId: sel.groupId,
            choiceIds: [...new Set(sel.choiceIds)],
          }));

          return { menuItem, quantity: line.quantity, selectedOptions: JSON.stringify(normalized) };
        });

        // Snapshot + price + guard + create + touch (shared with customer route).
        return placeOrder(tx, {
          session: { id: session.id },
          lines: resolvedLines,
          expectedTotal,
          settings: s,
          orderType,
          customerName: orderType === "TAKEAWAY" ? (customerName ?? null) : null,
        });
      });
    } catch (txError) {
      idempotencyStore.delete(idempotencyKey);
      throw txError;
    }

    idempotencyStore.set(idempotencyKey, { orderId: order.id, timestamp: Date.now() });

    log.info("StaffOrder", "Staff order placed", {
      orderId: order.id,
      orderType,
      tableNumber: tableNumber ?? null,
      itemCount: order.items.length,
      total: Number(order.totalAmount),
    });

    return NextResponse.json({ orderId: order.id, idempotent: false }, { status: 201 });
  } catch (error) {
    if (error instanceof PriceChangedError) {
      return NextResponse.json(
        { error: "Price changed", code: "PRICE_CHANGED", newTotal: error.newTotal },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to place order";
    const businessErrors: Record<string, { code: string; status: number }> = {
      "Some items are no longer available": { code: "ITEM_UNAVAILABLE", status: 400 },
      "Some options are no longer available": { code: "OPTION_UNAVAILABLE", status: 400 },
      "INVALID_OPTIONS": { code: "INVALID_OPTIONS", status: 400 },
      "Session is not active": { code: "SESSION_INACTIVE", status: 400 },
      "Invalid or inactive table": { code: "TABLE_NOT_FOUND", status: 404 }, // only on a deactivation race between the findFirst pre-check and getOrCreateSession
    };
    const known = businessErrors[message];
    if (known) {
      return NextResponse.json({ error: message, code: known.code }, { status: known.status });
    }
    log.error("StaffOrder", "Staff order placement failed", { error: message, orderType, tableNumber: tableNumber ?? null });
    return NextResponse.json({ error: "Failed to place order", code: "SERVER_ERROR" }, { status: 500 });
  }
}
