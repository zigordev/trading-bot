FROM node:20-alpine AS base
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

FROM node:20-alpine AS prod
WORKDIR /app/apps/control-plane
ENV NODE_ENV=production
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/control-plane/dist /app/apps/control-plane/dist
COPY apps/control-plane/package.json /app/apps/control-plane/package.json
COPY scripts/openbao-run.mjs /app/scripts/openbao-run.mjs
EXPOSE 8080
CMD ["node", "dist/main.js"]

FROM prod AS local
