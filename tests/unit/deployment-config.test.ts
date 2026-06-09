import { describe, it, expect } from "vitest";
import { parseDeploymentConfig, KNOWN_LOCALES } from "@/lib/deployment-config";

describe("parseDeploymentConfig", () => {
  it("returns en/THB/all-6 defaults when env is empty", () => {
    const c = parseDeploymentConfig({});
    expect(c.defaultLocale).toBe("en");
    expect(c.canonicalLocale).toBe("en");
    expect(c.currency).toBe("THB");
    expect(c.timezone).toBe("Asia/Bangkok");
    expect(c.enabledLocales).toEqual([...KNOWN_LOCALES]);
  });

  it("parses a Malaysian English deployment", () => {
    const c = parseDeploymentConfig({
      NEXT_PUBLIC_DEFAULT_LOCALE: "en",
      NEXT_PUBLIC_CANONICAL_LOCALE: "en",
      NEXT_PUBLIC_CURRENCY: "MYR",
      NEXT_PUBLIC_ENABLED_LOCALES: "en,zh-CN",
    });
    expect(c.defaultLocale).toBe("en");
    expect(c.canonicalLocale).toBe("en");
    expect(c.currency).toBe("MYR");
    expect(c.enabledLocales).toEqual(["en", "zh-CN"]);
  });

  it("accepts any valid ISO 4217 code, not just launch currencies", () => {
    expect(parseDeploymentConfig({ NEXT_PUBLIC_CURRENCY: "USD" }).currency).toBe("USD");
    expect(parseDeploymentConfig({ NEXT_PUBLIC_CURRENCY: "JPY" }).currency).toBe("JPY");
  });

  it("throws on a malformed / non-ISO currency code", () => {
    expect(() => parseDeploymentConfig({ NEXT_PUBLIC_CURRENCY: "XX" })).toThrow(/currency/i);
    expect(() => parseDeploymentConfig({ NEXT_PUBLIC_CURRENCY: "BAHT" })).toThrow(/currency/i);
  });

  it("throws when an enabled locale is not a known locale", () => {
    expect(() =>
      parseDeploymentConfig({ NEXT_PUBLIC_ENABLED_LOCALES: "en,fr" })
    ).toThrow(/locale/i);
  });

  it("throws when defaultLocale is not in the enabled set", () => {
    expect(() =>
      parseDeploymentConfig({
        NEXT_PUBLIC_DEFAULT_LOCALE: "vi",
        NEXT_PUBLIC_ENABLED_LOCALES: "en,th",
      })
    ).toThrow(/default/i);
  });

  it("throws when canonicalLocale is not in the enabled set", () => {
    expect(() =>
      parseDeploymentConfig({
        NEXT_PUBLIC_CANONICAL_LOCALE: "vi",
        NEXT_PUBLIC_ENABLED_LOCALES: "en,th",
      })
    ).toThrow(/canonical/i);
  });
});

describe("timezone derivation", () => {
  it("defaults to Asia/Bangkok when currency is THB (or unset)", () => {
    expect(parseDeploymentConfig({}).timezone).toBe("Asia/Bangkok");
    expect(
      parseDeploymentConfig({ NEXT_PUBLIC_CURRENCY: "THB" }).timezone
    ).toBe("Asia/Bangkok");
  });

  it("maps MYR to Asia/Kuala_Lumpur", () => {
    expect(
      parseDeploymentConfig({ NEXT_PUBLIC_CURRENCY: "MYR" }).timezone
    ).toBe("Asia/Kuala_Lumpur");
  });

  it("maps SGD to Asia/Singapore", () => {
    expect(
      parseDeploymentConfig({ NEXT_PUBLIC_CURRENCY: "SGD" }).timezone
    ).toBe("Asia/Singapore");
  });

  it("falls back to Asia/Bangkok for an unmapped (but valid) currency", () => {
    expect(
      parseDeploymentConfig({ NEXT_PUBLIC_CURRENCY: "USD" }).timezone
    ).toBe("Asia/Bangkok");
  });

  it("is case-insensitive on the currency code (myr -> KL)", () => {
    expect(
      parseDeploymentConfig({ NEXT_PUBLIC_CURRENCY: "myr" }).timezone
    ).toBe("Asia/Kuala_Lumpur");
  });
});
