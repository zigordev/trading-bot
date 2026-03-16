# Market Data Historical Retrieval Logic (Current Implementation)

This document describes exactly how historical market data is discovered, retrieved, stored, and made available for backtesting in the current local stack.

## Scope

- Service: `market-data` (`crates/market-data`)
- Store: ClickHouse (`trading-bot-historical-store`)
- Sources: Binance websocket streams + REST endpoints
- Consumers: `research-backtesting` and live `strategy-engine` (for inspection/replay readiness)

## 1) What data is persisted

Three historical tables are populated by `market-data`:

- `market_data_klines`
  - Key inputs: pair + timeframe + open time
  - Used as the primary source of indicator timeline
- `market_data_trades`
  - Key inputs: pair + aggregate trade id
  - Used for fill-aware execution replay
- `market_data_book_tickers`
  - Key inputs: pair + order book update id
  - Used for spread-aware fills when available

All three tables are created on startup with `ReplacingMergeTree` and TTL retention:

- `market_data_klines.TTL = HISTORICAL_KLINE_RETENTION_DAYS`
- `market_data_trades.TTL = HISTORICAL_TRADE_RETENTION_DAYS`
- `market_data_book_tickers.TTL = HISTORICAL_BOOK_TICKER_RETENTION_DAYS`

## 2) Service startup and control flow

### 2.1 Bootstrap sequence

When `market-data` starts:

1. It initializes HTTP/ClickHouse/Kafka clients.
2. It runs DB schema migrations (`ensure_schema`).
3. It ensures Redpanda/Kafka topics exist.
4. It performs an initial `perform_refresh("startup")`.
5. It starts background loops:
   - refresh loop (debounced, fed by config-change events + periodic reconcile),
   - Kafka config-change consumer,
   - periodic runtime refresh timer,
   - websocket stream manager.

### 2.2 Runtime refresh

`perform_refresh` does:

1. Fetch resolved analysis settings from:
   - `GET /v1/runtime-config/analysis-settings` (control-plane).
2. Derive active subscriptions:
   - one kline subscription per `(pair_code, timeframe_code)`,
   - one `aggTrade` + one `bookTicker` subscription per pair.
3. Publish subscription map to websocket loop.
4. Run backfill & gap repair for all active subscriptions.

Refresh sources:

- Config change event from `CONFIG_CHANGE_EVENTS_TOPIC`.
- Periodic timer (`RUNTIME_CONFIG_REFRESH_INTERVAL_MS`).
- Both can trigger `perform_refresh` in parallel; events are debounced (`CONFIG_REFRESH_DEBOUNCE_MS`).

## 3) Subscription model

`derive_active_subscriptions` groups resolved rows as:

- **kline subscriptions**
  - key = `{pair_code}:{timeframe_code}`
  - stream = `{symbol}@kline_{interval}`
- **pair subscriptions**
  - one `{symbol}@aggTrade`
  - one `{symbol}@bookTicker`

If several analysis settings share same pair/timeframe, only one live websocket channel is opened per type.

Subscription info is passed to websocket normalizers and used as context (`analysis_setting_ids`, `strategy_names`) in emitted events.

## 4) Live stream ingestion

`market-data` connects to Binance **combined stream**:

- endpoint from `BINANCE_STREAM_BASE_URL`
- stream names are joined as `streams=<stream1>/<stream2>/...`

Per message:

- parse envelope
- detect type (kline / aggTrade / bookTicker)
- normalize to internal models
- deduplicate via LRU event cache (`MARKET_EVENT_DEDUP_CAPACITY`)
- write to ClickHouse
- publish event to Kafka for live rows only (`ingestion_mode = "live"`):
  - klines: always publish
  - trades: publish only live
  - book-tickers: publish only live

Backfill rows are persisted too, but are not republished to Kafka (`ingestion_mode = "backfill"` for snapshot/repair rows).

## 5) Historical retrieval algorithms (Backfill + gap repair)

### 5.1 Klines (`/api/v3/klines`)

Function: `backfill_subscription`

