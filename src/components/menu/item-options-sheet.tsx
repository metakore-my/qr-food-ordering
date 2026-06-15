"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";

interface OptionChoiceName {
  locale: string;
  name: string;
}

interface OptionChoice {
  id: number;
  priceAdjustment: number;
  sortOrder: number;
  names: OptionChoiceName[];
}

interface OptionGroupName {
  locale: string;
  name: string;
}

interface OptionGroup {
  id: number;
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  sortOrder: number;
  names: OptionGroupName[];
  choices: OptionChoice[];
}

export interface SelectedOption {
  groupId: number;
  choiceIds: number[];
}

interface ItemOptionsSheetProps {
  item: {
    id: number;
    name: string;
    description?: string;
    price: number;
    imageUrl?: string;
    isCombo?: boolean;
    comboBasePrice?: number | null;
    optionGroups: OptionGroup[];
  };
  locale: string;
  onConfirm: (
    menuItemId: number,
    quantity: number,
    selectedOptions: SelectedOption[]
  ) => void;
  onClose: () => void;
}

function getLocalizedName(
  names: Array<{ locale: string; name: string }>,
  locale: string,
  fallbackLocale: string
): string {
  const loc = names.find((n) => n.locale === locale);
  const th = names.find((n) => n.locale === fallbackLocale);
  return loc?.name || th?.name || names[0]?.name || "";
}

