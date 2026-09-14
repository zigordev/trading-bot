#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CONFIG_FILE="scripts/local-stack.config.sh"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Missing $CONFIG_FILE" >&2
  exit 1
fi

APP_LABEL=""
APP_ENV_FILE=""
APP_ENV_EXAMPLE_FILE=""
COMPOSE_FILES=()
DEV_COMPOSE_FILES=()
SHARED_NETWORK="platform_ops_shared"
OPENBAO_LOCAL_ADDR="http://localhost:8200"
OPENBAO_KV_MOUNT="kv"
OPENBAO_SECRET_PATH=""
OPENBAO_REQUIRED_KEYS=""
OPENBAO_EXPORT_KEYS=""
OPENBAO_RUN="scripts/openbao-run.mjs"
DB_SERVICE=""
DB_USER=""
DB_NAME=""
DB_BOOTSTRAP_DB=""
TOLGEE_LOCAL_ADDR="http://localhost:8090"
TOLGEE_SYNC="none"
TOLGEE_WORKSPACE=""
RESET_MODE="volumes"
RESET_HOOKS=()
READY_MESSAGE=""
READY_URLS=()

. "$CONFIG_FILE"

compose_args() {
  local file
  if [ -n "$APP_ENV_FILE" ] && [ -f "$APP_ENV_FILE" ]; then
    printf '%s\n' "--env-file" "$APP_ENV_FILE"
  fi
  for file in ${COMPOSE_FILES[@]+"${COMPOSE_FILES[@]}"}; do
    printf '%s\n' "-f" "$file"
  done
  if [ "${1:-}" = "with-dev" ]; then
    for file in ${DEV_COMPOSE_FILES[@]+"${DEV_COMPOSE_FILES[@]}"}; do
      printf '%s\n' "-f" "$file"
    done
  fi
}

compose() {
  local mode="$1"; shift
  local args=()
  while IFS= read -r arg; do
    args+=("$arg")
  done < <(compose_args "$mode")
  docker compose "${args[@]}" "$@"
}

read_env_var_from_file() {
  local file="$1" key="$2" line
  line="$(grep -E "^${key}=" "$file" | tail -n1 || true)"
  printf '%s' "${line#*=}"
}

unset_compose_shell_overrides() {
  local file="$1" key
  while IFS='=' read -r key _; do
    unset "$key" || true
  done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$file" || true)
}

require_env_file() {
  [ -n "$APP_ENV_FILE" ] || return 0
  if [ -f "$APP_ENV_FILE" ]; then
    unset_compose_shell_overrides "$APP_ENV_FILE"
    return 0
  fi
  if [ ! -f "$APP_ENV_EXAMPLE_FILE" ]; then
    echo "Missing $APP_ENV_FILE and $APP_ENV_EXAMPLE_FILE." >&2
    exit 1
  fi
  cp "$APP_ENV_EXAMPLE_FILE" "$APP_ENV_FILE"
  echo "Created $APP_ENV_FILE from $APP_ENV_EXAMPLE_FILE — fill it in and rerun." >&2
  exit 1
}

wait_for_openbao() {
  local i=1 code=""
  echo "Waiting for OpenBao to become ready..."
  while [ $i -le 60 ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$OPENBAO_LOCAL_ADDR/v1/sys/health" || true)"
    case "$code" in
      200|429|472|473|501|503) break ;;
    esac
    sleep 2
    i=$((i + 1))
  done

  if [ $i -gt 60 ]; then
    echo "OpenBao did not become ready in time. Start the platform-ops local stack first." >&2
    echo "See docs/local-first-start.md" >&2
    exit 1
  fi

  case "$code" in
    200|429|472|473)
      echo "OpenBao is ready"
      ;;
    501)
      echo "OpenBao is uninitialized. Initialize/unseal it from platform-ops first." >&2
      echo "See docs/local-first-start.md" >&2
      exit 1
      ;;
    503)
      echo "OpenBao is sealed. Unseal it from platform-ops first." >&2
      echo "See docs/local-first-start.md" >&2
      exit 1
      ;;
    *)
      echo "Unexpected OpenBao health status: $code" >&2
      exit 1
      ;;
  esac
}

check_compose_secret_path() {
  local declared
  declared="$(
    for key in $(printf '%s' "$OPENBAO_EXPORT_KEYS" | tr ',' ' '); do
      export "$key=compose-check-placeholder"
    done
    compose "" config 2>/dev/null || true
  )"
  declared="$(printf '%s\n' "$declared" | sed -n 's/^[[:space:]]*OPENBAO_SECRET_PATH:[[:space:]]*//p' | sort -u)"
  [ -n "$declared" ] || return 0
  if [ "$declared" != "$OPENBAO_SECRET_PATH" ]; then
    echo "Compose OPENBAO_SECRET_PATH mismatch: config=$OPENBAO_SECRET_PATH compose=$declared" >&2
    exit 1
  fi
}

