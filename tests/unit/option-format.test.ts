import { describe, it, expect } from "vitest";
import { formatOptions } from "@/lib/report-utils";
import type { MoneyOptions } from "@/lib/money";

const money: MoneyOptions = { currency: "THB", decimals: 2, locale: "th" };

describe("formatOptions — old + new shape, locale-aware", () => {
  it("renders an OLD single-string snapshot unchanged (no locale args)", () => {
    const json = JSON.stringify([
      { groupName: "ขนาด", choiceName: "ใหญ่", priceAdjustment: 10 },
    ]);
    expect(formatOptions(json, money)).toBe("ขนาด: ใหญ่ +฿10.00");
  });

  it("renders a NEW locale-map snapshot in the requested locale", () => {
    const json = JSON.stringify([
      {
        groupName: { th: "ขนาด", en: "Size" },
        choiceName: { th: "ใหญ่", en: "Large" },
        priceAdjustment: 10,
      },
    ]);
    expect(formatOptions(json, money, "en", "th")).toBe("Size: Large +฿10.00");
  });

  it("falls back to canonical for a NEW snapshot when locale missing", () => {
    const json = JSON.stringify([
      { groupName: { th: "ขนาด" }, choiceName: { th: "ใหญ่" }, priceAdjustment: 0 },
    ]);
    expect(formatOptions(json, money, "en", "th")).toBe("ขนาด: ใหญ่");
  });

  it("joins multiple groups with ' / ' and choices with ', '", () => {
    const json = JSON.stringify([
      { groupName: { en: "Size" }, choiceName: { en: "Large" }, priceAdjustment: 0 },
      { groupName: { en: "Spice" }, choiceName: { en: "Hot" }, priceAdjustment: 0 },
    ]);
    expect(formatOptions(json, money, "en", "th")).toBe("Size: Large / Spice: Hot");
  });

  it("returns '' for an empty/invalid snapshot", () => {
    expect(formatOptions("[]", money, "en", "th")).toBe("");
    expect(formatOptions("not json", money, "en", "th")).toBe("");
  });
});
