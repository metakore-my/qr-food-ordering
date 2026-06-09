interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const globalForCache = globalThis as unknown as {
  menuCache: Map<string, CacheEntry<unknown>>;
};

if (!globalForCache.menuCache) {
  globalForCache.menuCache = new Map();
}

const cache = globalForCache.menuCache;

const TTL_MS = 60_000; // 60 seconds

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + TTL_MS });
}

export function invalidateMenuCache(): void {
  for (const key of cache.keys()) {
    if (key.startsWith("menu:")) {
      cache.delete(key);
    }
  }
}
