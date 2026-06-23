"use client";

import { useSyncExternalStore, useEffect } from "react";
import {
  adminFontPrefsStore,
  pxForFontSize,
  DEFAULT_ADMIN_FONT_SIZE,
} from "@/lib/admin-font-prefs";

/**
 * Admin shell wrapper that applies the per-device font-size preference.
 *
 * IMPORTANT — why this scales the ROOT, not this wrapper:
 * The admin UI is styled almost entirely with Tailwind `text-*` utilities, which
 * compile to `rem` units. `rem` is resolved against the ROOT element's font-size
 * (`<html>`) — NOT the nearest ancestor — so setting `font-size` on a mid-tree
 * wrapper does nothing to those utilities (verified: a `text-sm` child stays
 * 14px regardless of an ancestor's font-size). The only lever that moves
 * `rem`-based text is the root font-size. So we set it on `document.documentElement`.
 *
 * Customer-route isolation (the reason an earlier version avoided <html>): the
 * override is applied only while THIS component is mounted, and the effect's
 * cleanup RESTORES the root to its default on unmount. Admin and customer pages
 * are separate route trees and never mount together, so navigating to a customer
 * route (SPA or full load) leaves the root at the browser default. The isolation
 * is preserved through cleanup rather than through (impossible) `rem` scoping.
 *
 * We set the root font-size as a PERCENTAGE relative to the browser base
 * (medium = 100%), not an absolute px, so a user who raised their browser's
 * default font size for accessibility keeps that scaling — the admin preference
 * multiplies it instead of clobbering it. Medium (100%) is therefore a true
 * no-op, matching the prior baseline exactly.
 */

/** Root font-size percentage for a size, relative to the 16px medium baseline. */
function rootPercentFor(size: Parameters<typeof pxForFontSize>[0]): string {
  return `${(pxForFontSize(size) / pxForFontSize(DEFAULT_ADMIN_FONT_SIZE)) * 100}%`;
}

export function AdminFontScale({ children }: { children: React.ReactNode }) {
  const prefs = useSyncExternalStore(
    adminFontPrefsStore.subscribe,
    adminFontPrefsStore.read,
    adminFontPrefsStore.getServerSnapshot,
  );

  // Scale the ROOT font-size so every rem-based `text-*`/spacing utility in the
  // admin tree scales. Restore on unmount so customer routes are unaffected.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.fontSize; // typically "" (browser default)
    root.style.fontSize = rootPercentFor(prefs.size);
    return () => {
      root.style.fontSize = previous;
    };
  }, [prefs.size]);

  return <div className="relative min-h-screen bg-gray-50">{children}</div>;
}
