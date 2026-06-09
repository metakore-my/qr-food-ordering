import { describe, it, expect } from "vitest";
// Import the SAME helper the API routes use — no duplicated logic that can drift.
import { isValidOrderTransition as isValidTransition } from "@/lib/order-utils";

describe("Order status transitions", () => {
  it("allows PENDING → CONFIRMED", () => {
    expect(isValidTransition("PENDING", "CONFIRMED")).toBe(true);
  });

  it("allows PENDING → DECLINED", () => {
    expect(isValidTransition("PENDING", "DECLINED")).toBe(true);
  });

  it("allows CONFIRMED → COMPLETED", () => {
    expect(isValidTransition("CONFIRMED", "COMPLETED")).toBe(true);
  });

  it("allows CONFIRMED → DECLINED", () => {
    expect(isValidTransition("CONFIRMED", "DECLINED")).toBe(true);
  });

  it("rejects PENDING → COMPLETED (must confirm first)", () => {
    expect(isValidTransition("PENDING", "COMPLETED")).toBe(false);
  });

  it("rejects COMPLETED → any status (terminal)", () => {
    expect(isValidTransition("COMPLETED", "PENDING")).toBe(false);
    expect(isValidTransition("COMPLETED", "CONFIRMED")).toBe(false);
    expect(isValidTransition("COMPLETED", "DECLINED")).toBe(false);
  });

  it("rejects DECLINED → any status (terminal)", () => {
    expect(isValidTransition("DECLINED", "PENDING")).toBe(false);
    expect(isValidTransition("DECLINED", "CONFIRMED")).toBe(false);
    expect(isValidTransition("DECLINED", "COMPLETED")).toBe(false);
  });
});
