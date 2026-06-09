import { describe, it, expect } from "vitest";
import { resolveSettings, SETTING_KEYS, validateSettingsInput } from "@/lib/settings";

describe("resolveSettings (DB → default; no env tier for config)", () => {
  it("falls back to defaults when DB empty", () => {
    const s = resolveSettings({});
    expect(s.appName).toBe("Restaurant");
    expect(s.currency).toBe("MYR");
    expect(s.defaultLocale).toBe("en");
    expect(s.canonicalLocale).toBe("en");
    expect(s.brandTheme).toBe("green");
  });
  it("uses DB values when present", () => {
    const s = resolveSettings({ app_name: "Som Tum House", currency: "VND" });
    expect(s.appName).toBe("Som Tum House");
    expect(s.currency).toBe("VND");
  });
  it("derives timezone + decimals from the resolved currency", () => {
    const vnd = resolveSettings({ currency: "VND" });
    expect(vnd.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(vnd.decimals).toBe(0);
    expect(resolveSettings({ currency: "MYR" }).timezone).toBe("Asia/Kuala_Lumpur");
  });
  it("rejects invalid currency on validateSettingsInput", () => {
    expect(validateSettingsInput({ currency: "NOTACODE" }).ok).toBe(false);
  });
  it("rejects default_locale outside enabled set", () => {
    expect(validateSettingsInput({ enabled_locales: "en,th", default_locale: "vi" }).ok).toBe(false);
  });
  it("exposes the full key list", () => {
    expect(SETTING_KEYS).toContain("app_name");
    expect(SETTING_KEYS).toContain("brand_theme");
  });
});
