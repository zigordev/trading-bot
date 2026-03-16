# Market-data Architecture

## Purpose

`market-data` is the first runtime service in the new repository, and it is now implemented as a
Rust crate at `crates/market-data`.

It exists to turn authored configuration into a live Binance event feed without coupling exchange
connectivity to the control-plane or to future strategy logic.

## Responsibilities

Current responsibilities:

- fetch the resolved runtime projection from `/v1/runtime-config/analysis-settings`
- derive one active kline subscription per unique `pairCode + timeframeCode`
- derive one active aggregate-trade stream and one book-ticker stream per active pair
- refresh that subscription set when config changes
- reconcile periodically even if broker messages were missed
- connect to Binance combined websocket streams
- normalize Binance kline, aggregate-trade, and book-ticker payloads into internal event shapes
- publish normalized market-data events into Redpanda on dedicated topics
- persist klines, aggregate trades, and book tickers in ClickHouse
- repair missing tail candles through bounded REST backfill on startup and refresh
- backfill aggregate trades from Binance REST so the historian can support fill-aware replay
- backfill book-ticker rows by refreshing a REST book-ticker snapshot when the stored stream is stale
- expose health, readiness, metrics, runtime inspection, historian inspection, and replay-oriented endpoints

Explicit non-responsibilities:

- storing secrets in PostgreSQL
- owning authored configuration
- executing strategies
- placing orders
- serving as the full replay-grade archive by itself
- running backtests itself

## Why It Consumes The Resolved Projection

The control-plane already owns the operator-managed configuration graph.

`market-data` therefore does not join `pairs`, `timeframes`, `strategies`, and `analysis_settings`
itself for configuration authoring. It consumes the resolved projection that the control-plane
materializes.

That gives it:

- one HTTP contract for startup bootstrap
- one config-change topic for near-real-time refresh
- no direct dependency on control-plane table joins
- automatic provisioning of its consumed and published Kafka topics during startup

## Subscription Model

The service groups the resolved projection in two ways:

- kline subscriptions are grouped by `pairCode + timeframeCode`
- pair-level subscriptions are grouped by `pairCode`

That means:

- if multiple strategies use `BTCUSDT` on `1m`, `market-data` opens one Binance kline stream
- if multiple strategies use the same pair, `market-data` still opens only one `aggTrade` stream
  and one `bookTicker` stream for that pair
- the resulting normalized event carries the interested `analysisSettingIds` and `strategyNames`
- downstream consumers can decide whether to use those hints or maintain their own config cache

Pair codes are normalized into Binance symbols by stripping separators and uppercasing. For
example:

- `BTCUSDT` -> `BTCUSDT`
- `BTC/USDT` -> `BTCUSDT`

## Refresh Model

The refresh flow is intentionally redundant for correctness:

1. on startup, fetch the control-plane runtime projection
2. derive subscriptions and connect the Binance stream
3. consume config-change events from Redpanda
4. when relevant resources change, debounce and refresh from the control-plane
5. also reconcile periodically on a timer

The periodic refresh exists so the service can converge even if it was temporarily unavailable and
missed broker messages.

## Binance Interaction

The live transport uses Binance combined websocket streams for:

- klines
- aggregate trades
- book tickers

REST is used for bounded kline backfill and tail-gap repair, plus aggregate-trade backfill aligned
to the stored kline window for each active pair.

Book-ticker backfill is now also performed on startup/refresh:

- for each active pair, market-data checks the latest stored book-ticker timestamp
- if older than `HISTORICAL_BOOK_TICKER_BACKFILL_INTERVAL_MS` (default 60s), it issues a single
  `api/v3/depth` snapshot fetch (`limit=5`) and stores the top level as `book_ticker` with `lastUpdateId`

Important limitation:

- Binance currently exposes only current order-book snapshots for this endpoint, not true historical
  point-in-time snapshots by timestamp. The service therefore repairs missing recent book-ticker coverage
  and ensures fresh continuity, but it cannot reconstruct arbitrary historical book-ticker history
  from arbitrary past times.

This split is the right default because it:

- avoids continuous REST polling overhead
- keeps live latency low for active subscriptions
- reserves REST request weight for recovery cases only
- lowers end-to-end latency for active subscriptions

If the websocket drops, the service reconnects using a bounded backoff.

## Storage Model

The ClickHouse historian now owns three tables inside the configured database
`HISTORICAL_STORE_DATABASE`:

- `market_data_klines`
- `market_data_trades`
- `market_data_book_tickers`

The current local default is:

- database: `trading_bot_market_data`
- kline table: `market_data_klines`
- trade table: `market_data_trades`
- book-ticker table: `market_data_book_tickers`

The historian uses these storage policies:

