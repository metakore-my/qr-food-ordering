import { describe, it, expect } from "vitest";
import type { ExtractedNameFields } from "@/lib/menu-extraction";
import { itemIdentityNames, sourceLocaleForExtraction, computeReviewFlags } from "@/lib/menu-extraction";

const base: ExtractedNameFields = { name_th: "", name_en: "", name_zh_CN: "", name_ms: "", name_vi: "", price: 0, category: "X" };

describe("itemIdentityNames", () => {
  it("collects normalized non-empty names across all five locale fields", () => {
    const set = itemIdentityNames({ ...base, name_th: " ผัดไทย ", name_en: "Pad Thai" });
    expect(set.has("ผัดไทย")).toBe(true);
    expect(set.has("pad thai")).toBe(true);
    expect(set.size).toBe(2);
  });
  it("excludes empty/whitespace fields", () => {
    const set = itemIdentityNames({ ...base, name_ms: "Nasi Lemak", name_vi: "   " });
    expect(set.has("nasi lemak")).toBe(true);
    expect(set.size).toBe(1);
  });
});
describe("sourceLocaleForExtraction", () => {
  it("uses canonicalLocale when it is a known market locale", () => {
    expect(sourceLocaleForExtraction({ canonicalLocale: "ms", defaultLocale: "en" })).toBe("ms");
    expect(sourceLocaleForExtraction({ canonicalLocale: "vi", defaultLocale: "en" })).toBe("vi");
  });
  it("falls back to defaultLocale, then en", () => {
    expect(sourceLocaleForExtraction({ canonicalLocale: "", defaultLocale: "th" })).toBe("th");
    expect(sourceLocaleForExtraction({ canonicalLocale: "", defaultLocale: "" })).toBe("en");
  });
});

import { dedupeExtractedItems } from "@/lib/menu-extraction";
const mk = (o: Partial<typeof base>) => ({ ...base, ...o });

describe("dedupeExtractedItems", () => {
  it("merges two rows sharing a Thai name even when English differs", () => {
    const out = dedupeExtractedItems([mk({ name_th: "ผัดไทย", name_en: "Pad Thai", price: 50 }), mk({ name_th: "ผัดไทย", name_en: "Phad Thai", price: 50 })], "th");
    expect(out).toHaveLength(1); expect(out[0].name_th).toBe("ผัดไทย");
  });
  it("merges rows sharing an English name when source names differ/blank", () => {
    const out = dedupeExtractedItems([mk({ name_en: "Nasi Lemak", name_ms: "", price: 8 }), mk({ name_en: "Nasi Lemak", name_ms: "Nasi Lemak", price: 8 })], "ms");
    expect(out).toHaveLength(1); expect(out[0].name_ms).toBe("Nasi Lemak");
  });
  it("fills empty locale fields from the matched twin", () => {
    const out = dedupeExtractedItems([mk({ name_th: "ก๋วยเตี๋ยว", name_en: "", price: 40 }), mk({ name_th: "ก๋วยเตี๋ยว", name_en: "Noodle Soup", price: 40 })], "th");
    expect(out).toHaveLength(1); expect(out[0].name_en).toBe("Noodle Soup");
  });
  it("price conflict → one row, lower price kept, conflict recorded", () => {
    const out = dedupeExtractedItems([mk({ name_th: "ผัดไทย", price: 55 }), mk({ name_th: "ผัดไทย", price: 50 })], "th");
    expect(out).toHaveLength(1); expect(out[0].price).toBe(50);
    expect(out[0].priceConflict).toEqual({ prices: [55, 50], kept: 50 });
  });
  it("keeps genuinely different dishes separate", () => {
    const out = dedupeExtractedItems([mk({ name_th: "ผัดไทย" }), mk({ name_th: "ต้มยำกุ้ง" })], "th");
    expect(out).toHaveLength(2);
  });
  it("collapses exact name_en+price repeats (no regression)", () => {
    const out = dedupeExtractedItems([mk({ name_en: "Coke", price: 3 }), mk({ name_en: "Coke", price: 3 })], "en");
    expect(out).toHaveLength(1);
  });
  it("does NOT treat sentinel prices (-1, 0) as a real price conflict", () => {
    const out = dedupeExtractedItems([mk({ name_th: "ปลา", price: -1 }), mk({ name_th: "ปลา", price: 0 })], "th");
    expect(out).toHaveLength(1); expect(out[0].priceConflict).toBeUndefined();
  });
  it("merges a later variant-name row via the grown identity union (transitive)", () => {
    const out = dedupeExtractedItems(
      [
        mk({ name_th: "ผัดไทย", name_en: "Pad Thai", price: 50 }),
        mk({ name_th: "ผัดไทย", name_en: "Phad Thai", price: 50 }),
        mk({ name_th: "", name_en: "Phad Thai", price: 50 }),
      ],
      "th"
    );
    expect(out).toHaveLength(1);
  });

  it("accumulates a 3-way price conflict, keeping the lowest", () => {
    const out = dedupeExtractedItems(
      [
        mk({ name_th: "ผัดไทย", price: 60 }),
        mk({ name_th: "ผัดไทย", price: 55 }),
        mk({ name_th: "ผัดไทย", price: 50 }),
      ],
      "th"
    );
    expect(out).toHaveLength(1);
    expect(out[0].price).toBe(50);
    expect(out[0].priceConflict?.kept).toBe(50);
    expect(out[0].priceConflict?.prices).toEqual([60, 55, 50]);
  });

  it("carries optionGroups from the twin when the target has none", () => {
    const og = [{ name_en: "Size", choices: [] }];
    const out = dedupeExtractedItems(
      [
        mk({ name_th: "ผัดไทย", price: 50 }),
        mk({ name_th: "ผัดไทย", price: 50, optionGroups: og }),
      ],
      "th"
    );
    expect(out).toHaveLength(1);
    expect(out[0].optionGroups).toBeTruthy();
    // shallow-copied, not the same reference (no-mutate contract)
    expect(out[0].optionGroups).not.toBe(og);
  });

  it("does not mutate the input items array", () => {
    const input = [mk({ name_th: "ผัดไทย", price: 55 }), mk({ name_th: "ผัดไทย", price: 50 })];
    const snapshotPrice = input[0].price;
    dedupeExtractedItems(input, "th");
    expect(input[0].price).toBe(snapshotPrice); // input untouched
    expect(input).toHaveLength(2);
  });
});

describe("computeReviewFlags", () => {
  const existing = new Set(["nasi lemak"]);
  it("flags an existing-menu duplicate", () => {
    const f = computeReviewFlags(mk({ name_en: "Nasi Lemak", price: 8 }), existing);
    expect(f).toContain("existingDuplicate");
  });
  it("flags a price conflict", () => {
    const f = computeReviewFlags(mk({ name_th: "x", price: 50, priceConflict: { prices: [50, 55], kept: 50 } }), existing);
    expect(f).toContain("priceConflict");
  });
  it("flags unpriced (<=0) items", () => {
    expect(computeReviewFlags(mk({ name_en: "Fish", price: 0 }), existing)).toContain("unpriced");
    expect(computeReviewFlags(mk({ name_en: "Fish", price: -1 }), existing)).toContain("unpriced");
  });
  it("flags a missing name (no locale name at all)", () => {
    expect(computeReviewFlags(mk({ price: 5 }), existing)).toContain("missingName");
  });
  it("returns [] for a clean, novel, priced item", () => {
    expect(computeReviewFlags(mk({ name_en: "Iced Tea", price: 3 }), existing)).toEqual([]);
  });
});
