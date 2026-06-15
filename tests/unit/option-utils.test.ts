import { describe, it, expect } from "vitest";
import { resolveOptionName, buildNameMap } from "@/lib/option-utils";

describe("resolveOptionName — tolerant old-string + new-map reader", () => {
  it("returns an old plain-string name as-is", () => {
    expect(resolveOptionName("ขนาด", "en", "th")).toBe("ขนาด");
  });
  it("picks the viewer locale from a map", () => {
    expect(resolveOptionName({ th: "ขนาด", en: "Size" }, "en", "th")).toBe("Size");
  });
  it("falls back to canonical when the viewer locale key is absent", () => {
    expect(resolveOptionName({ th: "ขนาด" }, "en", "th")).toBe("ขนาด");
  });
  it("falls back to canonical when the viewer locale value is an empty string", () => {
    expect(resolveOptionName({ th: "ขนาด", en: "" }, "en", "th")).toBe("ขนาด");
  });
  it("falls back to the first non-empty value when neither viewer nor canonical present", () => {
    expect(resolveOptionName({ vi: "Cỡ" }, "en", "th")).toBe("Cỡ");
  });
  it("returns empty string for an empty map", () => {
    expect(resolveOptionName({}, "en", "th")).toBe("");
  });
  it("returns empty string for null / non-object", () => {
    // @ts-expect-error exercising defensive runtime path
    expect(resolveOptionName(null, "en", "th")).toBe("");
    // @ts-expect-error exercising defensive runtime path
    expect(resolveOptionName(undefined, "en", "th")).toBe("");
  });
});

describe("buildNameMap — omit-and-fall-back map builder", () => {
  const rows = [
    { locale: "th", name: "ขนาด" },
    { locale: "en", name: "Size" },
  ];
  it("includes only enabled locales that have a non-empty row", () => {
    expect(buildNameMap(rows, ["en", "th"])).toEqual({ th: "ขนาด", en: "Size" });
  });
  it("omits an enabled locale that has no row (resolves to canonical at read time)", () => {
    const map = buildNameMap([{ locale: "th", name: "ขนาด" }], ["en", "th"]);
    expect(map).toEqual({ th: "ขนาด" });
    expect(resolveOptionName(map, "en", "th")).toBe("ขนาด");
  });
  it("omits an enabled locale whose row is an empty/whitespace string", () => {
    const map = buildNameMap(
      [{ locale: "th", name: "ขนาด" }, { locale: "en", name: "  " }],
      ["en", "th"]
    );
    expect(map).toEqual({ th: "ขนาด" });
  });
  it("always includes the canonical key when any name exists", () => {
    const map = buildNameMap([{ locale: "th", name: "ขนาด" }], ["en", "th"]);
    expect(map.th).toBe("ขนาด");
  });
  it("returns an empty map for empty enabledLocales; resolves to ''", () => {
    const map = buildNameMap(rows, []);
    expect(map).toEqual({});
    expect(resolveOptionName(map, "en", "th")).toBe("");
  });
});
