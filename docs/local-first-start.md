# Local First Start (trading-bot)

Use this runbook when you are creating the `trading-bot` local environment from scratch.
Complete `platform-ops/docs/local-first-start.md` first. `trading-bot` depends on the shared OpenBao instance, shared Redpanda broker, shared Docker network, and shared observability stack started there.

## 1. What You Are Building

When this runbook is complete, you will have:

- a local PostgreSQL instance for `trading-bot`
- a local ClickHouse historian for `trading-bot` on `localhost:18123`
- the `control-plane` API running on `http://localhost:3020`
- the Rust `market-data` service running on `http://localhost:3030`
- the Rust `research-backtesting` service running on `http://localhost:3050`
- the Rust `execution` service running on `http://localhost:3070`
- a local Alloy sidecar shipping container logs into the shared Loki stack
- a local OpenBao secret path and app token ready for `trading-bot`
- the shared local Redpanda broker running in `platform-ops`
- the shared local observability stack running in `platform-ops`

At this stage the application includes the first control-plane slice, the first market-data
runtime slice, and the first research/backtesting slice.
Order execution and deeper order-book-aware backtesting are still not implemented yet.

## 2. Prerequisites

Run every command in this document from the `trading-bot` repo root unless stated otherwise.

Required:

- `platform-ops` local stack is already running
- OpenBao in `platform-ops` is initialized and unsealed
- `kv` v2 is enabled in OpenBao
- Redpanda from `platform-ops` is running on the shared Docker network
- Docker
- `jq`

Optional for host-side development:

- Rust toolchain if you want to run `cargo` directly or use the root `npm test` / `npm run build`
  commands outside Docker

## 3. Create The OpenBao Secret `kv/trading-bot`

Open OpenBao:

- `http://localhost:8200/ui`

Create secret path `kv/trading-bot` with these keys:

- `POSTGRES_PASSWORD`
  - password for the local `trading-bot` Postgres database

## 4. Create A Read-Only Policy For `trading-bot`

Create an OpenBao ACL policy named `trading-bot-local-read`.
This step requires the OpenBao root token saved during the `platform-ops` bootstrap:

```bash
ROOT_TOKEN='paste_root_token_here'

docker compose --env-file ../platform-ops/docker/.env.ops.local -f ../platform-ops/docker/compose.ops.local.yml exec -T \
  -e BAO_ADDR=http://127.0.0.1:8200 \
  -e BAO_TOKEN="$ROOT_TOKEN" \
  openbao bao policy write trading-bot-local-read - <<'EOF'
path "kv/data/trading-bot" { capabilities = ["read"] }
path "kv/metadata/trading-bot" { capabilities = ["read"] }
EOF
```

## 5. Create The `trading-bot` OpenBao Token

Use the OpenBao root token created during the `platform-ops` bootstrap.

Create the app token:

```bash
ROOT_TOKEN='paste_root_token_here'

docker compose --env-file ../platform-ops/docker/.env.ops.local -f ../platform-ops/docker/compose.ops.local.yml exec -T \
  -e BAO_ADDR=http://127.0.0.1:8200 \
  -e BAO_TOKEN="$ROOT_TOKEN" \
  openbao bao token create -policy=trading-bot-local-read -format=json \
  | jq -r '.auth.client_token'
```

Copy the printed token and use it only for `trading-bot`.

## 6. Prepare The Local Env File

Create the real local env file from the tracked example:

```bash
cp docker/.env.app.local.example docker/.env.app.local
```

Then edit `docker/.env.app.local`.

Set or review these values:

- `OPENBAO_TOKEN`
  - set it to the `trading-bot-local-read` token
- `OTEL_EXPORTER_OTLP_ENDPOINT`
  - keep the default if you use the local `platform-ops` collector
- `KAFKA_BOOTSTRAP_SERVERS`
  - keep the default if you use the shared Redpanda broker from `platform-ops`
- `CONFIG_CHANGE_EVENTS_TOPIC`
  - keep the default unless you intentionally want a different local topic name
