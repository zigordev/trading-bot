#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  $0 \
    --release-dir <path> \
    --region <aws-region> \
    --app-ssm-prefix </trading-bot/prod/app> \
    --control-plane-image <ecr-uri@digest> \
    --operator-console-image <ecr-uri@digest> \
    --market-data-image <ecr-uri@digest> \
    --research-backtesting-image <ecr-uri@digest> \
    --execution-image <ecr-uri@digest> \
    --release-tag <tag>
USAGE
}

RELEASE_DIR=""
AWS_REGION=""
APP_SSM_PREFIX=""
CONTROL_PLANE_IMAGE=""
OPERATOR_CONSOLE_IMAGE=""
MARKET_DATA_IMAGE=""
RESEARCH_BACKTESTING_IMAGE=""
EXECUTION_IMAGE=""
RELEASE_TAG=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --release-dir)
      RELEASE_DIR="$2"
      shift 2
      ;;
    --region)
      AWS_REGION="$2"
      shift 2
      ;;
    --app-ssm-prefix)
      APP_SSM_PREFIX="$2"
      shift 2
      ;;
    --control-plane-image)
      CONTROL_PLANE_IMAGE="$2"
      shift 2
      ;;
    --operator-console-image)
      OPERATOR_CONSOLE_IMAGE="$2"
      shift 2
      ;;
    --market-data-image)
      MARKET_DATA_IMAGE="$2"
      shift 2
      ;;
    --research-backtesting-image)
      RESEARCH_BACKTESTING_IMAGE="$2"
      shift 2
      ;;
    --execution-image)
      EXECUTION_IMAGE="$2"
      shift 2
      ;;
    --release-tag)
      RELEASE_TAG="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_value() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "Missing required arg: $name" >&2
    usage
    exit 1
  fi
}

require_value "--release-dir" "$RELEASE_DIR"
require_value "--region" "$AWS_REGION"
require_value "--app-ssm-prefix" "$APP_SSM_PREFIX"
require_value "--control-plane-image" "$CONTROL_PLANE_IMAGE"
require_value "--operator-console-image" "$OPERATOR_CONSOLE_IMAGE"
require_value "--market-data-image" "$MARKET_DATA_IMAGE"
require_value "--research-backtesting-image" "$RESEARCH_BACKTESTING_IMAGE"
require_value "--execution-image" "$EXECUTION_IMAGE"
require_value "--release-tag" "$RELEASE_TAG"

retry() {
  local attempts="$1"
  local sleep_seconds="$2"
  shift 2
  local i=1

  while true; do
    if "$@"; then
      return 0
    fi

    if [ "$i" -ge "$attempts" ]; then
      return 1
    fi

    sleep "$sleep_seconds"
    i=$((i + 1))
  done
}

for cmd in aws jq docker curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing command: $cmd" >&2
    exit 1
  fi
done

run_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  echo "Missing compose runtime (tried 'docker compose' and 'docker-compose')" >&2
  exit 1
}

if [ ! -d "$RELEASE_DIR" ]; then
  echo "Release dir not found: $RELEASE_DIR" >&2
  exit 1
fi

cd "$RELEASE_DIR"

APP_BASE_ENV_FILE="docker/.env.app.prod"
APP_ENV_FILE="$(mktemp /tmp/trading-bot-app-env.XXXXXX)"
trap 'rm -f "$APP_ENV_FILE"' EXIT
OPENBAO_LOCAL_ADDR="http://127.0.0.1:8200"
OPENBAO_KV_MOUNT="kv"
OPENBAO_SECRET_PATH="trading-bot"

if [ ! -f "$APP_BASE_ENV_FILE" ]; then
  echo "Missing base app env file in release bundle: $APP_BASE_ENV_FILE" >&2
  exit 1
fi

cp "$APP_BASE_ENV_FILE" "$APP_ENV_FILE"
chmod 600 "$APP_ENV_FILE"

read_env_var() {
  local file="$1"
  local key="$2"
  grep -E "^${key}=" "$file" | tail -n1 | cut -d'=' -f2- || true
}

require_env_var_in_file() {
  local file="$1"
  local key="$2"
  local value

  value="$(read_env_var "$file" "$key")"
  if [ -z "$value" ]; then
    echo "Missing required non-secret value '$key' in $file" >&2
    exit 1
  fi
}

upsert_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  tmp="$(mktemp)"

  awk -v key="$key" -v value="$value" -F= '
    BEGIN { updated=0 }
    $1 == key { print key "=" value; updated=1; next }
    { print }
    END { if (!updated) print key "=" value }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

