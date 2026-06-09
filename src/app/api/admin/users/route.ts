import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { passwordSchema } from "@/lib/validations";
import { ASSIGNABLE_PERMISSIONS, parsePermissions } from "@/lib/permissions";
import bcrypt from "bcryptjs";
import { z } from "zod";

const createUserSchema = z.object({
  username: z.string().min(1).max(50),
  password: passwordSchema,
  role: z.enum(["ADMIN", "SUPERADMIN"]),
  permissions: z.array(z.enum(ASSIGNABLE_PERMISSIONS)).default([]),
});

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      role: true,
      permissions: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const serialized = users.map((user) => ({
    ...user,
    permissions: parsePermissions(user.permissions),
    createdAt: user.createdAt.toISOString(),
  }));

  return NextResponse.json(serialized, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { username, password, role, permissions } = parsed.data;

  // Check if username already exists
  const existing = await prisma.user.findFirst({ where: { username } });
  if (existing) {
    return NextResponse.json(
      { error: "Username already exists" },
      { status: 409 }
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  // SUPERADMIN always gets empty permissions (they bypass checks)
  const storedPermissions = role === "SUPERADMIN" ? [] : permissions;

  const user = await prisma.user.create({
    data: {
      username,
      password: hashedPassword,
      role,
      permissions: JSON.stringify(storedPermissions),
    },
    select: {
      id: true,
      username: true,
      role: true,
      permissions: true,
      isActive: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    { ...user, permissions: parsePermissions(user.permissions), createdAt: user.createdAt.toISOString() },
    { status: 201 }
  );
}
