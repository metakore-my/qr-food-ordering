/** Client-side money formatting — currency/decimals/locale come from ConfigProvider. */
export interface MoneyOpts { currency: string; decimals: number; locale: string }

export function formatMoneyWith(amount: number, o: MoneyOpts, withSymbol = true): string {
  return withSymbol
    ? new Intl.NumberFormat(o.locale, { style: "currency", currency: o.currency, currencyDisplay: "narrowSymbol" }).format(amount)
    : new Intl.NumberFormat(o.locale, { style: "decimal", minimumFractionDigits: o.decimals, maximumFractionDigits: o.decimals }).format(amount);
}

export function currencySymbolWith(o: { currency: string; locale: string }): string {
  const parts = new Intl.NumberFormat(o.locale, { style: "currency", currency: o.currency, currencyDisplay: "narrowSymbol" }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? o.currency;
}