- `HISTORICAL_STORE_USER`
  - keep the default for the local ClickHouse container unless you intentionally change it
- `HISTORICAL_STORE_PASSWORD`
  - keep the default for the local ClickHouse container unless you intentionally change it
- `RUNTIME_CONFIG_REFRESH_INTERVAL_MS`
  - keep the default unless you need slower or faster runtime-config reconciliation
- `CONFIG_REFRESH_DEBOUNCE_MS`
  - keep the default unless you need faster or slower config-change coalescing
- `READINESS_MAX_CONFIG_AGE_MS`
  - keep the default unless you need stricter readiness staleness detection
- `BINANCE_STREAM_BASE_URL`
  - keep the default for local Binance public websocket connectivity
- `BINANCE_REST_BASE_URL`
  - keep the default for local Binance public REST recovery calls
- `BINANCE_REST_MAX_RETRIES`
  - keep the default unless you need a stricter or looser retry budget for Binance REST recovery
- `BINANCE_REST_RETRY_BACKOFF_MS`
  - keep the default unless Binance REST recovery should back off faster or slower
- `HISTORICAL_BACKFILL_LIMIT`
  - keep the default unless you want a different bounded kline recovery batch size
- `HISTORICAL_TRADE_BACKFILL_LIMIT`
  - keep the default unless you want larger or smaller aggregate-trade recovery pages
- `HISTORICAL_TRADE_BACKFILL_MAX_BATCHES`
  - keep the default unless you want to cap aggregate-trade recovery earlier or later
- `HISTORICAL_BACKFILL_MAX_CONCURRENCY`
  - keep the default unless you need to reduce or raise parallel recovery pressure
- `HISTORICAL_KLINE_RETENTION_DAYS`
  - keep the default unless you want a different ClickHouse TTL for candles
- `HISTORICAL_TRADE_RETENTION_DAYS`
  - keep the default unless you want a different ClickHouse TTL for aggregate trades
- `HISTORICAL_BOOK_TICKER_RETENTION_DAYS`
- `MARKET_EVENT_DEDUP_CAPACITY`
  - keep the default unless you need a larger in-memory dedup window
- `READINESS_MAX_DEPENDENCY_AGE_MS`
  - keep the default unless the research-backtesting readiness check should tolerate older dependency checks
- `BACKTEST_WARMUP_MULTIPLIER`
  - keep the default unless offline backtests should use a larger or smaller EMA warmup buffer
- `BACKTEST_MAX_KLINES`
  - keep the default unless you need wider replay windows than the local safety cap allows
- `BACKTEST_MAX_TRADES`
  - keep the default unless you need wider aggregate-trade replay windows than the local safety cap allows
  - keep the default unless a busy pair needs a wider quote replay window for quote-aware backtests
- `BACKTEST_RESULT_RETENTION_DAYS`
  - keep the default unless persisted backtest runs should live shorter or longer in ClickHouse
- `BACKTEST_FEE_BPS`
  - keep the default `0` unless local backtests should include a per-side fee assumption
- `BACKTEST_SLIPPAGE_BPS`
  - keep the default `0` unless local backtests should include a slippage assumption
- `BACKTEST_TIMERANGE_MS_BY_TIMEFRAME`
  - comma-separated timeframeCode=durationMs pairs, e.g. `1m=86400000,5m=604800000`

Leave these placeholders as they are:

- `POSTGRES_PASSWORD=SET_FROM_OPEN_BAO`

Fixed values such as the database name, database user, OpenBao address, KV mount, and secret path live in the compose file or helper script instead of the local env file.

## 7. Start The Local Stack

From the `trading-bot` repo root:

```bash
./scripts/local-stack-up.sh
```

What the script does:

- creates `docker/.env.app.local` from the tracked example if needed
- validates OpenBao reachability
- validates the token against `kv/trading-bot`
- validates the required OpenBao keys
- exports `POSTGRES_PASSWORD` from OpenBao
- starts the local Docker Compose stack
- lets the app-local services provision their Kafka topics automatically during startup

