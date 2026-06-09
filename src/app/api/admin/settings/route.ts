import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  SETTING_KEYS,
  getSettings,
  invalidateSettingsCache,
  validateSettingsInput,
  type SettingKey,
} from "@/lib/settings";
import { invalidateMenuCache } from "@/lib/menu-cache";

/**
 * Runtime config read/write — SUPERADMIN only (mirrors the auth gate in
 * `src/app/api/admin/users/route.ts`).
 *
 * GET   → current resolved settings.
 * PATCH → validate a partial settings patch, upsert the provided rows, bust the
 *         settings cache AND the menu cache (currency/locale affect the rendered
 *         menu), and return the freshly resolved settings.
 */

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = await getSettings();
  return NextResponse.json(settings, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Keep only known setting keys with string values.
  const allowed = new Set<string>(SETTING_KEYS);
  const patch: Partial<Record<SettingKey, string>> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (allowed.has(key) && typeof value === "string") {
      patch[key as SettingKey] = value;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No valid settings provided" },
      { status: 400 }
    );
  }

  const validation = validateSettingsInput(patch);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error ?? "Validation failed" },
      { status: 400 }
    );
  }

  // Upsert each provided row.
  await prisma.$transaction(
    Object.entries(patch).map(([key, value]) =>
      prisma.systemSetting.upsert({
        where: { key },
        update: { value: value as string },
        create: { key, value: value as string },
      })
    )
  );

  // Currency/locale changes affect the rendered menu, so bust both caches.
  invalidateSettingsCache();
  invalidateMenuCache();

  const settings = await getSettings();
  return NextResponse.json(settings, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
