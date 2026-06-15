import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  SETTING_KEYS,
  getSettings,
  invalidateSettingsCache,
  validateSettingsInput,
  isSettingsLockActive,
  pruneAppNameI18n,
  type SettingKey,
} from "@/lib/settings";
import { invalidateMenuCache } from "@/lib/menu-cache";
import { hasAnyAdmin } from "@/lib/first-admin";

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

  // Validate against the PERSISTED state, not the defaults — a single-field
  // patch (e.g. only default_locale) must stay consistent with the locale trio
  // already in the DB. See validateSettingsInput.
  const existingRows = await prisma.systemSetting.findMany({
    where: { key: { in: [...SETTING_KEYS] } },
  });
  const current: Partial<Record<SettingKey, string>> = {};
  for (const row of existingRows) current[row.key as SettingKey] = row.value;

  // currency + canonical_locale lock once configuration is established — see
  // isSettingsLockActive (locked when an admin exists, so BOTH the seed path and
  // the wizard path lock; sentinel-only derivation was a bug). The lock only
  // guards this settings PATCH; the setup endpoint passes no opts so it can still
  // establish these.
  const setupRow = await prisma.systemSetting.findUnique({
    where: { key: "setup_completed" },
  });
  const setupComplete = isSettingsLockActive(await hasAnyAdmin(), setupRow?.value);

  const validation = validateSettingsInput(patch, current, { setupComplete });
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error ?? "Validation failed", code: validation.code },
      { status: 400 }
    );
  }

  // When `enabled_locales` shrinks, prune any per-locale app name for a
  // now-disabled locale so it doesn't linger and keep rendering on its
  // still-routable URL (resolveAppName is an ungated map lookup). Prune the
  // EFFECTIVE map (patched value, else persisted) against the post-patch enabled
  // set, and write the result in the same transaction. Only acts when both the
  // enabled set is present in the patch and there's an i18n map to prune.
  if (patch.enabled_locales !== undefined) {
    const enabledAfter = patch.enabled_locales
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const rawI18n = patch.app_name_i18n ?? current.app_name_i18n;
    if (rawI18n) {
      let map: Record<string, string> = {};
      try {
        const parsed = JSON.parse(rawI18n);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") map[k] = v;
          }
        }
      } catch {
        map = {};
      }
      const prunedMap = pruneAppNameI18n(map, enabledAfter);
      // Only write if pruning actually changed something (avoid a redundant upsert).
      if (Object.keys(prunedMap).length !== Object.keys(map).length) {
        patch.app_name_i18n = JSON.stringify(prunedMap);
      }
    }
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