If the env file was auto-created and still contains the placeholder OpenBao token, the script stops and tells you to update it.

## 8. Validate The Local Stack

Confirm the app-local container is up:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml ps
```

Confirm PostgreSQL responds:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml exec -T postgres sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Confirm the ClickHouse historical store responds:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml exec -T historical-store \
  clickhouse-client --query "SHOW DATABASES"
```

Useful endpoints from the shared stack:

- Control-plane health: `http://localhost:3020/health`
- Control-plane metrics: `http://localhost:3020/metrics`
- Control-plane docs: `http://localhost:3020/docs`
- Control-plane pairs: `http://localhost:3020/v1/pairs`
- Control-plane timeframes: `http://localhost:3020/v1/timeframes`
- Control-plane strategies: `http://localhost:3020/v1/strategies`
- Control-plane risk profiles: `http://localhost:3020/v1/risk-profiles`
- Market-data health: `http://localhost:3030/health`
- Market-data metrics: `http://localhost:3030/metrics`
- Market-data info: `http://localhost:3030/v1/info`
- Market-data subscriptions: `http://localhost:3030/v1/subscriptions`
- Market-data runtime status: `http://localhost:3030/v1/status`
- Market-data recent klines example: `http://localhost:3030/v1/klines/BTCUSDT/1m`
- Market-data recent trades example: `http://localhost:3030/v1/trades/BTCUSDT`
- Market-data replay klines example: `http://localhost:3030/v1/replay/klines/BTCUSDT/1m?limit=100`
- Market-data replay trades example: `http://localhost:3030/v1/replay/trades/BTCUSDT?limit=100`
- Research-backtesting health: `http://localhost:3050/health`
- Research-backtesting metrics: `http://localhost:3050/metrics`
- Research-backtesting info: `http://localhost:3050/v1/info`
- Research-backtesting runtime status: `http://localhost:3050/v1/status`
- Research-backtesting backtests: `http://localhost:3050/v1/backtests`
- Research-backtesting persisted backtest lookup: `http://localhost:3050/v1/backtests/{backtest_id}`
- ClickHouse HTTP port: `localhost:18123`
- ClickHouse native port: `localhost:19000`
- OpenBao UI: `http://localhost:8200/ui`
- Redpanda Console: `http://localhost:8081`
- Grafana: `http://localhost:3002`

What you can do from `/docs` right now:

- create and manage pairs
- create and manage timeframes
- create and manage strategies
- create and manage risk profiles
- create and manage trading defaults
- create and manage research settings
- create and manage analysis settings

What happens after a successful config mutation now:

- the resource change is committed in PostgreSQL
- a config-change event is published directly to the Redpanda topic from `CONFIG_CHANGE_EVENTS_TOPIC`
- the market-data service consumes that event and refreshes its active subscriptions from the
  control-plane runtime projection
- on startup or refresh, the market-data service also repairs missing active kline tails through
  bounded Binance REST backfill and stores klines in ClickHouse database
  `HISTORICAL_STORE_DATABASE`, table `market_data_klines`
- the market-data service consumes the same config-change topic and refreshes its active retrieval set
- the research-backtesting service reads runtime-config on demand, then
  replays historical klines directly from ClickHouse through the shared `emaCross` logic (time window duration comes from `BACKTEST_TIMERANGE_MS_BY_TIMEFRAME`)
- completed backtest runs are also stored in ClickHouse table `research_backtest_runs`

You do not need to create the Redpanda topics manually for the default local setup. The
control-plane, market-data, and research-backtesting ensure their configured topics exist during
startup.

## 9. Daily Commands

Stop the stack and keep data:

```bash
./scripts/local-stack-down.sh
```

Stop the stack and remove volumes:

```bash
./scripts/local-stack-reset.sh
```

Start it again:

```bash
./scripts/local-stack-up.sh
```

If you are upgrading from an older local historical-store implementation:

- preferred: run `./scripts/local-stack-reset.sh`
- or manually remove only the unused old PostgreSQL table:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml exec -T postgres \
  sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP TABLE IF EXISTS market_data_klines;"'