export function ItemOptionsSheet({
  item,
  locale,
  onConfirm,
  onClose,
}: ItemOptionsSheetProps) {
  const t = useTranslations("menu");
  const tCart = useTranslations("cart");
  const tCommon = useTranslations("common");
  const cfg = useConfig();
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });

  const dialogRef = useRef<HTMLDivElement>(null);
  // Restore focus to the menu card that opened the sheet on close.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Dialog semantics: lock body scroll, focus into the sheet, Escape-to-close,
  // restore focus on unmount. Mirrors the admin order-detail modal so the
  // customer's primary add-to-cart-with-options surface is keyboard-usable too.
  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
    };
  }, [onClose]);

  const [quantity, setQuantity] = useState(1);
  const [selections, setSelections] = useState<Map<number, Set<number>>>(
    () => {
      // Pre-select the first choice for required SINGLE groups
      const map = new Map<number, Set<number>>();
      for (const group of item.optionGroups) {
        if (group.isRequired && group.selectionType === "SINGLE" && group.choices.length > 0) {
          map.set(group.id, new Set([group.choices[0].id]));
        }
      }
      return map;
    }
  );

  // Compute total with option adjustments
  const { total } = useMemo(() => {
    let adj = 0;
    for (const group of item.optionGroups) {
      const selected = selections.get(group.id);
      if (selected) {
        for (const choiceId of selected) {
          const choice = group.choices.find((c) => c.id === choiceId);
          if (choice) adj += choice.priceAdjustment;
        }
      }
    }
    const basePrice = (item.isCombo && item.comboBasePrice != null) ? item.comboBasePrice : item.price;
    return { total: (basePrice + adj) * quantity, optionAdjustment: adj };
  }, [item, selections, quantity]);

  // Check if all required groups are filled
  const canSubmit = useMemo(() => {
    for (const group of item.optionGroups) {
      if (group.isRequired) {
        const selected = selections.get(group.id);
        if (!selected || selected.size === 0) return false;
      }
    }
    return true;
  }, [item.optionGroups, selections]);

  function handleSingleSelect(groupId: number, choiceId: number) {
    setSelections((prev) => {
      const next = new Map(prev);
      next.set(groupId, new Set([choiceId]));
      return next;
    });
  }

  function handleMultipleToggle(groupId: number, choiceId: number) {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = new Set(prev.get(groupId) || []);
      if (current.has(choiceId)) {
        current.delete(choiceId);
      } else {
        current.add(choiceId);
      }
      next.set(groupId, current);
      return next;
    });
  }

  function handleConfirm() {
    const selectedOptions: SelectedOption[] = [];
    for (const [groupId, choiceIds] of selections) {
      if (choiceIds.size > 0) {
        selectedOptions.push({
          groupId,
          choiceIds: Array.from(choiceIds),
        });
      }
    }
    onConfirm(item.id, quantity, selectedOptions);
  }

  return (
    <div
      // z-[60] sits ABOVE the bottom nav (z-50) so the dim covers it and the
      // dialog is genuinely modal — a mis-tap on "Cart"/"Checkout" can no longer
      // dismiss the sheet and silently discard the customer's option choices.
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-options-title"
        tabIndex={-1}
        className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Item header */}
        <div className="flex shrink-0 items-start gap-3 border-b border-gray-100 p-4">
          {item.imageUrl && (
            <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
              <Image
                src={item.imageUrl}
                alt={item.name}
                fill
                sizes="64px"
                className="object-cover"
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 id="item-options-title" className="text-base font-semibold text-gray-900">
              {item.name}
            </h3>
            {item.description && (
              <p className="mt-0.5 text-sm text-gray-500 line-clamp-2">
                {item.description}
              </p>
            )}
            <p className="mt-1 text-sm font-medium text-primary-600">
              {money((item.isCombo && item.comboBasePrice != null) ? item.comboBasePrice : item.price)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tCommon("close")}
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <svg
              className="h-5 w-5"
              aria-hidden="true"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Option groups */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 sm:space-y-5">
          {item.optionGroups.map((group) => {
            const groupName = getLocalizedName(group.names, locale, cfg.canonicalLocale);
            const selected = selections.get(group.id) || new Set<number>();
            const isSingle = group.selectionType === "SINGLE";

            return (
              <div key={group.id}>
                <div className="mb-2 flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-gray-800">
                    {groupName}
                  </h4>
                  {group.isRequired && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      {t("requiredOption")}
                    </span>
                  )}
                </div>

                {/* SINGLE → radiogroup, MULTIPLE → group; choices carry the
                    radio/checkbox role + aria-checked so SRs announce selection
                    state and that one-vs-many applies. */}
                <div
                  className="space-y-1.5"
                  role={isSingle ? "radiogroup" : "group"}
                  aria-label={groupName}
                  aria-required={group.isRequired || undefined}
                >
                  {group.choices.map((choice) => {
                    const choiceName = getLocalizedName(
                      choice.names,
                      locale,
                      cfg.canonicalLocale
                    );
                    const isSelected = selected.has(choice.id);

                    return (
                      <button
                        key={choice.id}
                        type="button"
                        role={isSingle ? "radio" : "checkbox"}
                        aria-checked={isSelected}
                        onClick={() =>
                          isSingle
                            ? handleSingleSelect(group.id, choice.id)
                            : handleMultipleToggle(group.id, choice.id)
                        }
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors ${
                          isSelected
                            ? "border-primary-500 bg-primary-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          {/* Radio or checkbox indicator */}
                          <span
                            className={`flex h-5 w-5 items-center justify-center border-2 ${
                              isSingle ? "rounded-full" : "rounded-md"
                            } ${
                              isSelected
                                ? "border-primary-500 bg-primary-500"
                                : "border-gray-300"
                            }`}
                          >
                            {isSelected && (
                              <svg
                                className="h-3 w-3 text-white"
                                aria-hidden="true"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            )}
                          </span>
                          <span className="text-sm text-gray-800">
                            {choiceName}
                          </span>
                        </div>
                        {choice.priceAdjustment > 0 && (
                          <span className="text-sm text-gray-500">
                            +{money(choice.priceAdjustment)}
                          </span>
                        )}
                        {choice.priceAdjustment === 0 && (
                          <span className="text-xs text-gray-400">
                            {t("freeChoice")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer: quantity + total + add button. Extra bottom safe-area inset
            since the modal sheet now rests at the true viewport bottom (the dim
            covers the former nav gap) — keeps the CTA clear of the home bar. */}
        <div
          className="shrink-0 border-t border-gray-100 p-4 space-y-3"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {/* Quantity selector */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 disabled:text-gray-300"
                aria-label={tCart("decreaseQuantity")}
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <span className="w-10 text-center text-sm font-semibold text-gray-900">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                disabled={quantity >= 99}
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 disabled:text-gray-300"
                aria-label={tCart("increaseQuantity")}
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
            <div className="text-right">
              <span className="text-xs text-gray-500">{t("optionTotal")}</span>
              <p className="text-lg font-bold text-gray-900">
                {money(total)}
              </p>
            </div>
          </div>

          {/* Add to cart */}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="w-full rounded-lg bg-primary-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-600 active:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("addToCartWithOptions")} — {money(total)}
          </button>
        </div>
      </div>
    </div>
  );
}
