import { describe, it, expect } from "vitest";
import { staffPlaceOrderSchema } from "@/lib/validations";

describe("staffPlaceOrderSchema", () => {
  it("accepts a valid staff order payload", () => {
    const r = staffPlaceOrderSchema.safeParse({
      tableNumber: 5,
      idempotencyKey: "abc-123",
      expectedTotal: 160,
      lines: [{ menuItemId: 1, quantity: 2, selectedOptions: [{ groupId: 10, choiceIds: [100] }] }],
    });
    expect(r.success).toBe(true);
  });

  it("defaults selectedOptions to [] when omitted", () => {
    const r = staffPlaceOrderSchema.safeParse({
      tableNumber: 5,
      idempotencyKey: "abc-123",
      lines: [{ menuItemId: 1, quantity: 1 }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.lines[0].selectedOptions).toEqual([]);
  });

  it("rejects an empty lines array", () => {
    const r = staffPlaceOrderSchema.safeParse({
      tableNumber: 5,
      idempotencyKey: "abc-123",
      lines: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-positive tableNumber", () => {
    const r = staffPlaceOrderSchema.safeParse({
      tableNumber: 0,
      idempotencyKey: "abc-123",
      lines: [{ menuItemId: 1, quantity: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than MAX_OPTION_GROUPS option groups on a line", () => {
    const groups = Array.from({ length: 21 }, (_, i) => ({ groupId: i + 1, choiceIds: [1] }));
    const r = staffPlaceOrderSchema.safeParse({
      tableNumber: 5,
      idempotencyKey: "abc-123",
      lines: [{ menuItemId: 1, quantity: 1, selectedOptions: groups }],
    });
    expect(r.success).toBe(false);
  });
});
