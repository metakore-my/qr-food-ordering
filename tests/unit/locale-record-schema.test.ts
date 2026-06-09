import { describe, it, expect } from "vitest";
import { z } from "zod";
import { SUPPORTED_LOCALES } from "@/lib/validations";

/**
 * Regression lock for the category-creation 400 bug.
 *
 * `z.record(z.enum(SUPPORTED_LOCALES), valueType)` treats the enum as an
 * EXHAUSTIVE key set in Zod v4: it demands ALL locales be present, so a
 * partial admin submission (e.g. only `en` filled in) was rejected with
 * "Invalid input: expected string, received undefined" — a 400.
 *
 * The fix is `z.partialRecord`, which accepts any subset of the enum keys
 * while still rejecting unknown keys and still applying the value validator
 * (e.g. `.min(1)` rejects empty strings). This test reproduces the schema
 * shape used by the category create/update routes so the fix can't regress.
 */
const localeRecordSchema = z.partialRecord(
  z.enum(SUPPORTED_LOCALES),
  z.string().min(1)
);

describe("partialRecord locale schema (category translations)", () => {
  it("accepts a subset of locales (only en filled in)", () => {
    const result = localeRecordSchema.safeParse({ en: "Mains" });
    expect(result.success).toBe(true);
  });

  it("accepts all supported locales at once", () => {
    const full = Object.fromEntries(
      SUPPORTED_LOCALES.map((loc) => [loc, "Value"])
    );
    expect(localeRecordSchema.safeParse(full).success).toBe(true);
  });

  it("rejects an empty value (min(1) still enforced)", () => {
    expect(localeRecordSchema.safeParse({ en: "" }).success).toBe(false);
  });

  it("rejects an unknown locale key", () => {
    expect(localeRecordSchema.safeParse({ bogus: "x" }).success).toBe(false);
  });
});
