import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import crypto from "crypto";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("Error: DATABASE_URL is not set in .env");
  process.exit(1);
}

let parsed: URL;
try {
  parsed = new URL(dbUrl);
} catch {
  console.error(
    `Error: DATABASE_URL is not a valid URL.\n  Current value: ${dbUrl}\n  Expected format: mysql://user:password@host:port/database`
  );
  process.exit(1);
}

const adapter = new PrismaMariaDb({
  host: parsed.hostname,
  port: parseInt(parsed.port, 10) || 3306,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.replace(/^\//, ""),
  connectionLimit: 5,
});
const prisma = new PrismaClient({ adapter });

const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
const tableNumber = parseInt(process.argv[2] ?? "0", 10);
if (!tableNumber) {
  console.error("Usage: npx tsx scripts/get-table-url.ts <table-number>");
  process.exit(1);
}

function signTableToken(tableId: number, tableToken: string): string {
  const secret = process.env.QR_SECRET!;
  const payload = `${tableId}:${tableToken}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

async function main() {
  const table = await prisma.table.findUnique({ where: { number: tableNumber } });
  if (!table) {
    console.log(`Table ${tableNumber} not found in DB`);
    await prisma.$disconnect();
    return;
  }
  const signed = signTableToken(table.id, table.token);
  console.log(`${baseUrl}/table/${signed}`);
  await prisma.$disconnect();
}

main();
