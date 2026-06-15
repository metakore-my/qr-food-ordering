import { describe, it, expect } from "vitest";
import { validateSelectedOptions } from "@/lib/option-utils";

const groups = [
  { id: 1, selectionType: "SINGLE" as const, isRequired: true, choices: [{ id: 10 }, { id: 11 }] },
  { id: 2, selectionType: "MULTIPLE" as const, isRequired: false, choices: [{ id: 20 }, { id: 21 }] },
];

describe("validateSelectedOptions", () => {
  it("accepts a valid selection", () => {
    expect(validateSelectedOptions(groups, [{ groupId: 1, choiceIds: [10] }, { groupId: 2, choiceIds: [20, 21] }])).toEqual({ ok: true });
  });
  it("accepts when optional group omitted but required present", () => {
    expect(validateSelectedOptions(groups, [{ groupId: 1, choiceIds: [11] }])).toEqual({ ok: true });
  });
  it("rejects a missing required group", () => {
    const r = validateSelectedOptions(groups, [{ groupId: 2, choiceIds: [20] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("REQUIRED_MISSING");
  });
  it("rejects a SINGLE group with 2 choices", () => {
    const r = validateSelectedOptions(groups, [{ groupId: 1, choiceIds: [10, 11] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("SINGLE_CARDINALITY");
  });
  it("rejects a group not on the item", () => {
    // Satisfy the required group (1) first so the check that fires is the
    // group-not-found one for group 99 — the validator checks required-presence
    // before per-selection validity (matching the customer cart-add route order).
    const r = validateSelectedOptions(groups, [{ groupId: 1, choiceIds: [10] }, { groupId: 99, choiceIds: [1] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("GROUP_NOT_FOUND");
  });
  it("rejects a choice not in the group", () => {
    const r = validateSelectedOptions(groups, [{ groupId: 1, choiceIds: [999] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("CHOICE_NOT_FOUND");
  });
});
