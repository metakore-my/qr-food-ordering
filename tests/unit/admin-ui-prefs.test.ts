import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  sanitizeMenuListPrefs,
  DEFAULT_MENU_LIST_PREFS,
  sanitizeReportPrefs,
  DEFAULT_REPORT_PREFS,
} from "@/lib/admin-ui-prefs";
import { createPersistedPrefs } from "@/lib/persisted-prefs";

describe("sanitizeMenuListPrefs", () => {
  it("passes a fully-valid object through unchanged", () => {
    const v = { viewMode: "list", sortField: "price", sortDirection: "desc" };
    expect(sanitizeMenuListPrefs(v, DEFAULT_MENU_LIST_PREFS)).toEqual(v);
  });

  it("falls back to defaults for null / non-object / junk", () => {
    expect(sanitizeMenuListPrefs(null, DEFAULT_MENU_LIST_PREFS)).toEqual(DEFAULT_MENU_LIST_PREFS);
    expect(sanitizeMenuListPrefs("nope", DEFAULT_MENU_LIST_PREFS)).toEqual(DEFAULT_MENU_LIST_PREFS);
    expect(sanitizeMenuListPrefs(42, DEFAULT_MENU_LIST_PREFS)).toEqual(DEFAULT_MENU_LIST_PREFS);
  });

  it("fills only the invalid fields from defaults (partial / mixed)", () => {
    const out = sanitizeMenuListPrefs(
      { viewMode: "list", sortField: "bogus", sortDirection: 123 },
      DEFAULT_MENU_LIST_PREFS
    );
    expect(out).toEqual({
      viewMode: "list", // valid → kept
      sortField: "sortOrder", // invalid enum → default
      sortDirection: "asc", // wrong type → default
    });
  });

  it("rejects an out-of-enum viewMode", () => {
    expect(
      sanitizeMenuListPrefs({ viewMode: "table" }, DEFAULT_MENU_LIST_PREFS).viewMode
    ).toBe("grid");
  });
});

describe("sanitizeReportPrefs", () => {
  it("passes a fully-valid object through unchanged", () => {
    const v = {
      range: "7d",
      rangeMode: "custom",
      activeTab: "history",
      historyStatusFilter: "COMPLETED",
    };
    expect(sanitizeReportPrefs(v, DEFAULT_REPORT_PREFS)).toEqual(v);
  });

  it("falls back to defaults for junk", () => {
    expect(sanitizeReportPrefs(undefined, DEFAULT_REPORT_PREFS)).toEqual(DEFAULT_REPORT_PREFS);
    expect(sanitizeReportPrefs([], DEFAULT_REPORT_PREFS)).toEqual(DEFAULT_REPORT_PREFS);
  });

  it("rejects an invalid range preset / tab / status, keeps valid ones", () => {
    const out = sanitizeReportPrefs(
      { range: "today", rangeMode: "preset", activeTab: "analytics", historyStatusFilter: "BOGUS" },
      DEFAULT_REPORT_PREFS
    );
    expect(out.range).toBe("1d"); // "today" not a preset → default
    expect(out.rangeMode).toBe("preset");
    expect(out.activeTab).toBe("analytics");
    expect(out.historyStatusFilter).toBe("ALL"); // bogus status → default
  });

  it("does not carry custom from/to dates (only the validated fields exist)", () => {
    const out = sanitizeReportPrefs(
      { range: "30d", fromDate: "2026-01-01", toDate: "2026-02-01" },
      DEFAULT_REPORT_PREFS
    );
    expect(out).toEqual({
      range: "30d",
      rangeMode: "preset",
      activeTab: "analytics",
      historyStatusFilter: "ALL",
    });
    expect("fromDate" in out).toBe(false);
    expect("toDate" in out).toBe(false);
  });
});

describe("createPersistedPrefs", () => {
  // Minimal in-memory localStorage + window stub for the store machinery.
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    vi.stubGlobal("window", {
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  });

  interface P {
    a: string;
  }
  const defaults: P = { a: "x" };
  const sanitize = (parsed: unknown, d: P): P => {
    const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    return { a: typeof o.a === "string" ? o.a : d.a };
  };

  it("read() returns defaults when nothing stored, and the server snapshot is defaults", () => {
    const store = createPersistedPrefs("test_key_1", defaults, sanitize);
    expect(store.read()).toEqual(defaults);
    expect(store.getServerSnapshot()).toEqual(defaults);
  });

  it("write() persists a patch, read() reflects it, and subscribers are notified", () => {
    const store = createPersistedPrefs("test_key_2", defaults, sanitize);
    let notified = 0;
    store.subscribe(() => notified++);
    store.write({ a: "y" });
    expect(store.read()).toEqual({ a: "y" });
    expect(notified).toBe(1);
  });

  it("read() returns a STABLE identity until the stored value changes (no re-parse loop)", () => {
    const store = createPersistedPrefs("test_key_3", defaults, sanitize);
    const first = store.read();
    expect(store.read()).toBe(first); // same reference
    store.write({ a: "z" });
    const after = store.read();
    expect(after).not.toBe(first);
    expect(store.read()).toBe(after); // stable again
  });

  it("read() sanitizes a malformed stored value to defaults", () => {
    localStorage.setItem("test_key_4", "{ not json");
    const store = createPersistedPrefs("test_key_4", defaults, sanitize);
    expect(store.read()).toEqual(defaults);
  });
});
