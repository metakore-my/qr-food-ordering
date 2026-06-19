"use client";

import { useState, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useConfig } from "@/components/providers/config-provider";
import { currencySymbolWith } from "@/lib/money-client";
import { KNOWN_LOCALES, localesDefaultFirst } from "@/lib/deployment-config";
import { ImageUpload } from "@/components/ui/image-upload";
import {
  blankItemDraft,
  cloneOptionGroups,
  duplicateItemDraft,
  mergeTranslations,
  optionGroupsFromItem,
  type DraftSourceItem,
  type OptionGroupFormData,
  type TranslationData,
} from "@/lib/menu-item-draft";
import { MAX_OPTION_GROUPS, MAX_OPTION_CHOICES } from "@/lib/validations";

const LOCALE_CODES = KNOWN_LOCALES;

interface CategoryTranslation {
  id: number;
  categoryId: number;
  locale: string;
  name: string;
}

interface Category {
  id: number;
  sortOrder: number;
  isActive: boolean;
  names: CategoryTranslation[];
  createdAt: string;
  updatedAt: string;
}

interface MenuItemTranslation {
  id: number;
  menuItemId: number;
  locale: string;
  name: string;
  description: string | null;
}

interface OptionChoiceData {
  id?: number;
  priceAdjustment: number;
  sortOrder: number;
  names: Array<{ locale: string; name: string }>;
}

interface OptionGroupData {
  id?: number;
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  sortOrder: number;
  names: Array<{ locale: string; name: string }>;
  choices: OptionChoiceData[];
}

interface MenuItem {
  id: number;
  categoryId: number;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
  isCombo: boolean;
  isFeatured: boolean;
  comboBasePrice: number | null;
  sortOrder: number;
  names: MenuItemTranslation[];
  category: Category;
  optionGroups?: OptionGroupData[];
  createdAt: string;
  updatedAt: string;
}

interface MenuItemFormProps {
  item?: MenuItem | null;
  /** Source item to CLONE into a fresh create-mode draft (Duplicate item). */
  duplicateFrom?: MenuItem | null;
  categories: Category[];
  /** All current menu items (for the "copy options from another item" picker). */
  existingItems?: MenuItem[];
  onSave: (item: MenuItem) => void;
  onClose: () => void;
}

