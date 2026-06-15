import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

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

function createPrismaClient() {
  const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL!);
  const adapter = new PrismaMariaDb({
    ...dbConfig,
    connectionLimit: 5,
    minimumIdle: 0,
    idleTimeout: 60,
    allowPublicKeyRetrieval: true,
    // UTC-storage invariant: pins the DB session time_zone to +00:00 and makes the
    // driver read naive DATETIMEs as UTC, so Date<->SQL round-trips stay correct.
    // The app process must ALSO run in UTC (the default on most container hosts —
    // do NOT set TZ=Asia/Bangkok). Display conversion happens only in src/lib/date.ts.
    timezone: "Z",
  });
  return new PrismaClient({ adapter });
}

function getPrismaClient() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return Reflect.get(getPrismaClient(), prop);
  },
});
