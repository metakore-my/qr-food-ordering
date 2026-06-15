import { describe, it, expect } from "vitest";
import {
  formatDeploymentDateTime,
  formatDeploymentDate,
  formatDeploymentDateKey,
  formatDeploymentDayMonth,
  hourlyBucketFormatter,
  startOfDayInZone,
  startOfTodayInDeploymentZone,
} from "@/lib/date";
import { parseDeploymentConfig } from "@/lib/deployment-config";

// A fixed UTC instant: 2026-02-05T07:30:00Z.
// In Asia/Bangkok (UTC+7) that is 2026-02-05 14:30 local.
const UTC_INSTANT = "2026-02-05T07:30:00.000Z";

describe("date.ts deployment formatters (default Bangkok zone in test env)", () => {
  it("formatDeploymentDateTime renders day/month/year + 24h time in the deployment zone", () => {
    const out = formatDeploymentDateTime(UTC_INSTANT);
    expect(out).toMatch(/5 Feb 2026/);
    expect(out).toMatch(/14:30/);
  });

  it("formatDeploymentDate renders just the date (no time)", () => {
    const out = formatDeploymentDate(UTC_INSTANT);
    expect(out).toMatch(/5 Feb 2026/);
    expect(out).not.toMatch(/14:30/);
  });

  it("formatDeploymentDayMonth renders day + short month only", () => {
    const out = formatDeploymentDayMonth(UTC_INSTANT);
    expect(out).toMatch(/5 Feb/);
    expect(out).not.toMatch(/2026/);
  });

  it("formatDeploymentDateKey renders sortable YYYY-MM-DD in the deployment zone", () => {
    // 2026-02-05T07:30Z is 14:30 Bangkok the SAME calendar day → 2026-02-05.
    expect(formatDeploymentDateKey(UTC_INSTANT)).toBe("2026-02-05");
  });

  it("formatDeploymentDateKey resolves the day in the deployment zone, not UTC", () => {
    // 2026-02-05T18:00Z is 01:00 the NEXT day in Bangkok (+7) → 2026-02-06.
    expect(formatDeploymentDateKey("2026-02-05T18:00:00.000Z")).toBe("2026-02-06");
  });

  it("formatDeploymentDateKey sorts lexicographically = chronologically", () => {
    const a = formatDeploymentDateKey("2026-02-05T07:30:00.000Z");
    const b = formatDeploymentDateKey("2026-11-20T07:30:00.000Z");
    expect(a < b).toBe(true); // "2026-02-05" < "2026-11-20"
  });

  it("hourlyBucketFormatter buckets to the deployment-zone hour", () => {
    const fmt = hourlyBucketFormatter();
    const parts = fmt.formatToParts(new Date(UTC_INSTANT));
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    expect(get("hour")).toBe("14");
    expect(get("year")).toBe("2026");
    expect(get("month")).toBe("02");
    expect(get("day")).toBe("05");
  });
});

// The formatters above always run in the test process's Bangkok zone (currency
// unset). This block guards the OTHER half of the contract: that the IANA zone
// strings the config maps each currency to are real and yield the right offset.
// It re-renders the same UTC instant in the zone parseDeploymentConfig derives,
// catching a typo'd zone in CURRENCY_TIMEZONE (e.g. "Asia/KualaLumpur") that the
// Bangkok-only formatter tests cannot.
describe("currency-derived zones render the expected local hour", () => {
  const hourIn = (timezone: string): string =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(UTC_INSTANT));

  it("MYR -> Asia/Kuala_Lumpur renders 07:30Z as 15:00 (UTC+8)", () => {
    const tz = parseDeploymentConfig({ NEXT_PUBLIC_CURRENCY: "MYR" }).timezone;
    expect(tz).toBe("Asia/Kuala_Lumpur");
    expect(hourIn(tz)).toBe("15"); // 07:30Z + 8h = 15:30
  });

  it("SGD -> Asia/Singapore renders 07:30Z as 15:00 (UTC+8)", () => {
    const tz = parseDeploymentConfig({ NEXT_PUBLIC_CURRENCY: "SGD" }).timezone;
    expect(tz).toBe("Asia/Singapore");
    expect(hourIn(tz)).toBe("15");
  });

  it("THB -> Asia/Bangkok renders 07:30Z as 14:30 (UTC+7)", () => {
    const tz = parseDeploymentConfig({ NEXT_PUBLIC_CURRENCY: "THB" }).timezone;
    expect(tz).toBe("Asia/Bangkok");
    expect(hourIn(tz)).toBe("14");
  });
});

describe("startOfDayInZone", () => {
  // 2026-02-05 14:30 local Bangkok (= 07:30Z). Midnight Bangkok that day is
  // 2026-02-05T00:00:00+07:00 = 2026-02-04T17:00:00.000Z.
  const REFERENCE = new Date("2026-02-05T07:30:00.000Z");

  it("returns the UTC instant of local midnight for Asia/Bangkok (UTC+7)", () => {
    const start = startOfDayInZone(REFERENCE, "Asia/Bangkok");
    expect(start.toISOString()).toBe("2026-02-04T17:00:00.000Z");
  });

  it("returns the UTC instant of local midnight for Asia/Kuala_Lumpur (UTC+8)", () => {
    // Midnight 2026-02-05 in KL = 2026-02-04T16:00:00.000Z.
    const start = startOfDayInZone(REFERENCE, "Asia/Kuala_Lumpur");
    expect(start.toISOString()).toBe("2026-02-04T16:00:00.000Z");
  });

  it("uses the LOCAL calendar date, not the UTC date, near the day boundary", () => {
    // 2026-02-05T17:30:00Z is 2026-02-06 00:30 in Bangkok — already the 6th
    // locally. Start-of-day must be the 6th's midnight, not the 5th's.
    const lateUtc = new Date("2026-02-05T17:30:00.000Z");
    const start = startOfDayInZone(lateUtc, "Asia/Bangkok");
    // Midnight 2026-02-06 Bangkok = 2026-02-05T17:00:00.000Z.
    expect(start.toISOString()).toBe("2026-02-05T17:00:00.000Z");
  });

  it("the result, re-read in the zone, is exactly 00:00", () => {
    const start = startOfDayInZone(REFERENCE, "Asia/Singapore");
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(start);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    expect(`${get("hour")}:${get("minute")}`).toBe("00:00");
  });
});

describe("startOfTodayInDeploymentZone", () => {
  it("returns a Date whose local time in the deployment zone is 00:00", () => {
    // Default test env = Asia/Bangkok. Just assert the contract holds for "now".
    const start = startOfTodayInDeploymentZone();
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(start);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    expect(`${get("hour")}:${get("minute")}:${get("second")}`).toBe("00:00:00");
  });
});
