import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { translateCategoryNames } from "@/lib/openrouter";
import { getCapabilities } from "@/lib/integrations";
import { log } from "@/lib/logger";

export const maxDuration = 60;

const translateSchema = z.object({
  names: z
    .array(z.string().min(1).max(100))
    .min(1, "At least one name is required")
    .max(50, "Maximum 50 names"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "menu")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // OpenRouter not configured — AI features are hidden client-side, but guard
  // here so a stale client can't call OpenRouter with an empty API key.
  if (!getCapabilities().hasOpenRouter) {
    return NextResponse.json(
      { error: "AI features are not configured" },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = translateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const translations = await translateCategoryNames(parsed.data.names);
    return NextResponse.json({ translations });
  } catch (err) {
    log.error("Translate", "Category translation failed", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json(
      { error: "Category translation failed. Please try again." },
      { status: 502 }
    );
  }
}
