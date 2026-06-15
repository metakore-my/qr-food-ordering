import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { serializeMenuBackup } from "@/lib/menu-backup";
import { log } from "@/lib/logger";

/**
 * Menu backup download — SUPERADMIN only (mirrors the settings route gate).
 * Returns the full menu tree (categories/items/options/choices + all
 * translations) as a downloadable JSON file. Menu data ONLY — no orders.
 */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const categories = await prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        names: true,
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            names: true,
            optionGroups: {
              orderBy: { sortOrder: "asc" },
              include: {
                names: true,
                choices: {
                  orderBy: { sortOrder: "asc" },
                  include: { names: true },
                },
              },
            },
          },
        },
      },
    });

    const { appName } = await getSettings();
    const exportedAt = new Date().toISOString();
    const envelope = serializeMenuBackup(categories, { exportedAt, appName });

    const slug =
      appName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "menu";
    const datePart = exportedAt.slice(0, 10); // YYYY-MM-DD
    const filename = `menu-backup-${slug}-${datePart}.json`;

    return new NextResponse(JSON.stringify(envelope, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    log.error("MenuBackup", "Failed to build menu backup", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
