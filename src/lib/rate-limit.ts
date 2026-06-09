import { log } from "./logger";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const MAX_STORE_SIZE = 10_000;

interface Entry {
  count: number;
  resetAt: number;
}

// globalThis-guarded so dev HMR reuses the Map instead of leaking one per reload.
const globalForRateLimit = globalThis as unknown as {
  rateLimitStore?: Map<string, Entry>;
};
const store =
  globalForRateLimit.rateLimitStore ??
  (globalForRateLimit.rateLimitStore = new Map<string, Entry>());

/**
 * Check if an IP is rate-limited. Returns true if allowed, false if blocked.
 * Cleans up stale entries on each call.
 */
export function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // Cleanup stale entries
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }

  // Safety valve: evict oldest half (preserves rate limiting for active IPs).
  if (store.size > MAX_STORE_SIZE) {
    log.warn("RateLimit", "Safety valve triggered, evicting oldest entries", { size: store.size });
    const sorted = Array.from(store.entries())
      .sort(([, a], [, b]) => a.resetAt - b.resetAt);
    const toEvict = sorted.slice(0, Math.floor(sorted.length / 2));
    for (const [key] of toEvict) {
      store.delete(key);
    }
  }

  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  entry.count++;
  if (entry.count > MAX_ATTEMPTS) {
    log.warn("RateLimit", "IP blocked", { ip, attempts: entry.count });
    return false;
  }

  return true;
}
