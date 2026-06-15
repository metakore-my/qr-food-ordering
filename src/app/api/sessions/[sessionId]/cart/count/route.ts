import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { log } from "@/lib/logger";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    const cookieStore = await cookies();
    const cookieSessionId = cookieStore.get("session_id")?.value;

    if (!cookieSessionId || cookieSessionId !== sessionId) {
      return NextResponse.json(
        { error: "Unauthorized: session mismatch" },
        { status: 401 }
      );
    }

    const deviceId = cookieStore.get("device_id")?.value;
    if (!deviceId) {
      return NextResponse.json(
        { error: "Missing device_id" },
        { status: 400 }
      );
    }

    const { _sum } = await prisma.cartItem.aggregate({
      where: { sessionId, deviceId },
      _sum: { quantity: true },
    });

    return NextResponse.json({ count: _sum.quantity ?? 0 });
  } catch (error) {
    log.error("Cart", "Failed to get cart count", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to get cart count", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
