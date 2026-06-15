import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { translateCategoryNames } from "@/lib/openrouter";
import { getCapabilities } from "@/lib/integrations";
import { KNOWN_LOCALES } from "@/lib/deployment-config";
import { log } from "@/lib/logger";

// translateCategoryNames uses xhigh reasoning (deepseek-v4-flash, 60–120s+); the
// helper's abort is 280s when reasoning is set, so raise the route ceiling to
// match (mirrors the two menu translate routes — see OpenRouter Timeout rule).
export const maxDuration = 300;

const translateSchema = z.object({
  // Source language of the category names being translated. Backward-compatible:
  // an omitted value defaults to English (the legacy import-flow assumption).
  sourceLocale: z
    .enum(KNOWN_LOCALES as unknown as [string, ...string[]])
    .optional(),
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
    const translations = await translateCategoryNames(
      parsed.data.names,
      parsed.data.sourceLocale ?? "en"
    );
    return NextResponse.json({ translations });
  } catch (err) {
    log.error("Translate", "Category translation failed", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json(
      { error: "Category translation failed. Please try again." },
      { status: 502 }
    );
  }
}
