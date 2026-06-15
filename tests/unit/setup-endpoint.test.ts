import { describe, it, expect } from "vitest";
import { canRunSetup } from "@/app/api/admin/setup/route";

describe("setup gate-flip invariant", () => {
  it("allows setup only when zero admins exist", () => {
    expect(canRunSetup(0)).toBe(true);
  });
  it("forbids setup once any admin exists", () => {
    expect(canRunSetup(1)).toBe(false);
    expect(canRunSetup(5)).toBe(false);
  });
});

// `canRunSetup` is fed the NON-SEED user count (route: `tx.user.count({ where:
// { isSeed: false } })`, mirroring hasAnyAdmin()). A seeded dev account like
// `devxyz` (isSeed: true) is excluded from that count, so it does NOT flip the
// gate — the customer still gets the wizard. These cases pin the contract at the
// pure-gate level (the route supplies the non-seed count; this asserts what the
// gate does with it).
describe("setup gate — seed accounts do not close the wizard", () => {
  it("a deploy with only seed accounts (non-seed count 0) still allows setup", () => {
    // devxyz seeded ⇒ isSeed=true ⇒ non-seed count = 0 ⇒ wizard open.
    expect(canRunSetup(0)).toBe(true);
  });
  it("once the customer creates a real admin (non-seed count 1), setup closes", () => {
    expect(canRunSetup(1)).toBe(false);
  });
});
