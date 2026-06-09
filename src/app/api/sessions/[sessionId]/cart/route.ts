import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSessionExpired } from "@/lib/session";
import { cookies } from "next/headers";
import { isMaintenanceMode } from "@/lib/maintenance";
import { routing } from "@/i18n/routing";
import { getSettings } from "@/lib/settings";

/**
 * Locale filter for translation includes: [active cookie locale, canonical].
 * This polled path renders only those two, and fetching all 6 is the documented
 * RSS driver. Mirrors the sibling order-status route.
 */
function resolveLocaleFilter(
  rawLocale: string | undefined,
  canonicalLocale: string
): string[] {
  const locale = (routing.locales as readonly string[]).includes(rawLocale ?? "")
    ? (rawLocale as string)
    : routing.defaultLocale;
  return Array.from(new Set([locale, canonicalLocale]));
}

const selectedOptionSchema = z.object({
  groupId: z.number().int().positive(),
  choiceIds: z.array(z.number().int().positive()).min(1),
});

const addToCartSchema = z.object({
  menuItemId: z.number().int().positive(),
  quantity: z.number().int().positive().max(99),
  selectedOptions: z.array(selectedOptionSchema).optional().default([]),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

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

    const { canonicalLocale } = await getSettings();
    const localeFilter = resolveLocaleFilter(cookieStore.get("NEXT_LOCALE")?.value, canonicalLocale);

    const cartItems = await prisma.cartItem.findMany({
      where: { sessionId, deviceId },
      include: {
        menuItem: {
          include: {
            names: { where: { locale: { in: localeFilter } } },
            optionGroups: {
              orderBy: { sortOrder: "asc" },
              include: {
                names: { where: { locale: { in: localeFilter } } },
                choices: {
                  orderBy: { sortOrder: "asc" },
                  include: { names: { where: { locale: { in: localeFilter } } } },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const items = cartItems.map((ci) => ({
      id: ci.id,
      menuItemId: ci.menuItemId,
      quantity: ci.quantity,
      selectedOptions: JSON.parse(ci.selectedOptions),
      menuItem: {
        id: ci.menuItem.id,
        price: Number(ci.menuItem.price),
        isCombo: ci.menuItem.isCombo,
        comboBasePrice: ci.menuItem.comboBasePrice != null ? Number(ci.menuItem.comboBasePrice) : null,
        imageUrl: ci.menuItem.imageUrl,
        isAvailable: ci.menuItem.isAvailable,
        names: ci.menuItem.names.map((n) => ({
          locale: n.locale,
          name: n.name,
          description: n.description,
        })),
        optionGroups: ci.menuItem.optionGroups.map((g) => ({
          id: g.id,
          selectionType: g.selectionType,
          isRequired: g.isRequired,
          sortOrder: g.sortOrder,
          names: g.names,
          choices: g.choices.map((c) => ({
            id: c.id,
            priceAdjustment: Number(c.priceAdjustment),
            sortOrder: c.sortOrder,
            names: c.names,
          })),
        })),
      },
    }));

    return NextResponse.json({ items });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get cart";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  if (await isMaintenanceMode()) {
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
  }

  try {
    const { sessionId } = await params;

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

    const { canonicalLocale } = await getSettings();
    const localeFilter = resolveLocaleFilter(cookieStore.get("NEXT_LOCALE")?.value, canonicalLocale);

    // Validate session is ACTIVE
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    if (session.status !== "ACTIVE" || isSessionExpired(session.updatedAt)) {
      return NextResponse.json(
        { error: "Session is not active" },
        { status: 400 }
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

    const parsed = addToCartSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { menuItemId, quantity, selectedOptions } = parsed.data;

    // Validate menu item exists and is available, include option groups for validation
    const menuItem = await prisma.menuItem.findUnique({
      where: { id: menuItemId },
      include: {
        optionGroups: {
          include: { choices: true },
        },
      },
    });

    if (!menuItem) {
      return NextResponse.json(
        { error: "Menu item not found" },
        { status: 404 }
      );
    }

    if (!menuItem.isAvailable) {
      return NextResponse.json(
        { error: "Menu item is not available" },
        { status: 400 }
      );
    }

    // Validate selected options against menu item's option groups
    if (menuItem.optionGroups.length > 0 || selectedOptions.length > 0) {
      const groupMap = new Map(
        menuItem.optionGroups.map((g) => [g.id, g])
      );

      // Verify all required groups have selections
      for (const group of menuItem.optionGroups) {
        const selection = selectedOptions.find((s) => s.groupId === group.id);
        if (group.isRequired && !selection) {
          return NextResponse.json(
            { error: `Required option group ${group.id} is missing` },
            { status: 400 }
          );
        }
      }

      // Verify all selections reference valid groups and choices
      for (const sel of selectedOptions) {
        const group = groupMap.get(sel.groupId);
        if (!group) {
          return NextResponse.json(
            { error: `Option group ${sel.groupId} not found on this item` },
            { status: 400 }
          );
        }

        // SINGLE selection: exactly 1 choice
        if (group.selectionType === "SINGLE" && sel.choiceIds.length !== 1) {
          return NextResponse.json(
            { error: `Single-choice group ${sel.groupId} must have exactly 1 choice` },
            { status: 400 }
          );
        }

        // Verify all choiceIds belong to this group
        const validChoiceIds = new Set(group.choices.map((c) => c.id));
        for (const cid of sel.choiceIds) {
          if (!validChoiceIds.has(cid)) {
            return NextResponse.json(
              { error: `Choice ${cid} not found in group ${sel.groupId}` },
              { status: 400 }
            );
          }
        }
      }
    }

    // Serialize selectedOptions for storage and comparison (sorted for stable dedup)
    const optionsJson = JSON.stringify(
      [...selectedOptions]
        .sort((a, b) => a.groupId - b.groupId)
        .map((s) => ({
          groupId: s.groupId,
          choiceIds: [...s.choiceIds].sort((a, b) => a - b),
        }))
    );

    // Dedup: find existing cart item with same menuItemId AND same selectedOptions
    // Wrapped in a transaction to prevent two concurrent "add same item" requests
    // from both creating separate rows instead of merging quantities.
    const cartItem = await prisma.$transaction(async (tx) => {
      // Adding to the cart is customer activity — touch the session so the 4h
      // TTL acts as an inactivity timer (the @updatedAt field refreshes on any
      // update), not a hard 4h-from-creation cap. See lib/session.ts.
      await tx.session.update({ where: { id: sessionId }, data: {} });

      const existingCartItems = await tx.cartItem.findMany({
        where: { sessionId, deviceId, menuItemId },
      });

      const existing = existingCartItems.find(
        (ci) => ci.selectedOptions === optionsJson
      );

      if (existing) {
        const newQuantity = existing.quantity + quantity;
        if (newQuantity > 99) {
          throw new Error("MAX_QUANTITY");
        }
        return tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: newQuantity },
          include: {
            menuItem: {
              include: {
                names: { where: { locale: { in: localeFilter } } },
                optionGroups: {
                  orderBy: { sortOrder: "asc" },
                  include: {
                    names: { where: { locale: { in: localeFilter } } },
                    choices: {
                      orderBy: { sortOrder: "asc" },
                      include: { names: { where: { locale: { in: localeFilter } } } },
                    },
                  },
                },
              },
            },
          },
        });
      }

      return tx.cartItem.create({
        data: {
          sessionId,
          deviceId,
          menuItemId,
          quantity,
          selectedOptions: optionsJson,
        },
        include: {
          menuItem: {
            include: {
              names: { where: { locale: { in: localeFilter } } },
              optionGroups: {
                orderBy: { sortOrder: "asc" },
                include: {
                  names: { where: { locale: { in: localeFilter } } },
                  choices: {
                    orderBy: { sortOrder: "asc" },
                    include: { names: { where: { locale: { in: localeFilter } } } },
                  },
                },
              },
            },
          },
        },
      });
    });

    const wasExisting = cartItem.quantity !== quantity;

    return NextResponse.json(
      {
        id: cartItem.id,
        menuItemId: cartItem.menuItemId,
        quantity: cartItem.quantity,
        selectedOptions: JSON.parse(cartItem.selectedOptions),
        menuItem: {
          id: cartItem.menuItem.id,
          price: Number(cartItem.menuItem.price),
          isCombo: cartItem.menuItem.isCombo,
          comboBasePrice: cartItem.menuItem.comboBasePrice != null ? Number(cartItem.menuItem.comboBasePrice) : null,
          imageUrl: cartItem.menuItem.imageUrl,
          isAvailable: cartItem.menuItem.isAvailable,
          names: cartItem.menuItem.names.map((n) => ({
            locale: n.locale,
            name: n.name,
            description: n.description,
          })),
          optionGroups: cartItem.menuItem.optionGroups.map((g) => ({
            id: g.id,
            selectionType: g.selectionType,
            isRequired: g.isRequired,
            sortOrder: g.sortOrder,
            names: g.names,
            choices: g.choices.map((c) => ({
              id: c.id,
              priceAdjustment: Number(c.priceAdjustment),
              sortOrder: c.sortOrder,
              names: c.names,
            })),
          })),
        },
      },
      { status: wasExisting ? 200 : 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to add to cart";
    if (message === "MAX_QUANTITY") {
      return NextResponse.json(
        { error: "Maximum quantity per item is 99" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
