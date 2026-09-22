# syntax=docker/dockerfile:1

# ---- deps -------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
# Prisma needs OpenSSL on Alpine.
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build only needs a syntactically valid URL; nothing connects at build time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV AUTH_SECRET="build-time-placeholder-not-used-at-runtime-000"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Runs unprivileged: nothing in the app needs root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /app/.next ./.next
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/package.json ./package.json
# Migrations and the seed ship with the image so a release can apply its own.
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs
EXPOSE 3000

# Liveness plus a real database round trip.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.json()).then(j=>process.exit(j.status==='ok'?0:1)).catch(()=>process.exit(1))"

# Migrations run at start, not at build: the database only exists at runtime.
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p ${PORT}"]
