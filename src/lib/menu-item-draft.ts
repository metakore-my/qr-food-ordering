// Client-safe, pure helpers for the admin menu-item form. Imported by the form
// component AND its unit tests so the copy/clone/merge logic can't drift.

export interface TranslationData {
  name: string;
  description: string;
}

export interface OptionChoiceFormData {
  priceAdjustment: string;
  sortOrder: number;
  translations: Record<string, { name: string }>;
}

export interface OptionGroupFormData {
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  sortOrder: number;
  translations: Record<string, { name: string }>;
  choices: OptionChoiceFormData[];
}

/**
 * Deep-copy option groups for reuse (Duplicate item / Copy options).
 * Strips any persisted identity by re-sequencing sortOrder to 0..n and returns
 * fully independent objects (no shared references with the source), so the copy
 * can diverge freely and a later save creates NEW rows.
 */
export function cloneOptionGroups(
  groups?: OptionGroupFormData[]
): OptionGroupFormData[] {
  if (!groups || groups.length === 0) return [];
  return groups.map((g, gi) => ({
    selectionType: g.selectionType,
    isRequired: g.isRequired,
    sortOrder: gi,
    translations: Object.fromEntries(
      Object.entries(g.translations).map(([loc, v]) => [loc, { name: v.name }])
    ),
    choices: g.choices.map((c, ci) => ({
      priceAdjustment: c.priceAdjustment,
      sortOrder: ci,
      translations: Object.fromEntries(
        Object.entries(c.translations).map(([loc, v]) => [loc, { name: v.name }])
      ),
    })),
  }));
}

/** Editable form state for one menu item. */
export interface ItemDraft {
  categoryId: number | null;
  price: string;
  imageUrl: string | undefined;
  isCombo: boolean;
  isFeatured: boolean;
  comboBasePrice: string;
  translations: Record<string, TranslationData>;
  optionGroups: OptionGroupFormData[];
  activeLocale: string;
}

/** A persisted item as the menu list/API delivers it (names + optionGroups). */
export interface DraftSourceItem {
  categoryId: number;
  price: number;
  imageUrl: string | null;
  isCombo: boolean;
  isFeatured: boolean;
  comboBasePrice: number | null;
  names: Array<{ locale: string; name: string; description?: string | null }>;
  optionGroups?: Array<{
    selectionType: "SINGLE" | "MULTIPLE";
    isRequired: boolean;
    sortOrder: number;
    translations?: Record<string, { name: string }>;
    names?: Array<{ locale: string; name: string }>;
    choices: Array<{
      priceAdjustment: number;
      sortOrder: number;
      translations?: Record<string, { name: string }>;
      names?: Array<{ locale: string; name: string }>;
    }>;
  }>;
}

/** Empty draft for "Save & add another". Caller retains category separately. */
export function blankItemDraft(defaultLocale: string): ItemDraft {
  return {
    categoryId: null,
    price: "",
    imageUrl: undefined,
    isCombo: false,
    isFeatured: false,
    comboBasePrice: "",
    translations: {},
    optionGroups: [],
    activeLocale: defaultLocale,
  };
}

// Normalize an option group's names — accept either the form shape
// (`translations`) or the API/list shape (`names: [{locale,name}]`).
function groupTranslations(
  src: { translations?: Record<string, { name: string }>; names?: Array<{ locale: string; name: string }> }
): Record<string, { name: string }> {
  if (src.translations) return src.translations;
  if (src.names) {
    return Object.fromEntries(src.names.map((n) => [n.locale, { name: n.name }]));
  }
  return {};
}

/** Prefill an editable draft from an existing item (Duplicate). */
export function duplicateItemDraft(
  item: DraftSourceItem,
  defaultLocale: string
): ItemDraft {
  const translations: Record<string, TranslationData> = {};
  for (const n of item.names) {
    translations[n.locale] = { name: n.name, description: n.description ?? "" };
  }
  // Mark the clone in the default (primary) language only.
  if (translations[defaultLocale]?.name) {
    translations[defaultLocale] = {
      ...translations[defaultLocale],
      name: `${translations[defaultLocale].name} (copy)`,
    };
  }

  const optionGroups = cloneOptionGroups(
    (item.optionGroups ?? []).map((g) => ({
      selectionType: g.selectionType,
      isRequired: g.isRequired,
      sortOrder: g.sortOrder,
      translations: groupTranslations(g),
      choices: g.choices.map((c) => ({
        priceAdjustment: c.priceAdjustment.toString(),
        sortOrder: c.sortOrder,
        translations: groupTranslations(c),
      })),
    }))
  );

  return {
    categoryId: item.categoryId,
    price: item.price.toString(),
    imageUrl: item.imageUrl ?? undefined,
    isCombo: item.isCombo,
    isFeatured: item.isFeatured,
    comboBasePrice: item.comboBasePrice?.toString() ?? "",
    translations,
    optionGroups,
    activeLocale: defaultLocale,
  };
}

/**
 * Apply incoming translations into existing form translations, FILL-EMPTY-ONLY:
 * a non-empty existing field is never overwritten (the owner's manual edits are
 * always safe). Incoming blank/missing values never blank an existing field.
 * Existing descriptions are preserved when only names arrive.
 */
export function mergeTranslations(
  existing: Record<string, TranslationData>,
  incoming: Record<string, { name?: string; description?: string }>
): Record<string, TranslationData> {
  const out: Record<string, TranslationData> = {};
  // Carry every existing locale forward unchanged first.
  for (const [loc, v] of Object.entries(existing)) {
    out[loc] = { name: v.name, description: v.description };
  }
  for (const [loc, inc] of Object.entries(incoming)) {
    const prev = out[loc];
    const incName = inc.name?.trim();
    const incDesc = inc.description?.trim();
    const nameEmpty = !prev?.name?.trim();
    const descEmpty = !prev?.description?.trim();
    // Skip entirely if there's nothing to fill with.
    if (!incName && !incDesc) continue;
    out[loc] = {
      name: nameEmpty && incName ? incName : prev?.name ?? "",
      description: descEmpty && incDesc ? incDesc : prev?.description ?? "",
    };
  }
  return out;
}

/**
 * Map an existing item's API-shaped option groups into editable form state,
 * PRESERVING their order (used when EDITING an item — unlike cloneOptionGroups,
 * which re-sequences for a fresh copy). Tolerant of both `translations` and
 * `names` shapes.
 */
export function optionGroupsFromItem(
  groups?: DraftSourceItem["optionGroups"]
): OptionGroupFormData[] {
  if (!groups || groups.length === 0) return [];
  return groups.map((g) => ({
    selectionType: g.selectionType,
    isRequired: g.isRequired,
    sortOrder: g.sortOrder,
    translations: groupTranslations(g),
    choices: g.choices.map((c) => ({
      priceAdjustment: c.priceAdjustment.toString(),
      sortOrder: c.sortOrder,
      translations: groupTranslations(c),
    })),
  }));
}
