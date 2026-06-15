import type { Prisma } from "@prisma/client";
import type { ResolvedSettings } from "@/lib/settings";
import { buildNameMap, type LocalizedName } from "@/lib/option-utils";
import { computeUnitPrice, computeOrderTotal, roundMoney } from "@/lib/order-utils";

export class PriceChangedError extends Error {
  constructor(public readonly newTotal: number) {
    super("Price changed");
    this.name = "PriceChangedError";
  }
}

type OptionName = { locale: string; name: string };

export interface ResolvedOrderLine {
  menuItem: {
    id: number;
    isCombo: boolean;
    comboBasePrice: Prisma.Decimal | number | null;
    price: Prisma.Decimal | number;
    isAvailable: boolean; // present from the Prisma include; the caller checks this before invoking placeOrder
    names: Array<{ locale: string; name: string; description: string | null }>;
    optionGroups: Array<{
      id: number;
      names: OptionName[];
      choices: Array<{ id: number; priceAdjustment: Prisma.Decimal | number; names: OptionName[] }>;
    }>;
  };
  quantity: number;
  selectedOptions: string;
}

export interface PlaceOrderArgs {
  session: { id: string };
  lines: ResolvedOrderLine[];
  expectedTotal?: number;
  settings: ResolvedSettings;
}

/**
 * Build option/name snapshots, compute unitPrice/itemName/total, apply the
 * price-change guard, create the Order + OrderItems, and touch the session.
 * Runs INSIDE a caller-provided `tx` that has ALREADY locked + re-validated the
 * session row and validated that every line's menuItem is available. Throws
 * `PriceChangedError(total)` on an expectedTotal mismatch and
 * "Some options are no longer available" on a dead option ref. Returns the
 * created order include-shaped for serializeOrder.
 *
 * Shared by the customer order route (lines from a claimed device cart) and the
 * staff order route (lines resolved from the request payload) so the two
 * placement paths can't drift — same math, same snapshots, same Order shape.
 */
// NOTE: return shape must stay compatible with serializeOrder in api/orders/route.ts
export async function placeOrder(
  tx: Prisma.TransactionClient,
  { session, lines, expectedTotal, settings: s }: PlaceOrderArgs
) {
  let hasDeadOptionRef = false;

  const orderItemsData = lines.map((line) => {
    const selectedOpts: Array<{ groupId: number; choiceIds: number[] }> = JSON.parse(
      line.selectedOptions
    );

    let optionPriceTotal = 0;
    const optionSnapshot: Array<{
      groupName: LocalizedName;
      choiceName: LocalizedName;
      priceAdjustment: number;
    }> = [];

    for (const sel of selectedOpts) {
      const group = line.menuItem.optionGroups.find((g) => g.id === sel.groupId);
      if (!group) {
        hasDeadOptionRef = true;
        continue;
      }
      const groupName: LocalizedName = buildNameMap(group.names, s.enabledLocales);
      for (const choiceId of sel.choiceIds) {
        const choice = group.choices.find((c) => c.id === choiceId);
        if (!choice) {
          hasDeadOptionRef = true;
          continue;
        }
        const choiceName: LocalizedName = buildNameMap(choice.names, s.enabledLocales);
        const adj = Number(choice.priceAdjustment);
        optionPriceTotal += adj;
        optionSnapshot.push({ groupName, choiceName, priceAdjustment: adj });
      }
    }

    const unitPrice = computeUnitPrice(
      {
        isCombo: line.menuItem.isCombo,
        comboBasePrice:
          line.menuItem.comboBasePrice != null ? Number(line.menuItem.comboBasePrice) : null,
        price: Number(line.menuItem.price),
      },
      optionPriceTotal,
      s.decimals
    );

    const itemName =
      line.menuItem.names.find((n) => n.locale === s.canonicalLocale)?.name ||
      line.menuItem.names[0]?.name ||
      null;

    return {
      menuItemId: line.menuItem.id,
      itemName,
      quantity: line.quantity,
      unitPrice,
      selectedOptions: JSON.stringify(optionSnapshot),
    };
  });

  if (hasDeadOptionRef) {
    throw new Error("Some options are no longer available");
  }

  const totalAmount = computeOrderTotal(orderItemsData, s.decimals);

  if (expectedTotal != null && roundMoney(expectedTotal, s.decimals) !== totalAmount) {
    throw new PriceChangedError(totalAmount);
  }

  const newOrder = await tx.order.create({
    data: {
      sessionId: session.id,
      totalAmount,
      items: { create: orderItemsData },
    },
    include: {
      items: {
        include: {
          menuItem: {
            include: { names: { where: { locale: s.canonicalLocale } } },
          },
        },
      },
    },
  });

  await tx.session.update({ where: { id: session.id }, data: {} });

  return newOrder;
}