- Determine period:
  - `period_ms` from timeframe
  - `required_end = align_to_period_ms(now_ms, period_ms)`
  - `required_lookback_ms = HISTORICAL_BACKFILL_LIMIT * period_ms`
  - `required_start = align_to_period_ms(required_end - required_lookback_ms, period_ms)`
- Compute:
  - `latest_open_time` for pair+timeframe
  - `current_count` of distinct `open_time` inside `[required_start, required_end]`
  - `required_count` inferred from range
- If count is already enough and last candle already beyond end, skip.
- Otherwise start REST paging from `next_start_ms`:
  - `limit = min(HISTORICAL_BACKFILL_LIMIT, 1000)`
  - query params: `symbol`, `interval`, `limit`, `startTime`
  - after each batch, continue from `last_open_time + period_ms`
- Stop when:
  - Binance returns fewer rows than `limit`, or
  - there is no progress, or
  - loops consumed required range.

This is tail-gap repair + warm-fill for active subscriptions.

### 5.2 Aggregate trades (`/api/v3/aggTrades`)

Function: `backfill_pair_trades_with_lookback`

For each active pair:

1. compute `required_window_start = now - (HISTORICAL_BACKFILL_LIMIT * required_period_ms)`
2. get earliest kline open time:
   - if none: skip trade repair
3. get checkpoint:
   - latest trade row: `(latest_trade_time, aggregate_trade_id)` via `latest_trade_checkpoint`
4. choose pagination strategy:
   - no checkpoint → `startTime = earliest_kline_open_time`
   - checkpoint is newer than required window start → force `startTime = required_window_start`
   - otherwise → `fromId = latest_aggregate_trade_id + 1`
5. page REST with:
   - `symbol`
   - `limit = min(HISTORICAL_TRADE_BACKFILL_LIMIT, 1000)`
   - either `startTime` or `fromId`
6. persist each row and advance cursor (`fromId = last_trade_id + 1`)

Loop bounded by:
- `HISTORICAL_TRADE_BACKFILL_MAX_BATCHES` (warn when exhausted).

### 5.3 Book tickers (`/api/v3/depth`)

Function: `backfill_pair_book_ticker`

This is not a full historical replay path; it is continuity-aware checkpoint repair:

- check latest checkpoint:
  - `latest_book_ticker_checkpoint` (last `occurred_at_ms`)
- if checkpoint age > `HISTORICAL_BOOK_TICKER_BACKFILL_INTERVAL_MS` (default 60s) or absent:
  - request `GET /api/v3/depth?symbol=...&limit=5`
  - take top-level bid/ask
  - normalize as backfill book-ticker snapshot and store
- else skip.

This design gives near-real continuation from current time, but does not reconstruct deep historical ticker timelines arbitrarily.

## 6) Normalization + dedupe guarantees

- **event_id** patterns:
  - kline: `{subscription}:{open_time}:{event_time}:{state}`
  - trade: `{pair}:trade:{aggregate_trade_id}`
  - bookTicker live: `{pair}:book:{update_id}`
  - bookTicker backfill: `{pair}:book-backfill:{id-or-time}`
- duplicate events are discarded through in-memory LRU dedup cache before write/publish.
- storage is append-style with `ReplacingMergeTree(updated_at_ms)` to keep latest version by key.

## 7) Replay/read API and how it is used by backtesting

`market-data` exposes:

- recent reads:
  - `/v1/klines/{pair}/{tf}`
  - `/v1/trades/{pair}`
  - `/v1/book-tickers/{pair}`
- replay reads:
  - `/v1/replay/klines/{pair}/{tf}?startTime=...&endTime=...&limit=...`
  - `/v1/replay/trades/{pair}?startTime=...&endTime=...&limit=...`
  - `/v1/replay/book-tickers/{pair}?startTime=...&endTime=...&limit=...`

In `research-backtesting`, `resolve_input` requires:

- at least one replay kline row in window (otherwise fail),
- at least one aggregate trade in window (otherwise fail with fill-aware warning message).

Book tickers are optional; missing rows degrade quote realism but do not currently stop the run.

