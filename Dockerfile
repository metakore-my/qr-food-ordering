FROM node:20-alpine AS base

# ── Install production dependencies only ──
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Build stage: install all deps + build Next.js ──
FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
# Turnstile site key is the only NEXT_PUBLIC_* config value still inlined at
# build time (the client CAPTCHA widget needs it). App name, currency, locales,
# and theme are runtime DB settings — no longer build args.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
RUN npm run build

# ── Production image ──
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Next.js standalone output (includes server.js + traced node_modules)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma: schema + migrations for `prisma migrate deploy`
COPY --from=builder /app/prisma ./prisma
# Prisma config file (used by prisma migrate deploy to read DATABASE_URL)
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Production node_modules — overlays standalone's traced modules with the
# full production dependency tree. This ensures prisma CLI, mariadb driver,
# @prisma/adapter-mariadb, dotenv, and all their transitive deps are present.
COPY --from=deps /app/node_modules ./node_modules

# Generated Prisma client — must come AFTER node_modules copy so it overwrites
# the un-generated @prisma/client from deps
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Next.js image optimization cache — must be writable by nextjs user
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next/cache

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
