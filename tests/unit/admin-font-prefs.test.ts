import { describe, it, expect } from "vitest";
import {
  ADMIN_FONT_SIZES,
  DEFAULT_ADMIN_FONT_SIZE,
  DEFAULT_ADMIN_FONT_PREFS,
  clampFontSize,
  pxForFontSize,
  sanitizeFontPrefs,
} from "@/lib/admin-font-prefs";

describe("admin-font-prefs catalog + defaults", () => {
  it("exposes exactly small/medium/large", () => {
    expect(ADMIN_FONT_SIZES.map((s) => s.id)).toEqual(["small", "medium", "large"]);
  });

  it("defaults to medium (today's 16px baseline)", () => {
    expect(DEFAULT_ADMIN_FONT_SIZE).toBe("medium");
    expect(DEFAULT_ADMIN_FONT_PREFS).toEqual({ size: "medium" });
    expect(pxForFontSize("medium")).toBe(16);
  });

  it("maps each size to its px", () => {
    expect(pxForFontSize("small")).toBe(15);
    expect(pxForFontSize("medium")).toBe(16);
    expect(pxForFontSize("large")).toBe(18);
  });
});

describe("clampFontSize — tolerant id reader", () => {
  it("keeps a valid id", () => {
    expect(clampFontSize("small")).toBe("small");
    expect(clampFontSize("large")).toBe("large");
  });

  it("falls back to default for unknown / legacy / wrong-type / null", () => {
    expect(clampFontSize("xl")).toBe("medium");
    expect(clampFontSize(null)).toBe("medium");
    expect(clampFontSize(42)).toBe("medium");
    expect(clampFontSize(undefined)).toBe("medium");
    expect(clampFontSize({})).toBe("medium");
  });

  it("pxForFontSize falls back to medium px for a bad id", () => {
    // @ts-expect-error testing runtime tolerance
    expect(pxForFontSize("bogus")).toBe(16);
  });
});

describe("sanitizeFontPrefs — total, never throws", () => {
  it("passes a valid object through", () => {
    expect(sanitizeFontPrefs({ size: "large" }, DEFAULT_ADMIN_FONT_PREFS)).toEqual({ size: "large" });
  });

  it("falls back to defaults for null / non-object / junk", () => {
    expect(sanitizeFontPrefs(null, DEFAULT_ADMIN_FONT_PREFS)).toEqual(DEFAULT_ADMIN_FONT_PREFS);
    expect(sanitizeFontPrefs("nope", DEFAULT_ADMIN_FONT_PREFS)).toEqual(DEFAULT_ADMIN_FONT_PREFS);
    expect(sanitizeFontPrefs(7, DEFAULT_ADMIN_FONT_PREFS)).toEqual(DEFAULT_ADMIN_FONT_PREFS);
  });

  it("coerces an invalid size field to the default", () => {
    expect(sanitizeFontPrefs({ size: "huge" }, DEFAULT_ADMIN_FONT_PREFS)).toEqual({ size: "medium" });
    expect(sanitizeFontPrefs({ size: 5 }, DEFAULT_ADMIN_FONT_PREFS)).toEqual({ size: "medium" });
  });
});
