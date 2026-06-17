"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MenuCard } from "./menu-card";
import { MenuGrid } from "./menu-grid";
import { useCart, type SelectedOption } from "@/hooks/use-cart";
import { CartBadge } from "@/components/cart/cart-badge";
import { ItemOptionsSheet } from "./item-options-sheet";
import { useConfig } from "@/components/providers/config-provider";

interface OptionChoice {
  id: number;
  priceAdjustment: number;
  sortOrder: number;
  names: Array<{ locale: string; name: string }>;
}

interface OptionGroup {
  id: number;
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  sortOrder: number;
  names: Array<{ locale: string; name: string }>;
  choices: OptionChoice[];
}

interface MenuItemData {
  id: number;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  isAvailable: boolean;
  isCombo: boolean;
  isFeatured: boolean;
  comboBasePrice: number | null;
  optionGroups: OptionGroup[];
}

interface MenuPageClientProps {
  sessionId: string;
  categories: Array<{
    id: number;
    name: string;
    items: MenuItemData[];
  }>;
  featuredItems: Array<MenuItemData>;
  addToCartLabel: string;
  outOfStockLabel: string;
  recommendedLabel: string;
}

function addHasAdjustments(item: MenuItemData) {
  return {
    ...item,
    hasAdjustments: item.optionGroups.some(g =>
      g.choices.some(c => c.priceAdjustment > 0)
    ),
  };
}

export function MenuPageClient({
  sessionId,
  categories,
  featuredItems,
  addToCartLabel,
  outOfStockLabel,
  recommendedLabel,
}: MenuPageClientProps) {
  const locale = useLocale();
  const cfg = useConfig();
  const { addItem, itemCount, total } = useCart(sessionId);
  const [optionsItem, setOptionsItem] = useState<MenuItemData | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedMsg, setAddedMsg] = useState<string | null>(null);
  const tCart = useTranslations("cart");

  // The server pre-localizes `item.name` (menu page's getItemName: locale →
  // canonical → any), so the client already has the viewer's name — just look
  // the item up by id to name it in the add-to-cart confirmation.
  const nameById = useCallback(
    (menuItemId: number): string => {
      for (const cat of categories) {
        const f = cat.items.find((i) => i.id === menuItemId);
        if (f) return f.name;
      }
      return featuredItems.find((i) => i.id === menuItemId)?.name ?? "";
    },
    [categories, featuredItems]
  );

  const enhancedCategories = useMemo(() =>
    categories.map(cat => ({
      ...cat,
      items: cat.items.map(addHasAdjustments),
    })),
    [categories]
  );

  const handleAddToCart = useCallback(
    async (
      menuItemId: number,
      quantity: number,
      selectedOptions?: SelectedOption[]
    ) => {
      try {
        await addItem(menuItemId, quantity, selectedOptions);
        // Confirm the add — a phone customer can otherwise miss the cart-bar
        // change. This div is the aria-live region too, so SR users hear it.
        setAddError(null);
        setAddedMsg(
          tCart("addedToCart", { name: nameById(menuItemId), count: quantity })
        );
        setTimeout(() => setAddedMsg(null), 2500);
      } catch {
        // Surface a transient localized error instead of silently swallowing
        // (e.g. session expired, item just went unavailable).
        setAddedMsg(null);
        setAddError(tCart("failedToAddItem"));
        setTimeout(() => setAddError(null), 4000);
      }
    },
    [addItem, tCart, nameById]
  );

  const handleAddToCartClick = useCallback(
    (menuItemId: number, quantity: number) => {
      // Search in categories and featured items
      let found: MenuItemData | undefined;
      for (const cat of categories) {
        found = cat.items.find((i) => i.id === menuItemId);
        if (found) break;
      }
      if (!found) {
        found = featuredItems.find((i) => i.id === menuItemId);
      }
      if (found && found.optionGroups.length > 0) {
        setOptionsItem(found);
        return;
      }
      handleAddToCart(menuItemId, quantity);
    },
    [categories, featuredItems, handleAddToCart]
  );

  const handleOptionsConfirm = useCallback(
    (
      menuItemId: number,
      quantity: number,
      selectedOptions: SelectedOption[]
    ) => {
      setOptionsItem(null);
      handleAddToCart(menuItemId, quantity, selectedOptions);
    },
    [handleAddToCart]
  );

  return (
    <>
      {/* Transient add-to-cart error toast (assertive). */}
      {addError && (
        <div
          role="alert"
          className="fixed inset-x-4 top-4 z-50 mx-auto max-w-sm rounded-lg bg-red-600 px-4 py-3 text-center text-sm font-medium text-white shadow-lg"
        >
          {addError}
        </div>
      )}

      {/* Transient add-to-cart success toast. Polite aria-live so screen readers
          announce the add without interrupting; sighted users get the green
          confirmation a phone customer would otherwise miss. */}
      {addedMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-sm items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-3 text-center text-sm font-medium text-white shadow-lg"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 flex-shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
              clipRule="evenodd"
            />
          </svg>
          {addedMsg}
        </div>
      )}

      {/* Brand header — logo (when set) beside the app name; app name always
          shown so the restaurant is identified even without a logo. */}
      <header className="mb-6 flex items-center gap-3">
        {cfg.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cfg.logoUrl}
            alt={cfg.appName}
            className="h-10 w-auto max-w-[140px] object-contain"
          />
        )}
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
          {cfg.appName}
        </h1>
      </header>

      {/* Recommended section */}
      {featuredItems.length > 0 && (
        <section id="category--1" className="mb-8 scroll-mt-20">
          <h2 className="mb-4 text-base font-bold text-gray-900 sm:text-lg">
            {recommendedLabel}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featuredItems.map((item) => (
              <MenuCard
                key={`featured-${item.id}`}
                item={addHasAdjustments(item)}
                onAddToCart={handleAddToCartClick}
                addToCartLabel={addToCartLabel}
                outOfStockLabel={outOfStockLabel}
              />
            ))}
          </div>
        </section>
      )}

      <MenuGrid
        categories={enhancedCategories}
        onAddToCart={handleAddToCartClick}
        addToCartLabel={addToCartLabel}
        outOfStockLabel={outOfStockLabel}
      />

      {/* Cart badge */}
      <CartBadge itemCount={itemCount} total={total} />

      {/* Options bottom sheet */}
      {optionsItem && (
        <ItemOptionsSheet
          item={optionsItem}
          locale={locale}
          onConfirm={handleOptionsConfirm}
          onClose={() => setOptionsItem(null)}
        />
      )}
    </>
  );
}
