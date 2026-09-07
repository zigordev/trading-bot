#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f docker/compose.ci.yml)

cleanup() {
  "${compose[@]}" down -v --remove-orphans
}
trap cleanup EXIT

"${compose[@]}" up -d --wait postgres

DB_HOST=127.0.0.1 DB_PORT=15432 DB_USER=trading_bot_admin DB_PASSWORD=secret DB_NAME=trading_bot \
  npm run test:integration -w @trading-bot/control-plane