```

Run the current automated suite:

```bash
npm test
```

Build both active services on the host:

```bash
npm run build
```

## 10. Historical Store Smoke Test

Use this when you want to verify that live config drives Binance ingestion and that historian data
is being stored in ClickHouse rather than PostgreSQL.

1. Create one runnable config set from `http://localhost:3020/docs`:
   - pair `BTCUSDT`
   - timeframe `1m`
   - strategy `emaCross`
   - one enabled risk profile
   - one enabled trading defaults profile
   - one enabled `analysis-settings` binding that joins all of the above

2. Check that `market-data` derived subscriptions:

```bash
curl -fsS http://localhost:3030/v1/subscriptions | jq
curl -fsS http://localhost:3030/v1/status | jq
```

```bash
curl -fsS "http://localhost:3030/v1/klines/BTCUSDT/1m?limit=5" | jq
curl -fsS "http://localhost:3030/v1/trades/BTCUSDT?limit=5" | jq
```

4. Confirm the historian tables are populated in ClickHouse:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml exec -T historical-store \
```

5. Confirm the replay-oriented endpoints can read ascending historian windows:

```bash
curl -fsS "http://localhost:3030/v1/replay/klines/BTCUSDT/1m?limit=5" | jq
curl -fsS "http://localhost:3030/v1/replay/trades/BTCUSDT?limit=5" | jq
```

6. Confirm the old PostgreSQL kline table is not present:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml exec -T postgres \
  sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT to_regclass('\''public.market_data_klines'\'');"'
```

Expected results:

- `/v1/subscriptions` is non-empty
- `/v1/status` shows a live Binance stream and a recent `lastBackfillAt`
- `/v1/klines/...` returns candles with `ingestionMode` values such as `backfill` and `live`
- `/v1/trades/...` returns aggregate trades
- replay endpoints return ascending windows
- ClickHouse returns non-zero counts for the populated historian tables
- PostgreSQL returns an empty result for `to_regclass(...)`

## 11. Backtesting Smoke Test

Use this when you want to verify that the new offline replay path reads from ClickHouse, honors
`BACKTEST_TIMERANGE_MS_BY_TIMEFRAME`, and reuses the live `emaCross` logic.

1. Ensure `BACKTEST_TIMERANGE_MS_BY_TIMEFRAME` is set (it is already present in `docker/.env.app.local`).

2. Run a backtest against an existing active analysis setting:

```bash
ANALYSIS_SETTING_ID="$(curl -fsS http://localhost:3020/v1/runtime-config/analysis-settings | jq -r '.[0].id')"

curl -fsS -X POST http://localhost:3050/v1/backtests \
  -H 'content-type: application/json' \
  -d "{
    \"analysisSettingId\": \"${ANALYSIS_SETTING_ID}\",
    \"warmupCandles\": null
  }" | jq
```

3. Optional: run an explicit time-window backtest instead of using the default legacy-style window:

```bash
END_TIME_MS="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
START_TIME_MS="$((END_TIME_MS - 6 * 60 * 60 * 1000))"

curl -fsS -X POST http://localhost:3050/v1/backtests \
  -H 'content-type: application/json' \
  -d "{
    \"analysisSettingId\": \"${ANALYSIS_SETTING_ID}\",
    \"startTime\": ${START_TIME_MS},
    \"endTime\": ${END_TIME_MS}
  }" | jq
```

Expected results:

- `backtestId` is present
- `finishedAt` is present
- `durationMs` is present
- `dataset.replayKlineCount` is non-zero
- `dataset.replayTradeCount` is non-zero
- `dataset.replayBookTickerCount` is non-zero when quote coverage exists for the window
- `timeWindow.windowSource` is `env` for the first request and `request` for the second
- `signals` contains offline EMA crossover events when the replay window has enough movement
- `trades` contains simulated entries/exits resolved from best bid/ask quotes with aggregate-trade fallback
- `summary.totalPnlUsd` reflects the quote-aware execution model for that window
- `executionAssumptions` shows the fee and slippage assumptions applied to the replay

