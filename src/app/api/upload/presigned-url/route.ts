import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createPresignedUploadUrl } from "@/lib/r2";
import { hasPermission } from "@/lib/permissions";
import { getCapabilities } from "@/lib/integrations";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

const presignedUrlSchema = z.object({
  contentType: z.enum(ALLOWED_TYPES),
  fileSize: z.number().int().positive().max(MAX_SIZE),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user.role, session.user.permissions ?? [], "menu")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // R2 storage not wired on this deployment — the client hides upload controls,
  // but guard here too so a stale client can't trigger a broken upload.
  if (!getCapabilities().hasR2) {
    return NextResponse.json(
      { error: "Image uploads are not configured" },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = presignedUrlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const result = await createPresignedUploadUrl(parsed.data.contentType);
  return NextResponse.json(result);
}
