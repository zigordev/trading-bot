# syntax=docker/dockerfile:1.7
# Build context: monorepo root.

FROM node:20-alpine AS deps
WORKDIR /repo
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
COPY apps/operator-console/package.json apps/operator-console/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json
RUN npm ci --workspaces --include-workspace-root --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /repo
ARG NEXT_PUBLIC_CONTROL_PLANE_BASE_URL
ENV NEXT_PUBLIC_CONTROL_PLANE_BASE_URL=$NEXT_PUBLIC_CONTROL_PLANE_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY apps/operator-console ./apps/operator-console
COPY apps/control-plane/package.json apps/control-plane/package.json
RUN npm run build -w @trading-bot/operator-console

FROM node:20-alpine AS local
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache wget && addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=build --chown=nextjs:nodejs /repo/apps/operator-console/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/operator-console/.next/static ./apps/operator-console/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/apps/operator-console/public ./apps/operator-console/public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1
CMD ["node", "apps/operator-console/server.js"]
