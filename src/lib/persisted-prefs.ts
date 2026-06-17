/**
 * Generic localStorage-backed preference store for per-device, sticky-across-SPA-
 * navigation admin UI state (view mode, sort, active tab, date range, …).
 *
 * Why this exists: each admin route is a server component, so navigating between
 * them UNMOUNTS the previous page's React tree and remounts on return. Plain
 * `useState` therefore resets a chosen sort/view/range on every revisit. This
 * factory hoists such prefs into a localStorage-backed external store read via
 * `useSyncExternalStore` — the same lint-clean, hydration-safe pattern as
 * `use-order-alert-sound.ts` (server snapshot = defaults, client snapshot =
 * stored value, cross-tab `storage` events re-render, no setState-in-effect).
 *
 * Scope: NON-secret, per-device UI preferences only — never order/auth/money
 * data. A malformed or partial stored value degrades to the defaults via the
 * caller-supplied `sanitize` (never throws into React).
 *
 * Client-safe (no prisma/server imports). `globalThis`-guarded so dev HMR reuses
 * the same in-memory snapshot cache instead of orphaning it (matches the other
 * in-memory stores — see CLAUDE.md).
 */

export interface PersistedPrefsStore<T> {
  /** Stable snapshot for `useSyncExternalStore` (memoized; same identity until the stored value changes). */
  read: () => T;
  /** Server/SSR snapshot — always the defaults (the stored value is browser-only). */
  getServerSnapshot: () => T;
  /** Subscribe to same-tab writes + cross-tab `storage` events. */
  subscribe: (cb: () => void) => () => void;
  /** Merge a partial patch into the stored prefs and notify subscribers. */
  write: (patch: Partial<T>) => void;
}

interface Cache<T> {
  raw: string | null;
  value: T;
}

/**
 * Build a persisted-prefs store.
 *
 * @param storageKey  localStorage key (namespace per feature, e.g. "admin_menu_list_prefs").
 * @param defaults    the full default object (also the SSR + fallback value).
 * @param sanitize    coerce an arbitrary parsed value into a valid `T`, filling
 *                    any missing/invalid field from `defaults`. MUST be total
 *                    (never throw) and pure.
 */
export function createPersistedPrefs<T extends object>(
  storageKey: string,
  defaults: T,
  sanitize: (parsed: unknown, defaults: T) => T
): PersistedPrefsStore<T> {
  // `globalThis`-guarded snapshot cache so HMR doesn't orphan it.
  const cacheHolder = globalThis as unknown as {
    [k: string]: Cache<T> | undefined;
  };
  const cacheKey = `__persistedPrefs_${storageKey}`;
  if (!cacheHolder[cacheKey]) {
    cacheHolder[cacheKey] = { raw: null, value: defaults };
  }
  const cache = cacheHolder[cacheKey]!;

  const listeners = new Set<() => void>();

  function read(): T {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(storageKey);
    } catch {
      raw = null;
    }
    // Re-parse only when the raw string changed, so the returned identity is
    // stable between reads (a fresh parse each call would loop useSyncExternalStore).
    if (raw !== cache.raw) {
      cache.raw = raw;
      let parsed: unknown = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      }
      cache.value = sanitize(parsed, defaults);
    }
    return cache.value;
  }

  function getServerSnapshot(): T {
    return defaults;
  }

  function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey) cb();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }

  function write(patch: Partial<T>): void {
    const next = sanitize({ ...read(), ...patch }, defaults);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* storage unavailable (private mode / quota) — listeners still fire below */
    }
    // Invalidate the memoized snapshot so the next read reflects the write, then
    // notify same-tab subscribers (the `storage` event fires only in OTHER tabs).
    cache.raw = null;
    for (const cb of listeners) cb();
  }

  return { read, getServerSnapshot, subscribe, write };
}
