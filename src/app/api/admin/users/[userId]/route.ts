import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { ASSIGNABLE_PERMISSIONS, parsePermissions } from "@/lib/permissions";
import { passwordSchema } from "@/lib/validations";
import { z } from "zod";
import bcrypt from "bcryptjs";

const updateUserSchema = z.object({
  role: z.enum(["ADMIN", "SUPERADMIN"]).optional(),
  isActive: z.boolean().optional(),
  permissions: z.array(z.enum(ASSIGNABLE_PERMISSIONS)).optional(),
  password: passwordSchema.optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await params;
  const id = parseInt(userId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { role, isActive, permissions, password } = parsed.data;

  // Check if user exists
  const existing = await prisma.user.findFirst({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Cannot edit other SUPERADMIN accounts
  if (existing.role === "SUPERADMIN" && String(existing.id) !== session.user?.id) {
    return NextResponse.json({ error: "Cannot edit other superadmin accounts" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (role !== undefined) data.role = role;
  if (isActive !== undefined) data.isActive = isActive;
  if (password !== undefined) {
    const same = await bcrypt.compare(password, existing.password);
    if (same) {
      return NextResponse.json(
        { error: "New password must be different", details: { password: ["New password must be different from current password"] } },
        { status: 400 }
      );
    }
    data.password = await bcrypt.hash(password, 12);
    data.tokenVersion = { increment: 1 };
  }

  // Determine effective role (updated or existing)
  const effectiveRole = role ?? existing.role;
  if (permissions !== undefined) {
    // SUPERADMIN always gets empty permissions
    data.permissions = JSON.stringify(effectiveRole === "SUPERADMIN" ? [] : permissions);
  } else if (role === "SUPERADMIN") {
    // Changing to SUPERADMIN clears permissions
    data.permissions = JSON.stringify([]);
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      username: true,
      role: true,
      permissions: true,
      isActive: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    ...user,
    permissions: parsePermissions(user.permissions),
    createdAt: user.createdAt.toISOString(),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await params;
  const id = parseInt(userId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  const existing = await prisma.user.findFirst({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Cannot deactivate other SUPERADMIN accounts
  if (existing.role === "SUPERADMIN" && String(existing.id) !== session.user?.id) {
    return NextResponse.json({ error: "Cannot deactivate other superadmin accounts" }, { status: 403 });
  }

  // Soft delete: set isActive to false
  await prisma.user.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}
