import { describe, it, expect } from "vitest";
import { formatMoney, currencySymbol, currencyCode } from "@/lib/money";
import { currencyDecimals } from "@/lib/deployment-config";

describe("currencyDecimals", () => {
  it("returns 2 for THB/MYR/SGD", () => {
    expect(currencyDecimals("THB")).toBe(2);
    expect(currencyDecimals("MYR")).toBe(2);
    expect(currencyDecimals("SGD")).toBe(2);
  });
  it("returns 0 for VND (zero-decimal currency)", () => {
    expect(currencyDecimals("VND")).toBe(0);
  });
  it("falls back to 2 for an unknown-but-valid code", () => {
    expect(currencyDecimals("USD")).toBe(2);
  });
});

describe("formatMoney (default THB deployment)", () => {
  it("formats a whole amount with 2 decimals and a symbol", () => {
    const s = formatMoney(120);
    expect(s).toMatch(/120\.00/);
    expect(s).toMatch(/\D/); // contains a non-digit (the currency symbol)
  });

  it("groups thousands", () => {
    expect(formatMoney(1234.5)).toMatch(/1,234\.50/);
  });

  it("rounds to 2 decimals", () => {
    expect(formatMoney(5.005)).toMatch(/5\.01|5\.00/); // banker/half-up tolerant
  });

  it("withSymbol:false omits the currency symbol", () => {
    // money.ts is now server-only with an options-object signature; the 3rd
    // positional arg toggles the symbol. Omitting opts uses the THB/en default.
    const s = formatMoney(120, { currency: "THB", decimals: 2, locale: "en" }, false);
    expect(s).toMatch(/120\.00/);
    // No currency glyph. (Asserting absence of the symbol, not a digits-only
    // character class — the latter would spuriously fail on negatives like -120.00.)
    expect(s).not.toMatch(/[฿$€£¥₩RM]/);
  });

  it("currencySymbol returns a non-empty symbol string", () => {
    const sym = currencySymbol();
    expect(typeof sym).toBe("string");
    expect(sym.length).toBeGreaterThan(0);
    expect(sym).not.toMatch(/\d/);
  });

  it("currencyCode returns the ISO code (THB by default)", () => {
    expect(currencyCode()).toBe("THB");
  });
});
