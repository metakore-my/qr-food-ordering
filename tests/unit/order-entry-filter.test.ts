import { describe, it, expect } from "vitest";
import { visibleItems } from "@/lib/order-entry-filter";

interface I {
  id: number;
  name: string;
  isFeatured: boolean;
}

const drinks = {
  id: 1,
  items: [
    { id: 11, name: "Latte", isFeatured: true },
    { id: 12, name: "Kopi O", isFeatured: false },
  ] as I[],
};
const mains = {
  id: 2,
  items: [
    { id: 21, name: "Nasi Lemak", isFeatured: true },
    { id: 22, name: "Char Kuey Teow", isFeatured: false },
  ] as I[],
};
const cats = [drinks, mains];

describe("visibleItems", () => {
  it("empty search + category id returns only that category's items", () => {
    expect(visibleItems(cats, 2, "").map((i) => i.id)).toEqual([21, 22]);
  });

  it("empty search + unknown category id returns []", () => {
    expect(visibleItems(cats, 999, "")).toEqual([]);
  });

  it("empty search + 'featured' collects featured items across all categories", () => {
    expect(visibleItems(cats, "featured", "").map((i) => i.id)).toEqual([11, 21]);
  });

  it("empty search + 'featured' with no featured items returns []", () => {
    const plain = [{ id: 9, items: [{ id: 90, name: "x", isFeatured: false }] as I[] }];
    expect(visibleItems(plain, "featured", "")).toEqual([]);
  });

  it("non-empty search overrides the active chip and matches across ALL categories", () => {
    expect(visibleItems(cats, 1, "nasi").map((i) => i.id)).toEqual([21]);
  });

  it("search is case-insensitive and trims whitespace", () => {
    expect(visibleItems(cats, 1, "  LATTE ").map((i) => i.id)).toEqual([11]);
  });

  it("search matches a substring anywhere in the name", () => {
    expect(visibleItems(cats, "featured", "kuey").map((i) => i.id)).toEqual([22]);
  });

  it("whitespace-only search falls through to the active chip", () => {
    expect(visibleItems(cats, 2, "   ").map((i) => i.id)).toEqual([21, 22]);
  });

  it("returns [] for empty categories regardless of mode", () => {
    expect(visibleItems<I>([], "featured", "")).toEqual([]);
    expect(visibleItems<I>([], 1, "")).toEqual([]);
    expect(visibleItems<I>([], 1, "latte")).toEqual([]);
  });
});
