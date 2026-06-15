import { describe, it, expect } from "vitest";
import {
  passwordSchema,
  assertValidSeedPassword,
  isValidPriceForDecimals,
  findInvalidPriceField,
  priceSchema,
  priceAdjustmentSchema,
  optionGroupSchema,
  MAX_PRICE,
  MAX_OPTION_CHOICES,
} from "@/lib/validations";

describe("passwordSchema", () => {
  it("rejects passwords shorter than 8 chars", () => {
    expect(passwordSchema.safeParse("Ab1").success).toBe(false);
  });
  it("rejects passwords longer than 16 chars", () => {
    expect(passwordSchema.safeParse("Abcdefghijk12345678").success).toBe(false);
  });
  it("rejects passwords without uppercase", () => {
    expect(passwordSchema.safeParse("abcd1234").success).toBe(false);
  });
  it("rejects passwords without lowercase", () => {
    expect(passwordSchema.safeParse("ABCD1234").success).toBe(false);
  });
  it("rejects passwords without digit", () => {
    expect(passwordSchema.safeParse("Abcdefgh").success).toBe(false);
  });
  it("accepts valid passwords", () => {
    expect(passwordSchema.safeParse("ValidPass1").success).toBe(true);
  });
  it("accepts passwords with special characters", () => {
    expect(passwordSchema.safeParse("Test1234!@").success).toBe(true);
  });
});

describe("assertValidSeedPassword", () => {
  // The DB seed is the one admin-creation path that hashes a raw env value;
  // this guard makes it enforce the SAME passwordSchema as the wizard/users API.
  it("does not throw for a policy-compliant password", () => {
    expect(() => assertValidSeedPassword("SEED_SUPERADMIN_PASSWORD", "ValidPass1")).not.toThrow();
    expect(() => assertValidSeedPassword("SEED_DEV_PASSWORD", "Sample123Pw")).not.toThrow();
  });
  it("throws for a password missing an uppercase letter", () => {
    expect(() => assertValidSeedPassword("SEED_SUPERADMIN_PASSWORD", "abcd1234")).toThrow();
  });
  it("throws for a too-short password", () => {
    expect(() => assertValidSeedPassword("SEED_DEV_PASSWORD", "Ab1")).toThrow();
  });
  it("throws for a password missing a digit", () => {
    expect(() => assertValidSeedPassword("SEED_DEV_PASSWORD", "Abcdefgh")).toThrow();
  });
  it("names the offending env var and the failing rule in the message", () => {
    let msg = "";
    try {
      assertValidSeedPassword("SEED_SUPERADMIN_PASSWORD", "abcd1234");
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("SEED_SUPERADMIN_PASSWORD");
    expect(msg).toContain("uppercase");
  });
});

describe("currency-decimals price validation (runtime, post-zod)", () => {
  it("accepts whole and 2-dp prices for a 2-decimal currency", () => {
    expect(isValidPriceForDecimals(12, 2)).toBe(true);
    expect(isValidPriceForDecimals(12.5, 2)).toBe(true);
    expect(isValidPriceForDecimals(12.55, 2)).toBe(true);
  });
  it("rejects sub-cent precision for a 2-decimal currency", () => {
    expect(isValidPriceForDecimals(12.555, 2)).toBe(false);
  });
  it("rejects fractional prices for a 0-decimal currency (VND)", () => {
    expect(isValidPriceForDecimals(100.5, 0)).toBe(false);
    expect(isValidPriceForDecimals(100, 0)).toBe(true);
  });
  it("finds the first offending field across the payload", () => {
    expect(findInvalidPriceField({ price: 100.5 }, 0)).toBe("price");
    expect(findInvalidPriceField({ price: 100, comboBasePrice: 9.9 }, 0)).toBe(
      "comboBasePrice"
    );
    expect(
      findInvalidPriceField(
        {
          price: 100,
          optionGroups: [{ choices: [{ priceAdjustment: 0.5 }] }],
        },
        0
      )
    ).toBe("optionGroups.choices.priceAdjustment");
  });
  it("passes a fully conforming payload (null comboBasePrice allowed)", () => {
    expect(
      findInvalidPriceField(
        {
          price: 100,
          comboBasePrice: null,
          optionGroups: [{ choices: [{ priceAdjustment: 10 }] }],
        },
        0
      )
    ).toBeNull();
  });
});

describe("price magnitude / NaN / Infinity bounds (priceSchema)", () => {
  it("accepts a realistic price", () => {
    expect(priceSchema.safeParse(12.5).success).toBe(true);
    expect(priceSchema.safeParse(MAX_PRICE).success).toBe(true);
  });
  it("rejects a price above MAX_PRICE", () => {
    expect(priceSchema.safeParse(MAX_PRICE + 1).success).toBe(false);
    expect(priceSchema.safeParse(1e18).success).toBe(false);
  });
  it("rejects NaN and Infinity (Zod default) and non-positive", () => {
    expect(priceSchema.safeParse(NaN).success).toBe(false);
    expect(priceSchema.safeParse(Infinity).success).toBe(false);
    expect(priceSchema.safeParse(0).success).toBe(false);
    expect(priceSchema.safeParse(-1).success).toBe(false);
  });
  it("priceAdjustment allows 0 but still caps magnitude", () => {
    expect(priceAdjustmentSchema.safeParse(0).success).toBe(true);
    expect(priceAdjustmentSchema.safeParse(MAX_PRICE + 1).success).toBe(false);
    expect(priceAdjustmentSchema.safeParse(-1).success).toBe(false);
  });
});

describe("nested option payload caps (optionGroupSchema)", () => {
  const validTranslations = { en: { name: "Size" } };
  const choice = { priceAdjustment: 0, translations: { en: { name: "L" } } };
  it("accepts up to MAX_OPTION_CHOICES choices", () => {
    const group = {
      selectionType: "MULTIPLE" as const,
      isRequired: false,
      translations: validTranslations,
      choices: Array.from({ length: MAX_OPTION_CHOICES }, () => choice),
    };
    expect(optionGroupSchema.safeParse(group).success).toBe(true);
  });
  it("rejects more than MAX_OPTION_CHOICES choices", () => {
    const group = {
      selectionType: "MULTIPLE" as const,
      isRequired: false,
      translations: validTranslations,
      choices: Array.from({ length: MAX_OPTION_CHOICES + 1 }, () => choice),
    };
    expect(optionGroupSchema.safeParse(group).success).toBe(false);
  });
});
