/**
 * Per-device, sticky-across-navigation admin UI preferences (view mode, sort,
 * report range/tab/filter). See `persisted-prefs.ts` for the storage machinery
 * and the "why" (admin pages remount on SPA nav, resetting plain useState).
 *
 * Only NON-data UI preferences live here — never the selected category, current
 * page, or bulk-selection ids (those track live data that changes; persisting a
 * stale page/category/selection would be fragile, so they stay ephemeral). The
 * sanitizers are pure + total (unit-tested in admin-ui-prefs.test.ts) so a
 * malformed/old stored value degrades to the defaults rather than throwing.
 *
 * Client-safe (no server imports).
 */
import { createPersistedPrefs } from "./persisted-prefs";

// ── Menu management list (src/components/admin/menu-list.tsx) ────────────────
export type MenuViewMode = "grid" | "list";
export type MenuSortField =
  | "sortOrder"
  | "name"
  | "price"
  | "availability"
  | "dateAdded";
export type MenuSortDirection = "asc" | "desc";

export interface MenuListPrefs {
  viewMode: MenuViewMode;
  sortField: MenuSortField;
  sortDirection: MenuSortDirection;
}

export const DEFAULT_MENU_LIST_PREFS: MenuListPrefs = {
  viewMode: "grid",
  sortField: "sortOrder",
  sortDirection: "asc",
};

const MENU_VIEW_MODES: readonly MenuViewMode[] = ["grid", "list"];
const MENU_SORT_FIELDS: readonly MenuSortField[] = [
  "sortOrder",
  "name",
  "price",
  "availability",
  "dateAdded",
];
const MENU_SORT_DIRECTIONS: readonly MenuSortDirection[] = ["asc", "desc"];

export function sanitizeMenuListPrefs(
  parsed: unknown,
  defaults: MenuListPrefs
): MenuListPrefs {
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
    string,
    unknown
  >;
  const pick = <V extends string>(
    v: unknown,
    allowed: readonly V[],
    fallback: V
  ): V => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as V) : fallback);
  return {
    viewMode: pick(o.viewMode, MENU_VIEW_MODES, defaults.viewMode),
    sortField: pick(o.sortField, MENU_SORT_FIELDS, defaults.sortField),
    sortDirection: pick(
      o.sortDirection,
      MENU_SORT_DIRECTIONS,
      defaults.sortDirection
    ),
  };
}

export const menuListPrefsStore = createPersistedPrefs(
  "admin_menu_list_prefs",
  DEFAULT_MENU_LIST_PREFS,
  sanitizeMenuListPrefs
);

// ── Reports dashboard (src/components/admin/report-dashboard.tsx) ────────────
export type ReportRangeMode = "preset" | "custom";
export type ReportTab = "analytics" | "history";

export interface ReportPrefs {
  range: string; // a preset key ("1h".."90d"); validated against the route, not here
  rangeMode: ReportRangeMode;
  activeTab: ReportTab;
  historyStatusFilter: string; // "ALL" | order status; free-ish, length-capped
}

export const DEFAULT_REPORT_PREFS: ReportPrefs = {
  range: "1d",
  rangeMode: "preset",
  activeTab: "analytics",
  historyStatusFilter: "ALL",
};

// Valid preset keys (mirror RANGE_MS in report-utils). Kept here only to reject a
// junk stored value; the route is still authoritative on range math.
const REPORT_RANGE_PRESETS: readonly string[] = [
  "1h",
  "3h",
  "12h",
  "1d",
  "7d",
  "30d",
  "90d",
];
const REPORT_RANGE_MODES: readonly ReportRangeMode[] = ["preset", "custom"];
const REPORT_TABS: readonly ReportTab[] = ["analytics", "history"];
const REPORT_STATUS_FILTERS: readonly string[] = [
  "ALL",
  "PENDING",
  "CONFIRMED",
  "COMPLETED",
  "DECLINED",
];

export function sanitizeReportPrefs(
  parsed: unknown,
  defaults: ReportPrefs
): ReportPrefs {
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
    string,
    unknown
  >;
  const pick = <V extends string>(
    v: unknown,
    allowed: readonly V[],
    fallback: V
  ): V => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as V) : fallback);
  return {
    // NB: `range` deliberately does NOT persist custom from/to dates — a stale
    // absolute date window is rarely what the operator wants on a later visit, so
    // custom mode reverts to its empty pickers (rangeMode persists, dates don't).
    range: pick(o.range, REPORT_RANGE_PRESETS, defaults.range),
    rangeMode: pick(o.rangeMode, REPORT_RANGE_MODES, defaults.rangeMode),
    activeTab: pick(o.activeTab, REPORT_TABS, defaults.activeTab),
    historyStatusFilter: pick(
      o.historyStatusFilter,
      REPORT_STATUS_FILTERS,
      defaults.historyStatusFilter
    ),
  };
}

export const reportPrefsStore = createPersistedPrefs(
  "admin_report_prefs",
  DEFAULT_REPORT_PREFS,
  sanitizeReportPrefs
);
