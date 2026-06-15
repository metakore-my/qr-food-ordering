import { describe, it, expect } from "vitest";
import { validateSettingsInput, isSettingsLockActive } from "@/lib/settings";

// Regression for the seeded-deploy lock bypass: the settings PATCH derives
// `setupComplete` from this helper. The lock MUST engage when an admin exists,
// even if the `setup_completed` sentinel was never written — which is exactly
// the seed path (SEED_SUPERADMIN_PASSWORD set), where an admin exists from boot
// but the seed never writes the sentinel and the wizard (the only sentinel
// writer) is locked out. Deriving the lock from the sentinel ALONE left seeded
// production deploys permanently unlocked → a SUPERADMIN could change currency
// and canonical_locale post-setup, corrupting stored money precision and
// historical-order name resolution.
describe("isSettingsLockActive — settings lock derivation", () => {
  it("LOCKS when an admin exists even with NO sentinel (the seed path)", () => {
    expect(isSettingsLockActive(true, undefined)).toBe(true);
  });
  it("LOCKS when an admin exists and the sentinel is also set (wizard path, completed)", () => {
    expect(isSettingsLockActive(true, "true")).toBe(true);
  });
  it("LOCKS when the sentinel is set even with no admin (defensive backstop)", () => {
    expect(isSettingsLockActive(false, "true")).toBe(true);
  });
  it("does NOT lock when no admin exists and no sentinel (fresh DB / mid-wizard)", () => {
    expect(isSettingsLockActive(false, undefined)).toBe(false);
  });
  it("does NOT lock for a non-'true' sentinel value with no admin", () => {
    expect(isSettingsLockActive(false, "false")).toBe(false);
    expect(isSettingsLockActive(false, "")).toBe(false);
  });
});

const current = {
  app_name: "Sunrise",
  currency: "MYR",
  canonical_locale: "en",
  default_locale: "en",
  enabled_locales: "en,zh-CN",
};

describe("validateSettingsInput — locked-after-setup", () => {
  it("rejects a currency change when setup is complete", () => {
    const r = validateSettingsInput({ currency: "THB" }, current, { setupComplete: true });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SETTING_LOCKED");
  });
  it("rejects a canonical_locale change when setup is complete", () => {
    const r = validateSettingsInput({ canonical_locale: "zh-CN" }, current, { setupComplete: true });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SETTING_LOCKED");
  });
  it("ALLOWS a default_locale change when setup is complete (display-only, not locked)", () => {
    const r = validateSettingsInput({ default_locale: "zh-CN" }, current, { setupComplete: true });
    expect(r.ok).toBe(true);
  });
  it("allows a no-op re-submit of the same locked values when complete", () => {
    const r = validateSettingsInput(
      { currency: "MYR", canonical_locale: "en" },
      current,
      { setupComplete: true }
    );
    expect(r.ok).toBe(true);
  });
  it("allows locked-key changes when setup is NOT complete (pre-setup)", () => {
    const r = validateSettingsInput({ currency: "THB", canonical_locale: "zh-CN" }, current, { setupComplete: false });
    expect(r.ok).toBe(true);
  });
  it("defaults setupComplete to false when opts omitted (setup path)", () => {
    const r = validateSettingsInput({ currency: "THB" }, current);
    expect(r.ok).toBe(true);
  });
  it("allows editable keys (app_name, default_locale, enabled_locales) when complete", () => {
    const r = validateSettingsInput(
      { app_name: "New Name", default_locale: "zh-CN", enabled_locales: "en,zh-CN,ms" },
      current,
      { setupComplete: true }
    );
    expect(r.ok).toBe(true);
  });
});

describe("validateSettingsInput — app_name_i18n map", () => {
  it("accepts a valid map keyed by enabled locales", () => {
    const r = validateSettingsInput(
      { app_name_i18n: JSON.stringify({ "zh-CN": "日出咖啡" }) },
      current
    );
    expect(r.ok).toBe(true);
  });
  it("accepts an empty map", () => {
    const r = validateSettingsInput({ app_name_i18n: "{}" }, current);
    expect(r.ok).toBe(true);
  });
  it("rejects non-JSON", () => {
    const r = validateSettingsInput({ app_name_i18n: "{nope" }, current);
    expect(r.ok).toBe(false);
  });
  it("rejects a non-object (array)", () => {
    const r = validateSettingsInput({ app_name_i18n: JSON.stringify(["x"]) }, current);
    expect(r.ok).toBe(false);
  });
  it("rejects a key not in the enabled set", () => {
    const r = validateSettingsInput(
      { app_name_i18n: JSON.stringify({ vi: "Bình Minh" }) },
      current
    );
    expect(r.ok).toBe(false);
  });
  it("rejects an oversized value (>100 chars)", () => {
    const r = validateSettingsInput(
      { app_name_i18n: JSON.stringify({ "zh-CN": "x".repeat(101) }) },
      current
    );
    expect(r.ok).toBe(false);
  });
});
