import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { invalidateMenuCache } from "@/lib/menu-cache";
import {
  menuBackupSchema,
  buildCategoryCreateInput,
  normalizeBackupLocales,
  type MenuBackup,
} from "@/lib/menu-backup";
import {
  isValidPriceForDecimals,
  priceSchema,
  priceAdjustmentSchema,
  MAX_OPTION_GROUPS,
  MAX_OPTION_CHOICES,
} from "@/lib/validations";
import { log } from "@/lib/logger";

// Hard cap on the raw restore body BEFORE JSON.parse. The schema's tree-size
// caps (MAX_BACKUP_*) bound the materialized object graph, but only AFTER the
// full body is read + parsed into memory — so a multi-hundred-MB body still
// OOMs the single instance during parse. 10 MB is far above any real serialized
// menu (hundreds of items with translations + options is well under 1 MB) yet
// well below an OOM risk. SUPERADMIN-only already narrows the actor; this bounds
// the blast radius of a malicious/corrupt file. App Router route handlers have
// no default body limit (serverActions.bodySizeLimit applies only to Server
// Actions), so we enforce it here.
const MAX_RESTORE_BODY_BYTES = 10 * 1024 * 1024;

/** Validate every money field in the backup against the CURRENT currency
 *  (magnitude/finite via the shared schemas, precision via decimals) AND the
 *  option-array caps. Returns a literal error code or null. */
function validateMoneyAndCaps(
  backup: MenuBackup,
  decimals: number
): "INVALID_PRICE" | "INVALID_OPTIONS" | null {
  for (const cat of backup.categories) {
    for (const it of cat.items) {
      const price = Number(it.price);
      if (!priceSchema.safeParse(price).success) return "INVALID_PRICE";
      if (!isValidPriceForDecimals(price, decimals)) return "INVALID_PRICE";
      if (it.comboBasePrice != null) {
        const cb = Number(it.comboBasePrice);
        if (!priceAdjustmentSchema.safeParse(cb).success) return "INVALID_PRICE";
        if (!isValidPriceForDecimals(cb, decimals)) return "INVALID_PRICE";
      }
      if (it.optionGroups.length > MAX_OPTION_GROUPS) return "INVALID_OPTIONS";
      for (const g of it.optionGroups) {
        if (g.choices.length > MAX_OPTION_CHOICES) return "INVALID_OPTIONS";
        for (const ch of g.choices) {
          const adj = Number(ch.priceAdjustment);
          if (!priceAdjustmentSchema.safeParse(adj).success) return "INVALID_PRICE";
          if (!isValidPriceForDecimals(adj, decimals)) return "INVALID_PRICE";
        }
      }
    }
  }
  return null;
}

/**
 * Menu restore — SUPERADMIN only. FULL REPLACE: wipes every category (cascade
 * removes items/options/choices/translations + any referencing CartItems) and
 * recreates the tree from the uploaded backup, all in one transaction. Past
 * orders are untouched (OrderItem.menuItemId is ON DELETE SET NULL; they keep
 * their own price/name/option snapshots).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Reject an oversized body before reading/parsing it. Check the declared
  // Content-Length first (cheap), then enforce again on the actual bytes (a
  // client can lie about or omit Content-Length).
  const declaredLen = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_RESTORE_BODY_BYTES) {
    return NextResponse.json({ error: "BACKUP_TOO_LARGE" }, { status: 413 });
  }

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_RESTORE_BODY_BYTES) {
      return NextResponse.json({ error: "BACKUP_TOO_LARGE" }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = menuBackupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BACKUP" }, { status: 400 });
  }

  const { decimals, enabledLocales, canonicalLocale } = await getSettings();
  const validationErr = validateMoneyAndCaps(parsed.data, decimals);
  if (validationErr) {
    return NextResponse.json({ error: validationErr }, { status: 400 });
  }

  // Reconcile the file's translation rows against the CURRENT locale config
  // (a backup carries no locale settings — it may come from a deployment whose
  // config drifted, or a different deployment). Drop orphan/unknown-locale rows
  // (counted), but REJECT before touching the DB if any item would lose its name
  // entirely or its canonical-locale row (which drives the order itemName
  // snapshot). See normalizeBackupLocales + the spec's locale case matrix.
  const normalized = normalizeBackupLocales(parsed.data, {
    enabledLocales,
    canonicalLocale,
  });
  if (normalized.error) {
    // MISSING_CANONICAL | EMPTY_ITEM_NAME — pre-transaction, nothing wiped.
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Full replace: cascade wipes items → groups → choices → translations and
      // any CartItem referencing a deleted MenuItem. Orders are SET NULL, kept.
      await tx.category.deleteMany({});

      let categories = 0;
      let items = 0;
      for (const cat of normalized.backup.categories) {
        await tx.category.create({ data: buildCategoryCreateInput(cat) });
        categories += 1;
        items += cat.items.length;
      }
      return { categories, items };
    });

    invalidateMenuCache();
    return NextResponse.json(
      { restored: result, droppedTranslations: normalized.dropped },
      { status: 200 }
    );
  } catch (err) {
    log.error("MenuRestore", "Restore transaction failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
