import { describe, it, expect } from "vitest";
import { buildTranslatePrompt } from "@/lib/openrouter";

describe("buildTranslatePrompt", () => {
  it("names the given source locale as the source of truth", () => {
    const p = buildTranslatePrompt("zh-CN");
    expect(p).toMatch(/zh-CN/);
    expect(p.toLowerCase()).toMatch(/source of truth|primary reference|source language/);
  });

  it("defaults to English when no source locale is given", () => {
    const p = buildTranslatePrompt();
    expect(p).toMatch(/English|\ben\b/);
  });
});

import { buildTranslatePrompt as btp } from "@/lib/openrouter";

describe("buildTranslatePrompt — glossary injection", () => {
  it("injects canonical names for matched source names", () => {
    const p = btp("th", ["ผัดไทย"]);
    expect(p).toMatch(/Pad Thai/);
    expect(p).toMatch(/泰式炒河粉/);
  });
  it("omits the glossary block when no names match", () => {
    const p = btp("en", ["Mystery Special Soup"]);
    expect(p).not.toMatch(/GLOSSARY|use these exact names/i);
  });
  it("still works with no names arg (backward compatible)", () => {
    expect(btp("zh-CN")).toMatch(/zh-CN/);
  });
});
