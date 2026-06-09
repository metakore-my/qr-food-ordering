import { describe, it, expect } from "vitest";
import { passwordSchema } from "@/lib/validations";

describe("passwordSchema", () => {
  it("rejects passwords shorter than 8 chars", () => {
    expect(passwordSchema.safeParse("Ab1").success).toBe(false);
  });
  it("rejects passwords longer than 16 chars", () => {
    expect(passwordSchema.safeParse("Abcdefghijk12345678").success).toBe(false);
  });
  it("rejects passwords without uppercase", () => {
    expect(passwordSchema.safeParse("abcd1234").success).toBe(false);
  });
  it("rejects passwords without lowercase", () => {
    expect(passwordSchema.safeParse("ABCD1234").success).toBe(false);
  });
  it("rejects passwords without digit", () => {
    expect(passwordSchema.safeParse("Abcdefgh").success).toBe(false);
  });
  it("accepts valid passwords", () => {
    expect(passwordSchema.safeParse("ValidPass1").success).toBe(true);
  });
  it("accepts passwords with special characters", () => {
    expect(passwordSchema.safeParse("Test1234!@").success).toBe(true);
  });
});
