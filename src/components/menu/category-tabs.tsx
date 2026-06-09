"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";

interface CategoryTabsProps {
  categories: Array<{
    id: number;
    name: string;
  }>;
  allLabel: string;
}

export function CategoryTabs({ categories, allLabel }: CategoryTabsProps) {
  const tMenu = useTranslations("menu");
  const [activeId, setActiveId] = useState<number | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  // Scroll the active tab into view within the horizontal tab bar
  useEffect(() => {
    if (activeTabRef.current && tabsRef.current) {
      const tab = activeTabRef.current;
      const container = tabsRef.current;
      const tabLeft = tab.offsetLeft;
      const tabWidth = tab.offsetWidth;
      const containerWidth = container.offsetWidth;
      const scrollLeft = container.scrollLeft;

      // If the tab is not fully visible, scroll it into view
      if (tabLeft < scrollLeft) {
        container.scrollTo({ left: tabLeft - 16, behavior: "smooth" });
      } else if (tabLeft + tabWidth > scrollLeft + containerWidth) {
        container.scrollTo({
          left: tabLeft + tabWidth - containerWidth + 16,
          behavior: "smooth",
        });
      }
    }
  }, [activeId]);

  const handleTabClick = useCallback(
    (categoryId: number | null) => {
      setActiveId(categoryId);

      if (categoryId === null) {
        // Scroll to top for "All"
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      const section = document.getElementById(`category-${categoryId}`);
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    []
  );

  // Watch scroll position to highlight active category
  useEffect(() => {
    function handleScroll() {
      const scrollY = window.scrollY + 120; // offset for sticky header + tabs

      let currentCategoryId: number | null = null;
      for (const cat of categories) {
        const section = document.getElementById(`category-${cat.id}`);
        if (section && section.offsetTop <= scrollY) {
          currentCategoryId = cat.id;
        }
      }

      setActiveId(currentCategoryId);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [categories]);

  return (
    <div className="sticky top-0 z-10 -mx-4 bg-gray-50/95 px-4 py-2 backdrop-blur-sm">
      <div
        ref={tabsRef}
        className="hide-scrollbar flex gap-2 overflow-x-auto"
        role="tablist"
        aria-label={tMenu("menuCategories")}
      >
        {/* All tab */}
        <button
          ref={activeId === null ? activeTabRef : undefined}
          type="button"
          role="tab"
          aria-selected={activeId === null}
          onClick={() => handleTabClick(null)}
          className={`shrink-0 rounded-full px-4 py-3 min-h-[44px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
            activeId === null
              ? "bg-primary-500 text-white shadow-sm"
              : "bg-white text-gray-600 hover:bg-gray-100"
          }`}
        >
          {allLabel}
        </button>

        {categories.map((cat) => (
          <button
            key={cat.id}
            ref={activeId === cat.id ? activeTabRef : undefined}
            type="button"
            role="tab"
            aria-selected={activeId === cat.id}
            onClick={() => handleTabClick(cat.id)}
            className={`shrink-0 rounded-full px-4 py-3 min-h-[44px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
              activeId === cat.id
                ? "bg-primary-500 text-white shadow-sm"
                : "bg-white text-gray-600 hover:bg-gray-100"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>
    </div>
  );
}