- `market_data_klines`
  - `ReplacingMergeTree`
  - monthly partitioning from `openTime`
  - ordered by `pairCode + timeframeCode + openTime`
  - TTL controlled by `HISTORICAL_KLINE_RETENTION_DAYS`
- `market_data_trades`
  - `ReplacingMergeTree`
  - daily partitioning from `tradeTime`
  - ordered by `pairCode + tradeTime + aggregateTradeId`
  - TTL controlled by `HISTORICAL_TRADE_RETENTION_DAYS`
- `market_data_book_tickers`
  - `ReplacingMergeTree`
  - daily partitioning from `occurredAt`
  - ordered by `pairCode + occurredAt + orderBookUpdateId`
  - TTL controlled by `HISTORICAL_BOOK_TICKER_RETENTION_DAYS`

That makes the implemented access patterns cheap:

- insert repeated updates for a candle keyed by `pairCode + timeframeCode + openTime`
- read the newest candle timestamp for a subscription
- list deduplicated recent candles for warmup and debugging
- list recent aggregate trades and book tickers for operator inspection
- read ascending time windows for replay-oriented consumers
- backfill a bounded missing tail after restart or refresh
- maintain aggregate-trade coverage for the same active replay window

On refresh, the service looks up the latest stored candle per active subscription. If it finds a
gap, it calls Binance REST `api/v3/klines` with `startTime` at the next expected candle and
inserts the returned rows into ClickHouse before continuing with live websocket ingestion.

For aggregate trades, the service uses the earliest stored kline for each active pair as the lower
bound for historical coverage, then pages Binance REST `api/v3/aggTrades` into ClickHouse from the
latest stored aggregate-trade id onward. This gives the offline backtester aggregate-trade tape
for the same active window without putting ClickHouse in the live decision path.

Book tickers are persisted from both live websocket and periodic snapshot backfill, where snapshot
rows share the same `order_book_update_id` stream key.

Historian reads now exist in two forms:

- recent inspection reads
  - `/v1/klines/{pair_code}/{timeframe_code}`
  - `/v1/trades/{pair_code}`
  - `/v1/book-tickers/{pair_code}`
- replay-oriented reads
  - `/v1/replay/klines/{pair_code}/{timeframe_code}`
  - `/v1/replay/trades/{pair_code}`
  - `/v1/replay/book-tickers/{pair_code}`

Replay-oriented reads accept `startTime`, `endTime`, and `limit` query parameters and return
ascending event order.

## Event Contracts

Current topics:

- `trading-bot.market-data.klines.v1`
- `trading-bot.market-data.trades.v1`
- `trading-bot.market-data.book-tickers.v1`

The service ensures these topics exist during startup, along with the configured
`CONFIG_CHANGE_EVENTS_TOPIC`, so a fresh local stack does not depend on prior broker traffic.

Shared envelope fields across the normalized events include:

- `eventId`
- `eventType`
- `source`
- `occurredAt`
- `exchange`
- `streamName`
- `pairCode`
- `symbol`
- `analysisSettingIds`
- `strategyNames`

Kline events additionally include:

- `timeframeCode`
- `periodMs`
- `openTime`
- `closeTime`
- `eventTime`
- `ingestionMode`
- `closed`
- `open`
- `high`
- `low`
- `close`
- `volume`
- `quoteVolume`
- `tradeCount`

Aggregate-trade events additionally include:

- `eventTime`
- `aggregateTradeId`
- `ingestionMode`
- `price`
- `quantity`
- `tradeTime`
- `marketMaker`

Book-ticker events additionally include:

- `orderBookUpdateId`
- `bidPrice`
- `bidQuantity`
- `askPrice`
- `askQuantity`

No secret material is published.

## Secrets

For the current slice, no Binance secret is required because public websocket streams plus public
REST klines are used.

If future market-data features require authenticated Binance endpoints, those credentials should be
resolved from OpenBao through static app configuration, not stored in PostgreSQL.

## Performance Notes

This service now uses a dedicated analytical historian rather than coupling market history to
PostgreSQL.

What is improved already:

- live subscriptions come from combined Binance websocket streams instead of repeated REST polling
- startup gap repair is parallelized with bounded concurrency
- deduplication removes repeated live/backfill events inside the running process
- the market-data service owns a dedicated historical candle store instead of coupling this concern
  to the control-plane or to Postgres

What is still intentionally deferred:

- cross-restart deduplication guarantees
- offline optimization job orchestration
- long-range archival tiering beyond the ClickHouse TTL windows

## Remaining Gaps

- stronger event deduplication guarantees across reconnects
- consumer-specific narrower topics if needed
- OpenTelemetry instrumentation
- authenticated Binance endpoints if they become necessary