export function MenuItemForm({
  item,
  duplicateFrom = null,
  categories,
  existingItems = [],
  onSave,
  onClose,
}: MenuItemFormProps) {
  const t = useTranslations("admin.menuItemForm");
  const tCommon = useTranslations("common");
  const tLocales = useTranslations("locales");
  const locale = useLocale();
  const cfg = useConfig();
  // One-time seed: in CREATE mode, prefill (clone) from `duplicateFrom`. In edit
  // mode (`item` present) there's no seed — the edit path wins.
  const seed = item
    ? null
    : duplicateFrom
    ? duplicateItemDraft(duplicateFrom as DraftSourceItem, cfg.defaultLocale)
    : null;
  const [activeLocale, setActiveLocale] = useState(cfg.defaultLocale);
  // Order the language tabs with the deployment's default/primary locale first
  // (the rest keep canonical KNOWN_LOCALES order), so the language the operator
  // authors in reads as primary instead of sitting mid-row.
  const localeTabs = localesDefaultFirst(LOCALE_CODES, cfg.defaultLocale);
  const [categoryId, setCategoryId] = useState(
    seed?.categoryId ?? item?.categoryId ?? (categories[0]?.id || 0)
  );
  const [price, setPrice] = useState(seed?.price ?? item?.price?.toString() ?? "");
  const [imageUrl, setImageUrl] = useState<string | undefined>(
    seed ? seed.imageUrl : item?.imageUrl ?? undefined
  );
  const [translations, setTranslations] = useState<
    Record<string, TranslationData>
  >(() => {
    if (seed) return seed.translations;
    const initial: Record<string, TranslationData> = {};
    if (item) {
      for (const t of item.names) {
        initial[t.locale] = {
          name: t.name,
          description: t.description ?? "",
        };
      }
    }
    return initial;
  });
  const [optionGroups, setOptionGroups] = useState<OptionGroupFormData[]>(
    () => seed?.optionGroups ?? optionGroupsFromItem(item?.optionGroups)
  );
  const [optionsExpanded, setOptionsExpanded] = useState(
    () => (seed?.optionGroups.length ?? item?.optionGroups?.length ?? 0) > 0
  );
  const [isCombo, setIsCombo] = useState(seed?.isCombo ?? item?.isCombo ?? false);
  const [isFeatured, setIsFeatured] = useState(seed?.isFeatured ?? item?.isFeatured ?? false);
  const [comboBasePrice, setComboBasePrice] = useState(
    seed?.comboBasePrice ?? item?.comboBasePrice?.toString() ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const addAnotherRef = useRef(false);

  function handleTranslationChange(
    locale: string,
    field: "name" | "description",
    value: string
  ) {
    setTranslations((prev) => ({
      ...prev,
      [locale]: {
        name: prev[locale]?.name ?? "",
        description: prev[locale]?.description ?? "",
        [field]: value,
      },
    }));
  }

  function getCategoryName(cat: Category): string {
    const loc = cat.names.find((n) => n.locale === locale);
    const th = cat.names.find((n) => n.locale === cfg.defaultLocale);
    return loc?.name || th?.name || cat.names[0]?.name || `#${cat.id}`;
  }

  function getItemLabel(it: MenuItem): string {
    const loc = it.names.find((n) => n.locale === locale);
    const def = it.names.find((n) => n.locale === cfg.defaultLocale);
    return loc?.name || def?.name || it.names[0]?.name || `#${it.id}`;
  }

  // Sibling items that can donate options (exclude the one being edited).
  const copyableItems = existingItems.filter((it) => it.id !== item?.id);

  // AI-translate the English name into the other 5 locales via OpenRouter.
  // Translate-all: source = the deployment's primary language (cfg.defaultLocale),
  // not hardcoded English. Fills name + description + every option group/choice
  // name into the OTHER locales, fill-empty-only (never clobbers manual edits,
  // never overwrites the source locale).
  async function handleTranslate() {
    const src = cfg.defaultLocale;
    const sourceName = translations[src]?.name?.trim();
    if (!sourceName) {
      setError(t("translateNeedsSource", { language: tLocales(src) }));
      setActiveLocale(src);
      return;
    }
    setTranslating(true);
    setError(null);
    try {
      const sourceDesc = translations[src]?.description?.trim();
      // Item name (+ description as a second item when present).
      const nameItems = sourceDesc
        ? [{ name: sourceName }, { name: sourceDesc }]
        : [{ name: sourceName }];
      const nameReq = fetch("/api/menu/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLocale: src, items: nameItems }),
      });

      const hasOptions = optionGroups.length > 0;
      const optReq = hasOptions
        ? fetch("/api/menu/translate-options", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceLocale: src,
              groups: optionGroups.map((g) => ({
                name: g.translations[src]?.name ?? "",
                choices: g.choices.map((c) => ({ name: c.translations[src]?.name ?? "" })),
              })),
            }),
          })
        : null;

      const [nameRes, optRes] = await Promise.all([nameReq, optReq]);

      let nameOk = false;
      if (nameRes.ok) {
        const data = await nameRes.json();
        const nameResult: Record<string, string> | undefined = data.translations?.[0];
        const descResult: Record<string, string> | undefined = sourceDesc ? data.translations?.[1] : undefined;
        if (nameResult) {
          nameOk = true;
          const incoming: Record<string, { name?: string; description?: string }> = {};
          for (const loc of LOCALE_CODES) {
            if (loc === src) continue;
            incoming[loc] = {
              name: nameResult[loc] ?? "",
              description: descResult?.[loc] ?? "",
            };
          }
          setTranslations((prev) => mergeTranslations(prev, incoming));
        }
      }

      let optOk = !hasOptions;
      if (optRes && optRes.ok) {
        const data = await optRes.json();
        const groups = data.groups ?? [];
        optOk = true;
        // Fill-empty for option group/choice names (these carry only `name`,
        // no description, so a small local fill — mergeTranslations is for the
        // {name,description} item shape).
        const fillName = (
          existing: Record<string, { name: string }>,
          incoming: Record<string, string> | undefined
        ) => {
          const next = { ...existing };
          for (const loc of LOCALE_CODES) {
            if (loc === src) continue;
            if (!next[loc]?.name?.trim() && incoming?.[loc]?.trim()) {
              next[loc] = { name: incoming[loc] };
            }
          }
          return next;
        };
        setOptionGroups((prev) =>
          prev.map((g, gi) => {
            const tg = groups[gi];
            if (!tg) return g;
            return {
              ...g,
              translations: fillName(g.translations, tg.name),
              choices: g.choices.map((c, ci) => ({
                ...c,
                translations: fillName(c.translations, tg.choices?.[ci]?.name),
              })),
            };
          })
        );
      }

      if (!nameOk && !optOk) throw new Error(t("translateFailed"));
      if (!nameOk || !optOk) setError(t("translatePartial"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("translateFailed"));
    } finally {
      setTranslating(false);
    }
  }

  // Option group handlers
  function handleCopyOptionsFrom(sourceId: number) {
    const source = copyableItems.find((it) => it.id === sourceId);
    if (!source || !source.optionGroups || source.optionGroups.length === 0)
      return;
    const incoming = cloneOptionGroups(optionGroupsFromItem(source.optionGroups));
    setOptionGroups((prev) => {
      const merged = [...prev, ...incoming].map((g, gi) => ({
        ...g,
        sortOrder: gi,
      }));
      if (merged.length > MAX_OPTION_GROUPS) {
        setError(t("optionGroupCapReached", { max: MAX_OPTION_GROUPS }));
        return prev; // reject — don't exceed the cap
      }
      if (merged.some((g) => g.choices.length > MAX_OPTION_CHOICES)) {
        setError(t("optionChoiceCapReached", { max: MAX_OPTION_CHOICES }));
        return prev;
      }
      setError(null);
      return merged;
    });
    setOptionsExpanded(true);
  }

  function addOptionGroup() {
    setOptionGroups((prev) => [
      ...prev,
      {
        selectionType: "SINGLE",
        isRequired: false,
        sortOrder: prev.length,
        translations: {},
        choices: [
          {
            priceAdjustment: "0",
            sortOrder: 0,
            translations: {},
          },
        ],
      },
    ]);
    setOptionsExpanded(true);
  }

  function removeOptionGroup(index: number) {
    setOptionGroups((prev) => prev.filter((_, i) => i !== index));
  }

  function updateOptionGroup(
    index: number,
    field: keyof OptionGroupFormData,
    value: unknown
  ) {
    setOptionGroups((prev) =>
      prev.map((g, i) => (i === index ? { ...g, [field]: value } : g))
    );
  }

  function updateGroupTranslation(
    groupIndex: number,
    locale: string,
    name: string
  ) {
    setOptionGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex
          ? {
              ...g,
              translations: { ...g.translations, [locale]: { name } },
            }
          : g
      )
    );
  }

  function addChoice(groupIndex: number) {
    setOptionGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex
          ? {
              ...g,
              choices: [
                ...g.choices,
                {
                  priceAdjustment: "0",
                  sortOrder: g.choices.length,
                  translations: {},
                },
              ],
            }
          : g
      )
    );
  }

  function removeChoice(groupIndex: number, choiceIndex: number) {
    setOptionGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex
          ? { ...g, choices: g.choices.filter((_, ci) => ci !== choiceIndex) }
          : g
      )
    );
  }

  function updateChoice(
    groupIndex: number,
    choiceIndex: number,
    field: string,
    value: unknown
  ) {
    setOptionGroups((prev) =>
      prev.map((g, gi) =>
        gi === groupIndex
          ? {
              ...g,
              choices: g.choices.map((c, ci) =>
                ci === choiceIndex ? { ...c, [field]: value } : c
              ),
            }
          : g
      )
    );
  }

  function updateChoiceTranslation(
    groupIndex: number,
    choiceIndex: number,
    locale: string,
    name: string
  ) {
    setOptionGroups((prev) =>
      prev.map((g, gi) =>
        gi === groupIndex
          ? {
              ...g,
              choices: g.choices.map((c, ci) =>
                ci === choiceIndex
                  ? {
                      ...c,
                      translations: {
                        ...c.translations,
                        [locale]: { name },
                      },
                    }
                  : c
              ),
            }
          : g
      )
    );
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      setError(t("invalidPrice"));
      return;
    }

    // Filter out translations without a name
    const filteredTranslations: Record<
      string,
      { name: string; description?: string }
    > = {};
    for (const [locale, data] of Object.entries(translations)) {
      if (data.name.trim()) {
        filteredTranslations[locale] = {
          name: data.name.trim(),
          ...(data.description.trim()
            ? { description: data.description.trim() }
            : {}),
        };
      }
    }

    if (Object.keys(filteredTranslations).length === 0) {
      setError(t("translationRequired"));
      return;
    }

    if (!categoryId) {
      setError(t("categoryRequired"));
      return;
    }

    // Validate option groups
    for (const group of optionGroups) {
      const groupTranslations = Object.entries(group.translations).filter(
        ([, v]) => v.name.trim()
      );
      if (groupTranslations.length === 0) {
        setError(t("translationRequired"));
        return;
      }
      if (group.choices.length === 0) {
        setError(t("atLeastOneChoice"));
        return;
      }
      for (const choice of group.choices) {
        const choiceTranslations = Object.entries(choice.translations).filter(
          ([, v]) => v.name.trim()
        );
        if (choiceTranslations.length === 0) {
          setError(t("translationRequired"));
          return;
        }
      }
    }

    setLoading(true);
    setError(null);

    try {
      const url = item ? `/api/menu/${item.id}` : "/api/menu";
      const method = item ? "PATCH" : "POST";

      // Build option groups payload
      const optionGroupsPayload = optionGroups.map((g, gi) => ({
        selectionType: g.selectionType,
        isRequired: g.isRequired,
        sortOrder: gi,
        translations: Object.fromEntries(
          Object.entries(g.translations)
            .filter(([, v]) => v.name.trim())
            .map(([k, v]) => [k, { name: v.name.trim() }])
        ),
        choices: g.choices.map((c, ci) => ({
          priceAdjustment: parseFloat(c.priceAdjustment) || 0,
          sortOrder: ci,
          translations: Object.fromEntries(
            Object.entries(c.translations)
              .filter(([, v]) => v.name.trim())
              .map(([k, v]) => [k, { name: v.name.trim() }])
          ),
        })),
      }));

      const body: Record<string, unknown> = {
        categoryId,
        price: priceNum,
        isCombo,
        isFeatured,
        comboBasePrice: isCombo && comboBasePrice ? parseFloat(comboBasePrice) : null,
        translations: filteredTranslations,
        optionGroups: optionGroupsPayload,
      };

      // Include imageUrl: send null to clear, string to set, omit if unchanged
      if (imageUrl !== undefined) {
        body.imageUrl = imageUrl || null;
      } else if (!item) {
        body.imageUrl = null;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("failedToSave"));
      }

      const saved = await res.json();
      // Ensure price is a number for the client
      saved.price = Number(saved.price);
      if (saved.comboBasePrice != null) saved.comboBasePrice = Number(saved.comboBasePrice);
      onSave(saved);
      if (addAnotherRef.current) {
        resetForAnother();   // keep the modal open for the next item
      } else {
        onClose();           // normal save closes the modal
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  // Reset to a blank draft but KEEP the chosen category + active locale tab,
  // so an operator can rattle off several items in the same category.
  function resetForAnother() {
    const draft = blankItemDraft(cfg.defaultLocale);
    setPrice(draft.price);
    setImageUrl(draft.imageUrl);
    setIsCombo(draft.isCombo);
    setIsFeatured(draft.isFeatured);
    setComboBasePrice(draft.comboBasePrice);
    setTranslations(draft.translations);
    setOptionGroups(draft.optionGroups);
    setOptionsExpanded(false);
    setError(null);
    // categoryId and activeLocale intentionally preserved.
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="menu-item-form-title" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl sm:max-h-[90vh]">
        {/* Sticky header */}
        <div className="shrink-0 border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4">
          <h2 id="menu-item-form-title" className="text-lg font-semibold text-gray-900">
            {item ? t("editMenuItem") : t("addMenuItem")}
          </h2>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            {error && (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Category */}
              <div>
                <label
                  htmlFor="categoryId"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  {t("category")}
                </label>
                <select
                  id="categoryId"
                  value={categoryId}
                  onChange={(e) => setCategoryId(parseInt(e.target.value, 10))}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                >
                  <option value={0} disabled>
                    {t("selectCategory")}
                  </option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {getCategoryName(cat)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Price */}
              <div>
                <label
                  htmlFor="price"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  {t("priceLabel", { currencyCode: cfg.currency })}
                </label>
                <input
                  id="price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
              </div>
            </div>

            {/* Image Upload — only when R2 storage is configured. When it's not,
                show a note pointing the restaurant to its provider (the item
                still saves fine without a photo). */}
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t("image")}
              </label>
              {cfg.capabilities.hasR2 ? (
                <ImageUpload
                  value={imageUrl}
                  onUpload={(url) => setImageUrl(url)}
                  onRemove={() => setImageUrl(undefined)}
                />
              ) : (
                <p className="text-xs text-gray-400">{t("imageUploadUnavailable")}</p>
              )}
            </div>

            {/* Combo & Featured toggles */}
            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isCombo}
                  onChange={(e) => {
                    setIsCombo(e.target.checked);
                    if (!e.target.checked) setComboBasePrice("");
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-700">{t("isCombo")}</span>
              </label>

              {isCombo && (
                <div className="ml-6">
                  <label htmlFor="comboBasePrice" className="block text-sm font-medium text-gray-700">
                    {t("comboBasePrice", { currencyCode: cfg.currency })}
                  </label>
                  <p className="mt-0.5 text-xs text-gray-500">{t("comboPriceHint", { currencyCode: cfg.currency })}</p>
                  <input
                    id="comboBasePrice"
                    type="number"
                    min="0"
                    step="0.01"
                    value={comboBasePrice}
                    onChange={(e) => setComboBasePrice(e.target.value)}
                    placeholder={t("comboPricePlaceholder")}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 sm:w-48"
                  />
                </div>
              )}

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={(e) => setIsFeatured(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-700">{t("isFeatured")}</span>
              </label>
            </div>

            {/* Translation Tabs */}
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="block text-sm font-medium text-gray-700">
                  {t("translations")}
                </label>
                {/* AI translate — only when OpenRouter is configured. Fills the
                    5 non-English name fields from the English source. */}
                {cfg.capabilities.hasOpenRouter && (
                  <button
                    type="button"
                    onClick={handleTranslate}
                    disabled={translating || loading}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-primary-500 bg-white px-2.5 py-1.5 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
                    title={t("translateHint")}
                  >
                    {translating && (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-200 border-t-primary-500" />
                    )}
                    {translating ? t("translating") : t("translateAll", { language: tLocales(cfg.defaultLocale) })}
                  </button>
                )}
                {/* AI translate disabled — point the restaurant to its provider.
                    Shown only when OpenRouter is unconfigured. */}
                {!cfg.capabilities.hasOpenRouter && (
                  <p className="text-xs text-gray-400">{t("translateUnavailable")}</p>
                )}
              </div>
              <div className="mb-3 flex gap-1 overflow-x-auto border-b border-gray-200">
                {localeTabs.map((loc) => {
                  const hasValue = !!translations[loc]?.name?.trim();
                  return (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setActiveLocale(loc)}
                      className={`relative inline-flex min-h-[44px] shrink-0 items-center px-3 py-2 text-sm font-medium transition-colors ${
                        activeLocale === loc
                          ? "border-b-2 border-primary-500 text-primary-500"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {loc}
                      {hasValue && (
                        <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary-500" />
                      )}
                    </button>
                  );
                })}
              </div>

              {LOCALE_CODES.map((loc) => (
                <div
                  key={loc}
                  className={`space-y-3 ${
                    activeLocale === loc ? "block" : "hidden"
                  }`}
                >
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">
                      {t("itemName", { locale: tLocales(loc) })}
                    </label>
                    <input
                      type="text"
                      value={translations[loc]?.name ?? ""}
                      onChange={(e) =>
                        handleTranslationChange(loc, "name", e.target.value)
                      }
                      placeholder={t("itemNamePlaceholder", { locale: tLocales(loc) })}
                      maxLength={200}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">
                      {t("itemDescription", { locale: tLocales(loc) })}
                    </label>
                    <textarea
                      value={translations[loc]?.description ?? ""}
                      onChange={(e) =>
                        handleTranslationChange(
                          loc,
                          "description",
                          e.target.value
                        )
                      }
                      placeholder={t("itemDescriptionPlaceholder", { locale: tLocales(loc) })}
                      maxLength={500}
                      rows={2}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Option Groups Section */}
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setOptionsExpanded((prev) => !prev)}
                className="flex w-full items-center justify-between rounded-md bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                <span>
                  {t("options")}{" "}
                  <span className="text-gray-400">
                    ({optionGroups.length > 0
                      ? `${optionGroups.length} ${optionGroups.length === 1 ? "group" : "groups"}`
                      : t("noOptionGroups")})
                  </span>
                </span>
                <svg
                  className={`h-4 w-4 text-gray-500 transition-transform ${optionsExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {optionsExpanded && (
                <div className="mt-3 space-y-4">
                  {copyableItems.length > 0 && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <label className="text-xs font-medium text-gray-600">
                        {t("copyOptionsFrom")}
                      </label>
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const id = parseInt(e.target.value, 10);
                          if (!isNaN(id)) handleCopyOptionsFrom(id);
                          e.target.value = ""; // reset so the same item can be re-picked
                        }}
                        className="min-h-[44px] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                      >
                        <option value="" disabled>
                          {t("copyOptionsSelect")}
                        </option>
                        {copyableItems.map((it) => {
                          const count = it.optionGroups?.length ?? 0;
                          return (
                            <option key={it.id} value={it.id} disabled={count === 0}>
                              {getItemLabel(it)}
                              {count === 0 ? ` — ${t("noOptionGroupsShort")}` : ""}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}
                  {optionGroups.map((group, gi) => (
                    <div
                      key={gi}
                      className="rounded-lg border border-gray-200 bg-gray-50/50 p-3"
                    >
                      {/* Group header */}
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">
                          {t("optionGroups")} #{gi + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeOptionGroup(gi)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          {t("removeOptionGroup")}
                        </button>
                      </div>

                      {/* Group name — locale tabs (compact) */}
                      <div className="mb-2">
                        <div className="mb-1 flex gap-1 overflow-x-auto">
                          {localeTabs.map((loc) => (
                            <button
                              key={loc}
                              type="button"
                              onClick={() => setActiveLocale(loc)}
                              className={`inline-flex min-h-[44px] shrink-0 items-center px-2 py-1 text-xs font-medium transition-colors ${
                                activeLocale === loc
                                  ? "text-primary-600 underline"
                                  : "text-gray-400 hover:text-gray-600"
                              }`}
                            >
                              {loc}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          value={
                            group.translations[activeLocale]?.name ?? ""
                          }
                          onChange={(e) =>
                            updateGroupTranslation(
                              gi,
                              activeLocale,
                              e.target.value
                            )
                          }
                          placeholder={t("groupName", {
                            locale: tLocales(activeLocale),
                          })}
                          maxLength={100}
                          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-base text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                        />
                      </div>

                      {/* Selection type + required */}
                      <div className="mb-3 flex flex-wrap gap-3">
                        <label className="flex items-center gap-1.5 text-xs text-gray-600">
                          <select
                            value={group.selectionType}
                            onChange={(e) =>
                              updateOptionGroup(
                                gi,
                                "selectionType",
                                e.target.value
                              )
                            }
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-base focus:border-primary-500 focus:outline-none"
                          >
                            <option value="SINGLE">{t("single")}</option>
                            <option value="MULTIPLE">
                              {t("multiple")}
                            </option>
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={group.isRequired}
                            onChange={(e) =>
                              updateOptionGroup(
                                gi,
                                "isRequired",
                                e.target.checked
                              )
                            }
                            className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                          />
                          {t("required")}
                        </label>
                      </div>

                      {/* Choices */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">
                          {t("choices")}
                        </label>
                        {group.choices.map((choice, ci) => (
                          <div
                            key={ci}
                            className="flex items-start gap-2 rounded-md border border-gray-200 bg-white p-2"
                          >
                            <div className="flex-1 space-y-1">
                              <input
                                type="text"
                                value={
                                  choice.translations[activeLocale]?.name ??
                                  ""
                                }
                                onChange={(e) =>
                                  updateChoiceTranslation(
                                    gi,
                                    ci,
                                    activeLocale,
                                    e.target.value
                                  )
                                }
                                placeholder={t("choiceName", {
                                  locale: tLocales(activeLocale),
                                })}
                                maxLength={100}
                                className="w-full rounded border border-gray-200 px-2 py-1 text-base text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none"
                              />
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-gray-400">
                                  +{currencySymbolWith({ currency: cfg.currency, locale: cfg.defaultLocale })}
                                </span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={choice.priceAdjustment}
                                  onChange={(e) =>
                                    updateChoice(
                                      gi,
                                      ci,
                                      "priceAdjustment",
                                      e.target.value
                                    )
                                  }
                                  className="w-20 rounded border border-gray-200 px-2 py-1 text-base text-gray-900 focus:border-primary-500 focus:outline-none"
                                />
                              </div>
                            </div>
                            {group.choices.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeChoice(gi, ci)}
                                className="mt-1 text-xs text-red-400 hover:text-red-600"
                              >
                                {t("removeChoice")}
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addChoice(gi)}
                          className="text-xs font-medium text-primary-600 hover:text-primary-700"
                        >
                          + {t("addChoice")}
                        </button>
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={addOptionGroup}
                    className="w-full rounded-md border border-dashed border-gray-300 py-2 text-sm font-medium text-gray-500 hover:border-primary-400 hover:text-primary-600"
                  >
                    + {t("addOptionGroup")}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Sticky footer */}
          <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:opacity-60"
              >
                {tCommon("cancel")}
              </button>
              {!item && (
                <button
                  type="submit"
                  disabled={loading}
                  onClick={() => { addAnotherRef.current = true; }}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-primary-500 bg-white px-4 py-2.5 text-sm font-medium text-primary-600 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:opacity-60"
                >
                  {t("saveAndAddAnother")}
                </button>
              )}
              <button
                type="submit"
                disabled={loading}
                onClick={() => { addAnotherRef.current = false; }}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {loading ? tCommon("saving") : tCommon("save")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
