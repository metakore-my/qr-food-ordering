import { describe, it, expect } from "vitest";
import {
  layoutReceipt,
  wrapText,
  estimateTextWidth,
  type ReceiptData,
  type DrawOp,
} from "@/lib/receipt-layout";

function makeData(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    appName: "Test Cafe",
    logoUrl: null,
    locationLabel: "Table 5",
    dateLabel: "1 Jul 2026, 12:30",
    orders: [
      {
        title: "Order #1",
        subtotal: "RM24.00",
        items: [
          { qty: 2, name: "Nasi Lemak", options: "Spice: Hot", price: "RM24.00" },
        ],
      },
    ],
    grandTotalLabel: "Grand Total",
    grandTotal: "RM24.00",
    thankYouNote: "Your bill has been settled.",
    subtotalLabel: "Subtotal",
    ...overrides,
  };
}

function textOps(ops: DrawOp[]): Extract<DrawOp, { type: "text" }>[] {
  return ops.filter((o): o is Extract<DrawOp, { type: "text" }> => o.type === "text");
}

describe("estimateTextWidth", () => {
  it("scales linearly with font size", () => {
    const a = estimateTextWidth("hello", 10);
    const b = estimateTextWidth("hello", 20);
    expect(b).toBeCloseTo(a * 2);
  });
  it("counts CJK glyphs wider than Latin", () => {
    const cjk = estimateTextWidth("中文", 16);
    const latin = estimateTextWidth("ab", 16);
    expect(cjk).toBeGreaterThan(latin);
  });
  it("empty string is zero width", () => {
    expect(estimateTextWidth("", 16)).toBe(0);
  });
});

describe("wrapText", () => {
  it("keeps a short line as one line", () => {
    expect(wrapText("Nasi Lemak", 1000, 15)).toEqual(["Nasi Lemak"]);
  });
  it("wraps a long line to multiple lines", () => {
    const long = "Grilled chicken with extra sauce and a side of vegetables and rice";
    const lines = wrapText(long, 120, 15);
    expect(lines.length).toBeGreaterThan(1);
    // No wrapped line exceeds the width (allowing the estimator's own margin).
    for (const line of lines) {
      expect(estimateTextWidth(line, 15)).toBeLessThanOrEqual(120 + estimateTextWidth(" x", 15));
    }
  });
  it("hard-breaks a single token longer than the line", () => {
    const token = "x".repeat(200);
    const lines = wrapText(token, 100, 15);
    expect(lines.length).toBeGreaterThan(1);
  });
  it("returns a single empty string for empty input", () => {
    expect(wrapText("", 100, 15)).toEqual([""]);
  });
});

describe("layoutReceipt", () => {
  it("always emits a logoSlot op (wrapper fills it if the logo loads)", () => {
    const layout = layoutReceipt(makeData({ logoUrl: null }));
    expect(layout.ops.some((o) => o.type === "logoSlot")).toBe(true);
  });

  it("always emits the app-name as a text header, logo-independent", () => {
    const layout = layoutReceipt(makeData({ appName: "My Restaurant", logoUrl: null }));
    expect(textOps(layout.ops).some((o) => o.text === "My Restaurant")).toBe(true);
  });

  it("passes money/label strings through verbatim (no reformatting)", () => {
    const layout = layoutReceipt(makeData());
    const texts = textOps(layout.ops).map((o) => o.text);
    expect(texts).toContain("RM24.00"); // grand total + line price + subtotal
    expect(texts).toContain("Grand Total");
    expect(texts).toContain("Subtotal");
    expect(texts).toContain("Order #1");
  });

  it("renders the location label exactly as given (table or takeaway)", () => {
    const table = layoutReceipt(makeData({ locationLabel: "Table 5" }));
    expect(textOps(table.ops).some((o) => o.text.includes("Table 5"))).toBe(true);

    const takeaway = layoutReceipt(makeData({ locationLabel: "Takeaway" }));
    expect(textOps(takeaway.ops).some((o) => o.text.includes("Takeaway"))).toBe(true);
  });

  it("includes each item name and its option note", () => {
    const layout = layoutReceipt(makeData());
    const texts = textOps(layout.ops).map((o) => o.text);
    expect(texts.some((t) => t.includes("Nasi Lemak"))).toBe(true);
    expect(texts).toContain("Spice: Hot");
  });

  it("omits the option line when an item has no options", () => {
    const layout = layoutReceipt(
      makeData({
        orders: [
          {
            title: "Order #1",
            subtotal: "RM10.00",
            items: [{ qty: 1, name: "Teh Tarik", options: "", price: "RM10.00" }],
          },
        ],
      })
    );
    // "Spice: Hot" no longer present; only the item line.
    expect(textOps(layout.ops).some((o) => o.text === "Spice: Hot")).toBe(false);
  });

  it("grows in height as more orders/items are added", () => {
    const one = layoutReceipt(makeData());
    const many = layoutReceipt(
      makeData({
        orders: [
          makeData().orders[0],
          {
            title: "Order #2",
            subtotal: "RM30.00",
            items: [
              { qty: 1, name: "Char Kway Teow", options: "", price: "RM12.00" },
              { qty: 1, name: "Roti Canai", options: "Extra: Egg", price: "RM6.00" },
              { qty: 2, name: "Kopi O", options: "", price: "RM12.00" },
            ],
          },
        ],
      })
    );
    expect(many.height).toBeGreaterThan(one.height);
  });

  it("returns a positive content-sized canvas", () => {
    const layout = layoutReceipt(makeData());
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(Number.isInteger(layout.height)).toBe(true);
  });

  it("respects a custom width option", () => {
    const layout = layoutReceipt(makeData(), { width: 500 });
    expect(layout.width).toBe(500);
  });
});