fetch_ssm_secret_value() {
  local parameter_name="$1"
  local value
  local err_file
  local rc

  err_file="$(mktemp)"

  set +e
  value="$(aws ssm get-parameter --region "$AWS_REGION" --name "$parameter_name" --with-decryption --query 'Parameter.Value' --output text 2>"$err_file")"
  rc=$?
  set -e

  if [ "$rc" -ne 0 ] || [ -z "$value" ] || [ "$value" = "None" ]; then
    echo "Missing required SSM secret: $parameter_name (region=$AWS_REGION)" >&2
    if [ -s "$err_file" ]; then
      cat "$err_file" >&2
    fi
    rm -f "$err_file"
    exit 1
  fi

  rm -f "$err_file"
  printf '%s' "$value"
}

required_non_secret_keys=(
  HISTORICAL_STORE_DATABASE
  HISTORICAL_STORE_USER
  KAFKA_BOOTSTRAP_SERVERS
  EXECUTION_DEFAULT_MODE
  NEXT_PUBLIC_CONTROL_PLANE_BASE_URL
)

for key in "${required_non_secret_keys[@]}"; do
  require_env_var_in_file "$APP_ENV_FILE" "$key"
done

execution_mode="$(read_env_var "$APP_ENV_FILE" "EXECUTION_DEFAULT_MODE")"
if [ "$execution_mode" != "paper" ] && [ "$execution_mode" != "live" ]; then
  echo "EXECUTION_DEFAULT_MODE must be 'paper' or 'live', got '$execution_mode'" >&2
  exit 1
fi

openbao_token="$(fetch_ssm_secret_value "${APP_SSM_PREFIX%/}/OPENBAO_TOKEN")"
upsert_env_var "$APP_ENV_FILE" "OPENBAO_TOKEN" "$openbao_token"
upsert_env_var "$APP_ENV_FILE" "CONTROL_PLANE_IMAGE" "$CONTROL_PLANE_IMAGE"
upsert_env_var "$APP_ENV_FILE" "OPERATOR_CONSOLE_IMAGE" "$OPERATOR_CONSOLE_IMAGE"
upsert_env_var "$APP_ENV_FILE" "MARKET_DATA_IMAGE" "$MARKET_DATA_IMAGE"
upsert_env_var "$APP_ENV_FILE" "RESEARCH_BACKTESTING_IMAGE" "$RESEARCH_BACKTESTING_IMAGE"
upsert_env_var "$APP_ENV_FILE" "EXECUTION_IMAGE" "$EXECUTION_IMAGE"
upsert_env_var "$APP_ENV_FILE" "NEXT_PUBLIC_RELEASE" "$RELEASE_TAG"

docker network create "platform_ops_shared" >/dev/null 2>&1 || true

echo "[deploy] Waiting for OpenBao health"
openbao_ready="false"
openbao_code=""
i=1
while [ $i -le 60 ]; do
  openbao_code="$(curl -s -o /dev/null -w '%{http_code}' "$OPENBAO_LOCAL_ADDR/v1/sys/health" || true)"
  if [ "$openbao_code" = "200" ] || [ "$openbao_code" = "429" ]; then
    openbao_ready="true"
    break
  fi
  if [ "$openbao_code" = "501" ] || [ "$openbao_code" = "503" ]; then
    echo "[deploy] OpenBao health is $openbao_code (not initialized or sealed). Ensure platform-ops is initialized and unsealed." >&2
    break
  fi
  sleep 2
  i=$((i + 1))
done

if [ "$openbao_ready" != "true" ]; then
  echo "OpenBao did not become ready (last_health_code=$openbao_code). Ensure platform-ops is running on this host." >&2
  exit 1
fi

openbao_secret_url="${OPENBAO_LOCAL_ADDR}/v1/${OPENBAO_KV_MOUNT}/data/${OPENBAO_SECRET_PATH}"
openbao_secret_body_file="$(mktemp)"

openbao_secret_code="$(curl -s -o "$openbao_secret_body_file" -w '%{http_code}' -H "X-Vault-Token: $openbao_token" "$openbao_secret_url" || true)"
if [ "$openbao_secret_code" != "200" ]; then
  echo "Failed to read OpenBao secret ${OPENBAO_KV_MOUNT}/${OPENBAO_SECRET_PATH} with OPENBAO_TOKEN (status=$openbao_secret_code)" >&2
  cat "$openbao_secret_body_file" >&2 || true
  rm -f "$openbao_secret_body_file"
  exit 1
fi

