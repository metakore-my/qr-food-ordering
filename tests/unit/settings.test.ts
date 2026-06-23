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
  it("validates a single-field locale patch against the PERSISTED trio, not defaults", () => {
    const persisted = { enabled_locales: "en,th", default_locale: "en", canonical_locale: "en" };
    // {default_locale: "vi"} used to pass (validated against the all-6 default
    // set) and persist a default outside the enabled set.
    expect(validateSettingsInput({ default_locale: "vi" }, persisted).ok).toBe(false);
    expect(validateSettingsInput({ canonical_locale: "vi" }, persisted).ok).toBe(false);
    expect(validateSettingsInput({ default_locale: "th" }, persisted).ok).toBe(true);
  });
  it("rejects shrinking enabled_locales below the persisted default/canonical", () => {
    const persisted = { enabled_locales: "en,th,vi", default_locale: "vi", canonical_locale: "en" };
    // Removing "vi" would strand the persisted default_locale outside the set.
    expect(validateSettingsInput({ enabled_locales: "en,th" }, persisted).ok).toBe(false);
    // Shrinking is fine when the patch keeps/moves the trio consistent.
    expect(
      validateSettingsInput({ enabled_locales: "en,th", default_locale: "en" }, persisted).ok
    ).toBe(true);
  });
  it("falls back to defaults when no persisted state is supplied (setup wizard)", () => {
    // Fresh DB: any known locale is acceptable as default against the all-6 set.
    expect(validateSettingsInput({ default_locale: "vi" }).ok).toBe(true);
    expect(validateSettingsInput({ default_locale: "xx" }).ok).toBe(false);
  });
  it("accepts an http(s) logo_url and an empty (clearing) value", () => {
    expect(validateSettingsInput({ logo_url: "https://cdn.example.com/logo.png" }).ok).toBe(true);
    expect(validateSettingsInput({ logo_url: "http://example.com/l.svg" }).ok).toBe(true);
    expect(validateSettingsInput({ logo_url: "" }).ok).toBe(true); // clear the logo
  });
  it("rejects non-http(s) schemes and malformed logo_url", () => {
    expect(validateSettingsInput({ logo_url: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateSettingsInput({ logo_url: "data:text/html,<script>alert(1)</script>" }).ok).toBe(false);
    expect(validateSettingsInput({ logo_url: "not a url" }).ok).toBe(false);
  });
  it("rejects a logo_url over the 500-char cap", () => {
    const tooLong = "https://example.com/" + "a".repeat(500) + ".png";
    expect(validateSettingsInput({ logo_url: tooLong }).ok).toBe(false);
  });
  it("exposes the full key list", () => {
    expect(SETTING_KEYS).toContain("app_name");
    expect(SETTING_KEYS).toContain("brand_theme");
  });
});

describe("takeaway_enabled", () => {
  it("resolves takeawayEnabled=false by default", () => {
    expect(resolveSettings({}).takeawayEnabled).toBe(false);
  });
  it("resolves takeawayEnabled=true when the row is 'true'", () => {
    expect(resolveSettings({ takeaway_enabled: "true" }).takeawayEnabled).toBe(true);
  });
  it("resolves takeawayEnabled=false for any non-'true' value", () => {
    expect(resolveSettings({ takeaway_enabled: "false" }).takeawayEnabled).toBe(false);
    expect(resolveSettings({ takeaway_enabled: "yes" }).takeawayEnabled).toBe(false);
  });
  it("validateSettingsInput rejects a non-boolean takeaway_enabled", () => {
    const r = validateSettingsInput({ takeaway_enabled: "yes" }, resolveSettings({}), { setupComplete: true });
    expect(r.ok).toBe(false);
  });
  it("validateSettingsInput accepts 'true'/'false' (even after setup — not locked)", () => {
    expect(validateSettingsInput({ takeaway_enabled: "true" }, resolveSettings({}), { setupComplete: true }).ok).toBe(true);
    expect(validateSettingsInput({ takeaway_enabled: "false" }, resolveSettings({}), { setupComplete: true }).ok).toBe(true);
  });
});
