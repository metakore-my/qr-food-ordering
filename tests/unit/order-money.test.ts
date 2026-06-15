import { describe, it, expect } from "vitest";
import {
  roundMoney,
  effectiveBasePrice,
  computeUnitPrice,
  computeOrderTotal,
} from "@/lib/order-utils";

describe("roundMoney", () => {
  it("rounds to 2 decimals", () => {
    expect(roundMoney(80)).toBe(80);
    expect(roundMoney(80.125)).toBe(80.13);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3); // float drift guard
  });
});

describe("roundMoney currency-awareness", () => {
  it("rounds to 2 decimals by default (THB)", () => {
    expect(roundMoney(10.005)).toBe(10.01);
  });
  it("rounds to whole units for zero-decimal currencies (VND)", () => {
    expect(roundMoney(50000.7, 0)).toBe(50001);
    expect(roundMoney(50000.2, 0)).toBe(50000);
  });
});

describe("effectiveBasePrice", () => {
  it("uses price for a non-combo", () => {
    expect(effectiveBasePrice({ isCombo: false, comboBasePrice: null, price: 80 })).toBe(80);
  });
  it("uses comboBasePrice for a combo with a fixed price", () => {
    expect(effectiveBasePrice({ isCombo: true, comboBasePrice: 199, price: 80 })).toBe(199);
  });
  it("falls back to price for a combo with null comboBasePrice", () => {
    expect(effectiveBasePrice({ isCombo: true, comboBasePrice: null, price: 120 })).toBe(120);
  });
});

describe("computeUnitPrice", () => {
  const plain = { isCombo: false, comboBasePrice: null, price: 80 };
  const combo = { isCombo: true, comboBasePrice: 199, price: 80 };

  it("non-combo, no adjustments", () => {
    expect(computeUnitPrice(plain, 0)).toBe(80);
  });
  it("non-combo with positive adjustment", () => {
    expect(computeUnitPrice(plain, 15)).toBe(95);
  });
  it("non-combo with negative adjustment", () => {
    expect(computeUnitPrice(plain, -10)).toBe(70);
  });
  it("combo uses fixed base + adjustments", () => {
    expect(computeUnitPrice(combo, 20)).toBe(219);
  });
  it("rounds fractional adjustments", () => {
    expect(computeUnitPrice({ ...plain, price: 80 }, 0.005)).toBe(80.01);
  });
});

describe("computeOrderTotal", () => {
  it("sums unitPrice * quantity", () => {
    expect(
      computeOrderTotal([
        { unitPrice: 80, quantity: 1 },
        { unitPrice: 50, quantity: 2 },
      ])
    ).toBe(180);
  });
  it("returns 0 for an empty order", () => {
    expect(computeOrderTotal([])).toBe(0);
  });
  it("rounds once at the end (no per-line drift)", () => {
    expect(
      computeOrderTotal([
        { unitPrice: 0.1, quantity: 1 },
        { unitPrice: 0.2, quantity: 1 },
      ])
    ).toBe(0.3);
  });
  it("handles realistic combo + sides total", () => {
    expect(
      computeOrderTotal([
        { unitPrice: 219, quantity: 1 }, // combo + adj
        { unitPrice: 70, quantity: 3 }, // 210
      ])
    ).toBe(429);
  });
});
