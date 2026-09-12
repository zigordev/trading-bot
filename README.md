# trading-bot

Fresh repository for the new trading bot implementation.

Legacy code was moved to `../trading-bot-legacy/`.

## Repository shape

- `apps/control-plane/` — Node control-plane API (`@trading-bot/control-plane`)
- `apps/operator-console/` — Next.js operator console (`@trading-bot/operator-console`)
- `crates/market-data/`, `crates/research-backtesting/`, `crates/execution/` — Rust services
- `crates/strategy-engine/`, `crates/observability/` — Rust crates shared by those services
- `docker/` — app-local, app-dev and CI compose manifests + env templates
- `scripts/` — local stack, OpenBao startup, gitleaks pre-commit, licence and audit gates
- `.github/workflows/` — CI, release, governance workflows
- `docs/` — first-run guide, with the design notes under `docs/architecture/`

## Quick start

1. Install dependencies

```bash
npm ci
```

2. Start local app stack

```bash
npm run local:up
```

These commands only start and stop the app-specific local infrastructure. Shared
dependencies — OpenBao, Redpanda and the observability stack — come from
`platform-ops`, on the shared `platform_ops_shared` network. The app-local
services create the Kafka topics they need on startup, so there is no manual
Redpanda bootstrap step. For first-time setup, follow `docs/local-first-start.md`.

For an edit-and-refresh loop instead of a rebuild:

```bash
npm run local:dev
```

`local:up` builds and runs the production images. `local:dev` builds the `dev`
stage of each service instead and runs them under `docker compose watch`: the
control-plane under `tsx watch`, the operator console under `next dev`, and the
three Rust services under `cargo watch`, all fed by source synced from the host.
The Rust services share one named volume for `CARGO_TARGET_DIR`, so their
dependency artefacts are compiled once rather than three times — the first build
is long, and an incremental one is a few seconds. Both modes are the same
services on the same ports, so run one at a time.

3. Check stack

```bash
curl -fsS http://localhost:3020/health   # control-plane
curl -fsS http://localhost:3030/health   # market-data
curl -fsS http://localhost:3050/health   # research-backtesting
curl -fsS http://localhost:3070/health   # execution
curl -fsS http://localhost:3060          # operator console
```

4. Stop stack

```bash
npm run local:down
```

`npm run local:reset` drops the local volumes — Postgres and ClickHouse
included — and rebuilds from scratch.

## Quality commands

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test
npm run test:cov
```

`lint` runs the workspace linters and then `lint:rust` (`cargo clippy --workspace
--all-targets -- -D warnings`); `lint:rust:fmt` is the `cargo fmt` check. `test`
and `build` cover the control-plane and the operator console plus the
`market-data` and `research-backtesting` crates. The compose integration smoke
runs with `npm run test:integration`.

## Release + deploy model

- `Release Please` manages versioning/changelog + release PR.
- There is no deploy workflow yet. CI builds every image and scans it (SBOM +
  Trivy per image), but nothing is pushed to ECR and nothing is deployed —
  wiring that up is the next milestone for this repository.
- Platform infra/ops services are owned by `platform-ops`; this repo only ships
  app stack compose + app config under `docker/`.

## Current scope

This repository currently contains the first migration slice:

- target repository structure
- local infrastructure bootstrap for app-specific services
- runnable control-plane API
- runnable Rust `market-data` service
- PostgreSQL-backed CRUD for pairs, timeframes, strategies, risk profiles, trading defaults, and analysis settings
- direct config-change event publication into Redpanda
- automatic Kafka topic provisioning for the control-plane, market-data, and research-backtesting contracts
- a resolved runtime-config projection for active analysis settings
- hourly closed-window historical kline and aggregate-trade retrieval driven by that runtime projection
- ClickHouse-backed historical kline and aggregate-trade storage plus startup backfill and tail-gap repair
- historian inspection and replay-oriented query endpoints in `market-data`
- runnable Rust `research-backtesting` service
- direct ClickHouse kline and aggregate-trade replay for offline backtests
- offline replay using the shared strategy logic crate (`emaCross`, `strategy1`, `strategy2`)
- env-driven timeframe-specific backtest windows
- trade-tape-aware stop-loss, take-profit, reversal, fee, and slippage simulation in offline backtests
- persisted ClickHouse-backed backtest run storage plus list/get retrieval
- normalized signal publication into Redpanda
- normalized data-readiness publication into Redpanda on dedicated topics
- local-first documentation that assumes `platform-ops` is the shared base

No live order execution has been added yet.

## Current local service surface

`control-plane` on `http://localhost:3020`:

- `/docs`
- `/health`
- `/metrics`
- `/v1/info`
- `/v1/pairs`
- `/v1/timeframes`
- `/v1/strategies`
- `/v1/risk-profiles`
- `/v1/trading-defaults`
- `/v1/analysis-settings`
- `/v1/runtime-config/analysis-settings`

`market-data` on `http://localhost:3030`:

- `/health`
- `/metrics`
- `/v1/info`
- `/v1/subscriptions`
- `/v1/status`
- `/v1/klines/:pair_code/:timeframe_code`
- `/v1/trades/:pair_code`
- `/v1/replay/klines/:pair_code/:timeframe_code`
- `/v1/replay/trades/:pair_code`

`research-backtesting` on `http://localhost:3050`:

- `/health`
- `/metrics`
- `/v1/info`
- `/v1/status`
- `/v1/backtests`
- `/v1/backtests/:backtest_id`

## Docs

- `docs/architecture/current-platform-guide.md`
- `docs/architecture/remaining-implementation-work.md`
- `docs/architecture/architecture-overview.md`
- `docs/architecture/analysis-settings-architecture.md`
- `docs/architecture/config-change-events-architecture.md`
- `docs/architecture/general-settings-architecture.md`
- `docs/architecture/market-data-architecture.md`
- `docs/architecture/market-data-historical-retrieval.md`
- `docs/architecture/execution-architecture.md`
- `docs/architecture/backtest-replay-precision-guide.md`
- `docs/architecture/research-backtesting-architecture.md`
- `docs/architecture/research-settings-architecture.md`
- `docs/architecture/postgres-seed-data.md`
- `docs/local-first-start.md`
