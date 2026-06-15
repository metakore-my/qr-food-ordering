import { z } from "zod";
import { KNOWN_LOCALES } from "./deployment-config";
import { MAX_OPTION_GROUPS, MAX_OPTION_CHOICES } from "./validations";

/**
 * Self-contained, prisma-free helpers for full-menu backup/restore.
 *
 * This module is a PURE helper (no `import` of prisma at the top) so it can be
 * unit-tested in isolation AND imported by route code. It models the menu
 * portion of a deployment only — categories, items, their translations, and
 * option groups/choices. It does NOT touch orders, settings, users, tables, or
 * any operational state; a backup is a portable snapshot of the menu tree alone.
 */

export const BACKUP_FORMAT = "qr-food-ordering/menu-backup" as const;
export const BACKUP_VERSION = 1 as const;

// Tree-size caps. A restore is a DESTRUCTIVE full replace that runs the whole
// rebuild inside one transaction — an unbounded uploaded file could OOM the
// single app instance while Prisma materializes the nested-create, or hold the
// wipe-all transaction lock open for minutes. These bound every array in the
// menu tree, mirroring the option caps in validations.ts (MAX_OPTION_GROUPS /
// MAX_OPTION_CHOICES, applied below). They're generous — there are 6
// KNOWN_LOCALES (so a real `names` array never exceeds 6 rows), and a single
// restaurant's menu is well under these category/item counts — so they cost
// nothing legitimate while refusing a corrupt/hostile file.
export const MAX_BACKUP_TRANSLATIONS = 10; // > 6 locales, for headroom
export const MAX_BACKUP_ITEMS_PER_CATEGORY = 1000;
export const MAX_BACKUP_CATEGORIES = 500;

const decimalString = z
  .string()
  .refine((s) => s.trim() !== "" && Number.isFinite(Number(s)), {
    message: "must be a numeric string",
  });

// Translation-row caps are DB-derived, not arbitrary — the name length and the
// presence of a description column differ by level, so a single shared schema
// would let an over-long short name (or a stray description) validate here and
// then fail opaquely at prisma.create. Two row schemas keep "if it validates,
// it restores" honest:

// MenuItemTranslation.name VarChar(200), description VarChar(500) — items only.
const itemTranslationRow = z.object({
  locale: z.string().min(1).max(5),
  name: z.string().min(1).max(200),
  description: z.string().max(500).nullable().optional(),
});

// Category/OptionGroup/OptionChoice Translation.name VarChar(100), no description column.
const shortTranslationRow = z
  .object({
    locale: z.string().min(1).max(5),
    name: z.string().min(1).max(100),
  })
  .strict(); // a stray `description` fails loudly instead of validating-then-vanishing

const choiceNode = z.object({
  priceAdjustment: decimalString,
  sortOrder: z.number().int(),
  names: z.array(shortTranslationRow).max(MAX_BACKUP_TRANSLATIONS),
});

const optionGroupNode = z.object({
  selectionType: z.enum(["SINGLE", "MULTIPLE"]),
  isRequired: z.boolean(),
  sortOrder: z.number().int(),
  names: z.array(shortTranslationRow).max(MAX_BACKUP_TRANSLATIONS),
  // Schema-level option caps (defense-in-depth): the restore route's
  // validateMoneyAndCaps also enforces these with a friendlier INVALID_OPTIONS
  // code, but bounding here too means a hostile file can't OOM the parser before
  // that check runs.
  choices: z.array(choiceNode).max(MAX_OPTION_CHOICES),
});

const itemNode = z.object({
  price: decimalString,
  // Match the menu-write contract (`z.string().url().max(500)`): reject a
  // hand-edited backup that smuggles a non-URL imageUrl, which would otherwise
  // be stored verbatim and render as a broken <img src>.
  imageUrl: z.string().url().max(500).nullable().optional(),
  isAvailable: z.boolean(),
  isCombo: z.boolean(),
  isFeatured: z.boolean(),
  comboBasePrice: decimalString.nullable(),
  sortOrder: z.number().int(),
  names: z.array(itemTranslationRow).max(MAX_BACKUP_TRANSLATIONS),
  optionGroups: z.array(optionGroupNode).max(MAX_OPTION_GROUPS),
});

const categoryNode = z.object({
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  names: z.array(shortTranslationRow).max(MAX_BACKUP_TRANSLATIONS),
  items: z.array(itemNode).max(MAX_BACKUP_ITEMS_PER_CATEGORY),
});