4. Optional: verify the persisted run can be listed and retrieved:

```bash
BACKTEST_ID="$(curl -fsS -X POST http://localhost:3050/v1/backtests \
  -H 'content-type: application/json' \
  -d "{
    \"analysisSettingId\": \"${ANALYSIS_SETTING_ID}\",
    \"startTime\": ${START_TIME_MS},
    \"endTime\": ${END_TIME_MS}
  }" | jq -r '.backtestId')"

curl -fsS "http://localhost:3050/v1/backtests?limit=5" | jq
curl -fsS "http://localhost:3050/v1/backtests/${BACKTEST_ID}" | jq

docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml exec -T historical-store \
  clickhouse-client --user trading_bot_market_data --password trading_bot_market_data \
  --query "SELECT backtest_id, pair_code, timeframe_code, backtest_duration_ms, signal_count, trade_count FROM trading_bot_market_data.research_backtest_runs ORDER BY finished_at_ms DESC LIMIT 5"
```

Retention rule for this implemented slice:

- required history = `BACKTEST_TIMERANGE_MS_BY_TIMEFRAME` window for the timeframe + indicator warmup +
- default warmup = `slowPeriod * BACKTEST_WARMUP_MULTIPLIER`
- because the window values are milliseconds and keyed by timeframe, the amount of data required
  really does vary by timeframe, just like in the legacy system

Important legacy comparison:

- the legacy timeframe-specific window logic was correct
- the legacy use of lower-granularity `S1` data was a way to approximate intrabar execution
  resolution
- the current implementation replaces that with best bid/ask replay and aggregate-trade fallback
  for the retained window

## 12. Troubleshooting

`Missing required local env file`:

- copy `docker/.env.app.local.example` to `docker/.env.app.local`

`OPENBAO_TOKEN ... still has the example value`:

- edit `docker/.env.app.local`
- replace the placeholder with the real app token

OpenBao is not reachable:

- start `platform-ops` first with `npm run local:up`

OpenBao is uninitialized or sealed:

- complete the missing bootstrap or unseal steps in `platform-ops/docs/local-first-start.md`

PostgreSQL fails to start:

- inspect the logs:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml logs --no-color postgres
```

The API does not start:

- inspect API logs:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml logs --no-color api
```

The market-data service does not start:

- inspect market-data logs:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml logs --no-color market-data
```

The historical store does not start or does not contain historian data:

- inspect historical-store logs:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml logs --no-color historical-store
```

- inspect stored historian rows directly in ClickHouse:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml exec -T historical-store \
  clickhouse-client --multiquery --query "
    SELECT pair_code, timeframe_code, open_time, close_time
    FROM trading_bot_market_data.market_data_klines
    ORDER BY open_time DESC
    LIMIT 20;

    SELECT pair_code, aggregate_trade_id, trade_time
    FROM trading_bot_market_data.market_data_trades
    ORDER BY trade_time DESC
    LIMIT 20;

    SELECT pair_code, order_book_update_id, occurred_at_ms
    ORDER BY occurred_at_ms DESC
    LIMIT 20;
  "
```

The research-backtesting service does not start:

- inspect research-backtesting logs:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml logs --no-color research-backtesting
```

Backtests fail with missing-data errors:

- confirm that the ClickHouse historian contains the requested timeframe window:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml exec -T historical-store \
  clickhouse-client --query "
    SELECT
      pair_code,
      timeframe_code,
      toDateTime(min(open_time) / 1000) AS first_open_time,
      toDateTime(max(open_time) / 1000) AS last_open_time,
      countDistinct(open_time) AS candles
    FROM trading_bot_market_data.market_data_klines
    WHERE pair_code = 'BTCUSDT'
      AND timeframe_code = '1m'
    GROUP BY pair_code, timeframe_code
  "
```

- if the available window is too short, widen ClickHouse retention and let `market-data`
  continue ingesting until the needed range exists

## 13. Next Step

After the local infrastructure scaffold is ready, continue with:

- `docs/architecture-overview.md`
