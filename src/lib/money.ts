import { currencyDecimals } from "./deployment-config";

/**
 * Central server-side money display. Amounts are plain numbers in the
 * deployment's own currency (no FX, no minor-unit storage). Intl.NumberFormat
 * gives correct symbol, placement, grouping, and decimals for the configured
 * currency.
 *
 * Config is runtime DB-backed (`getSettings()`), so server callers pass an
 * explicit `{ currency, decimals, locale }` options object — there is no
 * build-time singleton to read. When omitted, the helpers fall back to the
 * hardcoded `DEFAULT_MONEY_OPTS` (THB / en / 2 decimals), matching the previous
 * unset-env default so any not-yet-migrated caller keeps rendering identically.
 *
 * Client components use `src/lib/money-client.ts` instead — this module is
 * server-only.
 */

export interface MoneyOptions {
  currency: string;
  decimals: number;
  locale: string;
}

const DEFAULT_MONEY_OPTS: MoneyOptions = {
  currency: "THB",
  decimals: currencyDecimals("THB"),
  locale: "en",
};

const globalForMoney = globalThis as unknown as {
  moneyFormatters?: Map<string, Intl.NumberFormat>;
};
if (!globalForMoney.moneyFormatters) {
  globalForMoney.moneyFormatters = new Map();
}
const formatters = globalForMoney.moneyFormatters;

function getFormatter(opts: MoneyOptions, withSymbol: boolean): Intl.NumberFormat {
  const key = `${opts.locale}:${opts.currency}:${opts.decimals}:${withSymbol}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = withSymbol
      ? new Intl.NumberFormat(opts.locale, {
          style: "currency",
          currency: opts.currency,
          currencyDisplay: "narrowSymbol",
        })
      : new Intl.NumberFormat(opts.locale, {
          style: "decimal",
          minimumFractionDigits: opts.decimals,
          maximumFractionDigits: opts.decimals,
        });
    formatters.set(key, fmt);
  }
  return fmt;
}

/** Format an amount (in the deployment currency) for display. WITH symbol by default. */
export function formatMoney(
  amount: number,
  opts: MoneyOptions = DEFAULT_MONEY_OPTS,
  withSymbol = true
): string {
  return getFormatter(opts, withSymbol).format(amount);
}

/**
 * Just the currency symbol glyph (e.g. "฿", "RM", "$"), for price-value templates.
 * Called only in static labels — not performance-critical, so intentionally no cache.
 */
export function currencySymbol(opts: MoneyOptions = DEFAULT_MONEY_OPTS): string {
  const parts = new Intl.NumberFormat(opts.locale, {
    style: "currency",
    currency: opts.currency,
    currencyDisplay: "narrowSymbol",
  }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? opts.currency;
}

/** The ISO 4217 code (e.g. "THB", "MYR"), for column headers / field labels. */
export function currencyCode(opts: MoneyOptions = DEFAULT_MONEY_OPTS): string {
  return opts.currency;
}
