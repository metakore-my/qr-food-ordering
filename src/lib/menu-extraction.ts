// Client-safe menu-extraction helpers — identity/dedup keying for AI-imported
// menu items. NO prisma import (importable from both the route and unit tests).
//
// Identity moved OFF the LLM-interpreted name_en (brittle for non-English menus)
// ONTO the printed SOURCE-language name: any non-empty name field can match two
// rows as the same dish, so a Thai menu dedups on its Thai script even when the
// model writes two different English romanizations.

// The four market source languages the VLM transcribes verbatim from the menu.
// (zh-TW is translation-only — never transcribed at extraction time.)
export const SOURCE_MARKET_LOCALES = ["th", "ms", "vi", "zh-CN"] as const;

export interface ExtractedNameFields {
  name_th: string;
  name_en: string;
  name_zh_CN: string;
  name_ms: string;
  name_vi: string;
  price: number;
  category: string;
  priceConflict?: { prices: number[]; kept: number };
  optionGroups?: unknown;
}

const NAME_FIELDS: Array<keyof ExtractedNameFields> = [
  "name_th",
  "name_en",
  "name_zh_CN",
  "name_ms",
  "name_vi",
];

// Normalized (trimmed + lowercased) non-empty names across all five locale
// fields — the identity set used to match two extracted rows as the same dish.
export function itemIdentityNames(item: ExtractedNameFields): Set<string> {
  const set = new Set<string>();
  for (const field of NAME_FIELDS) {
    const v = item[field];
    if (typeof v === "string") {
      const n = v.trim().toLowerCase();
      if (n) set.add(n);
    }
  }
  return set;
}

// Resolves the language the printed menu is transcribed in: the frozen
// canonical (= the main language set at setup) if it's a known market locale,
// else the editable default locale, else English. Drives the verbatim-source
// field on extraction + the later translate step's source-of-truth.
export function sourceLocaleForExtraction(settings: {
  canonicalLocale: string;
  defaultLocale: string;
}): string {
  const markets = new Set<string>(SOURCE_MARKET_LOCALES);
  if (markets.has(settings.canonicalLocale)) return settings.canonicalLocale;
  if (markets.has(settings.defaultLocale)) return settings.defaultLocale;
  return settings.canonicalLocale || settings.defaultLocale || "en";
}

// A sentinel price (-1 "Market Price", 0 "unclear") is NOT a real price — it
// must not trigger a price-conflict record when two rows merge.
function isRealPrice(p: number): boolean {
  return typeof p === "number" && p > 0;
}

// Merges extracted rows that share ANY normalized name (identity union grows as
// rows merge in), filling empty locale fields from the matched twin. On a real
// (non-sentinel) price disagreement keeps the LOWER price and records the
// conflict for the review UI; a sentinel price yields to a real one silently.
export function dedupeExtractedItems<T extends ExtractedNameFields>(
  items: T[],
  sourceLocale: string
): T[] {
  void sourceLocale; // reserved for future use (no behavioral effect today); kept for a stable, source-aware signature.
  const result: T[] = [];
  const identitySets: Array<Set<string>> = [];
  for (const item of items) {
    const names = itemIdentityNames(item);
    let matchIdx = -1;
    for (let i = 0; i < result.length; i++) {
      for (const n of names) {
        if (identitySets[i].has(n)) {
          matchIdx = i;
          break;
        }
      }
      if (matchIdx !== -1) break;
    }
    if (matchIdx === -1) {
      result.push({ ...item });
      identitySets.push(new Set(names));
      continue;
    }
    const target = result[matchIdx];
    for (const field of NAME_FIELDS) {
      const cur = (target[field] as string) ?? "";
      const incoming = (item[field] as string) ?? "";
      if (!cur.trim() && incoming.trim()) {
        (target as Record<string, unknown>)[field] = incoming;
      }
    }
    if (isRealPrice(item.price) && isRealPrice(target.price) && item.price !== target.price) {
      const prices = target.priceConflict
        ? [...target.priceConflict.prices, item.price]
        : [target.price, item.price];
      const kept = Math.min(...prices.filter(isRealPrice));
      target.price = kept;
      target.priceConflict = { prices, kept };
    } else if (!isRealPrice(target.price) && isRealPrice(item.price)) {
      target.price = item.price;
    }
    if (!target.optionGroups && item.optionGroups) {
      (target as Record<string, unknown>).optionGroups = Array.isArray(item.optionGroups)
        ? [...(item.optionGroups as unknown[])]
        : item.optionGroups;
    }
    // Grow the identity union with BOTH the merged target's names AND the incoming
    // item's names — so a variant name the item carried (e.g. an alternate
    // romanization) that wasn't copied into target still merges future rows.
    for (const n of itemIdentityNames(item)) identitySets[matchIdx].add(n);
    for (const n of itemIdentityNames(target)) identitySets[matchIdx].add(n);
  }
  return result;
}

export type ReviewFlag = "existingDuplicate" | "priceConflict" | "unpriced" | "missingName";

/** Advisory review flags for the import-review UI (drives badges + sort + summary). */
export function computeReviewFlags(
  item: ExtractedNameFields,
  existingNames: Set<string>
): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const names = itemIdentityNames(item);
  if (names.size === 0) flags.push("missingName");
  for (const n of names) {
    if (existingNames.has(n)) { flags.push("existingDuplicate"); break; }
  }
  if (item.priceConflict) flags.push("priceConflict");
  if (!isRealPrice(item.price)) flags.push("unpriced");
  return flags;
}
