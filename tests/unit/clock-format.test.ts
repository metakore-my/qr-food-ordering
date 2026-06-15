import { describe, it, expect } from "vitest";
import { formatClockHour, formatWeekday } from "@/lib/clock-format";

// These pure helpers back the analytics dashboard's "Busiest Hours" / "Busiest
// Day" labels. The whole point is that they render in the LOCALE THEY ARE GIVEN
// (the viewer's active UI locale), not the deployment default — the bug that
// leaked Bahasa "5 PTG" into an English dashboard. The tests pin that the locale
// argument actually drives the output, so a regression to a hardcoded/ignored
// locale fails here.

describe("formatClockHour", () => {
  it("renders the given hour 0–23 in the supplied locale", () => {
    // en-US uses 12-hour AM/PM; the 17:00 hour reads as 5 PM.
    const en = formatClockHour(17, "en-US");
    expect(en).toMatch(/5/);
    expect(en.toUpperCase()).toContain("PM");
  });

  it("changes presentation with the locale (24h zh vs 12h en)", () => {
    const en = formatClockHour(17, "en-US");
    const zh = formatClockHour(17, "zh-CN");
    // Different locales must produce different strings for the same hour —
    // proof the locale arg is honored rather than ignored.
    expect(zh).not.toBe(en);
  });

  it("wraps hours ≥24 via modulo (defensive)", () => {
    expect(formatClockHour(24, "en-US")).toBe(formatClockHour(0, "en-US"));
  });
});

describe("formatWeekday", () => {
  it("maps ISO weekday 1 to Monday in English (long)", () => {
    expect(formatWeekday(1, "en-US", "long")).toBe("Monday");
  });

  it("maps ISO weekday 7 to Sunday in English (long)", () => {
    expect(formatWeekday(7, "en-US", "long")).toBe("Sunday");
  });

  it("short style yields the abbreviated name", () => {
    expect(formatWeekday(1, "en-US", "short")).toMatch(/^Mon/);
  });

  it("honors the locale (English vs Chinese weekday differ)", () => {
    const en = formatWeekday(1, "en-US", "long");
    const zh = formatWeekday(1, "zh-CN", "long");
    expect(zh).not.toBe(en);
  });

  it("defaults to short style when omitted", () => {
    expect(formatWeekday(1, "en-US")).toBe(formatWeekday(1, "en-US", "short"));
  });
});
