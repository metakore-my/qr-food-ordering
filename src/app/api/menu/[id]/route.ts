import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { deleteR2Object } from "@/lib/r2";
import { SUPPORTED_LOCALES, translationSchema, optionGroupSchema, findInvalidPriceField, priceSchema, MAX_PRICE, MAX_OPTION_GROUPS } from "@/lib/validations";
import { invalidateMenuCache } from "@/lib/menu-cache";
import { getSettings } from "@/lib/settings";

const updateMenuItemSchema = z.object({
  categoryId: z.number().int().positive().optional(),
  price: priceSchema.optional(),
  imageUrl: z.string().url().max(500).optional().nullable(),
  isAvailable: z.boolean().optional(),
  isCombo: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  comboBasePrice: z.number().min(0).max(MAX_PRICE).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  translations: z
    .record(z.enum(SUPPORTED_LOCALES), translationSchema.optional())
    .optional(),
  optionGroups: z.array(optionGroupSchema).max(MAX_OPTION_GROUPS).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "menu")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return NextResponse.json(
      { error: "Invalid menu item ID" },
      { status: 400 }
    );
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

  const parsed = updateMenuItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // Currency-decimals price check (mirrors the create route) — zod can't
  // enforce it since decimals is a runtime setting.
  const { decimals } = await getSettings();
  const badPriceField = findInvalidPriceField(parsed.data, decimals);
  if (badPriceField) {
    return NextResponse.json(
      { error: `${badPriceField} must have at most ${decimals} decimal places` },
      { status: 400 }
    );
  }

  const existing = await prisma.menuItem.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json(
      { error: "Menu item not found" },
      { status: 404 }
    );
  }

  const { categoryId, price, imageUrl, isAvailable, isCombo, isFeatured, comboBasePrice, sortOrder, translations, optionGroups } =
    parsed.data;

  // Verify new category exists if changing
  if (categoryId !== undefined) {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 }
      );
    }
  }

  // Delete old R2 image if being replaced or cleared
  if (imageUrl !== undefined && existing.imageUrl && existing.imageUrl !== imageUrl) {
    await deleteR2Object(existing.imageUrl);
  }

  // Build update data
  const updateData: Record<string, unknown> = {};
  if (categoryId !== undefined) updateData.categoryId = categoryId;
  if (price !== undefined) updateData.price = price;
  if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
  if (isAvailable !== undefined) updateData.isAvailable = isAvailable;
  if (isCombo !== undefined) updateData.isCombo = isCombo;
  if (isFeatured !== undefined) updateData.isFeatured = isFeatured;
  if (comboBasePrice !== undefined) updateData.comboBasePrice = comboBasePrice;
  if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

  // Update menu item fields
  await prisma.menuItem.update({
    where: { id },
    data: updateData,
  });

  // Upsert translations if provided (parallel to avoid N+1)
  if (translations) {
    const defined = Object.entries(translations).filter(
      (entry): entry is [string, { name: string; description?: string | null }] => entry[1] != null
    );
    await Promise.all(
      defined.map(([locale, t]) =>
        prisma.menuItemTranslation.upsert({
          where: {
            menuItemId_locale: { menuItemId: id, locale },
          },
          update: {
            name: t.name,
            description: t.description ?? null,
          },
          create: {
            menuItemId: id,
            locale,
            name: t.name,
            description: t.description ?? null,
          },
        })
      )
    );
  }

  // Delete-and-recreate option groups if provided (in a transaction for atomicity)
  if (optionGroups !== undefined) {
    await prisma.$transaction(async (tx) => {
      // Delete all existing option groups (cascades to translations + choices)
      await tx.optionGroup.deleteMany({ where: { menuItemId: id } });

      // Clear cart items with stale option selections for this menu item
      // Items with selectedOptions "[]" (no options) are unaffected
      await tx.cartItem.deleteMany({
        where: {
          menuItemId: id,
          selectedOptions: { not: "[]" },
        },
      });

      // Create new groups
      if (optionGroups.length > 0) {
        for (let gi = 0; gi < optionGroups.length; gi++) {
          const group = optionGroups[gi];
          await tx.optionGroup.create({
            data: {
              menuItemId: id,
              selectionType: group.selectionType,
              isRequired: group.isRequired,
              sortOrder: group.sortOrder ?? gi,
              names: {
                create: Object.entries(group.translations)
                  .filter((e): e is [string, { name: string }] => e[1] != null)
                  .map(([locale, t]) => ({ locale, name: t.name })),
              },
              choices: {
                create: group.choices.map((choice, ci) => ({
                  priceAdjustment: choice.priceAdjustment,
                  sortOrder: choice.sortOrder ?? ci,
                  names: {
                    create: Object.entries(choice.translations)
                      .filter((e): e is [string, { name: string }] => e[1] != null)
                      .map(([locale, t]) => ({ locale, name: t.name })),
                  },
                })),
              },
            },
          });
        }
      }
    });
  }

  // Fetch updated menu item with all relations
  const menuItem = await prisma.menuItem.findUnique({
    where: { id },
    include: {
      names: true,
      category: {
        include: { names: true },
      },
      optionGroups: {
        orderBy: { sortOrder: "asc" },
        include: {
          names: true,
          choices: {
            orderBy: { sortOrder: "asc" },
            include: { names: true },
          },
        },
      },
    },
  });

  // Serialize Decimal fields
  const response = menuItem
    ? {
        ...menuItem,
        price: Number(menuItem.price),
        comboBasePrice: menuItem.comboBasePrice != null ? Number(menuItem.comboBasePrice) : null,
        optionGroups: menuItem.optionGroups.map((g) => ({
          ...g,
          choices: g.choices.map((c) => ({
            ...c,
            priceAdjustment: Number(c.priceAdjustment),
          })),
        })),
      }
    : menuItem;

  invalidateMenuCache();
  return NextResponse.json(response);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "menu")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return NextResponse.json(
      { error: "Invalid menu item ID" },
      { status: 400 }
    );
  }

  const existing = await prisma.menuItem.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json(
      { error: "Menu item not found" },
      { status: 404 }
    );
  }

  // Guard: prevent deletion if item is in active carts or pending orders
  const [activeCartCount, activeOrderItemCount] = await Promise.all([
    prisma.cartItem.count({ where: { menuItemId: id } }),
    prisma.orderItem.count({
      where: {
        menuItemId: id,
        order: { status: { in: ["PENDING", "CONFIRMED"] } },
      },
    }),
  ]);
  if (activeCartCount > 0 || activeOrderItemCount > 0) {
    return NextResponse.json(
      { error: "Cannot delete: item is in active carts or pending orders" },
      { status: 409 }
    );
  }

  // Delete R2 image if present
  if (existing.imageUrl) {
    await deleteR2Object(existing.imageUrl);
  }

  // Cascade delete is handled by Prisma schema (onDelete: Cascade)
  await prisma.menuItem.delete({ where: { id } });

  invalidateMenuCache();
  return NextResponse.json({ success: true });
}
