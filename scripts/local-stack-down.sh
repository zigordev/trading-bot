#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ENV_FILE="$REPO_ROOT/docker/.env.app.local"
APP_COMPOSE_FILE="$REPO_ROOT/docker/compose.app.local.yml"

if [ ! -f "$APP_ENV_FILE" ]; then
  echo "Missing required local env file: $APP_ENV_FILE"
  echo "Create it from docker/.env.app.local.example first."
  exit 1
fi

if [ "${1:-}" = "--volumes" ]; then
  docker compose --env-file "$APP_ENV_FILE" -f "$APP_COMPOSE_FILE" down --volumes
else
  docker compose --env-file "$APP_ENV_FILE" -f "$APP_COMPOSE_FILE" down
fi

echo "trading-bot local infrastructure is down."
