FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/operator-console/package.json apps/operator-console/package.json
RUN npm ci -w @trading-bot/operator-console

FROM base AS build
ARG EXPO_PUBLIC_CONTROL_PLANE_BASE_URL=http://localhost:3020
ENV EXPO_PUBLIC_CONTROL_PLANE_BASE_URL=${EXPO_PUBLIC_CONTROL_PLANE_BASE_URL}
COPY --from=deps /app/node_modules /app/node_modules
COPY package.json package-lock.json /app/
COPY apps/operator-console /app/apps/operator-console
WORKDIR /app/apps/operator-console
RUN npm run build:web

FROM nginx:1.27-alpine AS prod
COPY apps/operator-console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/operator-console/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

FROM prod AS local
