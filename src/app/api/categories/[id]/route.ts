import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { deleteR2Object } from "@/lib/r2";
import { SUPPORTED_LOCALES } from "@/lib/validations";
import { invalidateMenuCache } from "@/lib/menu-cache";

const updateCategorySchema = z.object({
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  translations: z
    .partialRecord(z.enum(SUPPORTED_LOCALES), z.string().min(1).max(100))
    .optional(),
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
      { error: "Invalid category ID" },
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

  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json(
      { error: "Category not found" },
      { status: 404 }
    );
  }

  const { sortOrder, isActive, translations } = parsed.data;

  // Build update data for category fields
  const updateData: { sortOrder?: number; isActive?: boolean } = {};
  if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
  if (isActive !== undefined) updateData.isActive = isActive;

  // Update category fields
  await prisma.category.update({
    where: { id },
    data: updateData,
  });

  // Upsert translations if provided (parallel to avoid N+1)
  if (translations) {
    await Promise.all(
      Object.entries(translations).map(([locale, name]) =>
        prisma.categoryTranslation.upsert({
          where: {
            categoryId_locale: { categoryId: id, locale },
          },
          update: { name },
          create: { categoryId: id, locale, name },
        })
      )
    );
  }

  // Fetch updated category with translations
  const category = await prisma.category.findUnique({
    where: { id },
    include: { names: true },
  });

  invalidateMenuCache();
  return NextResponse.json(category);
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
      { error: "Invalid category ID" },
      { status: 400 }
    );
  }

  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json(
      { error: "Category not found" },
      { status: 404 }
    );
  }

  // Guard: prevent deletion if any items in this category are in active carts or pending orders
  const [activeCartCount, activeOrderItemCount] = await Promise.all([
    prisma.cartItem.count({ where: { menuItem: { categoryId: id } } }),
    prisma.orderItem.count({
      where: {
        menuItem: { categoryId: id },
        order: { status: { in: ["PENDING", "CONFIRMED"] } },
      },
    }),
  ]);
  if (activeCartCount > 0 || activeOrderItemCount > 0) {
    return NextResponse.json(
      { error: "Cannot delete: items in this category are in active carts or pending orders" },
      { status: 409 }
    );
  }

  // Delete R2 images for all menu items in this category
  const itemsWithImages = await prisma.menuItem.findMany({
    where: { categoryId: id, imageUrl: { not: null } },
    select: { imageUrl: true },
  });
  if (itemsWithImages.length > 0) {
    await Promise.allSettled(
      itemsWithImages.map((item) => deleteR2Object(item.imageUrl!))
    );
  }

  // Cascade delete is handled by Prisma schema (onDelete: Cascade)
  await prisma.category.delete({ where: { id } });

  invalidateMenuCache();
  return NextResponse.json({ success: true });
}
