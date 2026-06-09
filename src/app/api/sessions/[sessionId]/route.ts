import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { cookies } from "next/headers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  // Validate the session_id cookie matches the requested session
  const cookieStore = await cookies();
  const cookieSessionId = cookieStore.get("session_id")?.value;

  if (!cookieSessionId || cookieSessionId !== sessionId) {
    return NextResponse.json(
      { error: "Unauthorized: session mismatch" },
      { status: 401 }
    );
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      table: {
        select: { id: true, number: true },
      },
      orders: {
        include: {
          items: {
            include: {
              menuItem: {
                select: { id: true, price: true, imageUrl: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      cartItems: {
        include: {
          menuItem: {
            select: { id: true, price: true, imageUrl: true },
          },
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json(session);
}

const updateSessionSchema = z.object({
  status: z.enum(["CHECKED_OUT", "EXPIRED"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  // Admin auth required for status changes
  const adminSession = await auth();
  if (!adminSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateSessionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const existing = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Validate status transition
  const VALID_TRANSITIONS: Record<string, string[]> = {
    ACTIVE: ["CHECKED_OUT", "EXPIRED"],
    CHECKED_OUT: ["EXPIRED"],
  };
  const allowed = VALID_TRANSITIONS[existing.status];
  if (!allowed || !allowed.includes(parsed.data.status)) {
    return NextResponse.json(
      { error: `Cannot transition from ${existing.status} to ${parsed.data.status}` },
      { status: 409 }
    );
  }

  const session = await prisma.session.update({
    where: { id: sessionId },
    data: { status: parsed.data.status },
    include: {
      table: {
        select: { id: true, number: true },
      },
    },
  });

  return NextResponse.json(session);
}
