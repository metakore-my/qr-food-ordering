import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { translateMenuItems } from "@/lib/openrouter";
import { getCapabilities } from "@/lib/integrations";
import { log } from "@/lib/logger";

export const maxDuration = 60;

const translateSchema = z.object({
  items: z
    .array(
      z.object({
        name_th: z.string().min(1),
        name_en: z.string().min(1),
        name_zh_CN: z.string().min(1),
      })
    )
    .min(1, "At least one item is required")
    .max(100, "Maximum 100 items"),
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
    const translations = await translateMenuItems(parsed.data.items);
    return NextResponse.json({ translations });
  } catch (err) {
    log.error("Translate", "Menu translation failed", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json(
      { error: "Translation failed. Please try again." },
      { status: 502 }
    );
  }
}
