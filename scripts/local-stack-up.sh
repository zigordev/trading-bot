#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ENV_FILE="$REPO_ROOT/docker/.env.app.local"
APP_ENV_EXAMPLE_FILE="$REPO_ROOT/docker/.env.app.local.example"
APP_COMPOSE_FILE="$REPO_ROOT/docker/compose.app.local.yml"
OPENBAO_LOCAL_ADDR="http://localhost:8200"
SHARED_NETWORK="platform_ops_shared"
OPENBAO_KV_MOUNT="kv"
OPENBAO_SECRET_PATH="trading-bot"
OPENBAO_SECRET_FIELD="POSTGRES_PASSWORD"
DB_NAME="trading_bot"
DB_USER="trading_bot_admin"

read_env_var_from_file() {
  local file="$1"
  local key="$2"
  local line
  line="$(grep -E "^${key}=" "$file" | tail -n1 || true)"
  if [ -z "$line" ]; then
    printf ''
    return
  fi
  printf '%s' "${line#*=}"
}

unset_compose_shell_overrides() {
  local file="$1"
  while IFS='=' read -r key _; do
    unset "$key" || true
  done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$file" || true)
}

if [ ! -f "$APP_ENV_FILE" ]; then
  if [ ! -f "$APP_ENV_EXAMPLE_FILE" ]; then
    echo "Missing $APP_ENV_FILE and $APP_ENV_EXAMPLE_FILE." >&2
    exit 1
  fi
  cp "$APP_ENV_EXAMPLE_FILE" "$APP_ENV_FILE"
  echo "Created $APP_ENV_FILE from $APP_ENV_EXAMPLE_FILE"
fi

docker network create "$SHARED_NETWORK" >/dev/null 2>&1 || true

openbao_token="$(read_env_var_from_file "$APP_ENV_FILE" "OPENBAO_TOKEN")"
if [ -z "$openbao_token" ]; then
  echo "OPENBAO_TOKEN is required in $APP_ENV_FILE" >&2
  exit 1
fi
if [ "$openbao_token" = "CHANGE_ME_LOCAL_OPENBAO_TOKEN" ]; then
  echo "OPENBAO_TOKEN in $APP_ENV_FILE still has the example value. Update it before retrying." >&2
  exit 1
fi

unset_compose_shell_overrides "$APP_ENV_FILE"

echo "Using OpenBao path: ${OPENBAO_KV_MOUNT}/${OPENBAO_SECRET_PATH}"

echo "Waiting for OpenBao to become ready..."
i=1
openbao_code=""
while [ $i -le 60 ]; do
  openbao_code="$(curl -s -o /dev/null -w '%{http_code}' "$OPENBAO_LOCAL_ADDR/v1/sys/health" || true)"
  case "$openbao_code" in
    200|429|472|473|501|503)
      break
      ;;
  esac
  sleep 2
  i=$((i + 1))
done

if [ $i -gt 60 ]; then
  echo "OpenBao did not become ready in time. Start platform-ops local stack first." >&2
  exit 1
fi

case "$openbao_code" in
  200|429|472|473)
    echo "OpenBao is ready"
    ;;
  501)
    echo "OpenBao is uninitialized. Initialize/unseal it from platform-ops first." >&2
    exit 1
    ;;
  503)
    echo "OpenBao is sealed. Unseal it from platform-ops first." >&2
    exit 1
    ;;
  *)
    echo "Unexpected OpenBao health status: $openbao_code" >&2
    exit 1
    ;;
esac

secret_url="$OPENBAO_LOCAL_ADDR/v1/${OPENBAO_KV_MOUNT}/data/${OPENBAO_SECRET_PATH}"
secret_body_file="$(mktemp)"
trap 'rm -f "$secret_body_file"' EXIT

secret_code="$(curl -s -o "$secret_body_file" -w '%{http_code}' -H "X-Vault-Token: $openbao_token" "$secret_url" || true)"
if [ "$secret_code" != "200" ]; then
  if [ "$secret_code" = "404" ]; then
    echo "OpenBao secret path does not exist or is not readable with OPENBAO_TOKEN: ${OPENBAO_KV_MOUNT}/${OPENBAO_SECRET_PATH}" >&2
    echo "Create kv/trading-bot with POSTGRES_PASSWORD and verify the token policy from docs/local-first-start.md." >&2
  else
    echo "OpenBao secret path is not readable with OPENBAO_TOKEN (status=$secret_code): ${OPENBAO_KV_MOUNT}/${OPENBAO_SECRET_PATH}" >&2
  fi
  cat "$secret_body_file" >&2 || true
  exit 1
fi

REQUIRED_KEYS="$OPENBAO_SECRET_FIELD" SECRET_BODY_FILE="$secret_body_file" node -e '
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.env.SECRET_BODY_FILE, "utf8"));
const data = payload?.data?.data ?? {};
const missing = Array.from(new Set(process.env.REQUIRED_KEYS.split(",").map((value) => value.trim()).filter(Boolean)))
  .filter((key) => {
    const value = data[key];
    return value === undefined || value === null || String(value).trim().length === 0;
  });
if (missing.length > 0) {
  console.error(`OpenBao secret path is missing required keys: ${missing.join(", ")}`);
  process.exit(1);
}
'

postgres_password="$(
  OPENBAO_SECRET_FIELD="$OPENBAO_SECRET_FIELD" SECRET_BODY_FILE="$secret_body_file" node -e '
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.env.SECRET_BODY_FILE, "utf8"));
const value = payload?.data?.data?.[process.env.OPENBAO_SECRET_FIELD];
if (!value || String(value).trim().length === 0) {
  console.error(`OpenBao secret path is missing required key: ${process.env.OPENBAO_SECRET_FIELD}`);
  process.exit(1);
}
process.stdout.write(String(value));
'
)"
export POSTGRES_PASSWORD="$postgres_password"

echo "Ensuring PostgreSQL container is running for database: $DB_NAME"
docker compose --env-file "$APP_ENV_FILE" -f "$APP_COMPOSE_FILE" up -d postgres

i=1
while [ $i -le 60 ]; do
  if docker compose --env-file "$APP_ENV_FILE" -f "$APP_COMPOSE_FILE" exec -T postgres \
    sh -lc "pg_isready -U \"$DB_USER\" -d \"$DB_NAME\" >/dev/null 2>&1"; then
    break
  fi
  sleep 2
  i=$((i + 1))
done

if [ $i -gt 60 ]; then
  echo "Postgres did not become ready in time." >&2
  exit 1
fi

docker compose --env-file "$APP_ENV_FILE" -f "$APP_COMPOSE_FILE" up -d --build --force-recreate --remove-orphans

echo "trading-bot local stack started."
