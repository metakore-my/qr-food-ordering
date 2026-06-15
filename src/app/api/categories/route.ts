import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { SUPPORTED_LOCALES } from "@/lib/validations";
import { invalidateMenuCache } from "@/lib/menu-cache";

const createCategorySchema = z.object({
  sortOrder: z.number().int().min(0).default(0),
  translations: z
    .partialRecord(z.enum(SUPPORTED_LOCALES), z.string().min(1).max(100))
    .refine((obj) => Object.keys(obj).length > 0, {
      message: "At least one translation is required",
    }),
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

  const parsed = createCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { sortOrder, translations } = parsed.data;

  const category = await prisma.category.create({
    data: {
      sortOrder,
      names: {
        create: Object.entries(translations).map(([locale, name]) => ({
          locale,
          name,
        })),
      },
    },
    include: {
      names: true,
    },
  });

  invalidateMenuCache();
  return NextResponse.json(category, { status: 201 });
}
