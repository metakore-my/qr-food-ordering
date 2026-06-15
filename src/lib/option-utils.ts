/**
 * Client-safe helpers for the order option-name snapshot. NO server-only imports
 * (imported by client components AND the order route AND report-utils).
 *
 * Snapshot name shape is one of:
 *   - OLD rows: a plain string (canonical-locale name, frozen pre-multilocale)
 *   - NEW rows: a Record<locale, string> map of names across enabled locales
 * resolveOptionName tolerates BOTH so old orders render unchanged.
 */

export type LocalizedName = string | Record<string, string>;

export interface SelectedOption {
  groupName?: LocalizedName;
  choiceName: LocalizedName;
  priceAdjustment?: number;
}

function pick(map: Record<string, string>, key: string): string {
  const v = map[key];
  return v && v.trim() ? v : "";
}

/**
 * Resolve a snapshot name to a display string for `locale`, falling back to
 * `canonical`, then the first non-empty value, then "". An old plain-string name
 * is returned verbatim. Accepts `LocalizedName` only; `null`/`undefined` are
 * handled defensively at runtime (callers that pass them get a type error, which
 * the test suite exercises via `@ts-expect-error`).
 */
export function resolveOptionName(
  name: LocalizedName,
  locale: string,
  canonical: string
): string {
  if (typeof name === "string") return name;
  if (!name || typeof name !== "object") return "";
  return (
    pick(name, locale) ||
    pick(name, canonical) ||
    Object.values(name).find((v) => v && v.trim()) ||
    ""
  );
}

/**
 * Build the stored locale→name map from translation rows. Omit-and-fall-back: a
 * locale key is included ONLY when that locale has its own non-empty translation;
 * missing/empty locales are omitted (resolveOptionName falls back to canonical at
 * read time), keeping stored rows small. Canonical needs no special handling here
 * because it is already one of `enabledLocales`, so its row is included whenever
 * present.
 */
export function buildNameMap(
  names: Array<{ locale: string; name: string }>,
  enabledLocales: string[]
): Record<string, string> {
  const byLocale = new Map<string, string>();
  for (const n of names) {
    if (n.name && n.name.trim()) byLocale.set(n.locale, n.name);
  }
  const map: Record<string, string> = {};
  for (const loc of enabledLocales) {
    const v = byLocale.get(loc);
    if (v) map[loc] = v;
  }
  return map;
}

/** A menu item's option groups, as needed for validating a selection. Both the
 *  customer cart-add route and the staff order route shape their Prisma include
 *  to satisfy this (id + selectionType + isRequired + choices[].id). */
export interface OptionGroupForValidation {
  id: number;
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  choices: Array<{ id: number }>;
}

/** Discriminated result of validating a selection against an item's groups. */
export type OptionValidationResult =
  | { ok: true }
  | { ok: false; reason: "REQUIRED_MISSING" | "GROUP_NOT_FOUND" | "SINGLE_CARDINALITY" | "CHOICE_NOT_FOUND"; groupId?: number; choiceId?: number };

/**
 * Validate a customer/staff option selection against an item's option groups —
 * the single source of truth shared by the customer cart-add route and the staff
 * order route, so the two can't drift. Checks: (a) every required group has a
 * selection, (b) each selected group exists on the item, (c) SINGLE groups carry
 * exactly one choice, (d) every choiceId belongs to its group. Does NOT dedup —
 * callers dedup choiceIds (Set) before persisting/snapshotting (a repeated choice
 * in a MULTIPLE group must count once). Pure: no DB, no HTTP.
 */
export function validateSelectedOptions(
  optionGroups: OptionGroupForValidation[],
  selectedOptions: Array<{ groupId: number; choiceIds: number[] }>
): OptionValidationResult {
  const groupMap = new Map(optionGroups.map((g) => [g.id, g]));

  // (a) required groups must have a selection
  for (const group of optionGroups) {
    if (group.isRequired && !selectedOptions.some((s) => s.groupId === group.id)) {
      return { ok: false, reason: "REQUIRED_MISSING", groupId: group.id };
    }
  }

  for (const sel of selectedOptions) {
    const group = groupMap.get(sel.groupId);
    // (b) selected group exists on the item
    if (!group) {
      return { ok: false, reason: "GROUP_NOT_FOUND", groupId: sel.groupId };
    }
    // (c) SINGLE → exactly one choice
    if (group.selectionType === "SINGLE" && sel.choiceIds.length !== 1) {
      return { ok: false, reason: "SINGLE_CARDINALITY", groupId: sel.groupId };
    }
    // (d) every choiceId belongs to the group
    const validChoiceIds = new Set(group.choices.map((c) => c.id));
    for (const cid of sel.choiceIds) {
      if (!validChoiceIds.has(cid)) {
        return { ok: false, reason: "CHOICE_NOT_FOUND", groupId: sel.groupId, choiceId: cid };
      }
    }
  }

  return { ok: true };
}
