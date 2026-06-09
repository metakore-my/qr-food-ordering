import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

const createTableSchema = z.object({
  input: z.string().min(1),
});

const RANGE_RE = /^(\d+)(?:-(\d+))?$/;
const MAX_BATCH = 50;

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "tables")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tables = await prisma.table.findMany({
    orderBy: { id: "asc" },
  });

  return NextResponse.json(tables);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "tables")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createTableSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const match = RANGE_RE.exec(parsed.data.input.trim());
  if (!match) {
    return NextResponse.json(
      { error: "Invalid format. Use a number (e.g. 5) or range (e.g. 1-10)." },
      { status: 400 }
    );
  }

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : start;

  if (start <= 0 || end <= 0) {
    return NextResponse.json(
      { error: "Table numbers must be positive integers." },
      { status: 400 }
    );
  }

  if (start > end) {
    return NextResponse.json(
      { error: "Start must be less than or equal to end." },
      { status: 400 }
    );
  }

  if (end - start + 1 > MAX_BATCH) {
    return NextResponse.json(
      { error: `Maximum ${MAX_BATCH} tables per batch.` },
      { status: 400 }
    );
  }

  const numbers = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  const existing = await prisma.table.findMany({
    where: { number: { in: numbers } },
    select: { number: true },
  });
  const existingNumbers = new Set(existing.map((t) => t.number));
  const toCreate = numbers.filter((n) => !existingNumbers.has(n));
  const skipped = numbers.filter((n) => existingNumbers.has(n));

  const created = await prisma.$transaction(
    toCreate.map((num) => {
      const token = crypto.randomBytes(32).toString("hex");
      return prisma.table.create({ data: { number: num, token } });
    })
  );

  return NextResponse.json(
    { created, skipped },
    { status: created.length > 0 ? 201 : 200 }
  );
}
