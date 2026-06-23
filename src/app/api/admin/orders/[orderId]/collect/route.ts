import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { settlementMode } from "@/lib/takeaway-settlement";
import { log } from "@/lib/logger";

// "Mark collected" — settles a TABLE-LESS (counter takeaway) session's single
// order. A table-bound takeaway settles via the table-QR checkout instead
// (settlement is chosen by table PRESENCE, see src/lib/takeaway-settlement.ts).
//
// COMPLETED is checkout-only: this route sets COMPLETED via a direct
// `updateMany` (mirroring /api/sessions/[sessionId]/checkout), NEVER through the
// order-PATCH transition map (which deliberately excludes COMPLETED). See
// .claude/rules/security-hardening.md "Race-Condition Guards".
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const authSession = await auth();
  if (!authSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    !hasPermission(
      authSession.user.role,
      authSession.user.permissions ?? [],
      "orders"
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orderId = Number((await params).orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json(
      { error: "Invalid order id", code: "ORDER_NOT_FOUND" },
      { status: 404 }
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          sessionId: true,
          session: { select: { tableId: true } },
        },
      });
      if (!order) throw new Error("ORDER_NOT_FOUND");
      // A table-bound takeaway settles with the table QR (sweeps the whole
      // session), not per-order here. `settlementMode` is the single source of
      // truth for the table-presence → settlement-path decision (shared with the
      // decline path so the two can't drift).
      if (settlementMode(order.session) !== "order") {
        throw new Error("USE_TABLE_CHECKOUT");
      }
      // Must be confirmed before collecting — mirrors checkout requiring
      // confirmed orders.
      if (order.status !== "CONFIRMED") throw new Error("ORDER_NOT_CONFIRMED");

      // Lock the session row FOR UPDATE so collect serializes against a
      // concurrent placement on the same session (matches the checkout flow).
      await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${order.sessionId} FOR UPDATE`;

      // COMPLETED via direct updateMany — bypasses the transition map by design.
      // INVARIANT: a table-less session holds exactly ONE order (counter takeaway
      // is one-shot per ticket — the staff route creates a fresh table-less
      // session per placement). So completing this order + checking out the
      // session settles everything. If a future change ever attaches a second
      // order to a table-less session, this must complete all of them.
      await tx.order.updateMany({
        where: { id: orderId, status: "CONFIRMED" },
        data: { status: "COMPLETED" },
      });
      await tx.session.update({
        where: { id: order.sessionId },
        data: { status: "CHECKED_OUT" },
      });
      await tx.cartItem.deleteMany({ where: { sessionId: order.sessionId } });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "SERVER_ERROR";
    const map: Record<string, number> = {
      ORDER_NOT_FOUND: 404,
      USE_TABLE_CHECKOUT: 400,
      ORDER_NOT_CONFIRMED: 400,
    };
    if (map[msg]) {
      return NextResponse.json({ error: msg, code: msg }, { status: map[msg] });
    }
    log.error("CollectOrder", "collect failed", { orderId, error: msg });
    return NextResponse.json(
      { error: "Failed to collect order", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
