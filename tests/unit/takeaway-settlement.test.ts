import { describe, it, expect } from "vitest";
import { settlementMode } from "@/lib/takeaway-settlement";

describe("settlementMode", () => {
  it("table-bound session settles by session (QR checkout)", () => {
    expect(settlementMode({ tableId: 5 })).toBe("session");
  });
  it("table-less session settles by order (Mark collected)", () => {
    expect(settlementMode({ tableId: null })).toBe("order");
  });
});
