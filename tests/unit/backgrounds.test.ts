import { describe, it, expect } from "vitest";
import {
  backgroundsForCurrency,
  CUISINE_BACKGROUNDS,
  type Cuisine,
} from "@/lib/backgrounds";

describe("backgroundsForCurrency", () => {
  it("maps each market currency to its cuisine set", () => {
    expect(backgroundsForCurrency("THB")).toBe(CUISINE_BACKGROUNDS.thai);
    expect(backgroundsForCurrency("MYR")).toBe(CUISINE_BACKGROUNDS.malaysian);
    expect(backgroundsForCurrency("SGD")).toBe(CUISINE_BACKGROUNDS.singaporean);
    expect(backgroundsForCurrency("VND")).toBe(CUISINE_BACKGROUNDS.vietnamese);
  });

  it("is case-insensitive", () => {
    expect(backgroundsForCurrency("myr")).toBe(CUISINE_BACKGROUNDS.malaysian);
    expect(backgroundsForCurrency("vnd")).toBe(CUISINE_BACKGROUNDS.vietnamese);
  });

  it("falls back to Malaysian for unknown or empty currency", () => {
    expect(backgroundsForCurrency("USD")).toBe(CUISINE_BACKGROUNDS.malaysian);
    expect(backgroundsForCurrency("")).toBe(CUISINE_BACKGROUNDS.malaysian);
    // @ts-expect-error testing defensive runtime behavior with a null-ish value
    expect(backgroundsForCurrency(undefined)).toBe(CUISINE_BACKGROUNDS.malaysian);
  });
});

describe("CUISINE_BACKGROUNDS", () => {
  const cuisines: Cuisine[] = ["thai", "malaysian", "singaporean", "vietnamese"];

  it("has exactly 5 unique paths per cuisine, namespaced by cuisine folder", () => {
    for (const cuisine of cuisines) {
      const paths = CUISINE_BACKGROUNDS[cuisine];
      expect(paths).toHaveLength(5);
      expect(new Set(paths).size).toBe(5); // unique
      for (const p of paths) {
        expect(p).toMatch(
          new RegExp(`^/images/backgrounds/${cuisine}/0[1-5]\\.webp$`)
        );
      }
    }
  });
});
