import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/logger";
import { getCapabilities } from "@/lib/integrations";
import { listR2Objects, deleteR2Key, keyFromPublicUrl } from "@/lib/r2";

const BATCH_SIZE = 1_000;

// Orphaned-R2-image sweep (Group 5):
// - Grace period: an object must be older than this to be eligible, so a freshly
//   uploaded image whose imageUrl hasn't yet been committed to the DB is never
//   deleted mid-save (the presign→PUT→save window).
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000; // 24h
// - Per-run delete cap: a runaway guard; a large backlog drains over several runs.
const MAX_ORPHAN_DELETES = 500;

interface GroupResult {
  success: boolean;
  data?: Record<string, number>;
  error?: string;
}

/** Delete rows in batches to prevent lock escalation on large tables. */
async function batchDeleteOrders(where: Prisma.OrderWhereInput): Promise<number> {
  let totalDeleted = 0;
  while (true) {
    const batch = await prisma.order.findMany({
      where,
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    // OrderItems cascade-deleted automatically via onDelete: Cascade
    const { count } = await prisma.order.deleteMany({
      where: { id: { in: batch.map((o) => o.id) } },
    });
    totalDeleted += count;

    if (batch.length < BATCH_SIZE) break;
    // Brief pause between batches to reduce DB pressure
    await new Promise((r) => setTimeout(r, 50));
  }
  return totalDeleted;
}

async function batchDeleteSessions(where: Prisma.SessionWhereInput): Promise<number> {
  let totalDeleted = 0;
  while (true) {
    const batch = await prisma.session.findMany({
      where,
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    // CartItems cascade-deleted automatically via onDelete: Cascade
    const { count } = await prisma.session.deleteMany({
      where: { id: { in: batch.map((s) => s.id) } },
    });
    totalDeleted += count;

    if (batch.length < BATCH_SIZE) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return totalDeleted;
}

/** Small delay between cleanup groups to spread DB load. */
function pause(ms = 100) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Constant-time Bearer-token check for the cron secret.
 *
 * Two failure modes a naive `header !== \`Bearer ${process.env.CRON_SECRET}\``
 * has, both closed here:
 *   1. **Unset secret = open endpoint.** If `CRON_SECRET` is missing, the naive
 *      compare becomes `!== "Bearer undefined"`, so a request literally sending
 *      `Authorization: Bearer undefined` would pass and trigger a full
 *      data-deletion sweep. We treat a missing/empty secret as misconfiguration
 *      (caller gets 503) rather than admitting the request.
 *   2. **Timing oracle.** A plain `!==` short-circuits at the first differing
 *      byte, leaking the token byte-by-byte to a same-network attacker. We
 *      compare with `timingSafeEqual` over equal-length buffers (mirrors the
 *      HMAC check in `qr.ts`).
 */
function isAuthorizedCron(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // unset/empty secret → never authorize (see #1)
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(authHeader ?? "");
  // timingSafeEqual throws on length mismatch, so gate on length first — the
  // length itself is not secret (token length is fixed per deploy).
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET) {
    log.error("Cron", "CRON_SECRET is not set — refusing cleanup");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  if (!isAuthorizedCron(authHeader)) {
    log.warn("Cron", "Unauthorized cleanup attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  log.info("Cron", "Cleanup job started");
  const results: Record<string, GroupResult> = {};

  // ── Group 1: Delete old orders — retention split by status ──
  // COMPLETED orders are settled-sale records the merchant needs for
  // bookkeeping/tax filing, so they're kept LONGER (90 days). Everything else
  // (DECLINED/EXPIRED/abandoned PENDING/CONFIRMED) is operational noise excluded
  // from revenue, pruned at 30 days. Single batched pass (one OR `where`) keeps
  // the lock-safety + single `deletedOrders` count. OrderItems cascade-delete.
  // NOTE: 90d here MUST stay >= the longest report range (RANGE_MS "90d" in
  // report-utils.ts) — a merchant must be able to query every COMPLETED order
  // still retained.
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const deletedOrders = await batchDeleteOrders({
      OR: [
        // Settled sales: keep 90 days.
        { status: "COMPLETED", createdAt: { lt: ninetyDaysAgo } },
        // Non-settled (noise): keep 30 days.
        { status: { not: "COMPLETED" }, createdAt: { lt: thirtyDaysAgo } },
      ],
    });

    results.oldOrders = {
      success: true,
      data: { deletedOrders },
    };
  } catch (err) {
    results.oldOrders = {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  await pause();

  // ── Group 2: Expire stale ACTIVE sessions (4h inactivity) ──
  // A session that ends without settlement can never complete its orders, so
  // decline its open (PENDING/CONFIRMED) orders in the same transaction —
  // otherwise they sit on the kitchen board forever in a state that's excluded
  // from every revenue report (same invariant as the admin "Close Table"
  // force-close). Staff settling an idle-but-unpaid table should do so via the
  // scanner BEFORE this daily sweep runs.
  try {
    const fourHoursAgo = new Date();
    fourHoursAgo.setHours(fourHoursAgo.getHours() - 4);

    const { expiredSessions, declinedOrders } = await prisma.$transaction(
      async (tx) => {
        const stale = await tx.session.findMany({
          where: { status: "ACTIVE", updatedAt: { lt: fourHoursAgo } },
          select: { id: true },
        });
        if (stale.length === 0) {
          return { expiredSessions: 0, declinedOrders: 0 };
        }
        const staleIds = stale.map((s) => s.id);

        const declined = await tx.order.updateMany({
          where: {
            sessionId: { in: staleIds },
            status: { in: ["PENDING", "CONFIRMED"] },
          },
          data: { status: "DECLINED" },
        });

        const expired = await tx.session.updateMany({
          where: { id: { in: staleIds } },
          data: { status: "EXPIRED" },
        });

        return {
          expiredSessions: expired.count,
          declinedOrders: declined.count,
        };
      }
    );

    results.staleSessions = {
      success: true,
      data: { expiredSessions, declinedOrders },
    };
  } catch (err) {
    results.staleSessions = {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  await pause();

  // ── Group 3: Expire old CHECKED_OUT sessions (30d) ──
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const expired = await prisma.session.updateMany({
      where: { status: "CHECKED_OUT", updatedAt: { lt: thirtyDaysAgo } },
      data: { status: "EXPIRED" },
    });

    results.oldCheckouts = {
      success: true,
      data: { expiredSessions: expired.count },
    };
  } catch (err) {
    results.oldCheckouts = {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  await pause();

  // ── Group 4: Hard-delete EXPIRED sessions that have no remaining orders ──
  // CartItems are cascade-deleted by the DB (onDelete: Cascade).
  // This is self-contained: after Group 1 removes old orders and Groups 2-3
  // expire sessions, this single query catches all deletable sessions in one
  // pass — no multi-run convergence needed.
  try {
    const deletedSessions = await batchDeleteSessions({
      status: "EXPIRED",
      orders: { none: {} },
    });

    results.orphanedSessions = {
      success: true,
      data: { deletedSessions },
    };
  } catch (err) {
    results.orphanedSessions = {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  await pause();

  // ── Group 5: Garbage-collect orphaned R2 images ──
  // A menu-image object in R2 becomes orphaned when its MenuItem is deleted or
  // its image replaced (and especially after a full-replace menu RESTORE, which
  // drops the whole tree and recreates it — the old items' R2 objects are never
  // referenced again). Nothing else prunes them, so the bucket grows unbounded
  // over time. This sweep diffs the bucket against the keys still referenced in
  // the DB and deletes the unreferenced ones.
  //
  // SAFETY (R2 deletion is irreversible — several guards make a wrong sweep
  // impossible to turn into data loss):
  //   - Capability gate: skipped entirely if R2 isn't configured.
  //   - Empty-ref-set abort: if the DB yields ZERO referenced keys (e.g. a query
  //     error, or mid-reset before a menu is restored), we DO NOT delete — an
  //     empty allow-list would otherwise mean "everything is an orphan" and wipe
  //     the bucket. We only delete when we have a trustworthy live set.
  //   - 24h grace period: only objects older than 24h are eligible, so an image
  //     just uploaded (presign→PUT) whose imageUrl hasn't been committed to the
  //     DB yet is never mistaken for an orphan and deleted mid-save.
  //   - Per-run cap: at most MAX_ORPHAN_DELETES removed per run (a runaway guard;
  //     a large backlog drains over several daily runs).
  try {
    if (!getCapabilities().hasR2) {
      results.orphanedImages = { success: true, data: { skipped: 1 } };
    } else {
      const objects = await listR2Objects("menu/");
      if (objects === null) {
        // list failed — surface as a group error, never proceed to delete.
        throw new Error("R2 list failed");
      }

      // Live reference set: every MenuItem.imageUrl + the logo_url setting.
      const [itemsWithImg, logoRow] = await Promise.all([
        prisma.menuItem.findMany({
          where: { imageUrl: { not: null } },
          select: { imageUrl: true },
        }),
        prisma.systemSetting.findUnique({ where: { key: "logo_url" } }),
      ]);
      const referenced = new Set<string>();
      for (const it of itemsWithImg) {
        const k = keyFromPublicUrl(it.imageUrl);
        if (k) referenced.add(k);
      }
      const logoKey = keyFromPublicUrl(logoRow?.value ?? null);
      if (logoKey) referenced.add(logoKey);

      if (referenced.size === 0) {
        // No trustworthy live set → refuse to delete (see SAFETY above).
        log.warn("Cron", "Orphan-image sweep skipped: zero referenced keys", {
          bucketObjects: objects.length,
        });
        results.orphanedImages = {
          success: true,
          data: { skippedNoRefs: 1, bucketObjects: objects.length },
        };
      } else {
        const cutoff = Date.now() - ORPHAN_GRACE_MS;
        const orphans = objects.filter(
          (o) =>
            !referenced.has(o.key) &&
            o.lastModified !== null &&
            o.lastModified.getTime() < cutoff
        );
        let deleted = 0;
        for (const o of orphans.slice(0, MAX_ORPHAN_DELETES)) {
          if (await deleteR2Key(o.key)) deleted++;
          await new Promise((r) => setTimeout(r, 20));
        }
        results.orphanedImages = {
          success: true,
          data: {
            bucketObjects: objects.length,
            referenced: referenced.size,
            orphansEligible: orphans.length,
            deleted,
          },
        };
      }
    }
  } catch (err) {
    results.orphanedImages = {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  // Determine HTTP status
  const groups = Object.values(results);
  const allOk = groups.every((g) => g.success);
  const allFailed = groups.every((g) => !g.success);
  const status = allOk ? 200 : allFailed ? 500 : 207;

  const duration = Date.now() - startTime;
  log.info("Cron", "Cleanup job finished", { durationMs: duration, status, results });

  return NextResponse.json({ results }, { status });
}
