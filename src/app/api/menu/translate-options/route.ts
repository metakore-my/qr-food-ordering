import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { translateOptionNames } from "@/lib/openrouter";
import { getCapabilities } from "@/lib/integrations";
import { KNOWN_LOCALES } from "@/lib/deployment-config";
import { log } from "@/lib/logger";

// Option-name translation uses deepseek-v4-flash with "xhigh" reasoning (60–120s+).
// Raised past the default 60s so the route doesn't cap a reasoning call mid-flight
// (helper uses a 280s abort when reasoning is on). Valid on a long-running Node host;
// on a 60s-capped serverless host, drop reasoning or use a background job.
export const maxDuration = 300;

// Option/choice names are short labels (capped at 100 in optionGroupSchema);
// bound them here too so a request can't ship unbounded text to the LLM. The
// choices array is capped (50 groups × unbounded choices would otherwise be a
// token/timeout blowup).
//
// Source-locale-aware shape: a single source `name` per group/choice + the
// locale they're written in.
const sourceNameSchema = z.object({ name: z.string().min(1).max(100) });

const newSchema = z.object({
  sourceLocale: z.enum(KNOWN_LOCALES as unknown as [string, ...string[]]),
  groups: z
    .array(
      z.object({
        ...sourceNameSchema.shape,
        choices: z.array(sourceNameSchema).min(1).max(50),
      })
    )
    .min(1, "At least one option group is required")
    .max(50, "Maximum 50 option groups"),
});

// Legacy trio shape — kept for backward compatibility with the AI import flow
// (treated as English-sourced).
const legacyNameSchema = z.object({
  name_th: z.string().min(1).max(100),
  name_en: z.string().min(1).max(100),
  name_zh_CN: z.string().min(1).max(100),
});

const legacySchema = z.object({
  groups: z
    .array(
      z.object({
        ...legacyNameSchema.shape,
        choices: z.array(legacyNameSchema).min(1).max(50),
      })
    )
    .min(1, "At least one option group is required")
    .max(50, "Maximum 50 option groups"),
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
  let resolvedInput: { groups: Array<{ name: string; choices: Array<{ name: string }> }> };
  let sourceLocale = "en";
  if (asNew.success) {
    resolvedInput = asNew.data;
    sourceLocale = asNew.data.sourceLocale;
  } else {
    const asLegacy = legacySchema.safeParse(body);
    if (!asLegacy.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: asNew.error.issues },
        { status: 400 }
      );
    }
    resolvedInput = {
      groups: asLegacy.data.groups.map((g) => ({
        name: g.name_en,
        choices: g.choices.map((c) => ({ name: c.name_en })),
      })),
    };
    sourceLocale = "en";
  }

  try {
    const result = await translateOptionNames(resolvedInput, sourceLocale);
    return NextResponse.json(result);
  } catch (err) {
    log.error("Translate", "Option translation failed", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json(
      { error: "Option translation failed. Please try again." },
      { status: 502 }
    );
  }
}
