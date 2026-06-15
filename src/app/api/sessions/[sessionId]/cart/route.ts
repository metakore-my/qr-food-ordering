import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSessionExpired, setSessionCookie } from "@/lib/session";
import { cookies } from "next/headers";
import { isMaintenanceMode } from "@/lib/maintenance";
import { routing } from "@/i18n/routing";
import { getSettings } from "@/lib/settings";
import { MAX_OPTION_GROUPS, MAX_OPTION_CHOICES } from "@/lib/validations";
import { validateSelectedOptions } from "@/lib/option-utils";
import { log } from "@/lib/logger";

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

// Caps mirror the menu-write limits (MAX_OPTION_GROUPS / MAX_OPTION_CHOICES):
// a cart line can't reference more option groups than an item can have, nor more
// choices in one group than the group can hold. Bounds the validation loop and
// the stored payload against an oversized request.
const selectedOptionSchema = z.object({
  groupId: z.number().int().positive(),
  choiceIds: z.array(z.number().int().positive()).min(1).max(MAX_OPTION_CHOICES),
});

const addToCartSchema = z.object({
  menuItemId: z.number().int().positive(),
  quantity: z.number().int().positive().max(99),
  selectedOptions: z.array(selectedOptionSchema).max(MAX_OPTION_GROUPS).optional().default([]),
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
    log.error("Cart", "Failed to get cart", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to get cart", code: "SERVER_ERROR" },
      { status: 500 }
    );
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

    // Validate selected options against the item's option groups via the shared
    // validator (single source of truth — the staff order route runs the same
    // check, so the two paths can't drift). Map the result to the existing 400s.
    const optionCheck = validateSelectedOptions(menuItem.optionGroups, selectedOptions);
    if (!optionCheck.ok) {
      const messages: Record<string, string> = {
        REQUIRED_MISSING: `Required option group ${optionCheck.groupId} is missing`,
        GROUP_NOT_FOUND: `Option group ${optionCheck.groupId} not found on this item`,
        SINGLE_CARDINALITY: `Single-choice group ${optionCheck.groupId} must have exactly 1 choice`,
        CHOICE_NOT_FOUND: `Choice ${optionCheck.choiceId} not found in group ${optionCheck.groupId}`,
      };
      return NextResponse.json({ error: messages[optionCheck.reason] }, { status: 400 });
    }

    // Serialize selectedOptions for storage and comparison (sorted for stable
    // dedup). choiceIds are de-duplicated here: the membership check above only
    // verifies each id belongs to the group, NOT that it appears once, so a
    // payload like `choiceIds: [5, 5, 5]` for a MULTIPLE group would otherwise be
    // stored verbatim and the order-placement loop (which sums priceAdjustment
    // per occurrence) would charge the +adjustment three times. Collapsing to a
    // Set makes a repeated choice count exactly once. SINGLE groups are already
    // capped at length 1 above, so this only matters for MULTIPLE.
    const optionsJson = JSON.stringify(
      [...selectedOptions]
        .sort((a, b) => a.groupId - b.groupId)
        .map((s) => ({
          groupId: s.groupId,
          choiceIds: [...new Set(s.choiceIds)].sort((a, b) => a - b),
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

    // Refresh the session_id cookie's 4h window — adding to cart bumped
    // session.updatedAt (above), so the cookie's sliding expiry must follow,
    // otherwise an actively-ordering party is logged out at hour-4-from-scan
    // even though their DB session is still alive. See lib/session.ts.
    setSessionCookie(cookieStore, sessionId);

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
        { error: "Maximum quantity per item is 99", code: "MAX_QUANTITY" },
        { status: 400 }
      );
    }
    log.error("Cart", "Failed to add to cart", { error: message });
    return NextResponse.json(
      { error: "Failed to add to cart", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
