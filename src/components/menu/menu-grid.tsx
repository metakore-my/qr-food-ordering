"use client";

import { useTranslations } from "next-intl";
import { MenuCard } from "./menu-card";

interface MenuGridProps {
  categories: Array<{
    id: number;
    name: string;
    items: Array<{
      id: number;
      name: string;
      description?: string;
      price: number;
      imageUrl?: string;
      isAvailable: boolean;
      isCombo?: boolean;
      isFeatured?: boolean;
      comboBasePrice?: number | null;
      hasAdjustments?: boolean;
      optionGroups: Array<unknown>;
    }>;
  }>;
  onAddToCart: (menuItemId: number, quantity: number) => void;
  addToCartLabel: string;
  outOfStockLabel: string;
}

export function MenuGrid({
  categories,
  onAddToCart,
  addToCartLabel,
  outOfStockLabel,
}: MenuGridProps) {
  const t = useTranslations("menu");

  if (categories.length === 0) {
    return (
      <div className="rounded-xl bg-white p-12 text-center shadow-sm">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="mx-auto mb-3 h-12 w-12 text-gray-300"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-gray-500">{t("noItems")}</p>
      </div>
    );
  }

  let globalIndex = 0;

  return (
    <div className="space-y-8">
      {categories.map((category) => (
        <section
          key={category.id}
          id={`category-${category.id}`}
          className="scroll-mt-20"
        >
          <h2 className="mb-4 text-base font-bold text-gray-900 sm:text-lg">
            {category.name}
          </h2>

          {category.items.length === 0 ? (
            <p className="text-sm text-gray-400">{t("noItemsInCategory")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {category.items.map((item) => {
                const isPriority = globalIndex < 4;
                globalIndex++;
                return (
                  <MenuCard
                    key={item.id}
                    item={item}
                    onAddToCart={onAddToCart}
                    addToCartLabel={addToCartLabel}
                    outOfStockLabel={outOfStockLabel}
                    priority={isPriority}
                  />
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
