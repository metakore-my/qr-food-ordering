import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { signTableToken } from "@/lib/qr";
import { hasPermission } from "@/lib/permissions";

export async function GET(
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

  const table = await prisma.table.findUnique({ where: { id } });
  if (!table) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }

  const signed = signTableToken(table.id, table.token);

  return NextResponse.json({ signedToken: signed });
}
