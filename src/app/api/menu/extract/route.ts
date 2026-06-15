import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { extractMenuItems } from "@/lib/openrouter";
import { sourceLocaleForExtraction } from "@/lib/menu-extraction";
import { getCapabilities } from "@/lib/integrations";
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/logger";

export const maxDuration = 60;

// NOTE: the Pages-Router `export const config = { api: { bodyParser } }` does
// nothing in an App Router route handler (Next ignores it). Body size is bounded
// instead by the Zod `.max(10)` images rule and the per-image MAX_IMAGE_SIZE
// check below — do not re-add a `config` export.
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB in base64 chars (approx)

const extractSchema = z.object({
  images: z
    .array(z.string().min(1))
    .min(1, "At least one image is required")
    .max(10, "Maximum 10 images"),
  // Existing category names are interpolated into the LLM system prompt, so cap
  // both the count and each string: prevents a token/cost blowup and limits the
  // raw text a caller can inject into the prompt. A menu with >100 categories is
  // not realistic; 100-char names match the category name cap elsewhere.
  existingCategories: z.array(z.string().max(100)).max(100).optional(),
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

  const parsed = extractSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // Validate image sizes (base64 string length ~ 4/3 * original bytes)
  for (const img of parsed.data.images) {
    const sizeEstimate = img.length * 0.75;
    if (sizeEstimate > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: "One or more images exceed 10MB" },
        { status: 400 }
      );
    }
  }

  try {
    const settings = await getSettings();
    const { currency, decimals } = settings;
    const sourceLocale = sourceLocaleForExtraction(settings);
    const items = await extractMenuItems(parsed.data.images, parsed.data.existingCategories, currency, decimals, sourceLocale);
    return NextResponse.json({ items });
  } catch (err) {
    log.error("Extract", "Menu extraction failed", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json(
      { error: "Menu extraction failed. Please try again." },
      { status: 502 }
    );
  }
}
