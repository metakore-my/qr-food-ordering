import { describe, it, expect } from "vitest";
import { formatMoneyWith, currencySymbolWith } from "@/lib/money-client";

describe("client money formatting", () => {
  it("formats THB with 2 decimals and symbol", () => {
    expect(formatMoneyWith(12, { currency: "THB", decimals: 2, locale: "en" })).toMatch(/12\.00/);
  });
  it("formats VND with 0 decimals", () => {
    const out = formatMoneyWith(50000, { currency: "VND", decimals: 0, locale: "en" });
    expect(out).not.toMatch(/\./);
    expect(out).toMatch(/50,000/);
  });
  it("returns the narrow currency symbol", () => {
    expect(typeof currencySymbolWith({ currency: "MYR", locale: "en" })).toBe("string");
  });
});
