# Remaining Implementation Work

## Purpose

This document is the focused backlog for what is still missing in `trading-bot`.

It is intentionally ordered around the current priority:

1. verify that backtesting works correctly with the required historical data
2. close the main replay and historian gaps
3. implement live execution after replay behavior is trusted
4. leave optimization until the end

Use this together with:

- `docs/current-platform-guide.md`
- `docs/market-data-architecture.md`
- `docs/research-backtesting-architecture.md`
- `docs/local-first-start.md`

## What Is Already Good Enough To Test

These slices already exist and should be testable today:

- `control-plane`
  - CRUD for config resources
  - resolved runtime config
  - config-change events
- `market-data`
  - live Binance public ingestion
  - ClickHouse historian for klines, aggregate trades, and book tickers
  - replay-oriented read endpoints
- `strategy-engine`
  - live `emaCross` evaluation on closed klines
  - signal publication
- `research-backtesting`
  - ClickHouse-based historical replay
  - shared `emaCross` logic reused from the live strategy engine
  - quote-aware stop-loss, take-profit, reversal, fee, and slippage simulation with aggregate-trade fallback
  - persisted backtest run storage and retrieval in ClickHouse

## Current Priority Order

### 1. Backtesting verification first

This is the main current goal.

Before implementing live execution, the platform needs confidence that:

- the correct historical kline window is being read from ClickHouse
- the required aggregate trades exist for the replay window
- replay and live strategy logic stay aligned
- risk profile and trading-default settings actually affect the simulated results
- multiple pair/timeframe bindings work, not only one `BTCUSDT/1m` happy path

### 2. Finish the remaining backtesting gaps

After the current replay path is verified, the main missing work is:

- stronger historian retention and backfill controls for wider replay windows
- better automated integration coverage across multiple pair/timeframe bindings
- replay quality gating before result publication: require synchronized kline/trade/book-ticker coverage for each requested window, and expose explicit degraded-quality reasons when inputs are partial
- optional full order-book-aware fill modeling
- partial-fill modeling
- extraction of execution simulation into a crate shared directly with future live execution

The current replay path is materially better than a candle-close backtest, but it is not yet a
state-of-the-art execution simulator.

What is already good:

- fills are driven by historical aggregate trades and best bid/ask book-ticker quotes rather than
  candle closes
- stop-loss and take-profit checks use replayed quote/trade events instead of OHLC inference
- fee and slippage assumptions are explicit and returned in the backtest response
- the service refuses fill-aware backtests when aggregate-trade coverage is missing for the
  requested window

What still limits accuracy:

- slippage is still a fixed basis-points adjustment, not a market-state-dependent execution model
- fills assume the next eligible quote or aggregate trade is executable for the whole order
- no latency is modeled between signal generation, order placement, and exchange execution
- no queue position is modeled for limit-style behavior
- no partial fills are modeled
- no depth-of-book replay exists, only top-of-book bid/ask snapshots
- historical trade storage intentionally drops `quantity` and `market_maker`, which limits how far
  replay realism can be improved without a schema change
- open positions at the end of the replay window should be mark-to-market or explicitly closed
  under a configurable rule so run-to-run comparisons stay fair
- default `BACKTEST_FEE_BPS=0.0` and `BACKTEST_SLIPPAGE_BPS=0.0` are convenient for smoke tests but
  should not be treated as realistic research defaults

Recommended future execution-accuracy improvements, in order:

- keep historical trade `quantity` and `market_maker` fields in ClickHouse replay storage
- use book-ticker size and trade size to support partial-fill logic
- add configurable latency modeling for signal-to-order and order-to-fill delays
- replace fixed slippage with a state-based model using spread, short-horizon volatility, and
  order size relative to available liquidity
- add explicit end-of-window mark-to-market or forced-close behavior for still-open positions
- add optional deeper order-book or L2 replay so larger orders can walk the book instead of always
  assuming top-of-book execution

### 3. Live execution later

Real execution should be implemented only after replay behavior is trusted.

Still missing there:

- Binance private credential loading from OpenBao
- order submission
- order state machine
- reconciliation
- portfolio and position accounting
- reuse of the same execution rules already validated in replay

### 4. Optimization last

Optimization should come after:

