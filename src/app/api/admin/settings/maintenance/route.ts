import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { invalidateMaintenanceCache } from "@/lib/maintenance";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: "maintenance_mode" },
  });

  return NextResponse.json({ enabled: setting?.value === "true" }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { enabled, password } = body as { enabled?: boolean; password?: string };

  if (typeof enabled !== "boolean" || typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Verify password
  const user = await prisma.user.findUnique({
    where: { id: Number(session.user.id) },
    select: { password: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  await prisma.systemSetting.upsert({
    where: { key: "maintenance_mode" },
    update: { value: String(enabled) },
    create: { key: "maintenance_mode", value: String(enabled) },
  });

  invalidateMaintenanceCache();

  return NextResponse.json({ enabled });
}
