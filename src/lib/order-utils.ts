/**
 * Shared order helpers (status transitions + money math). Imported by routes AND
 * unit tests as the single source of truth, so the two can't drift.
 */

/**
 * Allowed order status transitions for the admin order-PATCH. Terminal states
 * (COMPLETED, DECLINED) have none. COMPLETED is deliberately NOT a reachable
 * target here: an order becomes COMPLETED only through the /checkout settlement
 * flow (a direct updateMany that bypasses this map), so "an order is COMPLETED
 * iff staff settled the table" is guaranteed by construction — the order-PATCH
 * can confirm or decline, never complete.
 */
export const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "DECLINED"],
  CONFIRMED: ["DECLINED"],
};

/** True if `to` is a permitted next status from `from`. */
export function isValidOrderTransition(from: string, to: string): boolean {
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Round to `decimals` places (default 2), avoiding binary float drift. */
export function roundMoney(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Base price at order time: fixed `comboBasePrice` for combos, else item price. */
export function effectiveBasePrice(item: {
  isCombo: boolean;
  comboBasePrice: number | null;
  price: number;
}): number {
  return item.isCombo && item.comboBasePrice != null
    ? item.comboBasePrice
    : item.price;
}

/** Unit price = base + option adjustments, rounded to `decimals` (0 for VND). */
export function computeUnitPrice(
  item: { isCombo: boolean; comboBasePrice: number | null; price: number },
  optionPriceTotal: number,
  decimals = 2
): number {
  return roundMoney(effectiveBasePrice(item) + optionPriceTotal, decimals);
}

/** Order total = Σ(unitPrice × quantity), rounded once at the end to `decimals`. */
export function computeOrderTotal(
  lines: Array<{ unitPrice: number; quantity: number }>,
  decimals = 2
): number {
  return roundMoney(
    lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
    decimals
  );
}
