import { describe, it, expect } from "vitest";
import { toLatin1Title } from "@/lib/openrouter";

/**
 * Regression guard for the OpenRouter `X-Title` header.
 *
 * HTTP header values must be Latin-1 (ByteString, code points 0–255). The app
 * name is runtime DB config and is routinely non-Latin-1 for our markets, so a
 * raw `X-Title: ${appName} Food Ordering` made `fetch` throw "Cannot convert
 * argument to a ByteString" BEFORE the request was sent — breaking menu extract,
 * translate, and translate-options for every non-ASCII-named restaurant.
 *
 * The single load-bearing invariant: the result must ALWAYS be encodable as a
 * ByteString. We assert that directly (every char code <= 255) on every case.
 */

// Mirrors what `fetch` does internally when building a header value.
function isByteStringEncodable(s: string): boolean {
  for (const ch of s) {
    if (ch.codePointAt(0)! > 0xff) return false;
  }
  return true;
}

describe("toLatin1Title — Latin-1-safe X-Title header", () => {
  it("strips Thai characters (the reported bug)", () => {
    const out = toLatin1Title("ครัวบ้านไทย");
    expect(out).toBe("QR Food Ordering"); // nothing Latin-1 survives -> fallback base
    expect(isByteStringEncodable(out)).toBe(true);
  });

  it("strips Chinese characters", () => {
    expect(toLatin1Title("小厨房")).toBe("QR Food Ordering");
  });

  it("keeps a plain ASCII name unchanged", () => {
    expect(toLatin1Title("Baan Thai")).toBe("Baan Thai Food Ordering");
  });

  it("keeps the ASCII remainder of a mixed name", () => {
    expect(toLatin1Title("Som Tam ส้มตำ House")).toBe("Som Tam House Food Ordering");
  });

  it("preserves accented Latin-1 characters (é ñ ü)", () => {
    // These are valid Latin-1 (<= 0xFF), so they survive — and stay encodable.
    expect(toLatin1Title("Ñoño Café")).toBe("Ñoño Café Food Ordering");
    expect(isByteStringEncodable(toLatin1Title("Ñoño Café"))).toBe(true);
  });

  it("collapses whitespace left behind after stripping", () => {
    // After removing the Thai run, the two surrounding spaces collapse to one.
    expect(toLatin1Title("A  ไทย  B")).toBe("A B Food Ordering");
  });

  it("falls back when the name is empty or whitespace-only", () => {
    expect(toLatin1Title("")).toBe("QR Food Ordering");
    expect(toLatin1Title("   ")).toBe("QR Food Ordering");
    expect(toLatin1Title("　")).toBe("QR Food Ordering"); // ideographic space (U+3000)
  });

  it("drops emoji and control characters but keeps printable text", () => {
    expect(toLatin1Title("Noodle🍜 99")).toBe("Noodle 99 Food Ordering");
    expect(toLatin1Title("Tab\tHere")).toBe("Tab Here Food Ordering"); // \t -> stripped/collapsed
  });

  it("always produces a ByteString-encodable header value", () => {
    const names = [
      "ครัวบ้านไทย",
      "小厨房",
      "Phở Việt",
      "Nasi Lemak 🇲🇾",
      "Restaurant",
      "",
      "   ",
      "Ñoño Café",
      "ﾗｰﾒﾝ 日本",
    ];
    for (const n of names) {
      expect(isByteStringEncodable(toLatin1Title(n))).toBe(true);
    }
  });
});
