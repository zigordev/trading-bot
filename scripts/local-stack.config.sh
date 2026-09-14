APP_LABEL="the trading-bot stack"
APP_ENV_FILE="docker/.env.app.local"
APP_ENV_EXAMPLE_FILE="docker/.env.app.local.example"
COMPOSE_FILES=(docker/compose.app.local.yml)
DEV_COMPOSE_FILES=(docker/compose.app.dev.yml)

OPENBAO_SECRET_PATH="trading-bot"
OPENBAO_REQUIRED_KEYS="POSTGRES_PASSWORD"
OPENBAO_EXPORT_KEYS="POSTGRES_PASSWORD"
OPENBAO_RUN="scripts/openbao-run.mjs"

DB_SERVICE="trading_bot_db"
DB_USER="trading_bot_admin"
DB_NAME="trading_bot"
DB_BOOTSTRAP_DB="trading_bot"

RESET_MODE="volumes"
RESET_HOOKS=(scripts/local-kafka-reset.sh)
READY_MESSAGE="trading-bot local stack started."
READY_URLS=("http://localhost:3020/health" "http://localhost:3030/health" "http://localhost:3050/health" "http://localhost:3070/health" "http://localhost:3060")
