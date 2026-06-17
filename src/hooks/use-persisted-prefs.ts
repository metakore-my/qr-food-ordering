"use client";

import { useSyncExternalStore } from "react";
import type { PersistedPrefsStore } from "@/lib/persisted-prefs";

/**
 * Read a persisted-prefs store as React state (sticky across SPA navigation).
 * Returns `[prefs, write]` — `write` takes a partial patch. Hydration-safe:
 * the server snapshot is the defaults, the client snapshot is the stored value.
 */
export function usePersistedPrefs<T extends object>(
  store: PersistedPrefsStore<T>
): [T, (patch: Partial<T>) => void] {
  const prefs = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.getServerSnapshot
  );
  return [prefs, store.write];
}
