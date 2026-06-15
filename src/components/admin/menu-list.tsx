"use client";

import { useState, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import Image from "next/image";
import { useConfig } from "@/components/providers/config-provider";
import { useConfirm } from "@/components/providers/confirm-provider";
import { formatMoneyWith } from "@/lib/money-client";
import { CategoryForm } from "@/components/admin/category-form";
import { MenuItemForm } from "@/components/admin/menu-item-form";
import { MenuImportModal } from "@/components/admin/menu-import-modal";
import { Pagination, paginate } from "@/components/ui/pagination";

interface CategoryTranslation {
  id: number;
  categoryId: number;
  locale: string;
  name: string;
}

interface Category {
  id: number;
  sortOrder: number;
  isActive: boolean;
  names: CategoryTranslation[];
  createdAt: string;
  updatedAt: string;
}

interface MenuItemTranslation {
  id: number;
  menuItemId: number;
  locale: string;
  name: string;
  description: string | null;
}

interface OptionChoiceData {
  id?: number;
  priceAdjustment: number;
  sortOrder: number;
  names: Array<{ locale: string; name: string }>;
}

interface OptionGroupData {
  id?: number;
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  sortOrder: number;
  names: Array<{ locale: string; name: string }>;
  choices: OptionChoiceData[];
}

interface MenuItem {
  id: number;
  categoryId: number;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
  isCombo: boolean;
  isFeatured: boolean;
  comboBasePrice: number | null;
  sortOrder: number;
  names: MenuItemTranslation[];
  category: Category;
  optionGroups?: OptionGroupData[];
  createdAt: string;
  updatedAt: string;
}

interface MenuListProps {
  initialCategories: Category[];
  initialMenuItems: MenuItem[];
}

type SortField = "sortOrder" | "name" | "price" | "availability" | "dateAdded";
type SortDirection = "asc" | "desc";
type ViewMode = "grid" | "list";

export function MenuList({
  initialCategories,
  initialMenuItems,
}: MenuListProps) {
  const t = useTranslations("admin.menuManagement");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const cfg = useConfig();
  const confirm = useConfirm();
  const money = (amount: number) =>
    formatMoneyWith(amount, { currency: cfg.currency, decimals: cfg.decimals, locale: cfg.defaultLocale });

  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(initialMenuItems);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(
    initialCategories[0]?.id ?? null
  );
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [showMenuItemForm, setShowMenuItemForm] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState<MenuItem | null>(null);
  const [duplicateFrom, setDuplicateFrom] = useState<MenuItem | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  // View, sort, selection states
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortField, setSortField] = useState<SortField>("sortOrder");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [categoryExpanded, setCategoryExpanded] = useState(false);

  function getCategoryName(cat: Category): string {
    const loc = cat.names.find((n) => n.locale === locale);
    const th = cat.names.find((n) => n.locale === cfg.canonicalLocale);
    return loc?.name || th?.name || cat.names[0]?.name || `#${cat.id}`;
  }

  function getItemName(item: MenuItem): string {
    const loc = item.names.find((n) => n.locale === locale);
    const th = item.names.find((n) => n.locale === cfg.canonicalLocale);
    return loc?.name || th?.name || item.names[0]?.name || `#${item.id}`;
  }

  function getItemDescription(item: MenuItem): string | null {
    const loc = item.names.find((n) => n.locale === locale);
    const th = item.names.find((n) => n.locale === cfg.canonicalLocale);
    return (
      loc?.description || th?.description || item.names[0]?.description || null
    );
  }

  const filteredItems = selectedCategoryId
    ? menuItems.filter((item) => item.categoryId === selectedCategoryId)
    : menuItems;

  const sortedItems = useMemo(() => {
    // Pre-compute sort keys to avoid repeated getItemName() calls during sort
    const withKeys = filteredItems.map((item) => ({
      item,
      name: getItemName(item),
      dateMs: new Date(item.createdAt).getTime(),
    }));
    withKeys.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "price":
          cmp = a.item.price - b.item.price;
          break;
        case "availability":
          cmp = (a.item.isAvailable === b.item.isAvailable) ? 0 : a.item.isAvailable ? -1 : 1;
          break;
        case "dateAdded":
          cmp = a.dateMs - b.dateMs;
          break;
        case "sortOrder":
        default:
          cmp = a.item.sortOrder - b.item.sortOrder;
          break;
      }
      return sortDirection === "desc" ? -cmp : cmp;
    });
    return withKeys.map(({ item }) => item);
    // getItemName closes over both `locale` and `cfg.canonicalLocale` (the
    // name-fallback locale); include both so a live canonical-locale change re-sorts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredItems, sortField, sortDirection, locale, cfg.canonicalLocale]);

  const paginatedItems = paginate(sortedItems, page, 12);
  const allOnPageSelected = paginatedItems.length > 0 && paginatedItems.every((item) => selectedIds.has(item.id));
  const someSelected = selectedIds.size > 0;

  // --- Sort handler ---

  function handleSortOptionChange(value: string) {
    const [field, direction] = value.split("-") as [SortField, SortDirection];
    setSortField(field);
    setSortDirection(direction);
    setPage(1);
  }

  // --- Selection handlers ---

  function handleToggleSelect(itemId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  function handleToggleSelectAll() {
    if (allOnPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const item of paginatedItems) {
          next.delete(item.id);
        }
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const item of paginatedItems) {
          next.add(item.id);
        }
        return next;
      });
    }
  }

  function handleDeselectAll() {
    setSelectedIds(new Set());
  }

  // --- Bulk action handlers ---

  async function handleBulkDelete() {
    const count = selectedIds.size;
    if (!(await confirm({ message: t("confirmBulkDelete", { count }) }))) return;

    setBulkActionLoading(true);
    const idsToDelete = [...selectedIds];

    const results = await Promise.allSettled(
      idsToDelete.map((id) => fetch(`/api/menu/${id}`, { method: "DELETE" }))
    );

    let failed = 0;
    const deletedIds = new Set<number>();
    const errorMessages: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled" && result.value.ok) {
        deletedIds.add(idsToDelete[i]);
      } else {
        failed++;
        if (result.status === "fulfilled") {
          try {
            const data = await result.value.json();
            if (data.error) errorMessages.push(data.error);
          } catch {
            // ignore parse errors
          }
        }
      }
    }
    if (deletedIds.size > 0) {
      setMenuItems((prev) => prev.filter((i) => !deletedIds.has(i.id)));
    }

    if (failed > 0) {
      const base = t("bulkPartialFailure", { failed, total: count });
      setError(errorMessages.length > 0 ? `${base}: ${errorMessages[0]}` : base);
    }
    setSelectedIds(new Set());
    setBulkActionLoading(false);
  }

  async function handleBulkSetAvailability(isAvailable: boolean) {
    setBulkActionLoading(true);
    const ids = [...selectedIds];
    const total = ids.length;

    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/menu/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isAvailable }),
        }).then(async (res) => {
          if (!res.ok) throw new Error("Failed");
          const updated = await res.json();
          updated.price = Number(updated.price);
          return updated as MenuItem;
        })
      )
    );

    let failed = 0;
    const updatedItems: MenuItem[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        updatedItems.push(result.value);
      } else {
        failed++;
      }
    }
    if (updatedItems.length > 0) {
      const updatedMap = new Map(updatedItems.map((u) => [u.id, u]));
      setMenuItems((prev) =>
        prev.map((i) => updatedMap.get(i.id) ?? i)
      );
    }

    if (failed > 0) {
      setError(t("bulkPartialFailure", { failed, total }));
    }
    setSelectedIds(new Set());
    setBulkActionLoading(false);
  }

  // --- Category handlers ---

  function handleCategorySaved(saved: Category) {
    setCategories((prev) => {
      const exists = prev.find((c) => c.id === saved.id);
      if (exists) {
        return prev.map((c) => (c.id === saved.id ? saved : c));
      }
      return [...prev, saved];
    });
    if (!selectedCategoryId) {
      setSelectedCategoryId(saved.id);
    }
    setShowCategoryForm(false);
    setEditingCategory(null);
  }

  async function handleDeleteCategory(cat: Category) {
    if (
      !(await confirm({
        message: t("confirmDeleteCategory", { name: getCategoryName(cat) }),
      }))
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/categories/${cat.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("failedToDeleteCategory"));
      }

      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
      setMenuItems((prev) => prev.filter((item) => item.categoryId !== cat.id));

      if (selectedCategoryId === cat.id) {
        const remaining = categories.filter((c) => c.id !== cat.id);
        setSelectedCategoryId(remaining[0]?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    }
  }

  // --- Menu item handlers ---

  function handleMenuItemSaved(saved: MenuItem) {
    saved.price = Number(saved.price);
    if (saved.comboBasePrice != null) saved.comboBasePrice = Number(saved.comboBasePrice);
    setMenuItems((prev) => {
      const exists = prev.find((i) => i.id === saved.id);
      if (exists) {
        return prev.map((i) => (i.id === saved.id ? saved : i));
      }
      return [...prev, saved];
    });
    // Closing is owned by the form: normal Save calls onClose; "Save & add
    // another" keeps the modal open and re-seeds itself.
  }

  // Open the form in CREATE mode, seeded (cloned) from this item.
  function handleDuplicateItem(item: MenuItem) {
    setEditingMenuItem(null); // create mode
    setDuplicateFrom(item); // ...seeded from this item
    setShowMenuItemForm(true);
  }

  // Inline price edit from the list table — PATCHes the price directly,
  // mirroring handleToggleAvailability's request/normalize/update shape.
  async function handleInlinePrice(item: MenuItem, raw: string) {
    const value = parseFloat(raw);
    if (isNaN(value) || value <= 0) {
      setError(t("invalidPrice"));
      return;
    }
    if (value === item.price) return; // no-op
    try {
      const res = await fetch(`/api/menu/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: value }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || tCommon("errorGeneric"));
      }
      const updated = await res.json();
      updated.price = Number(updated.price);
      if (updated.comboBasePrice != null) updated.comboBasePrice = Number(updated.comboBasePrice);
      setMenuItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    }
  }

  async function handleToggleAvailability(item: MenuItem) {
    try {
      const res = await fetch(`/api/menu/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAvailable: !item.isAvailable }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("failedToUpdateAvailability"));
      }

      const updated = await res.json();
      updated.price = Number(updated.price);
      if (updated.comboBasePrice != null) updated.comboBasePrice = Number(updated.comboBasePrice);
      setMenuItems((prev) =>
        prev.map((i) => (i.id === updated.id ? updated : i))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    }
  }

  async function handleToggleFeatured(item: MenuItem) {
    try {
      const res = await fetch(`/api/menu/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFeatured: !item.isFeatured }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || tCommon("errorGeneric"));
      }

      const updated = await res.json();
      updated.price = Number(updated.price);
      if (updated.comboBasePrice != null) updated.comboBasePrice = Number(updated.comboBasePrice);
      setMenuItems((prev) =>
        prev.map((i) => (i.id === updated.id ? updated : i))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    }
  }

  async function handleDeleteMenuItem(item: MenuItem) {
    if (
      !(await confirm({ message: t("confirmDeleteItem", { name: getItemName(item) }) }))
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/menu/${item.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("failedToDeleteItem"));
      }

      setMenuItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    }
  }

  const sortValue = `${sortField}-${sortDirection}`;

  return (
    <div>
      {/* Error banner */}
      {error && (
        <div className="mb-4 flex items-center justify-between rounded-md bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:rounded-sm"
          >
            {tCommon("dismiss")}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Category Sidebar */}
        <div className="w-full shrink-0 lg:w-64">
          {/* Mobile: expandable dropdown */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm lg:hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <button
                type="button"
                onClick={() => setCategoryExpanded(!categoryExpanded)}
                className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${categoryExpanded ? "rotate-180" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-semibold text-gray-900">
                  {selectedCategoryId
                    ? getCategoryName(categories.find((c) => c.id === selectedCategoryId)!)
                    : t("categories")}
                </span>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {categories.length}
                </span>
              </button>
              <button
                onClick={() => {
                  setEditingCategory(null);
                  setShowCategoryForm(true);
                }}
                className="ml-2 inline-flex min-h-[44px] shrink-0 items-center rounded-md bg-primary-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
              >
                {t("addCategory")}
              </button>
            </div>
            {categoryExpanded && (
              <div className="border-t border-gray-200 p-2">
                {categories.length === 0 ? (
                  <p className="p-3 text-center text-sm text-gray-500">
                    {t("noCategories")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {categories.map((cat) => (
                      <div
                        role="button"
                        tabIndex={0}
                        key={cat.id}
                        className={`group flex cursor-pointer items-center justify-between rounded-md px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                          selectedCategoryId === cat.id
                            ? "bg-primary-50 text-primary-700"
                            : "text-gray-700 hover:bg-gray-50"
                        }`}
                        onClick={() => {
                          setSelectedCategoryId(cat.id);
                          setPage(1);
                          setSelectedIds(new Set());
                          setCategoryExpanded(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedCategoryId(cat.id);
                            setPage(1);
                            setSelectedIds(new Set());
                            setCategoryExpanded(false);
                          }
                        }}
                      >
                        <span className="font-medium">
                          {getCategoryName(cat)}
                        </span>
                        <span className="ml-2 flex shrink-0 items-center gap-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingCategory(cat);
                              setShowCategoryForm(true);
                            }}
                            className="flex h-11 w-11 items-center justify-center rounded text-gray-500 hover:text-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                            title={t("editCategory")}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCategory(cat);
                            }}
                            className="flex h-11 w-11 items-center justify-center rounded text-gray-500 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                            title={t("deleteCategory")}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Desktop: vertical sidebar list */}
          <div className="hidden rounded-lg border border-gray-200 bg-white shadow-sm lg:block">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">
                {t("categories")}
              </h2>
              <button
                onClick={() => {
                  setEditingCategory(null);
                  setShowCategoryForm(true);
                }}
                className="inline-flex min-h-[44px] items-center rounded-md bg-primary-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
              >
                {t("addCategory")}
              </button>
            </div>
            <div className="flex flex-col p-2">
              {categories.length === 0 ? (
                <p className="p-3 text-center text-sm text-gray-500">
                  {t("noCategories")}
                </p>
              ) : (
                categories.map((cat) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={cat.id}
                    className={`group flex cursor-pointer items-center justify-between rounded-md px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                      selectedCategoryId === cat.id
                        ? "bg-primary-50 text-primary-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      setSelectedCategoryId(cat.id);
                      setPage(1);
                      setSelectedIds(new Set());
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedCategoryId(cat.id);
                        setPage(1);
                        setSelectedIds(new Set());
                      }
                    }}
                  >
                    <span className="font-medium">
                      {getCategoryName(cat)}
                    </span>
                    <span className="ml-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCategory(cat);
                          setShowCategoryForm(true);
                        }}
                        className="flex h-11 w-11 items-center justify-center rounded text-gray-500 hover:text-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        title={t("editCategory")}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCategory(cat);
                        }}
                        className="flex h-11 w-11 items-center justify-center rounded text-gray-500 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        title={t("deleteCategory")}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Menu Items Main Area */}
        <div className="flex-1">
          {/* Frosted header card — keeps the "All Items"/category heading + the
              import/add toolbar legible over the animated cuisine background,
              matching the Categories panel's card treatment. */}
          <div className="mb-4 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900">
                {selectedCategoryId
                  ? `${getCategoryName(
                      categories.find((c) => c.id === selectedCategoryId)!
                    )}`
                  : t("allItems")}
              </h2>
              <div className="flex items-center gap-2">
                {/* AI menu import — only when OpenRouter is configured. */}
                {cfg.capabilities.hasOpenRouter && (
                  <button
                    onClick={() => setShowImportModal(true)}
                    className="rounded-md border border-primary-500 bg-white px-3 py-2 text-sm font-medium text-primary-500 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 sm:px-4"
                  >
                    {t("aiImport")}
                  </button>
                )}
                <button
                  onClick={() => {
                    setEditingMenuItem(null);
                    setDuplicateFrom(null);
                    setShowMenuItemForm(true);
                  }}
                  disabled={categories.length === 0}
                  className="rounded-md bg-primary-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
                >
                  {t("addItem")}
                </button>
              </div>
            </div>

            {/* AI import disabled — point the restaurant to its provider. Shown
                only when OpenRouter is unconfigured (the import button is hidden). */}
            {!cfg.capabilities.hasOpenRouter && (
              <p className="mt-2 text-xs text-gray-400">{t("aiUnavailable")}</p>
            )}
          </div>

          {/* Bulk action bar */}
          {someSelected && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5">
              <span className="text-sm font-medium text-primary-700">
                {t("selectedCount", { count: selectedIds.size })}
              </span>
              <div className="mx-1 h-4 w-px bg-primary-200" />
              <button
                onClick={handleBulkDelete}
                disabled={bulkActionLoading}
                className="inline-flex min-h-[44px] items-center rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 disabled:opacity-60"
              >
                {t("deleteSelected", { count: selectedIds.size })}
              </button>
              <button
                onClick={() => handleBulkSetAvailability(true)}
                disabled={bulkActionLoading}
                className="inline-flex min-h-[44px] items-center rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-1 disabled:opacity-60"
              >
                {t("bulkSetAvailable")}
              </button>
              <button
                onClick={() => handleBulkSetAvailability(false)}
                disabled={bulkActionLoading}
                className="inline-flex min-h-[44px] items-center rounded-md border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-xs font-medium text-yellow-700 transition-colors hover:bg-yellow-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-1 disabled:opacity-60"
              >
                {t("bulkSetUnavailable")}
              </button>
              <button
                onClick={handleDeselectAll}
                disabled={bulkActionLoading}
                className="inline-flex min-h-[44px] items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:opacity-60"
              >
                {t("deselectAll")}
              </button>
            </div>
          )}

          {/* Sort + View toggle toolbar */}
          {filteredItems.length > 0 && (
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <label htmlFor="sort-select" className="text-sm text-gray-600">
                  {t("sortBy")}:
                </label>
                <select
                  id="sort-select"
                  value={sortValue}
                  onChange={(e) => handleSortOptionChange(e.target.value)}
                  className="min-h-[44px] rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="sortOrder-asc">{t("sortDefault")}</option>
                  <option value="name-asc">{t("sortNameAZ")}</option>
                  <option value="name-desc">{t("sortNameZA")}</option>
                  <option value="price-asc">{t("sortPriceLow")}</option>
                  <option value="price-desc">{t("sortPriceHigh")}</option>
                  <option value="availability-asc">{t("sortAvailableFirst")}</option>
                  <option value="availability-desc">{t("sortUnavailableFirst")}</option>
                  <option value="dateAdded-desc">{t("sortNewest")}</option>
                  <option value="dateAdded-asc">{t("sortOldest")}</option>
                </select>
              </div>
              <div className="flex items-center gap-px rounded-md border border-gray-300">
                <button
                  onClick={() => setViewMode("grid")}
                  aria-pressed={viewMode === "grid"}
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-l-md px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                    viewMode === "grid"
                      ? "bg-primary-500 text-white"
                      : "bg-white text-gray-500 hover:bg-gray-50"
                  }`}
                  title={t("gridView")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  aria-pressed={viewMode === "list"}
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-r-md border-l border-gray-300 px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                    viewMode === "list"
                      ? "bg-primary-500 text-white"
                      : "bg-white text-gray-500 hover:bg-gray-50"
                  }`}
                  title={t("listView")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {filteredItems.length === 0 ? (
            menuItems.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm sm:p-12">
                <p className="mb-1 text-base font-medium text-gray-900">{t("emptyTitle")}</p>
                <p className="mb-5 text-sm text-gray-500">{t("emptySubtitle")}</p>
                <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                  {cfg.capabilities.hasOpenRouter && (
                    <button
                      onClick={() => setShowImportModal(true)}
                      disabled={categories.length === 0}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-primary-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      📷 {t("emptySnapPhoto")}
                    </button>
                  )}
                  <button
                    onClick={() => { setEditingMenuItem(null); setDuplicateFrom(null); setShowMenuItemForm(true); }}
                    disabled={categories.length === 0}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-primary-500 bg-white px-5 py-2.5 text-sm font-medium text-primary-600 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    ✍️ {t("emptyAddManually")}
                  </button>
                </div>
                {categories.length === 0 && (
                  <p className="mt-4 text-xs text-gray-500">{t("emptyNeedCategoryFirst")}</p>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white p-12 text-center shadow-sm">
                <p className="text-gray-500">{t("noMenuItems")}</p>
              </div>
            )
          ) : viewMode === "grid" ? (
            <>
              {/* Select all checkbox — whole label is a ≥44px tap target */}
              <label className="mb-2 inline-flex min-h-[44px] cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={handleToggleSelectAll}
                  className="h-5 w-5 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-600">{t("selectAll")}</span>
              </label>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {paginatedItems.map((item) => (
                  <div
                    key={item.id}
                    className={`relative overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md ${
                      selectedIds.has(item.id)
                        ? "border-primary-300 ring-2 ring-primary-300"
                        : "border-gray-200"
                    }`}
                  >
                    {/* Checkbox overlay — padded label gives a ≥44px tap target */}
                    <label className="absolute left-0 top-0 z-10 flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => handleToggleSelect(item.id)}
                        className="h-5 w-5 rounded border-gray-300 bg-white/80 text-primary-500 focus:ring-primary-500"
                      />
                    </label>

                    {/* Image thumbnail */}
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={getItemName(item)}
                        width={320}
                        height={160}
                        className="h-32 w-full object-cover sm:h-40"
                      />
                    ) : (
                      <div className="flex h-32 items-center justify-center bg-gray-100 sm:h-40">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-10 w-10 text-gray-300"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
                          />
                        </svg>
                      </div>
                    )}

                    <div className="p-4">
                      {/* Name and availability badge */}
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <h3 className="font-medium text-gray-900">
                          {getItemName(item)}
                        </h3>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            item.isAvailable
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {item.isAvailable ? t("available") : t("unavailable")}
                        </span>
                      </div>

                      {/* Combo & Featured badges */}
                      {(item.isCombo || item.isFeatured) && (
                        <div className="mb-1 flex flex-wrap gap-1">
                          {item.isCombo && (
                            <span className="inline-flex items-center rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800">
                              {t("combo")}
                            </span>
                          )}
                          {item.isFeatured && (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              {t("featured")}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Description */}
                      {getItemDescription(item) && (
                        <p className="mb-2 line-clamp-2 text-sm text-gray-500">
                          {getItemDescription(item)}
                        </p>
                      )}

                      {/* Price */}
                      <p className="mb-3 text-lg font-semibold text-primary-600">
                        {money(item.price)}
                      </p>

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Featured toggle */}
                        <button
                          onClick={() => handleToggleFeatured(item)}
                          className={`rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                            item.isFeatured
                              ? "border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                              : "border border-gray-300 bg-white text-gray-500 hover:bg-gray-50"
                          }`}
                        >
                          {item.isFeatured ? t("unfeatured") : t("setFeatured")}
                        </button>

                        {/* Availability toggle */}
                        <button
                          onClick={() => handleToggleAvailability(item)}
                          className={`rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                            item.isAvailable
                              ? "border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                              : "border border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                          }`}
                        >
                          {item.isAvailable ? t("setUnavailable") : t("setAvailable")}
                        </button>

                        {/* Edit */}
                        <button
                          onClick={() => {
                            setEditingMenuItem(item);
                            setShowMenuItemForm(true);
                          }}
                          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                        >
                          {tCommon("edit")}
                        </button>

                        {/* Duplicate */}
                        <button
                          onClick={() => handleDuplicateItem(item)}
                          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                        >
                          {t("duplicate")}
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => handleDeleteMenuItem(item)}
                          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                        >
                          {tCommon("delete")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* List view — Select All checkbox (≥44px tap target) */}
              <label className="mb-2 inline-flex min-h-[44px] cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={handleToggleSelectAll}
                  className="h-5 w-5 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-600">{t("selectAll")}</span>
              </label>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm lg:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-3 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={allOnPageSelected}
                          onChange={handleToggleSelectAll}
                          className="h-5 w-5 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                        />
                      </th>
                      <th className="w-[52px] min-w-[52px] px-3 py-3 text-left text-sm font-medium text-gray-600">
                        {/* Thumbnail */}
                      </th>
                      <th className="px-3 py-3 text-left text-sm font-medium text-gray-600">
                        {tCommon("name")}
                      </th>
                      <th className="px-3 py-3 text-left text-sm font-medium text-gray-600">
                        {t("categories")}
                      </th>
                      <th className="px-3 py-3 text-right text-sm font-medium text-gray-600">
                        {cfg.currency}
                      </th>
                      <th className="px-3 py-3 text-left text-sm font-medium text-gray-600">
                        {tCommon("status")}
                      </th>
                      <th className="px-3 py-3 text-right text-sm font-medium text-gray-600">
                        {tCommon("actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map((item) => (
                      <tr
                        key={item.id}
                        className={`border-b border-gray-100 last:border-b-0 ${
                          selectedIds.has(item.id) ? "bg-primary-50" : ""
                        }`}
                      >
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            onChange={() => handleToggleSelect(item.id)}
                            className="h-5 w-5 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                          />
                        </td>
                        <td className="w-[52px] min-w-[52px] px-3 py-2.5">
                          {item.imageUrl ? (
                            <Image
                              src={item.imageUrl}
                              alt={getItemName(item)}
                              width={40}
                              height={40}
                              className="h-10 w-10 shrink-0 rounded object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-100">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-5 w-5 text-gray-300"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={1}
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
                                />
                              </svg>
                            </div>
                          )}
                        </td>
                        <td className="max-w-[200px] px-3 py-2.5 text-sm font-medium text-gray-900">
                          {getItemName(item)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-sm text-gray-500">
                          {getCategoryName(item.category)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-medium text-gray-900">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={item.price}
                            key={item.price}
                            onBlur={(e) => {
                              if (parseFloat(e.target.value) !== item.price) handleInlinePrice(item, e.target.value);
                            }}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            aria-label={t("priceLabel", { currencyCode: cfg.currency })}
                            className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-base text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              item.isAvailable
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {item.isAvailable ? t("available") : t("unavailable")}
                          </span>
                          {item.isCombo && (
                            <span className="ml-1 inline-flex items-center rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800">
                              {t("combo")}
                            </span>
                          )}
                          {item.isFeatured && (
                            <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              {t("featured")}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleToggleFeatured(item)}
                              className={`inline-flex min-h-[44px] items-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                                item.isFeatured
                                  ? "border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                  : "border border-gray-300 bg-white text-gray-500 hover:bg-gray-50"
                              }`}
                            >
                              {item.isFeatured ? t("unfeatured") : t("setFeatured")}
                            </button>
                            <button
                              onClick={() => handleToggleAvailability(item)}
                              className={`inline-flex min-h-[44px] items-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                                item.isAvailable
                                  ? "border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                                  : "border border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                              }`}
                            >
                              {item.isAvailable ? t("setUnavailable") : t("setAvailable")}
                            </button>
                            <button
                              onClick={() => {
                                setEditingMenuItem(item);
                                setShowMenuItemForm(true);
                              }}
                              className="inline-flex min-h-[44px] items-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                            >
                              {tCommon("edit")}
                            </button>
                            <button
                              onClick={() => handleDuplicateItem(item)}
                              className="inline-flex min-h-[44px] items-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                            >
                              {t("duplicate")}
                            </button>
                            <button
                              onClick={() => handleDeleteMenuItem(item)}
                              className="inline-flex min-h-[44px] items-center rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                            >
                              {tCommon("delete")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="space-y-3 lg:hidden">
                {paginatedItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-lg border bg-white p-4 shadow-sm ${
                      selectedIds.has(item.id)
                        ? "border-primary-300 ring-2 ring-primary-300"
                        : "border-gray-200"
                    } border-l-4 ${item.isAvailable ? "border-l-green-500" : "border-l-red-500"}`}
                  >
                    {/* Top row: checkbox + thumbnail + name */}
                    <div className="flex items-start gap-3">
                      <label className="-m-1 flex min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => handleToggleSelect(item.id)}
                          className="h-5 w-5 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                        />
                      </label>
                      {item.imageUrl ? (
                        <Image
                          src={item.imageUrl}
                          alt={getItemName(item)}
                          width={48}
                          height={48}
                          className="h-12 w-12 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gray-100">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-6 w-6 text-gray-300"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
                            />
                          </svg>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium text-gray-900">
                          {getItemName(item)}
                        </h3>
                        <p className="text-xs text-gray-500">
                          {getCategoryName(item.category)}
                        </p>
                      </div>
                    </div>

                    {/* Middle row: price + status badges */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
                      <span className="text-sm font-semibold text-primary-600">
                        {money(item.price)}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          item.isAvailable
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {item.isAvailable ? t("available") : t("unavailable")}
                      </span>
                      {item.isCombo && (
                        <span className="inline-flex items-center rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800">
                          {t("combo")}
                        </span>
                      )}
                      {item.isFeatured && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          {t("featured")}
                        </span>
                      )}
                    </div>

                    {/* Actions row */}
                    <div className="mt-3 flex flex-wrap items-center gap-2 pl-7">
                      <button
                        onClick={() => handleToggleFeatured(item)}
                        className={`inline-flex min-h-[44px] items-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                          item.isFeatured
                            ? "border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : "border border-gray-300 bg-white text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        {item.isFeatured ? t("unfeatured") : t("setFeatured")}
                      </button>
                      <button
                        onClick={() => handleToggleAvailability(item)}
                        className={`inline-flex min-h-[44px] items-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                          item.isAvailable
                            ? "border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                            : "border border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                        }`}
                      >
                        {item.isAvailable ? t("setUnavailable") : t("setAvailable")}
                      </button>
                      <button
                        onClick={() => {
                          setEditingMenuItem(item);
                          setShowMenuItemForm(true);
                        }}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                      >
                        {tCommon("edit")}
                      </button>
                      <button
                        onClick={() => handleDeleteMenuItem(item)}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                      >
                        {tCommon("delete")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <Pagination
            currentPage={page}
            totalItems={sortedItems.length}
            pageSize={12}
            onPageChange={setPage}
          />
        </div>
      </div>

      {/* Category Form Modal */}
      {showCategoryForm && (
        <CategoryForm
          category={editingCategory}
          onSave={handleCategorySaved}
          onClose={() => {
            setShowCategoryForm(false);
            setEditingCategory(null);
          }}
        />
      )}

      {/* Menu Item Form Modal */}
      {showMenuItemForm && (
        <MenuItemForm
          item={editingMenuItem}
          duplicateFrom={duplicateFrom}
          categories={categories}
          existingItems={menuItems}
          onSave={handleMenuItemSaved}
          onClose={() => {
            setShowMenuItemForm(false);
            setEditingMenuItem(null);
            setDuplicateFrom(null);
          }}
        />
      )}

      {/* AI Import Modal — guarded on OpenRouter too, in case state goes stale. */}
      {showImportModal && cfg.capabilities.hasOpenRouter && (
        <MenuImportModal
          categories={categories}
          existingItems={menuItems}
          onImported={(newItems, newCategories) => {
            if (newCategories.length > 0) {
              setCategories((prev) => [...prev, ...newCategories]);
              if (!selectedCategoryId && newCategories[0]) {
                setSelectedCategoryId(newCategories[0].id);
              }
            }
            setMenuItems((prev) => [...prev, ...newItems]);
            setShowImportModal(false);
          }}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}
