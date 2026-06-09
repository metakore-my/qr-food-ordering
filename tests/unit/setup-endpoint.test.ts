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