- historian retention is stable
- replay is trusted
- execution rules are shared

Still missing there:

- batch optimization orchestration
- parameter sweeps
- optimization-result persistence and comparison
- selection and promotion workflow

## Recommended Local Verification Matrix

Use more than one pair and more than one timeframe so replay is not only tested on one narrow
path.

Recommended matrix:

- `BTCUSDT`
  - `1m`
  - `3m`
  - `5m`
- `ETHUSDT`
  - `1m`
  - `5m`
- `SOLUSDT`
  - `1m`

Those timeframes are deliberate:

- they are valid Binance intervals
- they match the current `research_settings` model
- they let you verify that the platform handles multiple subscriptions and replay windows

## Recommended Research Profile For Local Verification

The current local historian startup backfill is bounded by `HISTORICAL_BACKFILL_LIMIT=500`.

That means the approximate local retained kline window per timeframe is:

- `1m`
  - about `500 minutes`
  - about `8h 20m`
- `3m`
  - about `1500 minutes`
  - about `25h`
- `5m`
  - about `2500 minutes`
  - about `41h 40m`

Because of that, the existing `default` research profile is intentionally broader than the current
startup backfill and is not the best profile for immediate local smoke tests.

For local verification, use a smaller `smoke` profile:

- `1m`
  - `6h`
- `3m`
  - `12h`
- `5m`
  - `24h`

In milliseconds:

- `1m = 21_600_000`
- `3m = 43_200_000`
- `5m = 86_400_000`

With the current `emaCross` defaults of `fastPeriod=9`, `slowPeriod=21`, and
`BACKTEST_WARMUP_MULTIPLIER=5`, the approximate required retained history is:

- `1m`
  - `6h + 105m warmup`
- `3m`
  - `12h + 315m warmup`
- `5m`
  - `24h + 525m warmup`

That fits the current bounded kline historian. For quote-aware accuracy, the real constraint is
how much aggregate-trade and book-ticker history has been accumulated for the pair. If you want
legacy-sized default windows to work without explicit shorter requests, increase
`HISTORICAL_BACKFILL_LIMIT`, keep `market-data` running long enough to accumulate the matching
trade and quote history, and increase `BACKTEST_MAX_BOOK_TICKERS` if quote replay on a busy pair
hits a local cap.

## Seed The Verification Matrix

If your local database is empty, create the recommended matrix in this order.

Set the base URL:

```bash
BASE_URL=http://localhost:3020
```

Create extra pairs:

```bash
curl -fsS -X POST "$BASE_URL/v1/pairs" \
  -H 'content-type: application/json' \
  -d '{
    "code": "ETHUSDT",
    "operable": true,
    "originAssetNeededFunds": 1000,
    "destinationAssetNeededFunds": 1000
  }' | jq

curl -fsS -X POST "$BASE_URL/v1/pairs" \
  -H 'content-type: application/json' \
  -d '{
    "code": "SOLUSDT",
    "operable": true,
    "originAssetNeededFunds": 1000,
    "destinationAssetNeededFunds": 1000
  }' | jq
```

Create extra timeframes:

```bash
curl -fsS -X POST "$BASE_URL/v1/timeframes" \
  -H 'content-type: application/json' \
  -d '{
    "code": "3m",
    "longerTimeframeCode": "15m",
    "longerTimeframeMultiplier": 5,
    "periodMs": 180000,
    "operable": true
  }' | jq

curl -fsS -X POST "$BASE_URL/v1/timeframes" \
  -H 'content-type: application/json' \
  -d '{
    "code": "5m",
    "longerTimeframeCode": "15m",
    "longerTimeframeMultiplier": 3,
    "periodMs": 300000,
    "operable": true
  }' | jq
```

Make sure `BACKTEST_TIMERANGE_MS_BY_TIMEFRAME` matches the window you want to replay
(it is configured via `docker/.env.app.local`).

Create analysis bindings:

