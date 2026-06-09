import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/logger";

const BATCH_SIZE = 1_000;

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

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    log.warn("Cron", "Unauthorized cleanup attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  log.info("Cron", "Cleanup job started");
  const results: Record<string, GroupResult> = {};

  // ── Group 1: Delete orders older than 30 days (any status) ──
  // OrderItems are cascade-deleted by the DB (onDelete: Cascade).
  // Batched to prevent lock escalation on large tables.
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deletedOrders = await batchDeleteOrders({
      createdAt: { lt: thirtyDaysAgo },
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
  try {
    const fourHoursAgo = new Date();
    fourHoursAgo.setHours(fourHoursAgo.getHours() - 4);

    const expired = await prisma.session.updateMany({
      where: { status: "ACTIVE", updatedAt: { lt: fourHoursAgo } },
      data: { status: "EXPIRED" },
    });

    results.staleSessions = {
      success: true,
      data: { expiredSessions: expired.count },
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

  // Determine HTTP status
  const groups = Object.values(results);
  const allOk = groups.every((g) => g.success);
  const allFailed = groups.every((g) => !g.success);
  const status = allOk ? 200 : allFailed ? 500 : 207;

  const duration = Date.now() - startTime;
  log.info("Cron", "Cleanup job finished", { durationMs: duration, status, results });

  return NextResponse.json({ results }, { status });
}
