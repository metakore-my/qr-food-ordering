import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { isMaintenanceMode } from "@/lib/maintenance";
import { routing } from "@/i18n/routing";
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/logger";

const updateQuantitySchema = z.object({
  quantity: z.number().int().min(0).max(99),
});

export async function PATCH(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ sessionId: string; itemId: string }> }
) {
  if (await isMaintenanceMode()) {
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
  }

  try {
    const { sessionId, itemId } = await params;
    const cartItemId = parseInt(itemId, 10);

    if (isNaN(cartItemId)) {
      return NextResponse.json(
        { error: "Invalid item ID" },
        { status: 400 }
      );
    }

    // Validate session_id cookie matches
    const cookieStore = await cookies();
    const cookieSessionId = cookieStore.get("session_id")?.value;

    if (!cookieSessionId || cookieSessionId !== sessionId) {
      return NextResponse.json(
        { error: "Unauthorized: session mismatch" },
        { status: 401 }
      );
    }

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

    const parsed = updateQuantitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { quantity } = parsed.data;

    // Find the cart item and verify it belongs to this session
    const cartItem = await prisma.cartItem.findUnique({
      where: { id: cartItemId },
    });

    const deviceId = cookieStore.get("device_id")?.value;
    if (!cartItem || cartItem.sessionId !== sessionId || cartItem.deviceId !== deviceId) {
      return NextResponse.json(
        { error: "Cart item not found" },
        { status: 404 }
      );
    }

    // If quantity <= 0, delete the item
    if (quantity <= 0) {
      await prisma.cartItem.delete({
        where: { id: cartItemId },
      });
      return NextResponse.json({ deleted: true });
    }

    // Scope the returned names to the client's active locale + canonical
    // fallback (the client renders one locale) — never all 6 (RSS driver).
    const { canonicalLocale } = await getSettings();
    const rawLocale = cookieStore.get("NEXT_LOCALE")?.value;
    const locale = (routing.locales as readonly string[]).includes(rawLocale ?? "")
      ? (rawLocale as string)
      : routing.defaultLocale;
    const localeFilter = Array.from(new Set([locale, canonicalLocale]));

    // Update quantity
    const updated = await prisma.cartItem.update({
      where: { id: cartItemId },
      data: { quantity },
      include: {
        menuItem: {
          include: { names: { where: { locale: { in: localeFilter } } } },
        },
      },
    });

    return NextResponse.json({
      id: updated.id,
      menuItemId: updated.menuItemId,
      quantity: updated.quantity,
      selectedOptions: JSON.parse(updated.selectedOptions),
      menuItem: {
        id: updated.menuItem.id,
        price: Number(updated.menuItem.price),
        isCombo: updated.menuItem.isCombo,
        comboBasePrice: updated.menuItem.comboBasePrice != null ? Number(updated.menuItem.comboBasePrice) : null,
        imageUrl: updated.menuItem.imageUrl,
        isAvailable: updated.menuItem.isAvailable,
        names: updated.menuItem.names.map((n) => ({
          locale: n.locale,
          name: n.name,
          description: n.description,
        })),
      },
    });
  } catch (error) {
    log.error("Cart", "Failed to update cart item", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to update cart item", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ sessionId: string; itemId: string }> }
) {
  if (await isMaintenanceMode()) {
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
  }

  try {
    const { sessionId, itemId } = await params;
    const cartItemId = parseInt(itemId, 10);

    if (isNaN(cartItemId)) {
      return NextResponse.json(
        { error: "Invalid item ID" },
        { status: 400 }
      );
    }

    // Validate session_id cookie matches
    const cookieStore = await cookies();
    const cookieSessionId = cookieStore.get("session_id")?.value;

    if (!cookieSessionId || cookieSessionId !== sessionId) {
      return NextResponse.json(
        { error: "Unauthorized: session mismatch" },
        { status: 401 }
      );
    }

    // Find the cart item and verify it belongs to this session
    const cartItem = await prisma.cartItem.findUnique({
      where: { id: cartItemId },
    });

    const deviceId = cookieStore.get("device_id")?.value;
    if (!cartItem || cartItem.sessionId !== sessionId || cartItem.deviceId !== deviceId) {
      return NextResponse.json(
        { error: "Cart item not found" },
        { status: 404 }
      );
    }

    await prisma.cartItem.delete({
      where: { id: cartItemId },
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    log.error("Cart", "Failed to delete cart item", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to delete cart item", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
