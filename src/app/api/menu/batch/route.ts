import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { SUPPORTED_LOCALES, translationSchema, optionGroupSchema, findInvalidPriceField, priceSchema, MAX_PRICE, MAX_OPTION_GROUPS } from "@/lib/validations";
import { invalidateMenuCache } from "@/lib/menu-cache";
import { getSettings } from "@/lib/settings";

const batchCreateSchema = z.object({
  items: z
    .array(
      z.object({
        categoryId: z.number().int().positive(),
        price: priceSchema,
        imageUrl: z.string().url().max(500).optional().nullable(),
        isCombo: z.boolean().optional(),
        isFeatured: z.boolean().optional(),
        comboBasePrice: z.number().min(0).max(MAX_PRICE).nullable().optional(),
        translations: z
          .partialRecord(z.enum(SUPPORTED_LOCALES), translationSchema)
          .refine((obj) => Object.keys(obj).length > 0, {
            message: "At least one translation is required",
          }),
        optionGroups: z.array(optionGroupSchema).max(MAX_OPTION_GROUPS).optional(),
      })
    )
    .min(1, "At least one item is required")
    .max(100, "Maximum 100 items"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "menu")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  const parsed = batchCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // Currency-decimals price check (mirrors the single-create route) — zod
  // can't enforce it since decimals is a runtime setting.
  const { decimals } = await getSettings();
  for (let i = 0; i < parsed.data.items.length; i++) {
    const badPriceField = findInvalidPriceField(parsed.data.items[i], decimals);
    if (badPriceField) {
      return NextResponse.json(
        { error: `items[${i}].${badPriceField} must have at most ${decimals} decimal places` },
        { status: 400 }
      );
    }
  }

  // Verify all referenced category IDs exist
  const categoryIds = [...new Set(parsed.data.items.map((i) => i.categoryId))];
  const existingCategories = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true },
  });
  const existingIds = new Set(existingCategories.map((c) => c.id));
  const missingIds = categoryIds.filter((id) => !existingIds.has(id));

  if (missingIds.length > 0) {
    return NextResponse.json(
      { error: `Categories not found: ${missingIds.join(", ")}` },
      { status: 404 }
    );
  }

  const creates = parsed.data.items.map((item) =>
    prisma.menuItem.create({
      data: {
        categoryId: item.categoryId,
        price: item.price,
        imageUrl: item.imageUrl ?? null,
        isCombo: item.isCombo ?? false,
        isFeatured: item.isFeatured ?? false,
        comboBasePrice: item.comboBasePrice ?? null,
        names: {
          create: Object.entries(item.translations).map(([locale, t]) => ({
            locale,
            name: t.name,
            description: t.description ?? null,
          })),
        },
        ...(item.optionGroups && item.optionGroups.length > 0
          ? {
              optionGroups: {
                create: item.optionGroups.map((group, gi) => ({
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
                })),
              },
            }
          : {}),
      },
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
    })
  );

  const createdItems = await prisma.$transaction(creates);

  // Serialize Decimal fields
  const serialized = createdItems.map((item) => ({
    ...item,
    price: Number(item.price),
    comboBasePrice: item.comboBasePrice != null ? Number(item.comboBasePrice) : null,
    optionGroups: item.optionGroups.map((g) => ({
      ...g,
      choices: g.choices.map((c) => ({
        ...c,
        priceAdjustment: Number(c.priceAdjustment),
      })),
    })),
  }));

  invalidateMenuCache();
  return NextResponse.json(serialized, { status: 201 });
}
