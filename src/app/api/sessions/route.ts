import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getOrCreateSession, setSessionCookie } from "@/lib/session";
import { cookies } from "next/headers";
import { log } from "@/lib/logger";

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
    setSessionCookie(cookieStore, session.id);
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
    // Never echo the raw error to the client (token-format/signature/DB errors
    // all surface here). Log server-side and return a stable code. A bad/forged
    // token or inactive table is the only client-actionable case → INVALID_TABLE.
    log.warn("Session", "Failed to create session", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Invalid or inactive table", code: "INVALID_TABLE" },
      { status: 400 }
    );
  }
}
