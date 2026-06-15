import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { passwordSchema } from "@/lib/validations";
import {
  SETTING_KEYS,
  validateSettingsInput,
  invalidateSettingsCache,
  type SettingKey,
} from "@/lib/settings";
import { getCapabilities } from "@/lib/integrations";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { log } from "@/lib/logger";

/**
 * Setup may run ONLY when no users exist. Exported so the gate-flip invariant is
 * unit-testable; the authoritative guard is the count-then-create tx in POST.
 */
export function canRunSetup(adminCount: number): boolean {
  return adminCount === 0;
}

const setupSchema = z.object({
  username: z.string().min(1).max(50),
  password: passwordSchema,
  // partialRecord (not z.record): the wizard sends only a SUBSET of SETTING_KEYS.
  // z.record(z.enum(...)) treats the enum as exhaustive in Zod v4 and rejects it.
  settings: z.partialRecord(z.enum(SETTING_KEYS), z.string()).optional(),
  turnstileToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // 1. Validate credentials (same schema as the users API) + settings keys.
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: z.flattenError(parsed.error).fieldErrors },
      { status: 400 }
    );
  }

  const { username, password, settings, turnstileToken } = parsed.data;

  // 2. Verify Turnstile only when configured; skip otherwise so a CAPTCHA-less
  //    self-host can still complete the wizard.
  if (getCapabilities().hasTurnstile) {
    if (!turnstileToken || !(await verifyTurnstileToken(turnstileToken))) {
      return NextResponse.json(
        { error: "CAPTCHA verification failed", code: "TURNSTILE_FAILED" },
        { status: 400 }
      );
    }
  }

  // 3. Validate the settings fields before persisting.
  const settingsPatch = (settings ?? {}) as Partial<Record<SettingKey, string>>;
  const settingsCheck = validateSettingsInput(settingsPatch);
  if (!settingsCheck.ok) {
    return NextResponse.json(
      { error: settingsCheck.error ?? "Invalid settings" },
      { status: 400 }
    );
  }

  // canonical_locale is LOCKED after setup — so it MUST be persisted here, or it
  // resolves to the default "en" forever (unchangeable) even if the operator's
  // main language is something else. The shipped wizard always sends it, but a
  // hand-crafted setup POST might omit it; default it to default_locale (else the
  // first enabled locale) so a canonical row is always written. Mirrors the trio
  // resolution in validateSettingsInput.
  if (settingsPatch.canonical_locale === undefined) {
    const firstEnabled = settingsPatch.enabled_locales
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean)[0];
    const canon = settingsPatch.default_locale ?? firstEnabled;
    if (canon) settingsPatch.canonical_locale = canon;
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  try {
    // RACE GUARD: count-then-create must be in ONE tx (a bare count() outside is
    // a TOCTOU window). Mirrors the order-placement guard in security-hardening.md.
    await prisma.$transaction(async (tx) => {
      // Count only REAL admins (exclude seed accounts like `devxyz`) — mirrors
      // hasAnyAdmin(). Seeding a dev account must NOT close the wizard, so the
      // race-guard that lets the customer create the first real admin must also
      // ignore seed users. The `setup_completed` sentinel claim below still
      // closes the different-username race once setup runs.
      const count = await tx.user.count({ where: { isSeed: false } });
      if (!canRunSetup(count)) {
        throw new Error("SETUP_ALREADY_DONE");
      }

      // Claim the one-time `setup_completed` sentinel: `SystemSetting.key` is the
      // PK, so a concurrent second setup's create() throws P2002. This closes the
      // DIFFERENT-username gap (count() === 0 for both); the user count-then-create
      // only serializes same-username races. The seed never writes this key.
      try {
        await tx.systemSetting.create({
          data: { key: "setup_completed", value: "true" },
        });
      } catch {
        // P2002 → another setup already claimed the sentinel.
        throw new Error("SETUP_ALREADY_DONE");
      }

      await tx.user.create({
        data: {
          username,
          password: hashedPassword,
          role: "SUPERADMIN",
          permissions: "[]",
          isActive: true,
          // The wizard creates the customer's first REAL admin — explicitly
          // non-seed so it counts toward the gate and closes the wizard.
          isSeed: false,
        },
      });

      // Same tx as the admin create, so setup can't half-commit.
      for (const [key, value] of Object.entries(settingsPatch)) {
        if (value === undefined) continue;
        await tx.systemSetting.upsert({
          where: { key },
          create: { key, value: String(value) },
          update: { value: String(value) },
        });
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === "SETUP_ALREADY_DONE") {
      // Once ANY admin exists, setup is closed unconditionally.
      return NextResponse.json(
        { error: "Setup already completed", code: "SETUP_ALREADY_DONE" },
        { status: 403 }
      );
    }
    log.error("Setup", "First-admin creation failed", {
      error: e instanceof Error ? e.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Failed to complete setup", code: "SERVER_ERROR" },
      { status: 500 }
    );
  }

  // Bust the cache post-commit so the next request reads the new config.
  invalidateSettingsCache();

  return NextResponse.json({ ok: true }, { status: 201 });
}