## 8) Why some backtests may fail in practice

Most common failure messages:

- `no historical klines ... were found ...`
- `no historical aggregate trades were found ... fill-aware backtesting needs market_data_trades coverage`

Typical causes:

- `analysis settings` or timeframe changed and backfill not re-triggered yet,
- trade table window coverage missing for requested replay span,
- insufficient startup repair for older periods than current configured window logic.

## 9) Why this is called "historical retrieval"

It is mixed-mode:

- **tail-oriented bounded backfill** at startup and refresh
- **live stream growth** while service stays up
- **continuous repair** on every refresh cycle

This gives fast recovery and reliable recent replay, while keeping API load controlled (bounded batch sizes and bounded concurrency).

## 10) Practical tuning map

Use these env vars from `crates/market-data/src/config.rs`:

- `HISTORICAL_BACKFILL_LIMIT`
  - kline lookback in candles (`HISTORICAL_BACKFILL_LIMIT` periods) and max trade lookback window base
- `HISTORICAL_TRADE_BACKFILL_LIMIT`
  - page size cap before Binance batch cap for each trade query (internally capped to 1000)
- `HISTORICAL_TRADE_BACKFILL_MAX_BATCHES`
  - upper bound on trade backfill batch count
- `HISTORICAL_BACKFILL_MAX_CONCURRENCY`
- `HISTORICAL_BOOK_TICKER_BACKFILL_INTERVAL_MS`
  - when to force fresh book-ticker snapshot
- `BINANCE_REST_MAX_RETRIES`, `BINANCE_REST_RETRY_BACKOFF_MS`
- `HISTORICAL_*_RETENTION_DAYS`
- `MARKET_EVENT_DEDUP_CAPACITY`
- `RUNTIME_CONFIG_REFRESH_INTERVAL_MS`, `CONFIG_REFRESH_DEBOUNCE_MS`
- `HISTORICAL_STORE_COMPACTION_ENABLED` (default `true` in local sample)
- `HISTORICAL_STORE_COMPACTION_INTERVAL_MS` (default `180000`)
- `HISTORICAL_STORE_COMPACTION_AFTER_REFRESH` (default `false`)  
  when `true`, runs `OPTIMIZE TABLE ... FINAL` immediately after each successful
  refresh/backfill cycle as well as on the periodic loop.

`HISTORICAL_STORE_COMPACTION_ENABLED=true` runs a background compaction loop that executes:

`OPTIMIZE TABLE ... FINAL` on:
- `market_data_klines`
- `market_data_trades`
- `market_data_book_tickers`

The loop runs once on startup and then every `HISTORICAL_STORE_COMPACTION_INTERVAL_MS`.
This removes inactive `ReplacingMergeTree` parts from completed merges, so those parts are not kept indefinitely.

## 11) Operational checks

Useful operational endpoints:

- `GET /v1/status` and `GET /v1/subscriptions` (service view)
- `GET /health/readiness` (degraded when dependencies/config stale)

Useful quick validation queries (against ClickHouse):

- latest row windows per table:
  - `SELECT max(open_time) ... FROM market_data_klines`
  - `SELECT max(trade_time) ... FROM market_data_trades`
  - `SELECT max(occurred_at_ms) ... FROM market_data_book_tickers`
- per-pair continuity counts and checkpoints:
  - use existing methods `latest_kline_open_time`, `kline_open_time_count_in_range`, `latest_trade_checkpoint`, `latest_book_ticker_checkpoint` (via DB wrapper / service methods).

## 12) Files of interest

- `crates/market-data/src/config.rs` (env config)
- `crates/market-data/src/service.rs` (startup, streams, backfill)
- `crates/market-data/src/subscriptions.rs` (active pair/timeframe derivation)
- `crates/market-data/src/events.rs` (normalization, ingestion mode, event IDs)
- `crates/market-data/src/db.rs` (schema, checkpoints, replay/recent reads)
- `crates/market-data/src/main.rs` (historian and replay endpoints)
- `crates/research-backtesting/src/service.rs` (replay input contracts and data requirements)