read_openbao_secret() {
  local mount_path="${OPENBAO_KV_MOUNT%/}" secret_path="${OPENBAO_SECRET_PATH#/}" code
  SECRET_BODY_FILE="$(mktemp)"
  trap 'rm -f "$SECRET_BODY_FILE"' EXIT

  code="$(curl -s -o "$SECRET_BODY_FILE" -w '%{http_code}' \
    -H "X-Vault-Token: $OPENBAO_TOKEN_VALUE" \
    "$OPENBAO_LOCAL_ADDR/v1/${mount_path}/data/${secret_path}" || true)"
  if [ "$code" != "200" ]; then
    echo "OpenBao secret path is not readable with OPENBAO_TOKEN (status=$code): ${mount_path}/${secret_path}" >&2
    cat "$SECRET_BODY_FILE" >&2 || true
    echo >&2
    case "$code" in
      403) echo "The token is invalid, expired, revoked, or lacks the ${secret_path}-local-read policy. Run npm run local:token for a fresh one." >&2 ;;
      404) echo "Create the ${mount_path}/${secret_path} secret described in docs/local-first-start.md and retry." >&2 ;;
      *) echo "Check the OpenBao response and docs/local-first-start.md, then retry." >&2 ;;
    esac
    exit 1
  fi
}

require_secret_keys() {
  [ -n "$OPENBAO_REQUIRED_KEYS" ] || return 0
  REQUIRED_KEYS="$OPENBAO_REQUIRED_KEYS" SECRET_BODY_FILE="$SECRET_BODY_FILE" node -e '
const fs = require("node:fs");
const required = Array.from(
  new Set(
    String(process.env.REQUIRED_KEYS)
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  ),
);
if (required.length === 0) process.exit(0);
let payload;
try {
  payload = JSON.parse(fs.readFileSync(process.env.SECRET_BODY_FILE, "utf8"));
} catch (error) {
  console.error("Failed to parse OpenBao secret payload:", error.message);
  process.exit(1);
}
const data = payload?.data?.data;
if (!data || typeof data !== "object" || Array.isArray(data)) {
  console.error("OpenBao payload does not contain a kv-v2 data.data object");
  process.exit(1);
}
const missing = required.filter((key) => {
  const value = data[key];
  return value === undefined || value === null || String(value).trim().length === 0;
});
if (missing.length > 0) {
  console.error(`OpenBao secret path is missing required keys: ${missing.join(", ")}`);
  process.exit(1);
}
'
}

export_secret_keys() {
  [ -n "$OPENBAO_EXPORT_KEYS" ] || return 0
  local key value
  for key in $(printf '%s' "$OPENBAO_EXPORT_KEYS" | tr ',' ' '); do
    value="$(
      SECRET_KEY="$key" SECRET_BODY_FILE="$SECRET_BODY_FILE" node -e '
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.env.SECRET_BODY_FILE, "utf8"));
const value = payload?.data?.data?.[process.env.SECRET_KEY];
if (value === undefined || value === null || String(value).trim().length === 0) {
  console.error(`OpenBao secret path is missing required key: ${process.env.SECRET_KEY}`);
  process.exit(1);
}
process.stdout.write(String(value));
'
    )"
    export "$key=$value"
  done
}

sync_tolgee() {
  [ "$TOLGEE_SYNC" != "none" ] || return 0
  local project_id
  project_id="$(read_env_var_from_file "$APP_ENV_FILE" "TOLGEE_PROJECT_ID")"
  [ -n "$project_id" ] || return 0

  run_with_tolgee_env() {
    OPENBAO_ADDR="$OPENBAO_LOCAL_ADDR" \
    OPENBAO_TOKEN="$OPENBAO_TOKEN_VALUE" \
    OPENBAO_KV_MOUNT="$OPENBAO_KV_MOUNT" \
    OPENBAO_SECRET_PATH="$OPENBAO_SECRET_PATH" \
    OPENBAO_REQUIRED_KEYS="TOLGEE_API_KEY" \
    TOLGEE_API_URL="$TOLGEE_LOCAL_ADDR" \
    TOLGEE_PROJECT_ID="$project_id" \
      node "$OPENBAO_RUN" -- npm run "$1" -w "$TOLGEE_WORKSPACE"
  }

  if [ "$TOLGEE_SYNC" = "push-pull" ]; then
    echo "Pushing local translations to Tolgee..."
    run_with_tolgee_env i18n:push
  fi
  echo "Pulling Tolgee snapshots for local messages..."
  run_with_tolgee_env i18n:pull
}

