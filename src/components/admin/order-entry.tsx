"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useConfig } from "@/components/providers/config-provider";
import { formatMoneyWith } from "@/lib/money-client";
import { computeUnitPrice, computeOrderTotal } from "@/lib/order-utils";
import { ItemOptionsSheet, type SelectedOption } from "@/components/menu/item-options-sheet";
import { visibleItems } from "@/lib/order-entry-filter";

interface MenuItemDTO {
  id: number;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  isAvailable: boolean;
  isCombo: boolean;
  isFeatured: boolean;
  comboBasePrice: number | null;
  optionGroups: Array<{
    id: number;
    selectionType: "SINGLE" | "MULTIPLE";
    isRequired: boolean;
    sortOrder: number;
    names: Array<{ locale: string; name: string }>;
    choices: Array<{ id: number; priceAdjustment: number; sortOrder: number; names: Array<{ locale: string; name: string }> }>;
  }>;
}

interface CartLine {
  key: string;
  item: MenuItemDTO;
  quantity: number;
  selectedOptions: SelectedOption[];
}

interface OrderEntryProps {
  locale: string;
  categories: Array<{ id: number; name: string; items: MenuItemDTO[] }>;
  activeTables: Array<{ id: number; number: number }>;
}

function optionPriceTotal(item: MenuItemDTO, sel: SelectedOption[]): number {
  let total = 0;
  for (const s of sel) {
    const group = item.optionGroups.find((g) => g.id === s.groupId);
    if (!group) continue;
    for (const cid of s.choiceIds) {
      const choice = group.choices.find((c) => c.id === cid);
      if (choice) total += choice.priceAdjustment;
    }
  }
  return total;
}

function lineKey(menuItemId: number, sel: SelectedOption[]): string {
  const norm = [...sel].sort((a, b) => a.groupId - b.groupId).map((s) => ({ g: s.groupId, c: [...s.choiceIds].sort((a, b) => a - b) }));
  return `${menuItemId}:${JSON.stringify(norm)}`;
}

