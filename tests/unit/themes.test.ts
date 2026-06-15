import { describe, it, expect } from "vitest";
import { resolveThemeRamp, themeCssVars, PRESET_THEMES } from "@/lib/themes";

describe("themes", () => {
  it("ships green/terracotta/indigo/amber presets", () => {
    expect(Object.keys(PRESET_THEMES)).toEqual(["green", "terracotta", "indigo", "amber"]);
    expect(PRESET_THEMES.green[500]).toBe("#005A2A");
    expect(PRESET_THEMES.terracotta[500]).toBe("#C2410C");
    expect(PRESET_THEMES.indigo[500]).toBe("#3730A3");
    expect(PRESET_THEMES.amber[500]).toBe("#B45309");
  });
  it("resolves a preset ramp by key", () => {
    expect(resolveThemeRamp("indigo", null)[500]).toBe("#3730A3");
  });
  it("derives a custom ramp from a base hex when theme=custom", () => {
    const ramp = resolveThemeRamp("custom", "#884400");
    expect(ramp[500].toLowerCase()).toBe("#884400");
    expect(Object.keys(ramp)).toHaveLength(11);
  });
  it("falls back to green for an unknown theme key", () => {
    expect(resolveThemeRamp("bogus", null)[500]).toBe("#005A2A");
  });
  it("emits CSS custom properties for all 11 shades", () => {
    const css = themeCssVars(resolveThemeRamp("green", null));
    expect(css).toContain("--color-primary-500: #005A2A");
    expect(css.match(/--color-primary-/g)).toHaveLength(11);
  });
  it("drops any shade whose value is not a strict 6-digit hex (XSS-safe by construction)", () => {
    // Even if a malformed value reaches the ramp, themeCssVars must never emit it.
    const evil = { ...resolveThemeRamp("green", null), 500: "#000;}</style><script>alert(1)</script>" } as never;
    const css = themeCssVars(evil);
    expect(css).not.toContain("<script>");
    expect(css).not.toContain("</style>");
    // the bad shade is simply omitted, the rest still emit
    expect(css).toContain("--color-primary-400:");
    expect(css).not.toContain("--color-primary-500:");
  });
});
