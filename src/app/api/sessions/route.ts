import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getOrCreateSession } from "@/lib/session";
import { cookies } from "next/headers";

const createSessionSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createSessionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { session, table } = await getOrCreateSession(parsed.data.token);

    // Set session_id cookie
    const cookieStore = await cookies();
    cookieStore.set("session_id", session.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 4, // 4 hours
    });
    // Set device_id cookie if not already present (persists across sessions)
    if (!cookieStore.get("device_id")?.value) {
      cookieStore.set("device_id", randomUUID(), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365, // 1 year
      });
    }

    return NextResponse.json({
      session: {
        id: session.id,
        tableId: session.tableId,
        status: session.status,
        createdAt: session.createdAt,
      },
      table: {
        id: table.id,
        number: table.number,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create session";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
