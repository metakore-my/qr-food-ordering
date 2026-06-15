import { describe, it, expect } from "vitest";
import {
  resolveAppName,
  resolveSettings,
  pruneAppNameI18n,
  swapDefaultLocaleName,
} from "@/lib/settings";

describe("swapDefaultLocaleName — moving the main name when the default locale changes", () => {
  // app_name always holds the DEFAULT locale's name; app_name_i18n holds the
  // others. When the operator switches the default locale, the slots must swap:
  // the new default's name moves OUT of the map INTO app_name, and the old
  // default's app_name moves INTO the map. Otherwise the old main name is lost
  // and the new default's name is dropped on save (filtered as `loc === default`).
  const main = "Oriental Kopi"; // en (old default)
  const i18n = { "zh-CN": "华阳", ms: "Kopi Oriental" };

  it("swaps en→zh-CN: zh-CN name becomes main, old en name moves into the map", () => {
    const r = swapDefaultLocaleName(main, i18n, "en", "zh-CN");
    expect(r.appName).toBe("华阳");
    expect(r.appNameI18n).toEqual({ en: "Oriental Kopi", ms: "Kopi Oriental" });
    expect(r.appNameI18n["zh-CN"]).toBeUndefined(); // new default no longer in map
  });

  it("is reversible: switching back zh-CN→en restores the original", () => {
    const fwd = swapDefaultLocaleName(main, i18n, "en", "zh-CN");
    const back = swapDefaultLocaleName(fwd.appName, fwd.appNameI18n, "zh-CN", "en");
    expect(back.appName).toBe("Oriental Kopi");
    expect(back.appNameI18n).toEqual({ "zh-CN": "华阳", ms: "Kopi Oriental" });
  });

  it("when the new default has no name in the map, main becomes empty (operator fills it)", () => {
    const r = swapDefaultLocaleName(main, { ms: "Kopi Oriental" }, "en", "zh-CN");
    expect(r.appName).toBe("");
    expect(r.appNameI18n).toEqual({ en: "Oriental Kopi", ms: "Kopi Oriental" });
  });

  it("does not store an empty old-default name into the map", () => {
    const r = swapDefaultLocaleName("", { "zh-CN": "华阳" }, "en", "zh-CN");
    expect(r.appName).toBe("华阳");
    expect(r.appNameI18n.en).toBeUndefined(); // empty old name not stored
  });

  it("is a no-op when old and new locale are the same", () => {
    const r = swapDefaultLocaleName(main, i18n, "en", "en");
    expect(r.appName).toBe(main);
    expect(r.appNameI18n).toEqual(i18n);
  });

  it("does not mutate the input map", () => {
    const orig = { "zh-CN": "华阳", ms: "Kopi Oriental" };
    swapDefaultLocaleName(main, orig, "en", "zh-CN");
    expect(orig).toEqual({ "zh-CN": "华阳", ms: "Kopi Oriental" });
  });
});

describe("pruneAppNameI18n", () => {
  it("drops entries for locales no longer enabled", () => {
    const map = { "zh-CN": "日出咖啡", th: "ซันไรส์", vi: "Bình Minh" };
    // vi disabled (no longer in the enabled set)
    expect(pruneAppNameI18n(map, ["en", "zh-CN", "th"])).toEqual({
      "zh-CN": "日出咖啡",
      th: "ซันไรส์",
    });
  });
  it("keeps every entry when all their locales are still enabled", () => {
    const map = { "zh-CN": "日出咖啡", th: "ซันไรส์" };
    expect(pruneAppNameI18n(map, ["en", "zh-CN", "th", "vi"])).toEqual(map);
  });
  it("returns an empty map when no locale is enabled (degenerate)", () => {
    expect(pruneAppNameI18n({ "zh-CN": "日出咖啡" }, ["en"])).toEqual({});
  });
  it("handles an empty map", () => {
    expect(pruneAppNameI18n({}, ["en", "zh-CN"])).toEqual({});
  });
  it("does not mutate the input map", () => {
    const map = { "zh-CN": "日出咖啡", vi: "Bình Minh" };
    const out = pruneAppNameI18n(map, ["en", "zh-CN"]);
    expect(map).toEqual({ "zh-CN": "日出咖啡", vi: "Bình Minh" }); // unchanged
    expect(out).toEqual({ "zh-CN": "日出咖啡" });
  });
});

describe("resolveAppName", () => {
  const i18n = { "zh-CN": "日出咖啡", th: "" };

  it("returns the locale-specific name when present", () => {
    expect(resolveAppName("Sunrise Cafe", i18n, "zh-CN")).toBe("日出咖啡");
  });
  it("falls back to the main name when the locale is absent", () => {
    expect(resolveAppName("Sunrise Cafe", i18n, "vi")).toBe("Sunrise Cafe");
  });
  it("falls back to the main name when the locale value is empty/whitespace", () => {
    expect(resolveAppName("Sunrise Cafe", i18n, "th")).toBe("Sunrise Cafe");
    expect(resolveAppName("Sunrise Cafe", { en: "   " }, "en")).toBe("Sunrise Cafe");
  });
  it("falls back to the main name when the map is empty", () => {
    expect(resolveAppName("Sunrise Cafe", {}, "zh-CN")).toBe("Sunrise Cafe");
  });
});

describe("resolveSettings — app_name_i18n parsing", () => {
  it("parses a valid app_name_i18n JSON row into appNameI18n", () => {
    const s = resolveSettings({
      app_name: "Sunrise Cafe",
      app_name_i18n: JSON.stringify({ "zh-CN": "日出咖啡" }),
    });
    expect(s.appName).toBe("Sunrise Cafe");
    expect(s.appNameI18n).toEqual({ "zh-CN": "日出咖啡" });
  });
  it("tolerates malformed app_name_i18n JSON → empty map", () => {
    const s = resolveSettings({ app_name: "X", app_name_i18n: "{not json" });
    expect(s.appNameI18n).toEqual({});
  });
  it("defaults appNameI18n to {} when the row is absent", () => {
    const s = resolveSettings({ app_name: "X" });
    expect(s.appNameI18n).toEqual({});
  });
  it("ignores a non-object app_name_i18n value → empty map", () => {
    const s = resolveSettings({ app_name: "X", app_name_i18n: JSON.stringify(["a"]) });
    expect(s.appNameI18n).toEqual({});
  });
});
