/**
 * Pure browse-filtering for the staff order-entry picker. No React, no prisma —
 * imported by `order-entry.tsx` AND its unit test so the two can't drift
 * (the src/lib/* convention used across this repo).
 */

export interface FilterableItem {
  /** The already-resolved display name for the active locale (not a raw DB field). */
  name: string;
  isFeatured: boolean;
}

export interface FilterableCategory<I> {
  id: number;
  items: I[];
}

/**
 * Resolve which items the picker should show.
 * - Non-empty search OVERRIDES the active chip: case-insensitive substring match
 *   on the item name, across every category's items (in category order).
 * - Empty search + "featured": items with isFeatured, collected across all
 *   categories (in category order).
 * - Empty search + a category id: that category's items (or [] if the id is absent).
 */
export function visibleItems<I extends FilterableItem>(
  categories: FilterableCategory<I>[],
  activeCategory: number | "featured",
  search: string,
): I[] {
  const q = search.trim().toLowerCase();
  if (q !== "") {
    return categories.flatMap((c) => c.items).filter((it) => it.name.toLowerCase().includes(q));
  }
  if (activeCategory === "featured") {
    return categories.flatMap((c) => c.items).filter((it) => it.isFeatured);
  }
  const cat = categories.find((c) => c.id === activeCategory);
  return cat ? cat.items : [];
}
