import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { translateMenuItems } from "@/lib/openrouter";
import { getCapabilities } from "@/lib/integrations";
import { KNOWN_LOCALES } from "@/lib/deployment-config";
import { log } from "@/lib/logger";

// Translation uses deepseek-v4-flash with "xhigh" reasoning, which thinks before
// answering and routinely runs 60–120s — well past the default 60s. Raised so the
// route doesn't cap a reasoning call mid-flight (the openrouter helper uses a 280s
// abort when reasoning is on). Valid on a long-running Node host; on a
// 60s-capped serverless host, drop reasoning or move translation to a background job.
export const maxDuration = 300;

// Name fields are capped (matching the categories-translate route) so a single
// request can't ship megabytes of text to the LLM — token cost scales with input
// length, and the 100-item array cap alone doesn't bound per-field size.
//
// Source-locale-aware shape: a single source `name` per item + the locale it's
// written in. The prompt names that locale as the source of truth.
const newSchema = z.object({
  sourceLocale: z.enum(KNOWN_LOCALES as unknown as [string, ...string[]]),
  items: z
    .array(z.object({ name: z.string().min(1).max(200) }))
    .min(1, "At least one item is required")
    .max(100, "Maximum 100 items"),
});

// Legacy trio shape — kept for backward compatibility with the AI import flow
// (treated as English-sourced).
const legacySchema = z.object({
  items: z
    .array(
      z.object({
        name_th: z.string().min(1).max(200),
        name_en: z.string().min(1).max(200),
        name_zh_CN: z.string().min(1).max(200),
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

  // Accept both shapes: the new source-locale-aware shape, falling back to the
  // legacy English-sourced trio (the AI import flow).
  const asNew = newSchema.safeParse(body);
  let items: Array<{ name: string }>;
  let sourceLocale = "en";
  if (asNew.success) {
    items = asNew.data.items;
    sourceLocale = asNew.data.sourceLocale;
  } else {
    const asLegacy = legacySchema.safeParse(body);
    if (!asLegacy.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: asNew.error.issues },
        { status: 400 }
      );
    }
    items = asLegacy.data.items.map((i) => ({ name: i.name_en }));
    sourceLocale = "en";
  }

  try {
    const translations = await translateMenuItems(items, sourceLocale);
    return NextResponse.json({ translations });
  } catch (err) {
    log.error("Translate", "Menu translation failed", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json(
      { error: "Translation failed. Please try again." },
      { status: 502 }
    );
  }
}
