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

  // COMPLETED is reachable ONLY through the /checkout settlement flow (which
  // uses a direct updateMany, bypassing this transition map) — i.e. an order is
  // COMPLETED if and only if staff settled the table. The admin order-PATCH must
  // NOT be able to complete an order directly, or it could mint a settled-sale
  // (revenue, 90-day-retained) record without a checkout. So CONFIRMED → COMPLETED
  // is rejected here by design.
  it("rejects CONFIRMED → COMPLETED via PATCH (completion is checkout-only)", () => {
    expect(isValidTransition("CONFIRMED", "COMPLETED")).toBe(false);
  });

  it("allows CONFIRMED → DECLINED", () => {
    expect(isValidTransition("CONFIRMED", "DECLINED")).toBe(true);
  });

  it("rejects PENDING → COMPLETED (completion is checkout-only)", () => {
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
