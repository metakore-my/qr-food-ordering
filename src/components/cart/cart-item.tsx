"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CartItem as CartItemType } from "@/hooks/use-cart";
import { useConfig } from "@/components/providers/config-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { formatMoneyWith } from "@/lib/money-client";
import { computeUnitPrice } from "@/lib/order-utils";

interface CartItemProps {
  item: CartItemType;
  locale: string;
  onUpdateQuantity: (cartItemId: number, quantity: number) => void;
  onRemove: (cartItemId: number) => void;
}

function getItemName(
  names: Array<{ locale: string; name: string }>,
  locale: string,
  fallback: string,
  fallbackLocale: string
): string {
  // Try exact locale match
  const match = names.find((n) => n.locale === locale);
  if (match) return match.name;

  // Fallback to the canonical/default locale
  const th = names.find((n) => n.locale === fallbackLocale);
  if (th) return th.name;

  // Fallback to first available
  return names[0]?.name ?? fallback;
}

function getOptionSummary(
  item: CartItemType,
  locale: string,
  fallbackLocale: string,
  money: (amount: number) => string
): { text: string; adjustment: number } {
  if (
    !item.selectedOptions ||
    item.selectedOptions.length === 0 ||
    !item.menuItem.optionGroups
  ) {
    return { text: "", adjustment: 0 };
  }

  const groupParts: string[] = [];
  let totalAdj = 0;

  for (const sel of item.selectedOptions) {
    const group = item.menuItem.optionGroups?.find(
      (g) => g.id === sel.groupId
    );
    if (!group) continue;

    const groupName = getItemName(group.names, locale, "", fallbackLocale);
    const choiceNames: string[] = [];

    for (const cid of sel.choiceIds) {
      const choice = group.choices.find((c) => c.id === cid);
      if (!choice) continue;

      const choiceName = getItemName(choice.names, locale, "", fallbackLocale);
      if (choiceName) {
        const label = choice.priceAdjustment
          ? `${choiceName} +${money(choice.priceAdjustment)}`
          : choiceName;
        choiceNames.push(label);
      }
      totalAdj += choice.priceAdjustment;
    }

    if (choiceNames.length > 0) {
      groupParts.push(
        groupName
          ? `${groupName}: ${choiceNames.join(", ")}`
          : choiceNames.join(", ")
      );
    }
  }

  return { text: groupParts.join(" · "), adjustment: totalAdj };
}

export function CartItemRow({
  item,
  locale,
  onUpdateQuantity,
  onRemove,
}: CartItemProps) {
  const tCart = useTranslations("cart");
  const cfg = useConfig();
  const confirm = useConfirm();
  // Collapse the thumbnail if its image fails to load (matches menu-card) — a
  // broken-image glyph in the 64px box looks worse than no thumbnail.
  const [imgError, setImgError] = useState(false);
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });
  const name = getItemName(item.menuItem.names, locale, tCart("unknownItem"), cfg.canonicalLocale);
  const { text: optionText, adjustment: optionAdj } = getOptionSummary(
    item,
    locale,
    cfg.canonicalLocale,
    money
  );
  // Round the per-unit price the same way the order route and the cart grand
  // total do (computeUnitPrice → roundMoney), then multiply — so a displayed
  // line total can never drift from the summed grand total.
  const unitPrice = computeUnitPrice(
    {
      isCombo: !!item.menuItem.isCombo,
      comboBasePrice: item.menuItem.comboBasePrice ?? null,
      price: item.menuItem.price,
    },
    optionAdj,
    cfg.decimals
  );
  const lineTotal = unitPrice * item.quantity;

  const isUnavailable = !item.menuItem.isAvailable;

  return (
    <div className={`rounded-lg bg-white p-3 shadow-sm${isUnavailable ? " opacity-50" : ""}`}>
      {/* Top row: image + details + remove button */}
      <div className="flex items-start gap-3">
        {/* Image thumbnail — only rendered when an image exists AND loads. */}
        {item.menuItem.imageUrl && !imgError && (
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
            <Image
              src={item.menuItem.imageUrl}
              alt={name}
              fill
              sizes="64px"
              className="object-cover"
              onError={() => setImgError(true)}
            />
          </div>
        )}

        {/* Item details */}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900">
            {name}
          </h3>
          {isUnavailable && (
            <span className="text-xs font-medium text-red-600">
              {tCart("itemUnavailable")}
            </span>
          )}
          {optionText && (
            <p className="line-clamp-2 text-xs text-gray-600">{optionText}</p>
          )}
          <p className="text-sm text-gray-500">
            {money(unitPrice)}
          </p>
        </div>

        {/* Remove button */}
        <button
          type="button"
          onClick={async () => {
            if (await confirm({ message: tCart("confirmRemoveItem") })) {
              onRemove(item.id);
            }
          }}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
          aria-label={tCart("removeItem")}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Bottom row: quantity controls + line total */}
      <div className="mt-2 flex items-center justify-between">
        {/* Quantity controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
            disabled={item.quantity <= 1}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:text-gray-300"
            aria-label={tCart("decreaseQuantity")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
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

          <span className="flex h-11 w-10 items-center justify-center text-sm font-medium text-gray-900">
            {item.quantity}
          </span>

          <button
            type="button"
            onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
            disabled={item.quantity >= 99}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:text-gray-300"
            aria-label={tCart("increaseQuantity")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
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

        {/* Line total */}
        <span className="text-base font-bold text-gray-900">
          {money(lineTotal)}
        </span>
      </div>
    </div>
  );
}