read_openbao_key() {
  local key="$1"
  jq -r --arg key "$key" '.data.data[$key] // ""' "$openbao_secret_body_file"
}

require_openbao_key() {
  local key="$1"
  local value

  if ! value="$(read_openbao_key "$key")"; then
    echo "Failed to parse OpenBao secret payload from ${OPENBAO_KV_MOUNT}/${OPENBAO_SECRET_PATH}" >&2
    rm -f "$openbao_secret_body_file"
    exit 1
  fi

  if [ -z "$value" ]; then
    echo "OpenBao secret is missing required key: $key" >&2
    rm -f "$openbao_secret_body_file"
    exit 1
  fi

  printf '%s' "$value"
}

postgres_password="$(require_openbao_key "POSTGRES_PASSWORD")"
historical_store_password="$(require_openbao_key "HISTORICAL_STORE_PASSWORD")"

binance_api_key=""
binance_api_secret=""
if [ "$execution_mode" = "live" ]; then
  binance_api_key="$(require_openbao_key "BINANCE_API_KEY")"
  binance_api_secret="$(require_openbao_key "BINANCE_API_SECRET")"
fi

rm -f "$openbao_secret_body_file"

upsert_env_var "$APP_ENV_FILE" "POSTGRES_PASSWORD" "$postgres_password"
upsert_env_var "$APP_ENV_FILE" "HISTORICAL_STORE_PASSWORD" "$historical_store_password"
upsert_env_var "$APP_ENV_FILE" "BINANCE_API_KEY" "$binance_api_key"
upsert_env_var "$APP_ENV_FILE" "BINANCE_API_SECRET" "$binance_api_secret"

ECR_LOGGED_IN_REGISTRIES="|"

is_ecr_registry() {
  local registry="$1"
  [[ "$registry" == *".dkr.ecr."*".amazonaws.com"* ]]
}

login_ecr_for_image() {
  local image="$1"
  local registry
  local registry_region

  registry="${image%%/*}"

  if [ -z "$registry" ] || [ "$registry" = "$image" ]; then
    return 0
  fi

  if ! is_ecr_registry "$registry"; then
    return 0
  fi

  if [[ "$ECR_LOGGED_IN_REGISTRIES" == *"|${registry}|"* ]]; then
    return 0
  fi

  registry_region="$(printf '%s' "$registry" | awk -F'.' '{print $4}')"
  if [ -z "$registry_region" ]; then
    registry_region="$AWS_REGION"
  fi

  echo "[deploy] Logging into ECR registry: $registry (region=$registry_region)"
  aws ecr get-login-password --region "$registry_region" | docker login --username AWS --password-stdin "$registry" >/dev/null

  ECR_LOGGED_IN_REGISTRIES="${ECR_LOGGED_IN_REGISTRIES}${registry}|"
}

login_ecr_for_image "$CONTROL_PLANE_IMAGE"
login_ecr_for_image "$OPERATOR_CONSOLE_IMAGE"
login_ecr_for_image "$MARKET_DATA_IMAGE"
login_ecr_for_image "$RESEARCH_BACKTESTING_IMAGE"
login_ecr_for_image "$EXECUTION_IMAGE"

available_memory_kb="$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo 2>/dev/null || true)"
if [ -n "$available_memory_kb" ]; then
  echo "[deploy] Host MemAvailable before start: $((available_memory_kb / 1024)) MiB"
  if [ "$available_memory_kb" -lt 12582912 ]; then
    echo "[deploy] This stack measured ~10.6 GiB resident locally (ClickHouse ~5.57 GiB of it)." >&2
    echo "[deploy] The host reports less than 12 GiB available; resize before deploying." >&2
    exit 1
  fi
fi

echo "[deploy] Starting trading-bot app stack"
run_compose --env-file "$APP_ENV_FILE" -f docker/compose.app.prod.yml up -d --remove-orphans

echo "[deploy] Health checking control plane via app network"
retry 60 5 run_compose --env-file "$APP_ENV_FILE" -f docker/compose.app.prod.yml exec -T trading_bot_operator_console sh -lc "wget -qO- http://trading-bot-control-plane:8080/health >/dev/null"

echo "[deploy] Health checking operator console"
retry 60 5 run_compose --env-file "$APP_ENV_FILE" -f docker/compose.app.prod.yml exec -T trading_bot_operator_console sh -lc "wget -qO- http://localhost:3000/health >/dev/null"

run_compose --env-file "$APP_ENV_FILE" -f docker/compose.app.prod.yml ps

echo "[deploy] Release $RELEASE_TAG deployed successfully"
