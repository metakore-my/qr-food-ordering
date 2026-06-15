"use client";

import { memo, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";

interface MenuCardProps {
  item: {
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
  };
  onAddToCart: (menuItemId: number, quantity: number) => void;
  addToCartLabel: string;
  outOfStockLabel: string;
  priority?: boolean;
}

export const MenuCard = memo(function MenuCard({
  item,
  onAddToCart,
  addToCartLabel,
  outOfStockLabel,
  priority,
}: MenuCardProps) {
  const tCart = useTranslations("cart");
  const tMenu = useTranslations("menu");
  const cfg = useConfig();
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });
  const [quantity, setQuantity] = useState(1);

  function handleDecrement() {
    setQuantity((prev) => Math.max(1, prev - 1));
  }

  function handleIncrement() {
    setQuantity((prev) => Math.min(99, prev + 1));
  }

  function handleAddToCart() {
    onAddToCart(item.id, quantity);
    setQuantity(1);
  }

  const showFromPrice = item.hasAdjustments && !(item.isCombo && item.comboBasePrice != null);
  const displayPrice = item.isCombo && item.comboBasePrice != null ? item.comboBasePrice : item.price;
  const formattedPrice = showFromPrice
    ? tMenu("fromPrice", { price: money(displayPrice) })
    : money(displayPrice);

  const quantityControls = item.isAvailable ? (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-lg border border-gray-200">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={quantity <= 1}
          className="flex h-11 w-11 items-center justify-center text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:text-gray-300"
          aria-label={tCart("decreaseQuantity")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        </button>
        <span className="flex h-11 w-10 items-center justify-center text-sm font-medium text-gray-900">
          {quantity}
        </span>
        <button
          type="button"
          onClick={handleIncrement}
          disabled={quantity >= 99}
          className="flex h-11 w-11 items-center justify-center text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:text-gray-300"
          aria-label={tCart("increaseQuantity")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      <button
        type="button"
        onClick={handleAddToCart}
        className="h-11 flex-1 rounded-lg bg-primary-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-600 active:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
      >
        {addToCartLabel}
      </button>
    </div>
  ) : null;

  return (
    <div className={`relative overflow-hidden rounded-xl bg-white shadow-sm transition-shadow ${item.isAvailable ? "hover:shadow-md" : "opacity-75"}`}>
      {/* Badges */}
      {(item.isFeatured || item.isCombo) && item.imageUrl && (
        <div className="absolute top-2 left-2 z-10 flex gap-1.5">
          {item.isFeatured && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 shadow-sm">
              {tMenu("recommended")}
            </span>
          )}
          {item.isCombo && (
            <span className="rounded-full bg-primary-500 px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm">
              {tMenu("combo")}
            </span>
          )}
        </div>
      )}
      {item.imageUrl && (
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-gray-100">
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className={`object-cover ${!item.isAvailable ? "grayscale" : ""}`}
            priority={priority}
          />
          {!item.isAvailable && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <span className="rounded-full bg-gray-900/80 px-4 py-1.5 text-sm font-semibold text-white">
                {outOfStockLabel}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="p-4">
        <div className="flex items-center gap-2">
          <h3 className={`text-base font-semibold ${item.isAvailable ? "text-gray-900" : "text-gray-400"}`}>{item.name}</h3>
          {item.isFeatured && !item.imageUrl && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              {tMenu("recommended")}
            </span>
          )}
          {item.isCombo && !item.imageUrl && (
            <span className="rounded-full bg-primary-500 px-2 py-0.5 text-xs font-semibold text-white">
              {tMenu("combo")}
            </span>
          )}
          {!item.isAvailable && !item.imageUrl && (
            <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-500">
              {outOfStockLabel}
            </span>
          )}
        </div>
        {item.description && (
          <p className={`mt-1 line-clamp-2 text-sm ${item.isAvailable ? "text-gray-500" : "text-gray-300"}`}>
            {item.description}
          </p>
        )}
        <p className={`mt-2 text-base font-bold sm:text-lg ${item.isAvailable ? "text-primary-600" : "text-gray-400 line-through"}`}>
          {formattedPrice}
        </p>
        {quantityControls && <div className="mt-3">{quantityControls}</div>}
      </div>
    </div>
  );
});
