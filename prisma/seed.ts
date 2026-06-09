import "dotenv/config";
import { PrismaClient, UserRole } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import bcrypt from "bcryptjs";

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
 * Default SystemSetting rows for a fresh self-host deployment.
 *
 * Always upserted with an EMPTY `update: {}` so re-running the seed never
 * clobbers values an operator has changed in the admin console — it only fills
 * in rows that don't exist yet. Defaults match the project default deployment
 * (English UI, MYR currency, the 6-locale region set, green theme).
 */
const DEFAULT_SETTINGS: Record<string, string> = {
  maintenance_mode: "false",
  app_name: "Restaurant",
  currency: "MYR",
  default_locale: "en",
  canonical_locale: "en",
  enabled_locales: "en,th,vi,zh-CN,zh-TW,ms",
  brand_theme: "green",
};

async function main() {
  const pw1 = process.env.SEED_SUPERADMIN_PASSWORD;
  const pw2 = process.env.SEED_DEV_PASSWORD;

  // Dual-path admin seeding:
  //   - BOTH dev passwords set → create the local dev SUPERADMIN logins.
  //   - Either unset → create NO admin users (production self-host relies on the
  //     first-run /admin/setup wizard to register the first admin). Do NOT throw.
  if (pw1 && pw2) {
    const hash1 = await bcrypt.hash(pw1, 12);
    const hash2 = await bcrypt.hash(pw2, 12);

    await prisma.user.upsert({
      where: { username: "superadminxyz" },
      update: {},
      create: {
        username: "superadminxyz",
        password: hash1,
        role: UserRole.SUPERADMIN,
      },
    });

    await prisma.user.upsert({
      where: { username: "devxyz" },
      update: {},
      create: {
        username: "devxyz",
        password: hash2,
        role: UserRole.SUPERADMIN,
      },
    });

    console.log("Seeded dev SUPERADMIN users (superadminxyz, devxyz).");
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
