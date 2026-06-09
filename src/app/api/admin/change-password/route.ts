import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { changePasswordSchema } from "@/lib/validations";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    const details: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "newPassword");
      if (!details[key]) details[key] = [];
      details[key].push(issue.message);
    }
    return NextResponse.json({ error: "Validation failed", details }, { status: 400 });
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: Number(session.user.id) },
    select: { id: true, password: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    return NextResponse.json(
      { error: "Incorrect password", details: { currentPassword: ["Incorrect password"] } },
      { status: 401 },
    );
  }

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "New password must be different", details: { newPassword: ["New password must be different from current password"] } },
      { status: 400 },
    );
  }

  const hashed = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed, tokenVersion: { increment: 1 } },
  });

  return NextResponse.json({ success: true });
}
