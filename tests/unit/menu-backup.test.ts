import { describe, it, expect } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  menuBackupSchema,
  MAX_BACKUP_TRANSLATIONS,
  MAX_BACKUP_ITEMS_PER_CATEGORY,
  MAX_BACKUP_CATEGORIES,
} from "@/lib/menu-backup";

function validEnvelope() {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: "2026-06-14T08:00:00.000Z",
    appName: "Demo Cafe",
    categories: [
      {
        sortOrder: 0,
        isActive: true,
        names: [{ locale: "en", name: "Drinks" }],
        items: [
          {
            price: "12.00",
            imageUrl: "https://r2.example/img.webp",
            isAvailable: true,
            isCombo: false,
            isFeatured: false,
            comboBasePrice: null,
            sortOrder: 0,
            names: [{ locale: "en", name: "Iced Tea", description: "House blend" }],
            optionGroups: [
              {
                selectionType: "SINGLE",
                isRequired: true,
                sortOrder: 0,
                names: [{ locale: "en", name: "Size" }],
                choices: [
                  {
                    priceAdjustment: "0.00",
                    sortOrder: 0,
                    names: [{ locale: "en", name: "Regular" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("menuBackupSchema", () => {
  it("accepts a well-formed envelope", () => {
    expect(menuBackupSchema.safeParse(validEnvelope()).success).toBe(true);
  });
  it("rejects a wrong format string", () => {
    expect(menuBackupSchema.safeParse({ ...validEnvelope(), format: "nope" }).success).toBe(false);
  });
  it("rejects a wrong version", () => {
    expect(menuBackupSchema.safeParse({ ...validEnvelope(), version: 99 }).success).toBe(false);
  });
  it("rejects a non-array categories", () => {
    expect(menuBackupSchema.safeParse({ ...validEnvelope(), categories: {} }).success).toBe(false);
  });
  it("rejects a non-numeric price string", () => {
    const env = validEnvelope();
    env.categories[0].items[0].price = "abc";
    expect(menuBackupSchema.safeParse(env).success).toBe(false);
  });
  it("accepts an item with no option groups", () => {
    const env = validEnvelope();
    env.categories[0].items[0].optionGroups = [];
    expect(menuBackupSchema.safeParse(env).success).toBe(true);
  });

  // Name-length caps mirror the DB columns: category/group/choice names are
  // VarChar(100); only ITEM names are VarChar(200). Before splitting the row
  // schema, a 101–200 char short name passed validation then failed at
  // prisma.create with an opaque length error.
  it("rejects a CATEGORY name over 100 chars", () => {
    const env = validEnvelope();
    env.categories[0].names[0].name = "x".repeat(101);
    expect(menuBackupSchema.safeParse(env).success).toBe(false);
  });
  it("rejects an OPTION GROUP name over 100 chars", () => {
    const env = validEnvelope();
    env.categories[0].items[0].optionGroups[0].names[0].name = "x".repeat(101);
    expect(menuBackupSchema.safeParse(env).success).toBe(false);
  });
  it("rejects an OPTION CHOICE name over 100 chars", () => {
    const env = validEnvelope();
    env.categories[0].items[0].optionGroups[0].choices[0].names[0].name = "x".repeat(101);
    expect(menuBackupSchema.safeParse(env).success).toBe(false);
  });
  it("accepts an ITEM name of 101 chars (items allow up to 200)", () => {
    const env = validEnvelope();
    env.categories[0].items[0].names[0].name = "x".repeat(101);
    expect(menuBackupSchema.safeParse(env).success).toBe(true);
  });
  it("rejects an ITEM name over 200 chars", () => {
    const env = validEnvelope();
    env.categories[0].items[0].names[0].name = "x".repeat(201);
    expect(menuBackupSchema.safeParse(env).success).toBe(false);
  });
  it("rejects a description on a short-name (category/group/choice) row", () => {
    const env = validEnvelope();
    // Category translation table has no description column — a stray one must fail loudly.
    (env.categories[0].names[0] as { description?: string }).description = "nope";
    expect(menuBackupSchema.safeParse(env).success).toBe(false);
  });

  // Tree-size caps: bound a destructive full-replace restore against OOM /
  // transaction-lock-duration on the single app instance. 6 KNOWN_LOCALES means
  // a legitimate `names` array never exceeds 6 rows; a real menu has well under
  // the category/item caps. Mirrors the option caps in validations.ts.
  it("rejects a CATEGORY names array over MAX_BACKUP_TRANSLATIONS (11 > 10)", () => {
    const env = validEnvelope();
    env.categories[0].names = Array.from({ length: MAX_BACKUP_TRANSLATIONS + 1 }, (_, i) => ({
      locale: "en",
      name: `n${i}`,
    }));
    expect(menuBackupSchema.safeParse(env).success).toBe(false);
  });
  it("rejects a categories array over MAX_BACKUP_CATEGORIES (501 > 500)", () => {
    const env = validEnvelope();
    const oneCat = env.categories[0];
    env.categories = Array.from({ length: MAX_BACKUP_CATEGORIES + 1 }, () =>
      structuredClone(oneCat)
    );
    expect(menuBackupSchema.safeParse(env).success).toBe(false);
  });
  it("rejects a single category's items array over MAX_BACKUP_ITEMS_PER_CATEGORY (1001 > 1000)", () => {
    const env = validEnvelope();
    const oneItem = env.categories[0].items[0];
    env.categories[0].items = Array.from(
      { length: MAX_BACKUP_ITEMS_PER_CATEGORY + 1 },
      () => structuredClone(oneItem)
    );
    expect(menuBackupSchema.safeParse(env).success).toBe(false);
  });
  it("accepts an envelope at the boundary (6 names, 2 items, 1 category)", () => {
    const env = validEnvelope();
    env.categories[0].names = Array.from({ length: 6 }, (_, i) => ({
      locale: "en",
      name: `n${i}`,
    }));
    env.categories[0].items = [
      structuredClone(env.categories[0].items[0]),
      structuredClone(env.categories[0].items[0]),
    ];
    expect(menuBackupSchema.safeParse(env).success).toBe(true);
  });
});

import { serializeMenuBackup } from "@/lib/menu-backup";

describe("serializeMenuBackup", () => {
  const prismaTree = [
    {
      id: 5,
      sortOrder: 1,
      isActive: true,
      names: [{ id: 9, categoryId: 5, locale: "en", name: "Drinks" }],
      items: [
        {
          id: 7,
          categoryId: 5,
          price: "12.00",
          imageUrl: "https://r2/x.webp",
          isAvailable: true,
          isCombo: false,
          isFeatured: false,
          comboBasePrice: null,
          sortOrder: 0,
          names: [
            { id: 3, menuItemId: 7, locale: "en", name: "Iced Tea", description: "Cold" },
          ],
          optionGroups: [
            {
              id: 2,
              menuItemId: 7,
              selectionType: "SINGLE",
              isRequired: true,
              sortOrder: 0,
              names: [{ id: 1, optionGroupId: 2, locale: "en", name: "Size" }],
              choices: [
                {
                  id: 8,
                  optionGroupId: 2,
                  priceAdjustment: "0.00",
                  sortOrder: 0,
                  names: [{ id: 4, optionChoiceId: 8, locale: "en", name: "Regular" }],
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  it("produces an envelope that re-validates", () => {
    const env = serializeMenuBackup(prismaTree as never, { exportedAt: "2026-06-14T08:00:00.000Z", appName: "Demo" });
    expect(menuBackupSchema.safeParse(env).success).toBe(true);
  });
  it("strips all database ids", () => {
    const env = serializeMenuBackup(prismaTree as never, { exportedAt: "x", appName: "Demo" });
    const json = JSON.stringify(env);
    expect(json).not.toMatch(/"id":/);
    expect(json).not.toMatch(/"categoryId":/);
    expect(json).not.toMatch(/"menuItemId":/);
    expect(json).not.toMatch(/"optionGroupId":/);
    expect(json).not.toMatch(/"optionChoiceId":/);
  });
  it("emits Decimals as strings and preserves null comboBasePrice", () => {
    const env = serializeMenuBackup(prismaTree as never, { exportedAt: "x", appName: "Demo" });
    expect(typeof env.categories[0].items[0].price).toBe("string");
    expect(env.categories[0].items[0].comboBasePrice).toBeNull();
    expect(typeof env.categories[0].items[0].optionGroups[0].choices[0].priceAdjustment).toBe("string");
  });
});

import { buildCategoryCreateInput } from "@/lib/menu-backup";

describe("buildCategoryCreateInput", () => {
  const cat = {
    sortOrder: 2,
    isActive: false,
    names: [{ locale: "en", name: "Mains" }],
    items: [
      {
        price: "30.00",
        imageUrl: null,
        isAvailable: true,
        isCombo: false,
        isFeatured: true,
        comboBasePrice: null,
        sortOrder: 1,
        names: [{ locale: "en", name: "Burger", description: "Beef" }],
        optionGroups: [
          {
            selectionType: "MULTIPLE" as const,
            isRequired: false,
            sortOrder: 0,
            names: [{ locale: "en", name: "Extras" }],
            choices: [
              { priceAdjustment: "2.50", sortOrder: 0, names: [{ locale: "en", name: "Cheese" }] },
            ],
          },
        ],
      },
    ],
  };

  it("builds a nested-create input preserving fields", () => {
    const data = buildCategoryCreateInput(cat);
    expect(data.sortOrder).toBe(2);
    expect(data.isActive).toBe(false);
    expect(data.names.create).toEqual([{ locale: "en", name: "Mains" }]);
    const item = data.items.create[0];
    expect(item.price).toBe("30.00");
    expect(item.isFeatured).toBe(true);
    expect(item.names.create[0]).toEqual({ locale: "en", name: "Burger", description: "Beef" });
    const group = item.optionGroups.create[0];
    expect(group.selectionType).toBe("MULTIPLE");
    expect(group.choices.create[0].priceAdjustment).toBe("2.50");
    expect(group.choices.create[0].names.create[0].name).toBe("Cheese");
  });

  it("handles an item with empty option groups", () => {
    const data = buildCategoryCreateInput({ ...cat, items: [{ ...cat.items[0], optionGroups: [] }] });
    expect(data.items.create[0].optionGroups.create).toEqual([]);
  });
});

describe("combo + price-adjustment Decimal-string round-trip", () => {
  // A populated comboBasePrice and a non-zero choice priceAdjustment must survive
  // BOTH serialize and build as exact Decimal strings (never JS floats).
  const comboTree = [
    {
      id: 11,
      sortOrder: 0,
      isActive: true,
      names: [{ id: 1, categoryId: 11, locale: "en", name: "Sets" }],
      items: [
        {
          id: 21,
          categoryId: 11,
          price: "0.00",
          imageUrl: null,
          isAvailable: true,
          isCombo: true,
          isFeatured: false,
          comboBasePrice: "59.00",
          sortOrder: 0,
          names: [{ id: 2, menuItemId: 21, locale: "en", name: "Family Set" }],
          optionGroups: [
            {
              id: 31,
              menuItemId: 21,
              selectionType: "SINGLE",
              isRequired: true,
              sortOrder: 0,
              names: [{ id: 3, optionGroupId: 31, locale: "en", name: "Drink" }],
              choices: [
                {
                  id: 41,
                  optionGroupId: 31,
                  priceAdjustment: "5.50",
                  sortOrder: 0,
                  names: [{ id: 4, optionChoiceId: 41, locale: "en", name: "Upsize" }],
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  it("preserves comboBasePrice and priceAdjustment through serialize + build", () => {
    const env = serializeMenuBackup(comboTree as never, { exportedAt: "x", appName: "Demo" });
    const serItem = env.categories[0].items[0];
    expect(serItem.comboBasePrice).toBe("59.00");
    expect(typeof serItem.comboBasePrice).toBe("string");
    const serChoiceAdj = serItem.optionGroups[0].choices[0].priceAdjustment;
    expect(serChoiceAdj).toBe("5.50");
    expect(typeof serChoiceAdj).toBe("string");
    expect(menuBackupSchema.safeParse(env).success).toBe(true);

    const data = buildCategoryCreateInput(env.categories[0]);
    expect(data.items.create[0].comboBasePrice).toBe("59.00");
    expect(data.items.create[0].optionGroups.create[0].choices.create[0].priceAdjustment).toBe("5.50");
  });
});

import { normalizeBackupLocales } from "@/lib/menu-backup";

describe("normalizeBackupLocales", () => {
  function envWithItemNames(itemNames: { locale: string; name: string }[]) {
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: "x",
      appName: "Demo",
      categories: [
        {
          sortOrder: 0,
          isActive: true,
          names: [{ locale: "en", name: "Cat" }],
          items: [
            {
              price: "10.00",
              imageUrl: null,
              isAvailable: true,
              isCombo: false,
              isFeatured: false,
              comboBasePrice: null,
              sortOrder: 0,
              names: itemNames,
              optionGroups: [],
            },
          ],
        },
      ],
    };
  }

  it("is a pass-through when all locales are enabled (case 1/2)", () => {
    const env = envWithItemNames([{ locale: "en", name: "Tea" }, { locale: "zh-CN", name: "茶" }]);
    const r = normalizeBackupLocales(env, { enabledLocales: ["en", "zh-CN"], canonicalLocale: "en" });
    expect(r.error).toBeUndefined();
    expect(r.dropped).toBe(0);
    expect(r.backup.categories[0].items[0].names).toHaveLength(2);
  });

  it("does NOT block when a newly-enabled locale is absent from the file — leaves it empty (case 3)", () => {
    const env = envWithItemNames([{ locale: "en", name: "Tea" }]);
    const r = normalizeBackupLocales(env, { enabledLocales: ["en", "ms"], canonicalLocale: "en" });
    expect(r.error).toBeUndefined();
    expect(r.dropped).toBe(0);
    expect(r.backup.categories[0].items[0].names).toEqual([{ locale: "en", name: "Tea" }]);
  });

  it("drops rows for a now-disabled locale and counts them (case 4)", () => {
    const env = envWithItemNames([{ locale: "en", name: "Tea" }, { locale: "ms", name: "Teh" }]);
    const r = normalizeBackupLocales(env, { enabledLocales: ["ms"], canonicalLocale: "ms" });
    expect(r.error).toBeUndefined();
    // category 'en' row (1) + item 'en' row (1) both dropped = 2
    expect(r.dropped).toBe(2);
    expect(r.backup.categories[0].items[0].names).toEqual([{ locale: "ms", name: "Teh" }]);
  });

  it("drops an unknown (non-KNOWN_LOCALES) locale (case 7)", () => {
    const env = envWithItemNames([{ locale: "en", name: "Tea" }, { locale: "jp", name: "お茶" }]);
    const r = normalizeBackupLocales(env, { enabledLocales: ["en"], canonicalLocale: "en" });
    expect(r.error).toBeUndefined();
    expect(r.backup.categories[0].items[0].names).toEqual([{ locale: "en", name: "Tea" }]);
    expect(r.dropped).toBeGreaterThanOrEqual(1);
  });

  it("rejects when an item lacks the canonical-locale row (case 5)", () => {
    const env = envWithItemNames([{ locale: "ms", name: "Teh" }]);
    const r = normalizeBackupLocales(env, { enabledLocales: ["en", "ms"], canonicalLocale: "en" });
    expect(r.error).toBe("MISSING_CANONICAL");
  });

  it("rejects when an item has zero name rows after filtering (case 6)", () => {
    const env = envWithItemNames([{ locale: "jp", name: "x" }]);
    const r = normalizeBackupLocales(env, { enabledLocales: ["en"], canonicalLocale: "en" });
    expect(["EMPTY_ITEM_NAME", "MISSING_CANONICAL"]).toContain(r.error);
  });

  it("de-duplicates rows for the same locale (keeps the first, counts the rest)", () => {
    // A hand-edited/buggy-export file with two `en` rows would otherwise pass the
    // schema and then violate @@unique([menuItemId, locale]) INSIDE the restore
    // tx (after the wipe). normalizeBackupLocales drops the duplicate pre-tx.
    const env = envWithItemNames([
      { locale: "en", name: "Tea" },
      { locale: "en", name: "Tea (dup)" },
    ]);
    const r = normalizeBackupLocales(env, { enabledLocales: ["en"], canonicalLocale: "en" });
    expect(r.error).toBeUndefined();
    expect(r.backup.categories[0].items[0].names).toEqual([{ locale: "en", name: "Tea" }]);
    expect(r.dropped).toBe(1); // the second 'en' row
  });

  it("treats a whitespace-only name as empty (drops it, can trigger EMPTY_ITEM_NAME)", () => {
    // A `" "` name would otherwise restore a blank-looking dish AND falsely
    // satisfy the canonical/empty-name guards. Filtered out like an orphan row.
    const env = envWithItemNames([
      { locale: "en", name: "Tea" },
      { locale: "zh-CN", name: "   " },
    ]);
    const r = normalizeBackupLocales(env, { enabledLocales: ["en", "zh-CN"], canonicalLocale: "en" });
    expect(r.error).toBeUndefined();
    expect(r.backup.categories[0].items[0].names).toEqual([{ locale: "en", name: "Tea" }]);
    expect(r.dropped).toBe(1); // the whitespace-only zh-CN row
  });

  it("rejects EMPTY_ITEM_NAME when the only name row is whitespace-only", () => {
    const env = envWithItemNames([{ locale: "en", name: "  " }]);
    const r = normalizeBackupLocales(env, { enabledLocales: ["en"], canonicalLocale: "en" });
    expect(r.error).toBe("EMPTY_ITEM_NAME");
  });
});
