"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useConfig } from "@/components/providers/config-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { formatMoneyWith } from "@/lib/money-client";
import { sourceLocaleForExtraction, computeReviewFlags, dedupeExtractedItems, type ReviewFlag } from "@/lib/menu-extraction";
import type { ExtractedOptionGroup, ExtractedOptionChoice } from "@/lib/openrouter";

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
  createdAt: string;
  updatedAt: string;
}

// ExtractedOptionGroup / ExtractedOptionChoice are imported from openrouter.ts
// (the canonical 5-locale shape) — the modal must NOT redeclare a narrower
// (th/en/zh-CN-only) copy, or it silently drops the Malay/Vietnamese printed
// option names the extractor emits before they reach translation.

interface ExtractedItem {
  name_th: string;
  name_en: string;
  name_zh_CN: string;
  name_ms: string;
  name_vi: string;
  price: number;
  selected: boolean;
  category: string;
  priceConflict?: { prices: number[]; kept: number };
  optionGroups?: ExtractedOptionGroup[];
}

interface ExistingItemName {
  name: string;
  locale: string;
}

interface MenuImportModalProps {
  categories: Category[];
  existingItems: Array<{ names: ExistingItemName[] }>;
  onImported: (items: MenuItem[], newCategories: Category[]) => void;
  onClose: () => void;
}

type Step = "upload" | "extracting" | "review" | "saving";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_IMAGES = 10;

// First non-empty printed name across all five extracted locale fields — the
// last-resort base fallback so an option group/choice never serializes an empty
// name when its source language (e.g. VI/MS) sits outside the en/th defaults.
function groupAnyName(
  n: ExtractedOptionGroup | ExtractedOptionChoice
): string {
  return (
    n.name_en ||
    n.name_th ||
    n.name_zh_CN ||
    n.name_ms ||
    n.name_vi ||
    ""
  );
}

function buildExistingNameSet(
  items: Array<{ names: ExistingItemName[] }>
): Set<string> {
  const set = new Set<string>();
  for (const item of items) {
    for (const n of item.names) {
      const normalized = n.name.trim().toLowerCase();
      if (normalized) set.add(normalized);
    }
  }
  return set;
}

function checkDuplicate(
  item: ExtractedItem,
  existingNames: Set<string>
): string | null {
  // Check all five extracted name fields against existing menu items
  for (const name of [item.name_th, item.name_en, item.name_zh_CN, item.name_ms, item.name_vi]) {
    const normalized = name.trim().toLowerCase();
    if (normalized && existingNames.has(normalized)) {
      return name;
    }
  }
  return null;
}