bootstrap_database() {
  [ -n "$DB_SERVICE" ] || return 0
  local i=1 exists override

  if [ -n "$APP_ENV_FILE" ] && [ -f "$APP_ENV_FILE" ]; then
    override="$(read_env_var_from_file "$APP_ENV_FILE" "POSTGRES_USER")"
    [ -n "$override" ] && DB_USER="$override"
    override="$(read_env_var_from_file "$APP_ENV_FILE" "POSTGRES_DB")"
    if [ -n "$override" ]; then
      DB_NAME="$override"
      DB_BOOTSTRAP_DB="$override"
    fi
  fi

  echo "Ensuring PostgreSQL is running for database: $DB_NAME"
  compose "" up -d "$DB_SERVICE"

  while [ $i -le 60 ]; do
    if compose "" exec -T "$DB_SERVICE" \
      sh -lc "pg_isready -U \"$DB_USER\" -d \"$DB_BOOTSTRAP_DB\" >/dev/null 2>&1"; then
      break
    fi
    sleep 2
    i=$((i + 1))
  done

  if [ $i -gt 60 ]; then
    echo "Postgres did not become ready in time." >&2
    exit 1
  fi

  if [ -n "${POSTGRES_PASSWORD:-}" ]; then
    echo "Synchronizing the PostgreSQL role password with OpenBao..."
    compose "" exec -T "$DB_SERVICE" \
      psql \
        -v ON_ERROR_STOP=1 \
        -v db_password="$POSTGRES_PASSWORD" \
        -U "$DB_USER" \
        -d "$DB_BOOTSTRAP_DB" <<'SQL'
SELECT format('ALTER ROLE %I WITH PASSWORD %L', current_user, :'db_password') \gexec
SQL
  fi

  exists="$(
    compose "" exec -T "$DB_SERVICE" \
      sh -lc "psql -U \"$DB_USER\" -d \"$DB_BOOTSTRAP_DB\" -tAc \"SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'\""
  )"
  exists="$(printf '%s' "$exists" | tr -d '[:space:]')"
  if [ "$exists" != "1" ]; then
    compose "" exec -T "$DB_SERVICE" \
      sh -lc "psql -U \"$DB_USER\" -d \"$DB_BOOTSTRAP_DB\" -c \"CREATE DATABASE \\\"$DB_NAME\\\";\""
  fi
}

announce_ready() {
  local url
  [ -n "$READY_MESSAGE" ] && echo "$READY_MESSAGE"
  for url in ${READY_URLS[@]+"${READY_URLS[@]}"}; do
    echo "  $url"
  done
  return 0
}

prepare() {
  require_env_file
  docker network create "$SHARED_NETWORK" >/dev/null 2>&1 || true

  [ -n "$OPENBAO_SECRET_PATH" ] || return 0

  OPENBAO_TOKEN_VALUE="$(read_env_var_from_file "$APP_ENV_FILE" "OPENBAO_TOKEN")"
  if [ -z "$OPENBAO_TOKEN_VALUE" ]; then
    echo "OPENBAO_TOKEN is required in $APP_ENV_FILE" >&2
    exit 1
  fi
  if [ "$OPENBAO_TOKEN_VALUE" = "CHANGE_ME_LOCAL_OPENBAO_TOKEN" ]; then
    echo "OPENBAO_TOKEN in $APP_ENV_FILE still has the example value. Update it before retrying." >&2
    echo "Run npm run local:token to mint one." >&2
    exit 1
  fi

  echo "Using OpenBao path: ${OPENBAO_KV_MOUNT}/${OPENBAO_SECRET_PATH}"
  check_compose_secret_path
  wait_for_openbao
  read_openbao_secret
  require_secret_keys
  export_secret_keys
  sync_tolgee
}

cmd_up() {
  prepare
  bootstrap_database
  compose "" up -d --build --force-recreate --remove-orphans
  announce_ready
}

cmd_dev() {
  prepare
  bootstrap_database
  echo "Starting ${APP_LABEL} in watch mode."
  compose with-dev up --build --remove-orphans --watch
}

cmd_down() {
  compose "" down --remove-orphans "$@"
}

cmd_reset() {
  local hook
  if [ "$RESET_MODE" = "rebuild" ]; then
    compose "" down --remove-orphans
    compose "" build --no-cache
  else
    compose "" down -v --rmi local --remove-orphans
  fi
  for hook in ${RESET_HOOKS[@]+"${RESET_HOOKS[@]}"}; do
    echo "Running reset hook: $hook"
    bash "$hook"
  done
  cmd_up
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  dev) shift; cmd_dev "$@" ;;
  down) shift; cmd_down "$@" ;;
  reset) shift; cmd_reset "$@" ;;
  *)
    echo "Usage: scripts/local-stack.sh {up|dev|down|reset}" >&2
    exit 1
    ;;
esac