export const menuBackupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  appName: z.string(),
  categories: z.array(categoryNode).max(MAX_BACKUP_CATEGORIES),
});

export type MenuBackup = z.infer<typeof menuBackupSchema>;
export type MenuBackupCategory = z.infer<typeof categoryNode>;

interface RawTranslation { locale: string; name: string; description?: string | null }
interface RawChoice { priceAdjustment: unknown; sortOrder: number; names: RawTranslation[] }
interface RawGroup {
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  sortOrder: number;
  names: RawTranslation[];
  choices: RawChoice[];
}
interface RawItem {
  price: unknown;
  imageUrl: string | null;
  isAvailable: boolean;
  isCombo: boolean;
  isFeatured: boolean;
  comboBasePrice: unknown;
  sortOrder: number;
  names: RawTranslation[];
  optionGroups: RawGroup[];
}
interface RawCategory {
  sortOrder: number;
  isActive: boolean;
  names: RawTranslation[];
  items: RawItem[];
}

// Item translation rows carry an optional description (MenuItemTranslation has
// the column); emitted only when present so a null collapses cleanly.
function txItem(rows: RawTranslation[]) {
  return rows.map((t) => ({
    locale: t.locale,
    name: t.name,
    ...(t.description != null ? { description: t.description } : {}),
  }));
}

// Category/group/choice translation rows have NO description column — strip it
// unconditionally so a round-tripped envelope satisfies the strict short schema.
function txShort(rows: RawTranslation[]) {
  return rows.map((t) => ({ locale: t.locale, name: t.name }));
}

/**
 * Convert a prisma category tree (categories → items → optionGroups → choices,
 * each with `names`) into the portable backup envelope.
 *
 * Pure (no prisma import) and menu-data-only. The caller fetches the tree; this
 * helper does the transport-safe normalization: it STRIPS every database id
 * (category/item/group/choice ids plus the relation foreign keys) so a restore
 * always creates fresh rows, and it emits prisma `Decimal` columns (`price`,
 * `comboBasePrice`, `priceAdjustment`) as STRINGS — never JS floats — so money
 * precision survives JSON round-trips. A null `comboBasePrice` stays null.
 */
export function serializeMenuBackup(
  categories: RawCategory[],
  meta: { exportedAt: string; appName: string }
): MenuBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: meta.exportedAt,
    appName: meta.appName,
    categories: categories.map((c) => ({
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      names: txShort(c.names),
      items: c.items.map((it) => ({
        price: String(it.price),
        imageUrl: it.imageUrl ?? null,
        isAvailable: it.isAvailable,
        isCombo: it.isCombo,
        isFeatured: it.isFeatured,
        comboBasePrice: it.comboBasePrice != null ? String(it.comboBasePrice) : null,
        sortOrder: it.sortOrder,
        names: txItem(it.names),
        optionGroups: it.optionGroups.map((g) => ({
          selectionType: g.selectionType,
          isRequired: g.isRequired,
          sortOrder: g.sortOrder,
          names: txShort(g.names),
          choices: g.choices.map((ch) => ({
            priceAdjustment: String(ch.priceAdjustment),
            sortOrder: ch.sortOrder,
            names: txShort(ch.names),
          })),
        })),
      })),
    })),
  };
}

/**
 * Build a single category's prisma nested-`create` input from one validated
 * backup category node — `category.create({ data: buildCategoryCreateInput(c) })`.
 *
 * Pure (no prisma import); the caller owns the transaction/`create` call. It
 * reconstructs the full category → items → optionGroups → choices tree with all
 * translation `names`, preserving sortOrder, flags, and the Decimal-as-string
 * money fields verbatim (prisma accepts decimal strings on Decimal columns).
 * Missing optional `description` collapses to null. No ids are referenced, so
 * the restore always mints fresh rows.
 */