export function MenuImportModal({
  categories: initialCategories,
  existingItems,
  onImported,
  onClose,
}: MenuImportModalProps) {
  const t = useTranslations("admin.menuImport");
  const tCommon = useTranslations("common");
  const cfg = useConfig();
  const confirm = useConfirm();
  // The language the printed menu is transcribed in (canonical → default → en).
  // Anchors the AI translate request's source-of-truth so a non-English-first
  // deployment translates from its own primary language.
  const sourceLocale = sourceLocaleForExtraction({
    canonicalLocale: cfg.canonicalLocale,
    defaultLocale: cfg.defaultLocale,
  });
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });
  // Step must match the currency's minor unit so cent prices (9.50) aren't flagged
  // invalid by an integer step. 0.01 for THB/MYR/SGD, 1 for zero-decimal VND.
  const priceStep = cfg.decimals > 0 ? 1 / 10 ** cfg.decimals : 1;
  const existingNames = useMemo(
    () => buildExistingNameSet(existingItems),
    [existingItems]
  );

  const [step, setStep] = useState<Step>("upload");
  const [images, setImages] = useState<{ file: File; preview: string; base64: string }[]>([]);
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState<string>("");
  // Visual save-phase stepper: 0 = idle, 1 = Translating, 2 = Saving.
  const [saveStep, setSaveStep] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readFileAsBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  async function addFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      setError(t("tooManyImages"));
      return;
    }

    const toAdd = fileArray.slice(0, remaining);
    const newImages: typeof images = [];

    for (const file of toAdd) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError(t("invalidFileType"));
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(t("fileTooLarge"));
        return;
      }
      const base64 = await readFileAsBase64(file);
      newImages.push({
        file,
        preview: URL.createObjectURL(file),
        base64,
      });
    }

    setError(null);
    setImages((prev) => [...prev, ...newImages]);
  }

  function removeImage(index: number) {
    setImages((prev) => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    e.target.value = "";
  }

  async function handleExtract() {
    setStep("extracting");
    setError(null);

    try {
      const res = await fetch("/api/menu/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: images.map((img) => img.base64),
          existingCategories: initialCategories
            .map((cat) => {
              const en = cat.names.find((n) => n.locale === "en");
              return en?.name || cat.names[0]?.name || "";
            })
            .filter(Boolean),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t("extractionFailed"));
      }

      const data = await res.json();
      const extracted: ExtractedItem[] = (data.items || []).map(
        (item: { name_th: string; name_en: string; name_zh_CN: string; name_ms?: string; name_vi?: string; price: number; category?: string; priceConflict?: { prices: number[]; kept: number }; optionGroups?: ExtractedOptionGroup[] }) => {
          const base: ExtractedItem = {
            name_th: item.name_th,
            name_en: item.name_en,
            name_zh_CN: item.name_zh_CN,
            name_ms: item.name_ms ?? "",
            name_vi: item.name_vi ?? "",
            price: item.price,
            category: item.category || t("defaultCategory"),
            selected: true,
            priceConflict: item.priceConflict,
            ...(item.optionGroups && item.optionGroups.length > 0
              ? { optionGroups: item.optionGroups }
              : {}),
          };
          // Auto-deselect items that match existing menu items
          if (checkDuplicate(base, existingNames)) {
            base.selected = false;
          }
          return base;
        }
      );

      if (extracted.length === 0) {
        setError(t("noItemsExtracted"));
        setStep("upload");
        return;
      }

      const dupeCount = extracted.filter(
        (i) => checkDuplicate(i, existingNames) !== null
      ).length;
      if (dupeCount > 0) {
        setWarning(t("duplicatesFound", { count: dupeCount }));
      }

      setItems(extracted);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("extractionFailed"));
      setStep("upload");
    }
  }

  function toggleItem(index: number) {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, selected: !item.selected } : item
      )
    );
  }

  function toggleAll() {
    const allSelected = items.every((i) => i.selected);
    setItems((prev) => prev.map((item) => ({ ...item, selected: !allSelected })));
  }

  function updateItem(index: number, field: keyof ExtractedItem, value: string | number | boolean) {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    );
  }

  const includedItems = items.filter((i) => i.selected);

  // Per-item advisory review flags (single source of truth in menu-extraction):
  // drives the price-conflict badge, the confidence sort, and the summary bar.
  const itemFlags = useMemo<ReviewFlag[][]>(
    () => items.map((it) => computeReviewFlags(it, existingNames)),
    [items, existingNames]
  );

  // Render-order-only view (does NOT mutate state): floats flagged items to the
  // top while preserving original order within each group (stable sort). Carries
  // the ORIGINAL index so toggle/edit handlers still target the right item.
  const sortedItemEntries = useMemo(() => {
    return items
      .map((item, idx) => ({ item, idx, flagged: itemFlags[idx]?.length > 0 }))
      .sort((a, b) => (a.flagged === b.flagged ? 0 : a.flagged ? -1 : 1));
  }, [items, itemFlags]);

  // Per-row in-batch merge target: for each item, the index of the FIRST earlier
  // row the dedup considers the SAME dish (running dedupeExtractedItems on the
  // 2-row [predecessor, thisItem] collapses to 1), else -1. This is an
  // IN-BATCH duplicate (two extracted rows of one dish), distinct from the
  // existingDuplicate flag (matches the already-saved menu, not a merge target).
  const mergeTargets = useMemo<number[]>(() => {
    return items.map((item, idx) => {
      for (let j = 0; j < idx; j++) {
        if (dedupeExtractedItems([items[j], item], sourceLocale).length === 1) {
          return j;
        }
      }
      return -1;
    });
  }, [items, sourceLocale]);

  // Collapse a row into its in-batch twin above it, then drop the row. Reuses the
  // dedup helper so the merged result (filled-empty locale fields, lower price +
  // priceConflict record) matches the extraction-time dedup exactly. Preserves
  // the TARGET's selected flag (the kept row's intent wins).
  async function handleMergeRow(idx: number) {
    const target = mergeTargets[idx];
    if (target < 0) return;
    setItems((prev) => {
      const targetRow = prev[target];
      const thisRow = prev[idx];
      if (!targetRow || !thisRow) return prev;
      const merged = dedupeExtractedItems([targetRow, thisRow], sourceLocale)[0];
      return prev
        .map((it, i) => (i === target ? { ...merged, selected: it.selected } : it))
        .filter((_, i) => i !== idx);
    });
    setError(null);
    setWarning(t("mergedToast"));
  }

  // Pre-save summary counts (selected items only).
  const selectedCount = items.filter((i) => i.selected).length;
  const flaggedSelected = items.filter(
    (i, idx) => i.selected && itemFlags[idx]?.length > 0
  ).length;
  const readySelected = selectedCount - flaggedSelected;

  // Find existing category by English name (case-insensitive)
  function findExistingCategory(name: string, cats: Category[]): Category | undefined {
    const lower = name.toLowerCase().trim();
    return cats.find((cat) =>
      cat.names.some((n) => n.name.toLowerCase().trim() === lower)
    );
  }

  async function handleSave() {
    if (includedItems.length === 0) return;

    // Warn before silently dropping sentinel-priced items. The AI extractor emits
    // price -1 for "Market Price" items and 0 for unclear ones; the batch endpoint
    // rejects any price <= 0 (z.number().positive()), so the downstream filter
    // (validBatchItems, below) strips them. Without this prompt the admin would
    // see "saved" and never know a market-price line was dropped. List the names
    // and let them confirm dropping them or cancel to go back and set prices.
    const droppedItems = includedItems.filter((i) => i.price <= 0);
    if (droppedItems.length > 0) {
      const names = droppedItems
        .map((i) => i.name_en || i.name_th || i.name_zh_CN)
        .join(", ");
      const proceed = await confirm({
        message: t("confirmDropUnpriced", { count: droppedItems.length, names }),
        confirmLabel: tCommon("proceed"),
        tone: "default",
      });
      if (!proceed) return; // stay on the review step so they can fix prices
    }

    setStep("saving");
    setError(null);
    setSaveStep(0);

    try {
      // Step 1: Resolve categories — create any that don't exist
      // Stepper step 1 ("Translating") spans category creation + translation.
      setSaveStep(1);
      setSavingStatus(t("creatingCategories"));

      const categoryNames = [...new Set(includedItems.map((i) => i.category.trim()))];
      const categoryMap: Record<string, number> = {}; // category name -> id
      const allCategories = [...initialCategories];
      const newCategories: Category[] = [];

      // Find which categories need to be created
      const existingMap: Record<string, number> = {};
      const namesToCreate: string[] = [];
      for (const name of categoryNames) {
        const existing = findExistingCategory(name, allCategories);
        if (existing) {
          existingMap[name] = existing.id;
        } else {
          namesToCreate.push(name);
        }
      }
      Object.assign(categoryMap, existingMap);

      // Translate new category names to all locales, then create them
      if (namesToCreate.length > 0) {
        let categoryTranslations: Array<Record<string, string>> = [];
        try {
          const catTransRes = await fetch("/api/categories/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Category names are printed in the menu's source language — anchor
            // translation on it, same as the item/option name passes.
            body: JSON.stringify({ sourceLocale, names: namesToCreate }),
          });
          if (catTransRes.ok) {
            const catTransData = await catTransRes.json();
            categoryTranslations = catTransData.translations || [];
          }
        } catch {
          // Translation failed — will fall back to English name for all locales
        }

        for (let i = 0; i < namesToCreate.length; i++) {
          const name = namesToCreate[i];
          const trans = categoryTranslations[i] || {};
          const categoryPayload = {
            sortOrder: allCategories.length,
            translations: {
              th: trans.th || name,
              en: trans.en || name,
              vi: trans.vi || name,
              "zh-CN": trans["zh-CN"] || name,
              "zh-TW": trans["zh-TW"] || name,
              ms: trans.ms || name,
            },
          };
          const res = await fetch("/api/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(categoryPayload),
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const detail = data.issues
              ? `: ${JSON.stringify(data.issues)}`
              : "";
            throw new Error(
              (data.error || t("failedToCreateCategory", { name })) + detail
            );
          }

          const created: Category = await res.json();
          categoryMap[name] = created.id;
          allCategories.push(created);
          newCategories.push(created);
        }
      }

      // Step 2: Translate item names
      setSavingStatus(t("translating"));
      const translateRes = await fetch("/api/menu/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLocale,
          items: includedItems.map((i) => {
            // pick the source-language printed name; fall back to English, then Thai.
            const field = `name_${sourceLocale.replace("-", "_")}` as keyof typeof i;
            const sourceName = (i[field] as string) || i.name_en || i.name_th || "";
            return { name: sourceName };
          }),
        }),
      });

      let translations: Array<Record<string, string>> = [];
      if (translateRes.ok) {
        const tData = await translateRes.json();
        translations = tData.translations || [];
      }

      // Step 2b: Translate option group/choice names (if any items have options)
      const itemsWithOptions = includedItems.filter(
        (i) => i.optionGroups && i.optionGroups.length > 0
      );

      // Map from item index (in includedItems) to translated option data
      const optionTranslationsMap: Map<
        number,
        Array<{
          groupTrans: Record<string, string>;
          choiceTrans: Array<Record<string, string>>;
        }>
      > = new Map();

      if (itemsWithOptions.length > 0) {
        setSavingStatus(t("translatingOptions"));

        // Pick the source-language printed name across all five locale fields,
        // same precedence as the item-name call above (source → en → th). This
        // is what anchors option translation on the printed source language; a
        // VI/MS-only printed option name must NOT be dropped here.
        const optionField = `name_${sourceLocale.replace("-", "_")}` as
          | keyof ExtractedOptionGroup
          | keyof ExtractedOptionChoice;
        const sourceName = (n: ExtractedOptionGroup | ExtractedOptionChoice) =>
          (n[optionField as keyof typeof n] as string) || n.name_en || n.name_th || "";

        // Collect all option groups into a single source-locale-aware batch.
        // The translate-options route's new shape is { sourceLocale, groups:[{ name, choices:[{ name }] }] }.
        const allGroups: Array<{ name: string; choices: Array<{ name: string }> }> = [];
        // Track which item index each group belongs to
        const groupItemMap: Array<{ itemIdx: number; groupIdx: number }> = [];

        for (let i = 0; i < includedItems.length; i++) {
          const item = includedItems[i];
          if (!item.optionGroups || item.optionGroups.length === 0) continue;
          for (let g = 0; g < item.optionGroups.length; g++) {
            const group = item.optionGroups[g];
            allGroups.push({
              name: sourceName(group),
              choices: group.choices.map((c) => ({ name: sourceName(c) })),
            });
            groupItemMap.push({ itemIdx: i, groupIdx: g });
          }
        }

        try {
          const optTransRes = await fetch("/api/menu/translate-options", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceLocale, groups: allGroups }),
          });

          if (optTransRes.ok) {
            const optTransData = await optTransRes.json();
            const translatedGroups = optTransData.groups || [];

            for (let i = 0; i < groupItemMap.length; i++) {
              const { itemIdx } = groupItemMap[i];
              const tg = translatedGroups[i];
              if (!tg) continue;

              if (!optionTranslationsMap.has(itemIdx)) {
                optionTranslationsMap.set(itemIdx, []);
              }
              optionTranslationsMap.get(itemIdx)!.push({
                groupTrans: tg.name || {},
                choiceTrans: (tg.choices || []).map(
                  (c: { name: Record<string, string> }) => c.name || {}
                ),
              });
            }
          }
        } catch {
          // Option translation failed — fall back to base languages below.
        }
      }

      // Step 3: Build batch items with all translations
      // Stepper step 2 ("Saving") spans the final batch save.
      setSaveStep(2);
      setSavingStatus(t("savingItems", { count: includedItems.length }));

      const batchItems = includedItems.map((item, idx) => {
        const trans = translations[idx] || {};
        // Locale source precedence (learned from cross-market testing):
        // - en comes from EXTRACTION: the vision model reads printed English
        //   accurately and keeps the menu's exact wording.
        // - zh-CN PREFERS extraction (the vision model keeps printed Chinese
        //   verbatim, e.g. 肉脞面 as printed, not a re-translation) but falls
        //   back to the TRANSLATION pass when the source menu has no Chinese —
        //   otherwise an English-source menu silently kept English under zh-CN.
        // - th comes from the TRANSLATION pass, NOT extraction. On a non-Thai
        //   source menu the extractor hallucinates Thai inline (e.g. "Nasi
        //   Lemak" → "taro sugar"); the translation pass, anchored on the good
        //   English/Chinese, produces correct Thai — and faithfully echoes real
        //   Thai when the source IS Thai. So translation-first is never worse.
        // - vi / zh-TW / ms only exist in the translation pass.
        // Every field falls back to the English name if its source is empty.
        const translationsMap: Record<string, { name: string }> = {
          th: { name: trans.th || item.name_th || item.name_en },
          // Fall back through EVERY locale name so en.name is never empty when
          // the item has a name in any locale (e.g. a VI/MS-source item whose
          // translate pass failed) — otherwise validBatchItems would silently
          // drop a user-selected item for an empty English name.
          en: { name: trans.en || item.name_en || item.name_th || item.name_ms || item.name_vi || item.name_zh_CN },
          vi: { name: trans.vi || item.name_en },
          // Printed Chinese (extraction) wins; else the translated Chinese; else English.
          "zh-CN": { name: item.name_zh_CN || trans["zh-CN"] || item.name_en },
          "zh-TW": { name: trans["zh-TW"] || item.name_en },
          ms: { name: trans.ms || item.name_en },
        };

        // Build option groups with full translations
        let optionGroups: Array<{
          selectionType: "SINGLE" | "MULTIPLE";
          isRequired: boolean;
          sortOrder: number;
          translations: Record<string, { name: string }>;
          choices: Array<{
            priceAdjustment: number;
            sortOrder: number;
            translations: Record<string, { name: string }>;
          }>;
        }> | undefined;

        if (item.optionGroups && item.optionGroups.length > 0) {
          const optTrans = optionTranslationsMap.get(idx) || [];
          optionGroups = item.optionGroups.map((group, gi) => {
            const gt = optTrans[gi];
            return {
              selectionType: group.selectionType,
              isRequired: group.isRequired,
              sortOrder: gi,
              translations: {
                // th/vi/zh-TW/ms from the option-translation pass (extraction
                // hallucinates Thai on non-Thai menus); en/zh-CN from extraction.
                // Each base fallback falls through EVERY extracted locale name so
                // a VI/MS-source option (whose translate pass may have failed)
                // never lands an empty name — mirrors the item-name precedence.
                th: { name: gt?.groupTrans?.th || group.name_th || groupAnyName(group) },
                en: { name: group.name_en || group.name_th || groupAnyName(group) },
                vi: { name: gt?.groupTrans?.vi || group.name_vi || groupAnyName(group) },
                "zh-CN": { name: group.name_zh_CN || groupAnyName(group) },
                "zh-TW": { name: gt?.groupTrans?.["zh-TW"] || groupAnyName(group) },
                ms: { name: gt?.groupTrans?.ms || group.name_ms || groupAnyName(group) },
              },
              choices: group.choices.map((choice, ci) => {
                const ct = gt?.choiceTrans?.[ci];
                return {
                  priceAdjustment: choice.priceAdjustment,
                  sortOrder: ci,
                  translations: {
                    th: { name: ct?.th || choice.name_th || groupAnyName(choice) },
                    en: { name: choice.name_en || choice.name_th || groupAnyName(choice) },
                    vi: { name: ct?.vi || choice.name_vi || groupAnyName(choice) },
                    "zh-CN": { name: choice.name_zh_CN || groupAnyName(choice) },
                    "zh-TW": { name: ct?.["zh-TW"] || groupAnyName(choice) },
                    ms: { name: ct?.ms || choice.name_ms || groupAnyName(choice) },
                  },
                };
              }),
            };
          });
        }

        return {
          categoryId: categoryMap[item.category.trim()],
          price: item.price,
          translations: translationsMap,
          ...(optionGroups ? { optionGroups } : {}),
        };
      });

      // Filter out any items with empty names or missing categoryId
      const validBatchItems = batchItems.filter(
        (item) => item.categoryId && item.price > 0 && item.translations.en?.name
      );

      if (validBatchItems.length === 0) {
        throw new Error(t("saveFailed"));
      }

      const batchRes = await fetch("/api/menu/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: validBatchItems }),
      });

      if (!batchRes.ok) {
        const data = await batchRes.json().catch(() => ({}));
        const detail = data.issues
          ? `: ${data.issues.map((i: { message: string }) => i.message).join(", ")}`
          : "";
        throw new Error((data.error || t("saveFailed")) + detail);
      }

      const created = await batchRes.json();
      const normalized = created.map((item: MenuItem & { price: string | number }) => ({
        ...item,
        price: Number(item.price),
      }));
      onImported(normalized, newCategories);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
      setStep("review");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="menu-import-title" className="flex max-h-[95dvh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl sm:max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 id="menu-import-title" className="text-lg font-semibold text-gray-900">{t("title")}</h2>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-md text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            aria-label={tCommon("close")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Body - scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {warning && !error && (
            <div className="mb-4 rounded-md bg-orange-50 p-3 text-sm text-orange-700">
              {warning}
            </div>
          )}

          {/* UPLOAD STEP */}
          {step === "upload" && (
            <div>
              <h3 className="mb-1 text-base font-medium text-gray-900">
                {t("uploadTitle")}
              </h3>
              <p className="mb-4 text-sm text-gray-500">
                {t("uploadDescription")}
              </p>

              {/* Dropzone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 px-6 py-10 transition-colors hover:border-primary-400 hover:bg-primary-50/30"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="mb-3 h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
                <p className="text-sm font-medium text-gray-700">
                  {t("dropzone")}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {t("dropzoneHint")}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={handleFileInput}
                  className="hidden"
                />
              </div>

              {/* Image counter */}
              {images.length > 0 && (
                <p className="mb-3 text-sm text-gray-500">
                  {t("imageCount", { count: images.length })}
                </p>
              )}

              {/* Thumbnail grid */}
              {images.length > 0 && (
                <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {images.map((img, idx) => (
                    <div key={idx} className="group relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.preview}
                        alt={t("uploadImageAlt", { number: idx + 1 })}
                        className="h-24 w-full rounded-md border border-gray-200 object-cover"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeImage(idx);
                        }}
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-red-500 p-0.5 text-white opacity-0 shadow transition-opacity group-hover:opacity-100"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Extract button */}
              <div className="flex justify-end">
                <button
                  onClick={handleExtract}
                  disabled={images.length === 0}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t("extractItems")}
                </button>
              </div>
            </div>
          )}

          {/* EXTRACTING STEP */}
          {step === "extracting" && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-primary-500" />
              <p className="text-sm text-gray-600">
                {t("extracting", { count: images.length })}
              </p>
            </div>
          )}

          {/* REVIEW STEP */}
          {step === "review" && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-medium text-gray-900">
                    {t("reviewTitle")}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {t("reviewDescription", {
                      included: includedItems.length,
                      total: items.length,
                    })}
                  </p>
                </div>
              </div>

              {/* Mobile card layout */}
              <div className="space-y-3 md:hidden">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && items.every((i) => i.selected)}
                    onChange={toggleAll}
                    className="rounded border-gray-300"
                  />
                  {t("selectAll")}
                </label>
                {sortedItemEntries.map(({ item, idx }) => {
                  const duplicateMatch = checkDuplicate(item, existingNames);
                  return (
                    <div
                      key={idx}
                      className={`rounded-lg border p-3 space-y-2 ${
                        duplicateMatch
                          ? "border-orange-200 bg-orange-50"
                          : item.price === -1
                            ? "border-blue-200 bg-blue-50/50"
                            : item.price === 0
                              ? "border-yellow-200 bg-yellow-50"
                              : "border-gray-200"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => toggleItem(idx)}
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm font-medium text-gray-900">{item.name_th || item.name_en || `#${idx + 1}`}</span>
                        {duplicateMatch && (
                          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                            {t("duplicateBadge")}
                          </span>
                        )}
                        {item.priceConflict && (
                          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                            {t("priceConflictBadge")}
                          </span>
                        )}
                        {mergeTargets[idx] >= 0 && (
                          <button
                            type="button"
                            onClick={() => handleMergeRow(idx)}
                            className="ml-auto rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                          >
                            {t("mergeRow")}
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-1.5">
                        <div>
                          <label className="text-xs text-gray-500">{t("headerNameTh")}</label>
                          <input type="text" value={item.name_th} onChange={(e) => updateItem(idx, "name_th", e.target.value)} className="w-full rounded border border-gray-200 px-2 py-1.5 text-base focus:border-primary-500 focus:outline-none" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">{t("headerNameEn")}</label>
                          <input type="text" value={item.name_en} onChange={(e) => updateItem(idx, "name_en", e.target.value)} className="w-full rounded border border-gray-200 px-2 py-1.5 text-base focus:border-primary-500 focus:outline-none" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">{t("headerNameZhCN")}</label>
                          <input type="text" value={item.name_zh_CN} onChange={(e) => updateItem(idx, "name_zh_CN", e.target.value)} className="w-full rounded border border-gray-200 px-2 py-1.5 text-base focus:border-primary-500 focus:outline-none" />
                        </div>
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="text-xs text-gray-500">{t("headerPrice", { currencyCode: cfg.currency })}</label>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                step={priceStep}
                                value={item.price === -1 ? "" : item.price}
                                placeholder={item.price === -1 ? t("marketPrice") : "0"}
                                onChange={(e) => updateItem(idx, "price", Math.max(0, Number(e.target.value) || 0))}
                                className={`w-full rounded border px-2 py-1.5 text-base focus:border-primary-500 focus:outline-none ${item.price === -1 ? "border-blue-300 bg-blue-50" : "border-gray-200"}`}
                              />
                              {item.price === -1 && <span className="whitespace-nowrap text-xs font-medium text-blue-600">{t("marketPrice")}</span>}
                            </div>
                          </div>
                          <div className="flex-1">
                            <label className="text-xs text-gray-500">{t("headerCategory")}</label>
                            <input type="text" value={item.category} onChange={(e) => updateItem(idx, "category", e.target.value)} className="w-full rounded border border-gray-200 px-2 py-1.5 text-base focus:border-primary-500 focus:outline-none" />
                          </div>
                        </div>
                      </div>
                      {item.optionGroups && item.optionGroups.length > 0 && (
                        <div className="border-t border-gray-100 pt-1.5">
                          <span className="text-xs font-medium text-gray-500">{t("headerOptions")}</span>
                          {item.optionGroups.map((group, gi) => (
                            <div key={gi} className="mt-0.5 text-xs">
                              <span className="font-medium text-gray-700">{group.name_en}{group.isRequired && <span className="ml-1 text-red-500">*</span>}</span>
                              <span className="ml-1 text-gray-400">({group.selectionType === "SINGLE" ? t("optionSingle") : t("optionMultiple")})</span>
                              <div className="ml-2 text-gray-500">
                                {group.choices.map((c) => c.priceAdjustment > 0 ? `${c.name_en} +${money(c.priceAdjustment)}` : c.name_en).join(", ")}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop table layout */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs font-medium uppercase text-gray-500">
                      <th className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={items.length > 0 && items.every((i) => i.selected)}
                          onChange={toggleAll}
                          className="rounded border-gray-300"
                        />
                      </th>
                      <th className="px-2 py-2">{t("headerNameTh")}</th>
                      <th className="px-2 py-2">{t("headerNameEn")}</th>
                      <th className="px-2 py-2">{t("headerNameZhCN")}</th>
                      <th className="px-2 py-2">{t("headerPrice", { currencyCode: cfg.currency })}</th>
                      <th className="px-2 py-2">{t("headerCategory")}</th>
                      <th className="px-2 py-2">{t("headerOptions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItemEntries.map(({ item, idx }) => {
                      const duplicateMatch = checkDuplicate(item, existingNames);
                      return (
                      <tr
                        key={idx}
                        className={`border-b border-gray-100 ${
                          duplicateMatch
                            ? "bg-orange-50"
                            : item.price === -1
                              ? "bg-blue-50/50"
                              : item.price === 0
                                ? "bg-yellow-50"
                                : ""
                        }`}
                      >
                        <td className="px-2 py-2">
                          <div className="flex flex-col items-center gap-1">
                            <input
                              type="checkbox"
                              checked={item.selected}
                              onChange={() => toggleItem(idx)}
                              className="rounded border-gray-300"
                            />
                            {duplicateMatch && (
                              <span
                                className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700"
                                title={t("duplicateTooltip", { name: duplicateMatch })}
                              >
                                {t("duplicateBadge")}
                              </span>
                            )}
                            {item.priceConflict && (
                              <span
                                className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700"
                                title={t("priceConflictTooltip", {
                                  prices: item.priceConflict.prices.map((p) => money(p)).join(" / "),
                                  kept: money(item.priceConflict.kept),
                                })}
                              >
                                {t("priceConflictBadge")}
                              </span>
                            )}
                            {mergeTargets[idx] >= 0 && (
                              <button
                                type="button"
                                onClick={() => handleMergeRow(idx)}
                                className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                              >
                                {t("mergeRow")}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={item.name_th}
                            onChange={(e) =>
                              updateItem(idx, "name_th", e.target.value)
                            }
                            className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={item.name_en}
                            onChange={(e) =>
                              updateItem(idx, "name_en", e.target.value)
                            }
                            className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={item.name_zh_CN}
                            onChange={(e) =>
                              updateItem(idx, "name_zh_CN", e.target.value)
                            }
                            className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              step={priceStep}
                              value={item.price === -1 ? "" : item.price}
                              placeholder={item.price === -1 ? t("marketPrice") : "0"}
                              onChange={(e) =>
                                updateItem(
                                  idx,
                                  "price",
                                  Math.max(0, Number(e.target.value) || 0)
                                )
                              }
                              className={`w-20 rounded border px-2 py-1 text-sm focus:border-primary-500 focus:outline-none ${
                                item.price === -1
                                  ? "border-blue-300 bg-blue-50"
                                  : "border-gray-200"
                              }`}
                            />
                            {item.price === -1 && (
                              <span className="whitespace-nowrap text-xs font-medium text-blue-600" title={t("marketPriceTooltip")}>
                                {t("marketPrice")}
                              </span>
                            )}
                            {item.price === 0 && (
                              <span className="text-xs text-yellow-600" title={t("priceWarning")}>
                                !
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={item.category}
                            onChange={(e) =>
                              updateItem(idx, "category", e.target.value)
                            }
                            className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-2">
                          {item.optionGroups && item.optionGroups.length > 0 ? (
                            <div className="space-y-1">
                              {item.optionGroups.map((group, gi) => (
                                <div key={gi} className="text-xs">
                                  <span className="font-medium text-gray-700">
                                    {group.name_en}
                                    {group.isRequired && (
                                      <span className="ml-1 text-red-500">*</span>
                                    )}
                                  </span>
                                  <span className="ml-1 text-gray-400">
                                    ({group.selectionType === "SINGLE" ? t("optionSingle") : t("optionMultiple")})
                                  </span>
                                  <div className="ml-2 text-gray-500">
                                    {group.choices.map((c) =>
                                      c.priceAdjustment > 0
                                        ? `${c.name_en} +${money(c.priceAdjustment)}`
                                        : c.name_en
                                    ).join(", ")}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">{t("noOptions")}</span>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SAVING STEP */}
          {step === "saving" && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-primary-500" />
              <div className="space-y-2 text-center">
                <div className="flex items-center justify-center gap-2 text-xs">
                  {[t("stageTranslating"), t("stageSaving")].map((label, i) => {
                    const step = i + 1;
                    const active = saveStep === step;
                    const done = saveStep > step;
                    return (
                      <div
                        key={label}
                        aria-current={active ? "step" : undefined}
                        className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${
                          active
                            ? "bg-primary-100 font-medium text-primary-700"
                            : done
                              ? "text-primary-600"
                              : "text-gray-400"
                        }`}
                      >
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            active
                              ? "bg-primary-600"
                              : done
                                ? "bg-primary-400"
                                : "bg-gray-300"
                          }`}
                        />
                        {label}
                      </div>
                    );
                  })}
                </div>
                <p className="text-sm text-gray-600">{savingStatus}</p>
                {saveStep > 0 && (
                  <p className="text-xs text-gray-400">
                    {t("stageStep", { current: saveStep, total: 2 })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === "review" && (
          <div className="border-t border-gray-200 px-6 py-4">
            <p className="mb-3 text-sm text-gray-600">
              {t("reviewSummary", {
                total: selectedCount,
                flagged: flaggedSelected,
                ready: readySelected,
              })}
            </p>
            <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setStep("upload");
                setError(null);
              }}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
            >
              {t("back")}
            </button>
            <button
              onClick={handleSave}
              disabled={includedItems.length === 0}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("saveItems", { count: includedItems.length })}
            </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
