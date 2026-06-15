import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { SUPPORTED_LOCALES, translationSchema, optionGroupSchema, findInvalidPriceField, priceSchema, MAX_PRICE, MAX_OPTION_GROUPS } from "@/lib/validations";
import { invalidateMenuCache } from "@/lib/menu-cache";
import { getSettings } from "@/lib/settings";

const createMenuItemSchema = z.object({
  categoryId: z.number().int().positive(),
  price: priceSchema,
  imageUrl: z.string().url().max(500).optional().nullable(),
  isCombo: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  comboBasePrice: z.number().min(0).max(MAX_PRICE).nullable().optional(),
  translations: z
    .record(z.enum(SUPPORTED_LOCALES), translationSchema.optional())
    .refine((obj) => Object.values(obj).filter(Boolean).length > 0, {
      message: "At least one translation is required",
    }),
  optionGroups: z.array(optionGroupSchema).max(MAX_OPTION_GROUPS).optional(),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const locale = searchParams.get("locale");
  const categoryId = searchParams.get("categoryId");

  // Public mode: locale param present - only return available items
  // Admin mode: no locale param - requires auth + menu permission
  const isPublicMode = !!locale;

  if (!isPublicMode) {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasPermission(session.user.role, session.user.permissions ?? [], "menu")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const where: Record<string, unknown> = {};
  if (isPublicMode) {
    where.isAvailable = true;
    where.category = { isActive: true };
  }
  if (categoryId) {
    const catId = parseInt(categoryId, 10);
    if (!isNaN(catId)) {
      where.categoryId = catId;
    }
  }

  const menuItems = await prisma.menuItem.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      names: locale
        ? { where: { locale } }
        : true,
      category: {
        include: {
          names: locale
            ? { where: { locale } }
            : true,
        },
      },
      optionGroups: {
        orderBy: { sortOrder: "asc" },
        include: {
          names: locale ? { where: { locale } } : true,
          choices: {
            orderBy: { sortOrder: "asc" },
            include: {
              names: locale ? { where: { locale } } : true,
            },
          },
        },
      },
    },
  });

  // Serialize items (convert Decimal fields to numbers)
  const serializedItems = menuItems.map((item) => ({
    ...item,
    price: Number(item.price),
    comboBasePrice: item.comboBasePrice != null ? Number(item.comboBasePrice) : null,
    optionGroups: item.optionGroups.map((group) => ({
      ...group,
      choices: group.choices.map((choice) => ({
        ...choice,
        priceAdjustment: Number(choice.priceAdjustment),
      })),
    })),
  }));

  // Group by category
  const grouped: Record<
    number,
    {
      category: {
        id: number;
        sortOrder: number;
        isActive: boolean;
        names: Array<{ id: number; locale: string; name: string }>;
      };
      items: typeof serializedItems;
    }
  > = {};

  for (const item of serializedItems) {
    const catId = item.categoryId;
    if (!grouped[catId]) {
      grouped[catId] = {
        category: {
          id: item.category.id,
          sortOrder: item.category.sortOrder,
          isActive: item.category.isActive,
          names: item.category.names,
        },
        items: [],
      };
    }
    grouped[catId].items.push(item);
  }

  // Sort groups by category sortOrder
  const result = Object.values(grouped).sort(
    (a, b) => a.category.sortOrder - b.category.sortOrder
  );

  const response = NextResponse.json(result);

  // Add short-lived cache headers for public menu requests
  if (isPublicMode) {
    response.headers.set(
      "Cache-Control",
      "public, max-age=0, must-revalidate"
    );
  }

  return response;
}

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

  const parsed = createMenuItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // Reject prices with more fractional digits than the deployment currency
  // allows (zod can't — decimals is a runtime setting). A 0-decimal deployment
  // (VND) storing 100.5 would render rounded everywhere but charge the stored
  // Decimal in exports.
  const { decimals } = await getSettings();
  const badPriceField = findInvalidPriceField(parsed.data, decimals);
  if (badPriceField) {
    return NextResponse.json(
      { error: `${badPriceField} must have at most ${decimals} decimal places` },
      { status: 400 }
    );
  }

  const { categoryId, price, imageUrl, isCombo, isFeatured, comboBasePrice, translations, optionGroups } = parsed.data;

  // Verify category exists
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
  });
  if (!category) {
    return NextResponse.json(
      { error: "Category not found" },
      { status: 404 }
    );
  }

  const menuItem = await prisma.menuItem.create({
    data: {
      categoryId,
      price,
      imageUrl: imageUrl ?? null,
      isCombo: isCombo ?? false,
      isFeatured: isFeatured ?? false,
      comboBasePrice: comboBasePrice ?? null,
      names: {
        create: Object.entries(translations)
          .filter((e): e is [string, { name: string; description?: string }] => e[1] != null)
          .map(([locale, t]) => ({
            locale,
            name: t.name,
            description: t.description ?? null,
          })),
      },
      ...(optionGroups && optionGroups.length > 0
        ? {
            optionGroups: {
              create: optionGroups.map((group, gi) => ({
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
  });

  // Serialize Decimal fields
  const response = {
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
  };

  invalidateMenuCache();
  return NextResponse.json(response, { status: 201 });
}
