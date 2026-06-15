import { describe, it, expect, beforeAll } from "vitest";
import { signTableToken, verifyTableToken } from "@/lib/qr";

beforeAll(() => {
  process.env.QR_SECRET = "test-secret-for-unit-tests";
});

describe("QR token signing", () => {
  it("generates a valid signed token for a table", () => {
    const token = signTableToken(1, "table-uuid-123");
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
  });

  it("verifies a valid token", () => {
    const token = signTableToken(1, "table-uuid-123");
    const result = verifyTableToken(token);
    expect(result).toEqual({ tableId: 1, tableToken: "table-uuid-123" });
  });

  it("rejects a tampered token", () => {
    const token = signTableToken(1, "table-uuid-123");
    const tampered = token.slice(0, -5) + "xxxxx";
    expect(() => verifyTableToken(tampered)).toThrow();
  });
});
