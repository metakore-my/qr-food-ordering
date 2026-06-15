import { prisma } from "@/lib/prisma";
import { log } from "@/lib/logger";

let cachedValue: boolean | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10_000; // 10 seconds

export async function isMaintenanceMode(): Promise<boolean> {
  const now = Date.now();
  if (cachedValue !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedValue;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: "maintenance_mode" },
  });
  cachedValue = setting?.value === "true";
  cacheTimestamp = now;
  return cachedValue;
}

/** Call after toggling maintenance mode to bust the cache immediately. */
export function invalidateMaintenanceCache() {
  log.info("Maintenance", "Cache invalidated");
  cachedValue = null;
  cacheTimestamp = 0;
}
