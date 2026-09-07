# syntax=docker/dockerfile:1.7
# Build context: monorepo root.

FROM node:26-alpine AS deps
WORKDIR /repo
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
COPY apps/operator-console/package.json apps/operator-console/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json
# HUSKY=0 and --ignore-scripts: the root `prepare` script installs git hooks
# and lives in scripts/, which this stage does not copy.
RUN HUSKY=0 npm ci --workspaces --include-workspace-root --no-audit --no-fund --ignore-scripts

FROM node:26-alpine AS build
WORKDIR /repo
ARG NEXT_PUBLIC_CONTROL_PLANE_BASE_URL
ENV NEXT_PUBLIC_CONTROL_PLANE_BASE_URL=$NEXT_PUBLIC_CONTROL_PLANE_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY apps/operator-console ./apps/operator-console
COPY apps/control-plane/package.json apps/control-plane/package.json
RUN npm run build -w @trading-bot/operator-console

FROM node:26-alpine AS local
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
# Same hardening as the other Node runtime images this session: patch
# Alpine's OpenSSL at build time rather than waiting on the upstream tag, and
# drop the bundled npm/yarn CLIs — a standalone Next.js server has no
# legitimate use for either.
RUN apk upgrade --no-cache zlib libcrypto3 libssl3 \
 && apk add --no-cache wget \
 && addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 \
 && rm -rf /usr/local/lib/node_modules/npm /opt/yarn-v1.22.22 \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=build --chown=nextjs:nodejs /repo/apps/operator-console/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/operator-console/.next/static ./apps/operator-console/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/apps/operator-console/public ./apps/operator-console/public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1
CMD ["node", "apps/operator-console/server.js"]
