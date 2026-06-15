import { describe, it, expect } from "vitest";
// Import the SAME helper the report routes use — no duplicated logic that can drift.
import { resolveRange, RangeError } from "@/lib/report-utils";

const TZ = "Asia/Bangkok"; // +07:00, DST-free — exact day boundaries
const NOW = new Date("2025-06-15T10:00:00Z");

function params(obj: Record<string, string>): URLSearchParams {
  return new URLSearchParams(obj);
}

describe("resolveRange — preset mode", () => {
  it("defaults to 1d when no params given", () => {
    const r = resolveRange(params({}), TZ, NOW);
    expect(r.mode).toBe("preset");
    expect(r.label).toBe("1d");
    expect(r.until.getTime()).toBe(NOW.getTime());
    expect(NOW.getTime() - r.cutoff.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("resolves 90d to a 90-day rolling window", () => {
    const r = resolveRange(params({ range: "90d" }), TZ, NOW);
    expect(NOW.getTime() - r.cutoff.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it("rejects an unknown preset with INVALID_RANGE", () => {
    try {
      resolveRange(params({ range: "5y" }), TZ, NOW);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      expect((e as RangeError).code).toBe("INVALID_RANGE");
    }
  });
});

describe("resolveRange — custom mode", () => {
  it("resolves an explicit from/to to day boundaries (to is inclusive)", () => {
    const r = resolveRange(params({ from: "2025-01-01", to: "2025-01-31" }), TZ, NOW);
    expect(r.mode).toBe("custom");
    // cutoff = 1 Jan 00:00 Bangkok = 31 Dec 17:00 UTC
    expect(r.cutoff.toISOString()).toBe("2024-12-31T17:00:00.000Z");
    // until = 1 Feb 00:00 Bangkok (exclusive) = 31 Jan 17:00 UTC — includes all of 31 Jan
    expect(r.until.toISOString()).toBe("2025-01-31T17:00:00.000Z");
  });

  it("a single-day range covers exactly that day", () => {
    const r = resolveRange(params({ from: "2025-03-10", to: "2025-03-10" }), TZ, NOW);
    expect(r.until.getTime() - r.cutoff.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("custom takes precedence over a preset when both present", () => {
    const r = resolveRange(params({ range: "1h", from: "2025-01-01", to: "2025-01-02" }), TZ, NOW);
    expect(r.mode).toBe("custom");
  });

  it("rejects from > to", () => {
    try {
      resolveRange(params({ from: "2025-02-01", to: "2025-01-01" }), TZ, NOW);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as RangeError).code).toBe("INVALID_RANGE");
    }
  });

  it("rejects malformed dates", () => {
    try {
      resolveRange(params({ from: "01/01/2025", to: "2025-01-31" }), TZ, NOW);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as RangeError).code).toBe("INVALID_RANGE");
    }
  });

  it("rejects only one of from/to (both required)", () => {
    try {
      resolveRange(params({ from: "2025-01-01" }), TZ, NOW);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as RangeError).code).toBe("INVALID_RANGE");
    }
  });

  it("rejects a span beyond the 90-day retention horizon with RANGE_TOO_LARGE", () => {
    try {
      // 1 Jan → 1 May is ~121 days
      resolveRange(params({ from: "2025-01-01", to: "2025-05-01" }), TZ, NOW);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as RangeError).code).toBe("RANGE_TOO_LARGE");
    }
  });

  it("accepts a span of exactly 90 days", () => {
    // 1 Jan → 31 Mar inclusive = 90 days
    const r = resolveRange(params({ from: "2025-01-01", to: "2025-03-31" }), TZ, NOW);
    expect(r.mode).toBe("custom");
  });

  it("rejects calendar-overflow dates that JS Date silently rolls forward", () => {
    // new Date("2025-02-30") does NOT return Invalid Date — it overflows to
    // Mar 2. A shape-only regex + isNaN check would let it through and snap the
    // window to the wrong day. These must be rejected as INVALID_RANGE.
    for (const bad of ["2025-02-30", "2025-04-31", "2025-13-01", "2025-00-10"]) {
      try {
        resolveRange(params({ from: bad, to: "2025-05-01" }), TZ, NOW);
        throw new Error(`should have thrown for ${bad}`);
      } catch (e) {
        expect((e as RangeError).code).toBe("INVALID_RANGE");
      }
    }
  });

  it("accepts a valid leap day", () => {
    const r = resolveRange(params({ from: "2024-02-29", to: "2024-02-29" }), TZ, NOW);
    expect(r.mode).toBe("custom");
  });
});
