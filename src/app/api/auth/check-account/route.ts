import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { getCapabilities } from "@/lib/integrations";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  // Rate limit by IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = await request.json();

  // Verify turnstile — only when CAPTCHA is configured on this deployment.
  // When unset (hasTurnstile === false), this pre-check skips verification so
  // login works with rate-limit + bcrypt only (mirrors auth.ts authorize).
  if (getCapabilities().hasTurnstile) {
    if (!body.turnstileToken || !(await verifyTurnstileToken(body.turnstileToken))) {
      return NextResponse.json({ error: "captcha_failed" }, { status: 403 });
    }
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  // Look up user WITHOUT isActive filter
  const user = await prisma.user.findFirst({
    where: { username: parsed.data.username },
  });

  if (!user) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const valid = await bcrypt.compare(parsed.data.password, user.password);
  if (!valid) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  // Return same error for deactivated accounts to prevent account enumeration
  if (!user.isActive) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
