"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useConfig } from "@/components/providers/config-provider";
import { currencySymbolWith } from "@/lib/money-client";
import { KNOWN_LOCALES } from "@/lib/deployment-config";
import { ImageUpload } from "@/components/ui/image-upload";

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
  categories: Category[];
  onSave: (item: MenuItem) => void;
  onClose: () => void;
}

interface TranslationData {
  name: string;
  description: string;
}

interface OptionGroupFormData {
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  sortOrder: number;
  translations: Record<string, { name: string }>;
  choices: Array<{
    priceAdjustment: string;
    sortOrder: number;
    translations: Record<string, { name: string }>;
  }>;
}

function initOptionGroups(groups?: OptionGroupData[]): OptionGroupFormData[] {
  if (!groups || groups.length === 0) return [];
  return groups.map((g) => ({
    selectionType: g.selectionType,
    isRequired: g.isRequired,
    sortOrder: g.sortOrder,
    translations: Object.fromEntries(
      g.names.map((n) => [n.locale, { name: n.name }])
    ),
    choices: g.choices.map((c) => ({
      priceAdjustment: c.priceAdjustment.toString(),
      sortOrder: c.sortOrder,
      translations: Object.fromEntries(
        c.names.map((n) => [n.locale, { name: n.name }])
      ),
    })),
  }));
}

export function MenuItemForm({
  item,
  categories,
  onSave,
  onClose,
}: MenuItemFormProps) {
  const t = useTranslations("admin.menuItemForm");
  const tCommon = useTranslations("common");
  const tLocales = useTranslations("locales");
  const locale = useLocale();
  const cfg = useConfig();
  const [activeLocale, setActiveLocale] = useState("th");
  const [categoryId, setCategoryId] = useState(
    item?.categoryId ?? (categories[0]?.id || 0)
  );
  const [price, setPrice] = useState(item?.price?.toString() ?? "");
  const [imageUrl, setImageUrl] = useState<string | undefined>(
    item?.imageUrl ?? undefined
  );
  const [translations, setTranslations] = useState<
    Record<string, TranslationData>
  >(() => {
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
    () => initOptionGroups(item?.optionGroups)
  );
  const [optionsExpanded, setOptionsExpanded] = useState(
    () => (item?.optionGroups?.length ?? 0) > 0
  );
  const [isCombo, setIsCombo] = useState(item?.isCombo ?? false);
  const [isFeatured, setIsFeatured] = useState(item?.isFeatured ?? false);
  const [comboBasePrice, setComboBasePrice] = useState(
    item?.comboBasePrice?.toString() ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Option group handlers
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

  async function handleSubmit(e: React.FormEvent) {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    } finally {
      setLoading(false);
    }
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

            {/* Image Upload — only when R2 storage is configured; otherwise
                the item simply saves without a photo. */}
            {cfg.capabilities.hasR2 && (
              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {t("image")}
                </label>
                <ImageUpload
                  value={imageUrl}
                  onUpload={(url) => setImageUrl(url)}
                  onRemove={() => setImageUrl(undefined)}
                />
              </div>
            )}

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
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("translations")}
              </label>
              <div className="mb-3 flex flex-wrap gap-1 border-b border-gray-200">
                {LOCALE_CODES.map((loc) => {
                  const hasValue = !!translations[loc]?.name?.trim();
                  return (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setActiveLocale(loc)}
                      className={`relative inline-flex min-h-[44px] items-center px-3 py-2 text-sm font-medium transition-colors ${
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
                        <div className="mb-1 flex flex-wrap gap-1">
                          {LOCALE_CODES.map((loc) => (
                            <button
                              key={loc}
                              type="button"
                              onClick={() => setActiveLocale(loc)}
                              className={`inline-flex min-h-[44px] items-center px-2 py-1 text-xs font-medium transition-colors ${
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
                          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs focus:border-primary-500 focus:outline-none"
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
                                className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none"
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
                                  className="w-20 rounded border border-gray-200 px-2 py-1 text-xs text-gray-900 focus:border-primary-500 focus:outline-none"
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
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:opacity-60"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="submit"
                disabled={loading}
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
