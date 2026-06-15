import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

const updateTableSchema = z.object({
  number: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "tables")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { tableId } = await params;
  const id = parseInt(tableId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid table ID" }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateTableSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const existing = await prisma.table.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }

  const table = await prisma.table.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(table);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "tables")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { tableId } = await params;
  const id = parseInt(tableId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid table ID" }, { status: 400 });
  }

  const existing = await prisma.table.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }

  const table = await prisma.table.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json(table);
}
