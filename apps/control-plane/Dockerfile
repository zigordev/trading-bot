FROM node:26-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/control-plane/package.json apps/control-plane/package.json
# HUSKY=0 and --ignore-scripts: the root `prepare` script installs git hooks
# and lives in scripts/, which this stage does not copy.
RUN HUSKY=0 npm ci -w @trading-bot/control-plane --ignore-scripts

FROM base AS build
COPY --from=deps /app/node_modules /app/node_modules
COPY package.json package-lock.json /app/
COPY apps/control-plane /app/apps/control-plane
WORKDIR /app/apps/control-plane
RUN npm run build

FROM node:26-alpine AS prod
WORKDIR /app/apps/control-plane
ENV NODE_ENV=production
# Pull the latest Alpine security patches at build time rather than waiting on
# the upstream node:24-alpine tag to be rebuilt, and drop the bundled npm CLI —
# this image only ever runs `node dist/main.js`, so npm/npx/corepack (and their
# own vendored, separately-versioned dependencies) are attack surface with no
# legitimate use here.
RUN apk upgrade --no-cache \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/control-plane/dist /app/apps/control-plane/dist
COPY apps/control-plane/package.json /app/apps/control-plane/package.json
COPY scripts/openbao-run.mjs /app/scripts/openbao-run.mjs
# The node image ships an unprivileged `node` user; every other Node image in
# the estate already runs as it.
USER node

EXPOSE 8080
CMD ["node", "dist/main.js"]

FROM prod AS local