export function buildCategoryCreateInput(category: MenuBackupCategory) {
  return {
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    names: {
      // CategoryTranslation has no description column.
      create: category.names.map((t) => ({ locale: t.locale, name: t.name })),
    },
    items: {
      create: category.items.map((it) => ({
        price: it.price,
        imageUrl: it.imageUrl ?? null,
        isAvailable: it.isAvailable,
        isCombo: it.isCombo,
        isFeatured: it.isFeatured,
        comboBasePrice: it.comboBasePrice ?? null,
        sortOrder: it.sortOrder,
        names: {
          create: it.names.map((t) => ({
            locale: t.locale,
            name: t.name,
            description: t.description ?? null,
          })),
        },
        optionGroups: {
          create: it.optionGroups.map((g) => ({
            selectionType: g.selectionType,
            isRequired: g.isRequired,
            sortOrder: g.sortOrder,
            names: {
              create: g.names.map((t) => ({ locale: t.locale, name: t.name })),
            },
            choices: {
              create: g.choices.map((ch) => ({
                priceAdjustment: ch.priceAdjustment,
                sortOrder: ch.sortOrder,
                names: {
                  create: ch.names.map((t) => ({ locale: t.locale, name: t.name })),
                },
              })),
            },
          })),
        },
      })),
    },
  };
}

export interface NormalizeLocalesResult {
  backup: MenuBackup;
  dropped: number;
  error?: "MISSING_CANONICAL" | "EMPTY_ITEM_NAME";
}

/**
 * Reconcile the locales in a backup against the TARGET deployment's locale
 * settings before restore. Pure (no prisma import) and menu-data-only.
 *
 * A backup may have been exported from a deployment whose enabled/canonical
 * locales differ from the one being restored into. This pass walks every
 * translation `names` array (categories, items, option groups, choices) and:
 *
 *  - DROPS rows whose locale is not in `enabledLocales ∪ {canonicalLocale}`, or
 *    is not a routable `KNOWN_LOCALES` value at all (counted in `dropped`).
 *    A locale enabled in the target but absent from the file is simply left
 *    empty — never an error (the operator can translate it later).
 *  - REJECTS (returns an `error`, leaving the partially-filtered tree for
 *    inspection) when an ITEM ends up with zero name rows (`EMPTY_ITEM_NAME`)
 *    or with rows but none in the canonical locale (`MISSING_CANONICAL`).
 *
 * Why the canonical row is mandatory: order placement snapshots the canonical
 * locale into `OrderItem.itemName`, so an item that can't resolve a canonical
 * name would later snapshot an empty/wrong dish name onto every order — a data
 * defect that only surfaces at sale time. Group/choice rows are filtered but
 * NOT canonical-checked (their snapshots are multi-locale and tolerant).
 */
export function normalizeBackupLocales(
  backup: MenuBackup,
  settings: { enabledLocales: string[]; canonicalLocale: string }
): NormalizeLocalesResult {
  const allowed = new Set(
    [...settings.enabledLocales, settings.canonicalLocale].filter((l) =>
      (KNOWN_LOCALES as readonly string[]).includes(l)
    )
  );
  let dropped = 0;

  // Keep a row only if its locale is allowed AND its name is non-empty after
  // trimming (a whitespace-only name would otherwise restore a blank-looking
  // dish/category and falsely satisfy the canonical/empty-name guards), and at
  // most ONE row per locale (a hand-edited/buggy-export file with two rows for
  // the same locale would otherwise pass the schema and then violate the
  // @@unique([…, locale]) constraint INSIDE the restore tx — after the wipe —
  // returning a generic 500 instead of a clean pre-tx rejection). Dropped rows
  // are counted like any orphan, so an item left nameless still trips
  // EMPTY_ITEM_NAME below.
  function filterRows<T extends { locale: string; name: string }>(rows: T[]): T[] {
    const seen = new Set<string>();
    const kept = rows.filter((r) => {
      if (!allowed.has(r.locale)) return false;
      if (typeof r.name !== "string" || !r.name.trim()) return false;
      if (seen.has(r.locale)) return false;
      seen.add(r.locale);
      return true;
    });
    dropped += rows.length - kept.length;
    return kept;
  }

  let error: NormalizeLocalesResult["error"] | undefined;

  const categories = backup.categories.map((c) => ({
    ...c,
    names: filterRows(c.names),
    items: c.items.map((it) => {
      const names = filterRows(it.names);
      if (names.length === 0) {
        error ??= "EMPTY_ITEM_NAME";
      } else if (!names.some((n) => n.locale === settings.canonicalLocale)) {
        error ??= "MISSING_CANONICAL";
      }
      return {
        ...it,
        names,
        optionGroups: it.optionGroups.map((g) => ({
          ...g,
          names: filterRows(g.names),
          choices: g.choices.map((ch) => ({ ...ch, names: filterRows(ch.names) })),
        })),
      };
    }),
  }));

  return { backup: { ...backup, categories }, dropped, error };
}
