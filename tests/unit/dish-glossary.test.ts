import { describe, it, expect } from "vitest";
import { DISH_GLOSSARY, lookupGlossary } from "@/lib/dish-glossary";

describe("DISH_GLOSSARY shape", () => {
  it("every entry has all 6 locale renderings, non-empty", () => {
    for (const e of DISH_GLOSSARY) {
      for (const loc of ["en", "th", "vi", "zh-CN", "zh-TW", "ms"] as const) {
        expect(e.names[loc]?.length, `${e.id}.${loc}`).toBeGreaterThan(0);
      }
    }
  });
  it("covers all four markets (Thai, Malay, Vietnamese, Chinese staples)", () => {
    const ids = new Set(DISH_GLOSSARY.map((e) => e.id));
    expect(ids.has("pad-thai")).toBe(true);
    expect(ids.has("nasi-lemak")).toBe(true);
    expect(ids.has("pho")).toBe(true);
  });
});
describe("lookupGlossary", () => {
  it("matches on any locale name, case/space tolerant", () => {
    expect(lookupGlossary("  PAD THAI ")?.id).toBe("pad-thai");
    expect(lookupGlossary("ผัดไทย")?.id).toBe("pad-thai");
    expect(lookupGlossary("Nasi Lemak")?.id).toBe("nasi-lemak");
  });
  it("returns null for an unknown dish", () => {
    expect(lookupGlossary("Mystery Special Soup")).toBeNull();
  });
});