export function OrderEntry({ locale, categories, activeTables }: OrderEntryProps) {
  const t = useTranslations("admin.orderEntry");
  const router = useRouter();
  const { currency, decimals, takeawayEnabled } = useConfig();

  const [tableInput, setTableInput] = useState("");
  const [orderType, setOrderType] = useState<"DINE_IN" | "TAKEAWAY">("DINE_IN");
  const [customerName, setCustomerName] = useState("");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<number | "featured">(
    categories[0]?.id ?? "featured"
  );
  const hasFeatured = useMemo(
    () => categories.some((c) => c.items.some((it) => it.isFeatured)),
    [categories]
  );
  const [lines, setLines] = useState<CartLine[]>([]);
  const [sheetItem, setSheetItem] = useState<MenuItemDTO | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placedNumber, setPlacedNumber] = useState<number | null>(null);
  const [placedTakeaway, setPlacedTakeaway] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const tableNumber = useMemo(() => {
    const n = parseInt(tableInput, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [tableInput]);

  const tableValid = useMemo(
    () => tableNumber != null && activeTables.some((tbl) => tbl.number === tableNumber),
    [tableNumber, activeTables]
  );

  // Place gate: dine-in needs a valid table; takeaway allows a blank table
  // (counter takeaway) OR a valid table (seated party). A non-empty but invalid
  // table number blocks placement in either mode (tableValid is false).
  const canPlace =
    lines.length > 0 &&
    !placing &&
    (orderType === "TAKEAWAY" ? tableInput === "" || tableValid : tableValid);

  const filtered = useMemo(
    () => visibleItems(categories, activeCategory, search),
    [categories, activeCategory, search]
  );

  const fmt = useCallback((v: number) => formatMoneyWith(v, { currency, decimals, locale }), [currency, decimals, locale]);

  const total = useMemo(() => {
    const orderLines = lines.map((l) => ({
      unitPrice: computeUnitPrice(
        { isCombo: l.item.isCombo, comboBasePrice: l.item.comboBasePrice, price: l.item.price },
        optionPriceTotal(l.item, l.selectedOptions),
        decimals
      ),
      quantity: l.quantity,
    }));
    return computeOrderTotal(orderLines, decimals);
  }, [lines, decimals]);

  function addLine(item: MenuItemDTO, quantity: number, selectedOptions: SelectedOption[]) {
    setError(null);
    setLines((prev) => {
      const key = lineKey(item.id, selectedOptions);
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, l.quantity + quantity) } : l));
      }
      return [...prev, { key, item, quantity, selectedOptions }];
    });
  }

  function onAddClick(item: MenuItemDTO) {
    if (item.optionGroups.length > 0) {
      setSheetItem(item);
    } else {
      addLine(item, 1, []);
    }
  }

  function setQty(key: string, qty: number) {
    setLines((prev) => (qty <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, qty) } : l))));
  }

  async function handlePlace() {
    if (submittingRef.current) return;
    if (!canPlace) return;
    submittingRef.current = true;
    setPlacing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/orders/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderType,
          ...(tableNumber != null && tableValid ? { tableNumber } : {}),
          ...(orderType === "TAKEAWAY" && customerName.trim() ? { customerName: customerName.trim() } : {}),
          idempotencyKey: crypto.randomUUID(),
          expectedTotal: total,
          lines: lines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, selectedOptions: l.selectedOptions })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code: string = data.code ?? "SERVER_ERROR";
        if (code === "PRICE_CHANGED" && typeof data.newTotal === "number") {
          setError(t("errors.PRICE_CHANGED", { total: fmt(data.newTotal) }));
          // Parity with the customer cart: a live currency/decimals switch makes
          // the captured config stale → re-render the RSC tree so ConfigProvider
          // delivers fresh values before the staff re-confirm tap.
          router.refresh();
        } else {
          const key = `errors.${code}`;
          setError(t.has(key) ? t(key) : t("errors.SERVER_ERROR"));
        }
        return;
      }
      if (orderType === "TAKEAWAY" && (tableInput === "" || tableNumber == null)) {
        setPlacedTakeaway(true);
        setPlacedNumber(null);
      } else {
        setPlacedNumber(tableNumber);
        setPlacedTakeaway(false);
      }
      setLines([]);
      setCustomerName("");
    } catch {
      setError(t("errors.SERVER_ERROR"));
    } finally {
      setPlacing(false);
      submittingRef.current = false;
    }
  }

  if (placedNumber != null || placedTakeaway) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <h2 className="text-lg font-bold text-gray-900">{t("placedTitle")}</h2>
          <p className="mt-2 text-sm text-gray-600">
            {placedNumber != null ? t("placedBody", { number: placedNumber }) : t("placedTakeawayBody")}
          </p>
          <button
            type="button"
            onClick={() => { setPlacedNumber(null); setPlacedTakeaway(false); setTableInput(""); }}
            className="mt-4 min-h-[44px] rounded-lg bg-primary-700 px-4 text-sm font-semibold text-white"
          >
            {t("placeAnother")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4 md:p-6 lg:grid-cols-[1fr_22rem] lg:items-start">
      <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        {takeawayEnabled && (
          <div role="radiogroup" aria-label={t("orderTypeLabel")} className="mb-3 flex gap-2">
            <button
              type="button"
              role="radio"
              aria-checked={orderType === "DINE_IN"}
              onClick={() => setOrderType("DINE_IN")}
              className={`min-h-[44px] rounded-lg px-4 text-sm font-semibold ${orderType === "DINE_IN" ? "bg-primary-700 text-white" : "border border-gray-300 bg-white text-gray-700"}`}
            >
              {t("dineIn")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={orderType === "TAKEAWAY"}
              onClick={() => setOrderType("TAKEAWAY")}
              className={`min-h-[44px] rounded-lg px-4 text-sm font-semibold ${orderType === "TAKEAWAY" ? "bg-primary-700 text-white" : "border border-gray-300 bg-white text-gray-700"}`}
            >
              {t("takeaway")}
            </button>
          </div>
        )}

        <label className="block text-sm font-medium text-gray-700">{t("tableLabel")}</label>
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={tableInput}
          onChange={(e) => setTableInput(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder={t("tablePlaceholder")}
          className="mt-1 min-h-[44px] w-40 rounded-lg border border-gray-300 bg-white px-3"
        />
        {tableInput !== "" && (
          <p className={`mt-1 text-sm ${tableValid ? "text-green-700" : "text-red-600"}`}>
            {tableValid ? t("tableValid", { number: tableNumber! }) : t("tableInvalid")}
          </p>
        )}

        {takeawayEnabled && orderType === "TAKEAWAY" && (
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            maxLength={100}
            placeholder={t("customerNamePlaceholder")}
            aria-label={t("customerNameLabel")}
            className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3"
          />
        )}

        <div role="tablist" aria-label={t("categoryTabsLabel")} className="mt-4 -mx-1 flex gap-2 overflow-x-auto whitespace-nowrap px-1 pb-1">
          {hasFeatured && (
            <button
              type="button"
              role="tab"
              aria-selected={activeCategory === "featured"}
              onClick={() => setActiveCategory("featured")}
              className={`min-h-[44px] shrink-0 rounded-lg px-3 text-sm font-semibold ${activeCategory === "featured" ? "bg-primary-700 text-white" : "border border-gray-300 bg-white text-gray-700"}`}
            >
              ⭐ {t("featured")}
            </button>
          )}
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={activeCategory === cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`min-h-[44px] shrink-0 rounded-lg px-3 text-sm font-semibold ${activeCategory === cat.id ? "bg-primary-700 text-white" : "border border-gray-300 bg-white text-gray-700"}`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="mt-3 min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3"
        />

        {filtered.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">{t("noResults")}</p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {filtered.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:border-primary-300 hover:bg-primary-50/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{item.name}</p>
                  <p className="text-xs text-gray-500">{fmt(item.isCombo && item.comboBasePrice != null ? item.comboBasePrice : item.price)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onAddClick(item)}
                  className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg bg-primary-700 px-3 text-sm font-semibold text-white transition-colors hover:bg-primary-800"
                >
                  {item.optionGroups.length > 0 ? t("choose") : "+"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Below lg the summary renders after the (potentially long) menu list, so
          on small screens it sticks to the viewport bottom — staff always see the
          running total + Place Order without scrolling the whole menu. On lg+ it's
          a normal right-hand column. max-h + overflow keeps a long order scrollable
          without the sticky panel eating the screen. */}
      <aside className="sticky bottom-[calc(48px+env(safe-area-inset-bottom,0px))] z-30 max-h-[60vh] overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 shadow-lg md:bottom-0 lg:sticky lg:top-6 lg:bottom-auto lg:z-auto lg:max-h-[calc(100vh-3rem)] lg:shadow-sm">
        <h2 className="text-sm font-bold text-gray-900">{t("orderHeading")}</h2>
        {lines.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">{t("emptyOrder")}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {lines.map((l) => (
              <li key={l.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{l.item.name}</span>
                <span className="flex items-center gap-2">
                  <button type="button" aria-label={t("decreaseItem", { name: l.item.name })} onClick={() => setQty(l.key, l.quantity - 1)} className="min-h-[44px] min-w-[44px] rounded border">−</button>
                  <span className="w-6 text-center">{l.quantity}</span>
                  <button type="button" aria-label={t("increaseItem", { name: l.item.name })} onClick={() => setQty(l.key, l.quantity + 1)} className="min-h-[44px] min-w-[44px] rounded border">+</button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-sm font-bold">
          <span>{t("total")}</span>
          <span>{fmt(total)}</span>
        </div>

        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        {orderType === "DINE_IN" && !tableValid && lines.length > 0 && <p className="mt-2 text-sm text-amber-700">{t("selectTableFirst")}</p>}

        <button
          type="button"
          disabled={!canPlace}
          onClick={handlePlace}
          className="mt-3 min-h-[44px] w-full rounded-lg bg-primary-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {placing ? t("placing") : t("placeButton")}
        </button>
      </aside>

      {sheetItem && (
        <ItemOptionsSheet
          item={{
            id: sheetItem.id,
            name: sheetItem.name,
            description: sheetItem.description,
            price: sheetItem.price,
            imageUrl: sheetItem.imageUrl,
            isCombo: sheetItem.isCombo,
            comboBasePrice: sheetItem.comboBasePrice,
            optionGroups: sheetItem.optionGroups,
          }}
          locale={locale}
          onConfirm={(_menuItemId, quantity, selectedOptions) => {
            addLine(sheetItem, quantity, selectedOptions);
            setSheetItem(null);
          }}
          onClose={() => setSheetItem(null)}
        />
      )}
    </div>
  );
}
