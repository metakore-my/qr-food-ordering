import { formatMoney, type MoneyOptions } from "./money";
import { routing } from "@/i18n/routing";

export const RANGE_MS: Record<string, number> = {
  "1h": 1 * 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function getItemName(
  names: { locale: string; name: string }[],
  locale: string,
  canonicalLocale: string
): string {
  const loc = names.find((n) => n.locale === locale);
  const canon = names.find((n) => n.locale === canonicalLocale);
  return loc?.name || canon?.name || names[0]?.name || "Unknown";
}

interface SelectedOption {
  groupName?: string;
  choiceName: string;
  priceAdjustment?: number;
}

/**
 * Parse an `OrderItem.selectedOptions` JSON snapshot defensively.
 * The column is free-form `@db.Text`; never let a malformed row throw and
 * 500 a whole report — fall back to an empty selection. Shared by every
 * report endpoint so the parse safety can't drift between them.
 */
export function parseSelectedOptions(selectedOptions: string): SelectedOption[] {
  try {
    const parsed = JSON.parse(selectedOptions);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Render an option snapshot as a single human-readable string for exports,
 * grouping choices by option group: `Size: Large +฿10 / Spice: Hot`.
 * Returns "" when there are no options. Shared by the Excel export routes.
 * `money` carries the runtime currency/decimals/locale for price formatting.
 */
export function formatOptions(
  selectedOptions: string,
  money: MoneyOptions
): string {
  const opts = parseSelectedOptions(selectedOptions);
  if (!opts.length) return "";
  const grouped = new Map<string, string[]>();
  for (const o of opts) {
    const key = o.groupName || "";
    const arr = grouped.get(key) || [];
    const label = o.priceAdjustment
      ? `${o.choiceName} +${formatMoney(o.priceAdjustment, money)}`
      : o.choiceName;
    arr.push(label);
    grouped.set(key, arr);
  }
  return Array.from(grouped.entries())
    .map(([group, choices]) =>
      group ? `${group}: ${choices.join(", ")}` : choices.join(", ")
    )
    .join(" / ");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getNestedKey(obj: any, path: string): string {
  const val = path.split(".").reduce((o, k) => o?.[k], obj);
  return typeof val === "string" ? val : path;
}

/**
 * Server-side translation loader for report routes (which have no React
 * `useTranslations`). Validates the locale against the enabled set, falls
 * back to the default locale, and returns a `t(key)` reading from
 * `admin.reports.<prefix><key>` in that locale's message bundle. Pass
 * `prefix: "excel."` for the Excel sheet labels. Shared so every report
 * route resolves labels identically (and the dynamic import path stays
 * locale-validated — no traversal).
 */
export async function loadReportMessages(locale: string, prefix = "") {
  const validLocale = (routing.locales as readonly string[]).includes(locale)
    ? locale
    : routing.defaultLocale;

  let messages;
  try {
    messages = (await import(`@/i18n/messages/${validLocale}.json`)).default;
  } catch {
    messages = (await import(`@/i18n/messages/${routing.defaultLocale}.json`))
      .default;
  }

  return (key: string) =>
    getNestedKey(messages, `admin.reports.${prefix}${key}`);
}
