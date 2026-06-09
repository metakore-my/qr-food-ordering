"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MenuCard } from "./menu-card";
import { MenuGrid } from "./menu-grid";
import { useCart, type SelectedOption } from "@/hooks/use-cart";
import { CartBadge } from "@/components/cart/cart-badge";
import { ItemOptionsSheet } from "./item-options-sheet";

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
  const { addItem, itemCount } = useCart(sessionId);
  const [optionsItem, setOptionsItem] = useState<MenuItemData | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const tCart = useTranslations("cart");

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
      } catch {
        // Surface a transient localized error instead of silently swallowing
        // (e.g. session expired, item just went unavailable).
        setAddError(tCart("failedToAddItem"));
        setTimeout(() => setAddError(null), 4000);
      }
    },
    [addItem, tCart]
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
      {/* Transient add-to-cart error toast */}
      {addError && (
        <div
          role="alert"
          className="fixed inset-x-4 top-4 z-50 mx-auto max-w-sm rounded-lg bg-red-600 px-4 py-3 text-center text-sm font-medium text-white shadow-lg"
        >
          {addError}
        </div>
      )}

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
      <CartBadge itemCount={itemCount} />

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
