import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { loginSchema } from "./validations";
import { parsePermissions } from "./permissions";
import { verifyTurnstileToken } from "./turnstile";
import { getCapabilities } from "./integrations";
import { checkRateLimit } from "./rate-limit";
import { log } from "./logger";

// Short-lived JWT-validation cache to cut DB hits. globalThis-guarded so dev HMR
// reuses the same Map instead of leaking one per reload.
const globalForAuth = globalThis as unknown as {
  jwtCache?: Map<string, { isActive: boolean; tokenVersion: number; ts: number }>;
};
const jwtCache =
  globalForAuth.jwtCache ??
  (globalForAuth.jwtCache = new Map<
    string,
    { isActive: boolean; tokenVersion: number; ts: number }
  >());
const JWT_CACHE_TTL_MS = 30_000; // 30 seconds
const JWT_CACHE_MAX_SIZE = 1_000;

function cleanupJwtCache() {
  const now = Date.now();
  for (const [key, entry] of jwtCache) {
    if (now - entry.ts > JWT_CACHE_TTL_MS) {
      jwtCache.delete(key);
    }
  }
  // Safety valve: evict oldest half if still too large
  if (jwtCache.size > JWT_CACHE_MAX_SIZE) {
    const sorted = Array.from(jwtCache.entries())
      .sort(([, a], [, b]) => a.ts - b.ts);
    const toEvict = sorted.slice(0, Math.floor(sorted.length / 2));
    for (const [key] of toEvict) {
      jwtCache.delete(key);
    }
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Host trust is opt-in, NOT hardcoded — the template ships to unknown hosts and
  // Auth.js builds redirect URLs from the host header, safe only behind a trusted
  // proxy. Proxied deploys set AUTH_TRUST_HOST=true; bare hosts get the safe
  // default + a loud UntrustedHost error. Do NOT re-hardcode trustHost: true.
  trustHost: process.env.AUTH_TRUST_HOST === "true",
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
        turnstileToken: { label: "Turnstile", type: "text" },
      },
      authorize: async (credentials) => {
        const username = (credentials?.username as string) || "unknown";
        log.info("Auth", "Login attempt", { username });

        // Rate limit by username to prevent brute-force
        if (!checkRateLimit(`auth:${username}`)) {
          log.warn("Auth", "Login rate-limited", { username });
          return null;
        }

        // Verify Turnstile token — only when CAPTCHA is configured on this
        // deployment. When the secret is unset (hasTurnstile === false), login
        // proceeds with rate-limit + bcrypt only. Mirrors the setup route.
        if (getCapabilities().hasTurnstile) {
          const token = credentials?.turnstileToken as string | undefined;
          if (!token || !(await verifyTurnstileToken(token))) {
            log.warn("Auth", "Login failed: Turnstile verification", { username });
            return null;
          }
        }

        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          log.warn("Auth", "Login failed: validation error", { username });
          return null;
        }

        const user = await prisma.user.findFirst({
          where: { username: parsed.data.username, isActive: true },
        });
        if (!user) {
          log.warn("Auth", "Login failed: user not found", { username: parsed.data.username });
          return null;
        }

        const valid = await bcrypt.compare(parsed.data.password, user.password);
        if (!valid) {
          log.warn("Auth", "Login failed: bad password", { username: parsed.data.username });
          return null;
        }

        log.info("Auth", "Login success", { username: user.username, role: user.role });
        return {
          id: String(user.id),
          name: user.username,
          role: user.role,
          permissions: parsePermissions(user.permissions),
          tokenVersion: user.tokenVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.permissions = user.permissions;
        token.tokenVersion = user.tokenVersion;
      }

      // Check if user is still active and tokenVersion matches on every request
      // Returning null clears the session cookie via sessionStore.clean()
      if (token.sub) {
        cleanupJwtCache();
        const now = Date.now();
        const cached = jwtCache.get(token.sub);
        let isActive: boolean;
        let tokenVersion: number;

        if (cached && now - cached.ts < JWT_CACHE_TTL_MS) {
          isActive = cached.isActive;
          tokenVersion = cached.tokenVersion;
        } else {
          const dbUser = await prisma.user.findFirst({
            where: { id: parseInt(token.sub, 10) },
            select: { isActive: true, tokenVersion: true },
          });
          if (!dbUser) return null;
          isActive = dbUser.isActive;
          tokenVersion = dbUser.tokenVersion;
          jwtCache.set(token.sub, { isActive, tokenVersion, ts: now });
        }

        if (!isActive) {
          log.warn("Auth", "JWT rejected: user deactivated", { userId: token.sub });
          return null;
        }
        if (tokenVersion !== token.tokenVersion) {
          log.warn("Auth", "JWT rejected: token version mismatch", { userId: token.sub });
          return null;
        }
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role;
        session.user.permissions = token.permissions;
      }
      return session;
    },
  },
  pages: {
    signIn: "/admin/login",
  },
});
