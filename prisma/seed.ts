import "dotenv/config";
import { PrismaClient, UserRole } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import bcrypt from "bcryptjs";
import { assertValidSeedPassword } from "../src/lib/validations";
import { KNOWN_LOCALES } from "../src/lib/deployment-config";

function parseDatabaseUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
  };
}

const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL!);
const adapter = new PrismaMariaDb({
  ...dbConfig,
  connectionLimit: 5,
  // Store DATETIME columns as UTC regardless of the machine running the seed
  // (an operator's laptop may not be in UTC). Matches src/lib/prisma.ts.
  timezone: "Z",
});
const prisma = new PrismaClient({ adapter });

/**
 * The pre-wizard main locale follows `NEXT_PUBLIC_DEFAULT_LOCALE` — the single
 * config env var and the edge URL-root locale (see CLAUDE.md / routing.ts). The
 * seed's `default_locale` + `canonical_locale` MUST agree with it: otherwise a
 * `NEXT_PUBLIC_DEFAULT_LOCALE=ms` deploy edge-routes `/` → `/ms` but the seeded
 * DB says the main/canonical locale is `en`, so the (pre-setup) wizard renders
 * English-canonical on a `/ms/...` URL. Falls back to `en` when the env var is
 * unset or not a KNOWN_LOCALE. The chosen locale is also forced into
 * `enabled_locales` so the main language can never be a disabled one.
 */
const DEFAULT_LOCALE = (() => {
  const raw = process.env.NEXT_PUBLIC_DEFAULT_LOCALE?.trim();
  return raw && (KNOWN_LOCALES as readonly string[]).includes(raw) ? raw : "en";
})();

const ENABLED_LOCALES = (() => {
  // Full region set, but guarantee the chosen main locale is present + first.
  const rest = KNOWN_LOCALES.filter((l) => l !== DEFAULT_LOCALE);
  return [DEFAULT_LOCALE, ...rest].join(",");
})();

/**
 * The generic "restaurant" noun per locale — the pre-wizard default app name.
 * `app_name` is seeded in the deployment's DEFAULT_LOCALE and `app_name_i18n`
 * carries the OTHER enabled locales, so every language tab shows a sensible
 * localized default (Restoran / ร้านอาหาร / 餐厅 …) until the operator sets a
 * real name in the wizard. Covers all KNOWN_LOCALES.
 */
const RESTAURANT_NAME: Record<string, string> = {
  en: "Restaurant",
  ms: "Restoran",
  th: "ร้านอาหาร",
  vi: "Nhà hàng",
  "zh-CN": "餐厅",
  "zh-TW": "餐廳",
};

const APP_NAME = RESTAURANT_NAME[DEFAULT_LOCALE] ?? "Restaurant";

// Per-locale names for every enabled locale EXCEPT the default (whose name lives
// in `app_name`). Mirrors the wizard/settings shape: a JSON map keyed by enabled
// non-default locales. `resolveAppName` falls back to `app_name` for any locale
// missing here.
const APP_NAME_I18N = JSON.stringify(
  Object.fromEntries(
    ENABLED_LOCALES.split(",")
      .filter((loc) => loc !== DEFAULT_LOCALE && RESTAURANT_NAME[loc])
      .map((loc) => [loc, RESTAURANT_NAME[loc]])
  )
);

/**
 * Default SystemSetting rows for a fresh self-host deployment.
 *
 * Always upserted with an EMPTY `update: {}` so re-running the seed never
 * clobbers values an operator has changed in the admin console — it only fills
 * in rows that don't exist yet. Defaults match the project default deployment
 * (MYR currency, the 6-locale region set, green theme); the main/canonical
 * locale follows NEXT_PUBLIC_DEFAULT_LOCALE (see DEFAULT_LOCALE above).
 */
const DEFAULT_SETTINGS: Record<string, string> = {
  maintenance_mode: "false",
  app_name: APP_NAME,
  app_name_i18n: APP_NAME_I18N,
  currency: "MYR",
  default_locale: DEFAULT_LOCALE,
  canonical_locale: DEFAULT_LOCALE,
  enabled_locales: ENABLED_LOCALES,
  brand_theme: "green",
};

async function main() {
  const pw1 = process.env.SEED_SUPERADMIN_PASSWORD;
  const pw2 = process.env.SEED_DEV_PASSWORD;

  // Admin seeding is per-password — each var seeds its own SUPERADMIN when it
  // holds a value:
  //   - SEED_SUPERADMIN_PASSWORD set → seed the `superadminxyz` SUPERADMIN.
  //   - SEED_DEV_PASSWORD set        → seed the `devxyz` SUPERADMIN.
  // The two are independent (set one, both, or neither). When BOTH are unset the
  // DB stays empty and the first-run /admin/setup wizard shows to the first
  // visitor at /admin, who registers the first admin themselves. Do NOT throw.

  // Validate BOTH passwords up front — before any DB write — so an invalid value
  // fails fast (and atomically) instead of seeding one admin then throwing on the
  // other, leaving a half-seeded DB. Empty/unset values are skipped (not an error).
  if (pw1) assertValidSeedPassword("SEED_SUPERADMIN_PASSWORD", pw1);
  if (pw2) assertValidSeedPassword("SEED_DEV_PASSWORD", pw2);

  const seeded: string[] = [];

  if (pw1) {
    const hash1 = await bcrypt.hash(pw1, 12);
    await prisma.user.upsert({
      where: { username: "superadminxyz" },
      update: {},
      create: {
        username: "superadminxyz",
        password: hash1,
        role: UserRole.SUPERADMIN,
        // Seed account: flagged so it does NOT close the /admin/setup wizard —
        // the customer still creates their own first real admin. See first-admin.ts.
        isSeed: true,
      },
    });
    seeded.push("superadminxyz");
  }

  if (pw2) {
    const hash2 = await bcrypt.hash(pw2, 12);
    await prisma.user.upsert({
      where: { username: "devxyz" },
      update: {},
      create: {
        username: "devxyz",
        password: hash2,
        role: UserRole.SUPERADMIN,
        // Seed account: flagged so it does NOT close the /admin/setup wizard —
        // the customer still creates their own first real admin. See first-admin.ts.
        isSeed: true,
      },
    });
    seeded.push("devxyz");
  }

  if (seeded.length > 0) {
    console.log(`Seeded SUPERADMIN user(s): ${seeded.join(", ")}.`);
  } else {
    console.log(
      "SEED_SUPERADMIN_PASSWORD / SEED_DEV_PASSWORD unset — skipping admin seeding " +
      "(use the /admin/setup wizard to register the first admin)."
    );
  }

  // Always ensure default system settings exist (never clobber existing values).
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }

  console.log("Ensured default system settings.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
