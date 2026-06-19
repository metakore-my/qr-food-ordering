import { describe, it, expect } from "vitest";
import {
  parseDeploymentConfig,
  KNOWN_LOCALES,
  localesDefaultFirst,
} from "@/lib/deployment-config";

describe("parseDeploymentConfig", () => {
  it("returns en/THB/all-6 defaults when env is empty", () => {
    const c = parseDeploymentConfig({});
    expect(c.defaultLocale).toBe("en");
    expect(c.currency).toBe("THB");
    expect(c.timezone).toBe("Asia/Bangkok");
    expect(c.enabledLocales).toEqual([...KNOWN_LOCALES]);
  });

  it("parses a Malaysian English deployment", () => {
    const c = parseDeploymentConfig({
      NEXT_PUBLIC_DEFAULT_LOCALE: "en",
      NEXT_PUBLIC_CURRENCY: "MYR",
      NEXT_PUBLIC_ENABLED_LOCALES: "en,zh-CN",
    });
    expect(c.defaultLocale).toBe("en");
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

describe("localesDefaultFirst", () => {
  it("moves the default locale to the front, keeping the rest in canonical order", () => {
    expect(localesDefaultFirst(KNOWN_LOCALES, "zh-CN")).toEqual([
      "zh-CN",
      "en",
      "th",
      "vi",
      "zh-TW",
      "ms",
    ]);
  });

  it("is a no-op (same order) when the default is already first", () => {
    expect(localesDefaultFirst(KNOWN_LOCALES, "en")).toEqual([...KNOWN_LOCALES]);
  });

  it("moves a mid-list default (ms) to the front", () => {
    expect(localesDefaultFirst(KNOWN_LOCALES, "ms")).toEqual([
      "ms",
      "en",
      "th",
      "vi",
      "zh-CN",
      "zh-TW",
    ]);
  });

  it("returns the list unchanged when the default is not in it", () => {
    expect(localesDefaultFirst(KNOWN_LOCALES, "fr")).toEqual([...KNOWN_LOCALES]);
  });

  it("returns the list unchanged for an empty default", () => {
    expect(localesDefaultFirst(KNOWN_LOCALES, "")).toEqual([...KNOWN_LOCALES]);
  });

  it("works on an arbitrary subset (enabled-locale style), default first", () => {
    expect(localesDefaultFirst(["en", "th", "zh-CN"], "th")).toEqual([
      "th",
      "en",
      "zh-CN",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [...KNOWN_LOCALES];
    localesDefaultFirst(input, "vi");
    expect(input).toEqual([...KNOWN_LOCALES]);
  });
});
