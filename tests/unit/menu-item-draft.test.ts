import { describe, it, expect } from "vitest";
import { cloneOptionGroups, blankItemDraft, duplicateItemDraft, mergeTranslations, optionGroupsFromItem } from "@/lib/menu-item-draft";
import type { OptionGroupFormData, DraftSourceItem } from "@/lib/menu-item-draft";

const sample: OptionGroupFormData[] = [
  {
    selectionType: "SINGLE",
    isRequired: true,
    sortOrder: 5,
    translations: { en: { name: "Size" }, "zh-CN": { name: "尺寸" } },
    choices: [
      { priceAdjustment: "0", sortOrder: 3, translations: { en: { name: "Small" } } },
      { priceAdjustment: "2", sortOrder: 9, translations: { en: { name: "Large" } } },
    ],
  },
];

describe("cloneOptionGroups", () => {
  it("re-sequences group and choice sortOrder to 0..n", () => {
    const out = cloneOptionGroups(sample);
    expect(out[0].sortOrder).toBe(0);
    expect(out[0].choices[0].sortOrder).toBe(0);
    expect(out[0].choices[1].sortOrder).toBe(1);
  });

  it("deep-copies so mutating the clone never touches the source", () => {
    const out = cloneOptionGroups(sample);
    out[0].translations.en.name = "MUTATED";
    out[0].choices[0].priceAdjustment = "999";
    expect(sample[0].translations.en.name).toBe("Size");
    expect(sample[0].choices[0].priceAdjustment).toBe("0");
  });

  it("preserves translations and price adjustments verbatim", () => {
    const out = cloneOptionGroups(sample);
    expect(out[0].translations["zh-CN"].name).toBe("尺寸");
    expect(out[0].choices[1].priceAdjustment).toBe("2");
    expect(out[0].selectionType).toBe("SINGLE");
    expect(out[0].isRequired).toBe(true);
  });

  it("returns [] for empty or undefined input", () => {
    expect(cloneOptionGroups([])).toEqual([]);
    expect(cloneOptionGroups(undefined)).toEqual([]);
  });
});

const sourceItem: DraftSourceItem = {
  categoryId: 7,
  price: 12.5,
  imageUrl: "https://r2.example.com/menu/abc.webp",
  isCombo: false,
  isFeatured: true,
  comboBasePrice: null,
  names: [
    { locale: "zh-CN", name: "肉脞面", description: "招牌" },
    { locale: "en", name: "Minced Pork Noodles", description: "" },
  ],
  optionGroups: [
    {
      selectionType: "SINGLE",
      isRequired: false,
      sortOrder: 0,
      translations: { "zh-CN": { name: "份量" } },
      choices: [
        { priceAdjustment: 0, sortOrder: 0, names: [{ locale: "zh-CN", name: "小" }] },
      ],
    },
  ],
};

describe("blankItemDraft", () => {
  it("sets activeLocale to the given default locale", () => {
    expect(blankItemDraft("ms").activeLocale).toBe("ms");
    expect(blankItemDraft("zh-CN").activeLocale).toBe("zh-CN");
  });

  it("clears name/price/description/options", () => {
    const d = blankItemDraft("en");
    expect(d.price).toBe("");
    expect(d.translations).toEqual({});
    expect(d.optionGroups).toEqual([]);
    expect(d.imageUrl).toBeUndefined();
  });
});

describe("duplicateItemDraft", () => {
  it("copies the imageUrl reference verbatim (no re-upload)", () => {
    const d = duplicateItemDraft(sourceItem, "zh-CN");
    expect(d.imageUrl).toBe("https://r2.example.com/menu/abc.webp");
  });

  it("appends a copy marker to the default-locale name only", () => {
    const d = duplicateItemDraft(sourceItem, "zh-CN");
    expect(d.translations["zh-CN"].name).toBe("肉脞面 (copy)");
    expect(d.translations["en"].name).toBe("Minced Pork Noodles"); // untouched
  });

  it("copies options with ids stripped and sortOrder re-sequenced", () => {
    const d = duplicateItemDraft(sourceItem, "zh-CN");
    expect(d.optionGroups).toHaveLength(1);
    expect(d.optionGroups[0].sortOrder).toBe(0);
    expect(d.optionGroups[0].translations["zh-CN"].name).toBe("份量");
    expect(d.optionGroups[0].choices[0].priceAdjustment).toBe("0");
  });

  it("carries category, price, and flags", () => {
    const d = duplicateItemDraft(sourceItem, "zh-CN");
    expect(d.categoryId).toBe(7);
    expect(d.price).toBe("12.5");
    expect(d.isFeatured).toBe(true);
  });
});

describe("mergeTranslations (fill-empty-only)", () => {
  it("fills only empty fields, never overwrites a non-empty one", () => {
    const existing = { en: { name: "Tea", description: "" }, ms: { name: "Teh", description: "" } };
    const incoming = { en: { name: "SHOULD-NOT-WIN" }, ms: { name: "SHOULD-NOT-WIN" }, "zh-CN": { name: "茶" } };
    const out = mergeTranslations(existing, incoming);
    expect(out.en.name).toBe("Tea");        // kept
    expect(out.ms.name).toBe("Teh");        // kept
    expect(out["zh-CN"].name).toBe("茶");   // filled
  });

  it("treats whitespace-only existing values as empty (fillable)", () => {
    const out = mergeTranslations({ vi: { name: "   ", description: "" } }, { vi: { name: "Trà" } });
    expect(out.vi.name).toBe("Trà");
  });

  it("ignores incoming blank/missing locales (no blanking)", () => {
    const out = mergeTranslations({ en: { name: "Tea", description: "" } }, { ms: { name: "" } });
    expect(out.en.name).toBe("Tea");
    expect(out.ms).toBeUndefined();
  });

  it("preserves existing descriptions when only names are translated", () => {
    const out = mergeTranslations(
      { en: { name: "Tea", description: "Hot" }, ms: { name: "", description: "Panas" } },
      { ms: { name: "Teh" } }
    );
    expect(out.ms.name).toBe("Teh");
    expect(out.ms.description).toBe("Panas");
  });

  it("is idempotent", () => {
    const existing = { en: { name: "Tea", description: "" } };
    const incoming = { ms: { name: "Teh" } };
    const once = mergeTranslations(existing, incoming);
    const twice = mergeTranslations(once, incoming);
    expect(twice).toEqual(once);
  });
});

describe("optionGroupsFromItem", () => {
  it("preserves the existing sortOrder (does NOT re-sequence)", () => {
    const out = optionGroupsFromItem([
      {
        selectionType: "MULTIPLE",
        isRequired: false,
        sortOrder: 4,
        names: [{ locale: "en", name: "Add-ons" }],
        choices: [{ priceAdjustment: 1.5, sortOrder: 8, names: [{ locale: "en", name: "Egg" }] }],
      },
    ]);
    expect(out[0].sortOrder).toBe(4);
    expect(out[0].choices[0].sortOrder).toBe(8);
    expect(out[0].translations.en.name).toBe("Add-ons");
    expect(out[0].choices[0].priceAdjustment).toBe("1.5");
  });
});
