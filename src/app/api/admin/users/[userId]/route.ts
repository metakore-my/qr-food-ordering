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

// Thrown inside the update/delete transaction when the operation would remove
// the last active SUPERADMIN. Caught at the route boundary → 409 LAST_SUPERADMIN.
class LastSuperadminError extends Error {}

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

  // A SUPERADMIN may edit itself (the only superadmin a superadmin can edit), so
  // a self-PATCH that demotes (role → ADMIN) or deactivates (isActive: false)
  // could remove the LAST active SUPERADMIN and lock the deployment out of
  // /admin/users, /admin/settings, and maintenance with no recovery path
  // (setup is permanently closed once any user exists). Refuse if this change
  // would drop the active-SUPERADMIN count to zero. Counted inside the update
  // transaction so a concurrent demotion of a peer can't race past the floor.
  const wouldRemoveSuperadmin =
    existing.role === "SUPERADMIN" &&
    ((role !== undefined && role !== "SUPERADMIN") || isActive === false);

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

  // Bump tokenVersion whenever this change alters what a live JWT is allowed to
  // do — password, role, permissions, OR deactivation. The auth.ts jwt callback
  // only re-reads isActive + tokenVersion per request (role/permissions are
  // frozen at sign-in), so WITHOUT this bump a demoted superadmin or a
  // permission-revoked admin would keep their old privileges on their current
  // token until it naturally expires. The tokenVersion mismatch forces re-auth.
  const authzChanged =
    password !== undefined ||
    (role !== undefined && role !== existing.role) ||
    data.permissions !== undefined ||
    isActive === false;
  if (authzChanged) {
    data.tokenVersion = { increment: 1 };
  }

  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      if (wouldRemoveSuperadmin) {
        const remaining = await tx.user.count({
          where: { role: "SUPERADMIN", isActive: true, id: { not: id } },
        });
        if (remaining === 0) {
          throw new LastSuperadminError();
        }
      }
      return tx.user.update({
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
    });
  } catch (err) {
    if (err instanceof LastSuperadminError) {
      return NextResponse.json(
        { error: "Cannot remove the last superadmin", code: "LAST_SUPERADMIN" },
        { status: 409 }
      );
    }
    throw err;
  }

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

  // Deactivating self when self is the last active SUPERADMIN would lock the
  // deployment out with no recovery path — same floor guard as PATCH. Count +
  // update run in one transaction so a concurrent peer-removal can't race past.
  try {
    await prisma.$transaction(async (tx) => {
      if (existing.role === "SUPERADMIN") {
        const remaining = await tx.user.count({
          where: { role: "SUPERADMIN", isActive: true, id: { not: id } },
        });
        if (remaining === 0) {
          throw new LastSuperadminError();
        }
      }
      // Soft delete: set isActive to false. Bump tokenVersion too so any live
      // JWT for this user is force-invalidated on its next request (the jwt
      // callback's isActive re-check already catches this within the 30s cache
      // TTL; the bump makes it deterministic and immediate).
      await tx.user.update({
        where: { id },
        data: { isActive: false, tokenVersion: { increment: 1 } },
      });
    });
  } catch (err) {
    if (err instanceof LastSuperadminError) {
      return NextResponse.json(
        { error: "Cannot remove the last superadmin", code: "LAST_SUPERADMIN" },
        { status: 409 }
      );
    }
    throw err;
  }

  return NextResponse.json({ success: true });
}
