import { describe, it, expect } from "vitest";

// Mirrors the cart dedup serialization logic from the cart POST route
function serializeOptions(
  selectedOptions: Array<{ groupId: number; choiceIds: number[] }>
): string {
  return JSON.stringify(
    [...selectedOptions]
      .sort((a, b) => a.groupId - b.groupId)
      .map((s) => ({
        groupId: s.groupId,
        choiceIds: [...s.choiceIds].sort((a, b) => a - b),
      }))
  );
}

describe("Cart deduplication", () => {
  it("produces the same key for identical options", () => {
    const opts = [
      { groupId: 1, choiceIds: [10, 20] },
      { groupId: 2, choiceIds: [30] },
    ];
    expect(serializeOptions(opts)).toBe(serializeOptions(opts));
  });

  it("produces the same key regardless of group order", () => {
    const a = [
      { groupId: 2, choiceIds: [30] },
      { groupId: 1, choiceIds: [10] },
    ];
    const b = [
      { groupId: 1, choiceIds: [10] },
      { groupId: 2, choiceIds: [30] },
    ];
    expect(serializeOptions(a)).toBe(serializeOptions(b));
  });

  it("produces the same key regardless of choice order", () => {
    const a = [{ groupId: 1, choiceIds: [20, 10, 30] }];
    const b = [{ groupId: 1, choiceIds: [10, 30, 20] }];
    expect(serializeOptions(a)).toBe(serializeOptions(b));
  });

  it("produces different keys for different choices", () => {
    const a = [{ groupId: 1, choiceIds: [10] }];
    const b = [{ groupId: 1, choiceIds: [20] }];
    expect(serializeOptions(a)).not.toBe(serializeOptions(b));
  });

  it("handles empty options", () => {
    expect(serializeOptions([])).toBe("[]");
  });
});