```bash
curl -fsS -X POST "$BASE_URL/v1/analysis-settings" \
  -H 'content-type: application/json' \
  -d '{
    "pairCode": "BTCUSDT",
    "timeframeCode": "3m",
    "strategyName": "emaCross",
    "riskProfileName": "default",
    "tradingDefaultsName": "default",
    "technicalAnalysisSettings": {
      "fastPeriod": 9,
      "slowPeriod": 21
    },
    "enabled": true
  }' | jq

curl -fsS -X POST "$BASE_URL/v1/analysis-settings" \
  -H 'content-type: application/json' \
  -d '{
    "pairCode": "BTCUSDT",
    "timeframeCode": "5m",
    "strategyName": "emaCross",
    "riskProfileName": "default",
    "tradingDefaultsName": "default",
    "technicalAnalysisSettings": {
      "fastPeriod": 9,
      "slowPeriod": 21
    },
    "enabled": true
  }' | jq

curl -fsS -X POST "$BASE_URL/v1/analysis-settings" \
  -H 'content-type: application/json' \
  -d '{
    "pairCode": "ETHUSDT",
    "timeframeCode": "1m",
    "strategyName": "emaCross",
    "riskProfileName": "default",
    "tradingDefaultsName": "default",
    "technicalAnalysisSettings": {
      "fastPeriod": 9,
      "slowPeriod": 21
    },
    "enabled": true
  }' | jq

curl -fsS -X POST "$BASE_URL/v1/analysis-settings" \
  -H 'content-type: application/json' \
  -d '{
    "pairCode": "ETHUSDT",
    "timeframeCode": "5m",
    "strategyName": "emaCross",
    "riskProfileName": "default",
    "tradingDefaultsName": "default",
    "technicalAnalysisSettings": {
      "fastPeriod": 9,
      "slowPeriod": 21
    },
    "enabled": true
  }' | jq

curl -fsS -X POST "$BASE_URL/v1/analysis-settings" \
  -H 'content-type: application/json' \
  -d '{
    "pairCode": "SOLUSDT",
    "timeframeCode": "1m",
    "strategyName": "emaCross",
    "riskProfileName": "default",
    "tradingDefaultsName": "default",
    "technicalAnalysisSettings": {
      "fastPeriod": 9,
      "slowPeriod": 21
    },
    "enabled": true
  }' | jq
```

If some rows already exist, the API will return `409 Conflict`. That is expected.

## Verify The Historian Is Populated

First confirm the runtime matrix:

```bash
curl -fsS http://localhost:3020/v1/runtime-config/analysis-settings | jq
curl -fsS http://localhost:3030/v1/subscriptions | jq
curl -fsS http://localhost:3030/v1/status | jq
```

Then inspect ClickHouse directly:

```bash
docker exec trading-bot-app-local-historical-store-1 \
  clickhouse-client --user trading_bot_market_data --password trading_bot_market_data \
  --query "SELECT pair_code, timeframe_code, countDistinct(open_time) AS candles FROM trading_bot_market_data.market_data_klines GROUP BY pair_code, timeframe_code ORDER BY pair_code, timeframe_code"
```

For a single pair/timeframe:

```bash
curl -fsS "http://localhost:3030/v1/klines/BTCUSDT/3m?limit=5" | jq
curl -fsS "http://localhost:3030/v1/trades/BTCUSDT?limit=5" | jq
curl -fsS "http://localhost:3030/v1/book-tickers/BTCUSDT?limit=5" | jq
```

## Run Backtests Against The Matrix

Use explicit `startTime` and `endTime` for local verification.

The default legacy-style backtest window ends at the previous midnight UTC. That is useful as a
model, but it is not the best smoke-test request when the local historian only holds a bounded
recent window.

Get the current analysis-setting IDs:

```bash
curl -fsS http://localhost:3020/v1/runtime-config/analysis-settings | jq -r '.[] | "\(.pairCode) \(.timeframeCode) \(.id)"'
```

Run example backtests:

