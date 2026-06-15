import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";

const updateItemSchema = z.object({
  quantity: z.number().int().min(0).max(99),
});

export async function PATCH(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ orderId: string; itemId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "orders")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { orderId, itemId } = await params;
  const orderIdNum = parseInt(orderId, 10);
  const itemIdNum = parseInt(itemId, 10);

  if (isNaN(orderIdNum) || isNaN(itemIdNum)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = updateItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { quantity } = parsed.data;

  // Canonical locale for the response name include (admin doesn't render
  // localized names here) — read before the transaction.
  const { canonicalLocale } = await getSettings();

  // All reads and writes run inside one transaction that locks the Order row
  // FOR UPDATE first, so concurrent edits to different items of the same order
  // serialize: status is validated under the lock (no editing a just-finalized
  // order), the total is recomputed from a fresh in-transaction read (no
  // lost-update), and the "last item" check can't race two qty→0 edits into an
  // orphaned zero-item order.
  let result: { deleted: true; orderId: number } | { deleted: false; order: Parameters<typeof serializeOrder>[0] };
  try {
    result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: number; status: string }>>`
        SELECT id, status FROM orders WHERE id = ${orderIdNum} FOR UPDATE
      `;
      if (!locked[0]) {
        throw new Error("ORDER_NOT_FOUND");
      }
      // Guard under the lock: only PENDING or CONFIRMED orders are editable.
      if (locked[0].status !== "PENDING" && locked[0].status !== "CONFIRMED") {
        throw new Error("ORDER_NOT_EDITABLE");
      }

      // Re-read items inside the transaction (current, not a stale snapshot).
      const items = await tx.orderItem.findMany({ where: { orderId: orderIdNum } });
      const target = items.find((i) => i.id === itemIdNum);
      if (!target) {
        throw new Error("ITEM_NOT_FOUND");
      }

      // Removing the last remaining item deletes the whole order.
      if (quantity === 0 && items.length === 1) {
        await tx.order.delete({ where: { id: orderIdNum } });
        return { deleted: true as const, orderId: orderIdNum };
      }

      if (quantity === 0) {
        await tx.orderItem.delete({ where: { id: itemIdNum } });
      } else {
        await tx.orderItem.update({ where: { id: itemIdNum }, data: { quantity } });
      }

      // Recompute the total from the post-mutation in-transaction state.
      const remaining = await tx.orderItem.findMany({ where: { orderId: orderIdNum } });
      const newTotal = remaining.reduce(
        (sum, i) => sum + Number(i.unitPrice) * i.quantity,
        0
      );

      const order = await tx.order.update({
        where: { id: orderIdNum },
        data: { totalAmount: newTotal },
        include: {
          items: {
            include: {
              // Scope to the canonical locale — the admin response doesn't render
              // localized names here; never fetch all 6 locales (RSS rule).
              menuItem: { include: { names: { where: { locale: canonicalLocale } } } },
            },
          },
          session: {
            include: {
              table: { select: { id: true, number: true } },
            },
          },
        },
      });

      return { deleted: false as const, order };
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ORDER_NOT_FOUND" || code === "ITEM_NOT_FOUND") {
      return NextResponse.json({ error: "Order item not found" }, { status: 404 });
    }
    if (code === "ORDER_NOT_EDITABLE") {
      return NextResponse.json(
        { error: "Cannot edit items on a completed or declined order" },
        { status: 400 }
      );
    }
    throw error;
  }

  if (result.deleted) {
    return NextResponse.json({ deleted: true, orderId: result.orderId });
  }
  return NextResponse.json({
    deleted: false,
    order: serializeOrder(result.order),
  });
}

function serializeOrder(order: {
  id: number;
  sessionId: string;
  status: string;
  totalAmount: unknown;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: number;
    menuItemId: number | null;
    quantity: number;
    unitPrice: unknown;
    selectedOptions: string;
    menuItem: {
      id: number;
      imageUrl: string | null;
      names: Array<{ locale: string; name: string; description: string | null }>;
    } | null;
  }>;
  session: {
    id: string;
    tableId: number;
    status: string;
    table: { id: number; number: number };
  };
}) {
  return {
    id: order.id,
    sessionId: order.sessionId,
    status: order.status,
    totalAmount: Number(order.totalAmount),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
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
            names: item.menuItem.names,
          }
        : null,
    })),
    session: {
      id: order.session.id,
      tableId: order.session.tableId,
      status: order.session.status,
      table: order.session.table,
    },
  };
}
