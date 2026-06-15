import { describe, it, expect } from "vitest";
import { getItemName } from "@/lib/report-utils";

/**
 * Regression guard for OrderItem.itemName snapshot resolution. Precedence is
 * LIVE-NAME-FIRST: active locale → canonical → snapshot → any live name →
 * "Unknown". The live join wins for undeleted items so every viewer sees their
 * own language (6-locale product); the order-time snapshot (canonical locale)
 * backstops a menu DELETE (live join gone via SetNull) or a missing
 * translation, so a line can never go blank. getItemName is the single source
 * of truth shared by every order-line read path — client components mirror
 * this chain inline.
 */
describe("getItemName — order-line name resolution", () => {
  const liveNames = [
    { locale: "en", name: "Pad Thai" },
    { locale: "th", name: "ผัดไทย" },
  ];

  it("prefers the live active-locale name over the snapshot (localized display)", () => {
    // The viewer's locale has a live translation — it wins so an English-UI
    // viewer isn't shown the canonical-locale snapshot.
    expect(getItemName(liveNames, "en", "th", "ผัดไทย (as ordered)")).toBe(
      "Pad Thai"
    );
  });

  it("falls back to the live canonical name before the snapshot", () => {
    // No "vi" translation: canonical live name beats the (possibly stale)
    // snapshot for an item that still exists.
    expect(getItemName(liveNames, "vi", "th", "old name")).toBe("ผัดไทย");
  });

  it("uses the snapshot when the item was deleted (empty live join)", () => {
    // menuItem was deleted (SetNull → empty names): the snapshot survives.
    expect(getItemName([], "en", "en", "Seasonal Special")).toBe(
      "Seasonal Special"
    );
  });

  it("uses the snapshot over an unrelated-locale live name", () => {
    // Neither the active nor canonical locale has a live translation; the
    // canonical-locale snapshot is more meaningful than an arbitrary locale.
    expect(
      getItemName([{ locale: "ms", name: "Mee Goreng" }], "vi", "en", "Fried Noodles")
    ).toBe("Fried Noodles");
  });

  it("resolves legacy rows (no snapshot) from the live join", () => {
    // Pre-migration order line: itemName is null → live chain as before.
    expect(getItemName(liveNames, "th", "en", null)).toBe("ผัดไทย");
    expect(getItemName(liveNames, "vi", "en", undefined)).toBe("Pad Thai"); // canonical
    expect(getItemName([{ locale: "ms", name: "Mee Goreng" }], "vi", "en")).toBe(
      "Mee Goreng"
    ); // first available
    expect(getItemName([], "en", "en")).toBe("Unknown"); // nothing at all
  });

  it("treats an empty-string snapshot as absent", () => {
    // An empty snapshot is not a real name — don't render a blank line.
    expect(getItemName([], "en", "en", "")).toBe("Unknown");
    expect(getItemName([{ locale: "ms", name: "Mee Goreng" }], "vi", "en", "")).toBe(
      "Mee Goreng"
    );
  });
});