```bash
END_TIME_MS="$(node -e 'console.log(Date.now())')"
START_1M_MS="$((END_TIME_MS - 6 * 60 * 60 * 1000))"
START_3M_MS="$((END_TIME_MS - 12 * 60 * 60 * 1000))"
START_5M_MS="$((END_TIME_MS - 24 * 60 * 60 * 1000))"

BTC_1M_ID="$(curl -fsS http://localhost:3020/v1/runtime-config/analysis-settings | jq -r '.[] | select(.pairCode == "BTCUSDT" and .timeframeCode == "1m") | .id')"
BTC_3M_ID="$(curl -fsS http://localhost:3020/v1/runtime-config/analysis-settings | jq -r '.[] | select(.pairCode == "BTCUSDT" and .timeframeCode == "3m") | .id')"
ETH_5M_ID="$(curl -fsS http://localhost:3020/v1/runtime-config/analysis-settings | jq -r '.[] | select(.pairCode == "ETHUSDT" and .timeframeCode == "5m") | .id')"

curl -fsS -X POST http://localhost:3050/v1/backtests \
  -H 'content-type: application/json' \
  -d "{
    \"analysisSettingId\": \"${BTC_1M_ID}\",
    \"researchSettingsName\": \"smoke\",
    \"windowKind\": \"backtesting\",
    \"startTime\": ${START_1M_MS},
    \"endTime\": ${END_TIME_MS}
  }" | jq

curl -fsS -X POST http://localhost:3050/v1/backtests \
  -H 'content-type: application/json' \
  -d "{
    \"analysisSettingId\": \"${BTC_3M_ID}\",
    \"researchSettingsName\": \"smoke\",
    \"windowKind\": \"backtesting\",
    \"startTime\": ${START_3M_MS},
    \"endTime\": ${END_TIME_MS}
  }" | jq

curl -fsS -X POST http://localhost:3050/v1/backtests \
  -H 'content-type: application/json' \
  -d "{
    \"analysisSettingId\": \"${ETH_5M_ID}\",
    \"researchSettingsName\": \"smoke\",
    \"windowKind\": \"backtesting\",
    \"startTime\": ${START_5M_MS},
    \"endTime\": ${END_TIME_MS}
  }" | jq
```

Important current behavior:

- `POST /v1/backtests` does not accept `closeOpenPositionAtEnd`
- still-open positions at the end of the replay window are not force-closed by the simulator today
- end-of-window forced close or mark-to-market remains future work

## Where To See Backtest Results

There is no separate UI yet. The current result surface is the API plus the supporting ClickHouse
tables.

Primary result location:

- `POST http://localhost:3050/v1/backtests`
- `GET http://localhost:3050/v1/backtests`
- `GET http://localhost:3050/v1/backtests/{backtest_id}`

The main fields to inspect in the response are:

- `analysis`
  - confirms which pair, timeframe, risk profile, and trading defaults were used
- `timeWindow`
  - confirms the effective replay and warmup window
- `dataset`
  - shows how many klines and aggregate trades were actually read
- `executionAssumptions`
  - shows fee and slippage assumptions applied
- `signals`
  - shows the emitted offline strategy signals
- `trades`
  - shows the simulated entries and exits
- `summary`
  - shows counts and total PnL
- `durationMs`
  - shows total backtest request processing time in milliseconds

Useful follow-up checks:

- `GET http://localhost:3050/v1/status`
  - shows `lastBacktest` after a run
- `GET http://localhost:3030/v1/replay/klines/{pair}/{timeframe}`
  - inspect the kline replay input
- `GET http://localhost:3030/v1/replay/trades/{pair}`
  - inspect the trade replay input
- ClickHouse in DataGrip
  - inspect `research_backtest_runs`
  - inspect `market_data_klines`
  - inspect `market_data_trades`

## Still Missing After Backtesting Verification

Once the current matrix is behaving correctly, this is still missing:

- historian improvements
  - stronger long-range backfill strategy
  - stronger Binance REST rate-limit handling for bulk history
  - wider retained history for arbitrary replay windows
- replay realism
  - reintroduce quote-aware replay only after the trade-only path is stable
  - restore book-ticker capture and storage later if execution modeling needs top-of-book context again
  - full order-book-aware fill matching
  - partial fills
  - richer portfolio accounting
- execution
  - private Binance integration via OpenBao
  - real order lifecycle
  - reconciliation
- optimization
  - orchestration
  - result storage
  - parameter sweep workflow
- broader strategy coverage
  - more strategies beyond `emaCross`

## What Should Stay Deferred

These should remain at the end:

- real execution
- optimization

The reason is simple:

- if replay is not trusted yet, live execution will encode the wrong assumptions
- if replay is not trusted yet, optimization will optimize noise instead of behavior
