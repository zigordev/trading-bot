use std::sync::Arc;
use std::time::Instant;

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Datelike, Duration, TimeZone, Utc};
use serde::Serialize;
use std::time::Duration as StdDuration;
use trading_bot_market_data::db::{Database, StoredBacktestRunSummary, StoredBacktestRunWrite};
use trading_bot_market_data::models::PersistedBookTickerRecord as HistoricalBookTickerRecord;
use trading_bot_market_data::models::PersistedKlineRecord as HistoricalKlineRecord;
use trading_bot_market_data::models::PersistedTradeRecord as HistoricalTradeRecord;
use trading_bot_strategy_engine::{
    models::{MarketDataKlineEvent, PersistedKlineRecord, ResolvedAnalysisSettingsRecord},
    strategy_logic::{AnalysisEvaluator, AnalysisSpec, build_analysis_spec},
};

use crate::{
    config::AppConfig,
    execution_simulation::{SimulationConfig, simulate_trade_replay},
    metrics::Metrics,
    models::{
        BacktestDatasetSummary, BacktestExecutionAssumptions, BacktestRequest, BacktestResponse,
        BacktestSignalRecord, BacktestSummary, BacktestTimeWindow, BacktestWindowKind,
        LastBacktestStatus, PersistedBacktestRunSummary, ResearchSettingsRecord,
        ResolvedBacktestInput, SimulatedTradeRecord,
    },
};
use tracing::{error, info, warn};
use uuid::Uuid;

#[cfg(test)]
const DAY_MS: i64 = 86_400_000;

#[derive(Clone)]
pub struct ResearchBacktestingService {
    inner: Arc<Inner>,
}

struct Inner {
    config: AppConfig,
    metrics: Metrics,
    control_plane_client: reqwest::Client,
    historical_store: Database,
    status: tokio::sync::RwLock<RuntimeStatus>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub started: bool,
    pub dependencies: DependencyStatus,
    pub last_backtest: Option<LastBacktestStatus>,
    pub otel_exporter_configured: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub control_plane: String,
    pub historical_store: String,
    pub last_checked_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessPayload {
    pub status: String,
    pub service: String,
    pub checks: ReadinessChecks,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessChecks {
    pub control_plane: String,
    pub historical_store: String,
}

#[derive(Clone, Debug)]
struct CompletedBacktest {
    response: BacktestResponse,
}

impl ResearchBacktestingService {
    pub async fn new(config: AppConfig) -> Result<Self> {
        let control_plane_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(
                config.control_plane_request_timeout_ms,
            ))
            .build()?;
        let historical_store = Database::from_connection(
            format!(
                "http://{}:{}",
                config.historical_store_host, config.historical_store_port
            ),
            config.historical_store_database.clone(),
            config.historical_store_user.clone(),
            config.historical_store_password.clone(),
        )?;
        let metrics = Metrics::new()?;

        let service = Self {
            inner: Arc::new(Inner {
                config: config.clone(),
                metrics,
                control_plane_client,
                historical_store,
                status: tokio::sync::RwLock::new(RuntimeStatus {
                    started: false,
                    dependencies: DependencyStatus::default(),
                    last_backtest: None,
                    otel_exporter_configured: config.otel_exporter_otlp_endpoint.is_some(),
                }),
            }),
        };

        service
            .inner
            .historical_store
            .ensure_research_backtest_schema(config.backtest_result_retention_days)
            .await?;

        service.refresh_dependencies().await?;
        {
            let mut status = service.inner.status.write().await;
            status.started = true;
        }

        if service.inner.config.auto_backtest_enabled {
            service.start_auto_backtest_scheduler();
        }

        Ok(service)
    }

    fn start_auto_backtest_scheduler(self: &Self) {
        let service = self.clone();
        let interval = StdDuration::from_secs(service.inner.config.auto_backtest_interval_seconds);
        let research_settings_name = service
            .inner
            .config
            .auto_backtest_research_settings_name
            .clone();
        let window_kind = service.inner.config.auto_backtest_window_kind;

        tokio::spawn(async move {
            loop {
                if let Err(error) = service
                    .run_enabled_analysis_backtests(&research_settings_name, window_kind)
                    .await
                {
                    error!(
                        error = %error,
                        research_settings_name = %research_settings_name,
                        window_kind = %window_kind.as_str(),
                        "scheduled backtest batch failed"
                    );
                }
                tokio::time::sleep(interval).await;
            }
        });
    }

    pub fn config_snapshot(&self) -> AppConfig {
        self.inner.config.clone()
    }

    pub fn metrics_text(&self) -> Result<String> {
        self.inner.metrics.encode().map_err(Into::into)
    }

    pub async fn status(&self) -> RuntimeStatus {
        self.inner.status.read().await.clone()
    }

    pub async fn readiness(&self) -> ReadinessPayload {
        let dependency_status = match self.refresh_dependencies().await {
            Ok(status) => status,
            Err(_) => self.inner.status.read().await.dependencies.clone(),
        };
        let dependencies_fresh_enough = dependency_status
            .last_checked_at
            .as_ref()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|timestamp| {
                Utc::now()
                    .signed_duration_since(timestamp.with_timezone(&Utc))
                    .num_milliseconds()
                    <= self.inner.config.readiness_max_dependency_age_ms as i64
            })
            .unwrap_or(false);
        let control_plane = if dependencies_fresh_enough {
            dependency_status.control_plane.clone()
        } else {
            "down".to_string()
        };
        let historical_store = if dependencies_fresh_enough {
            dependency_status.historical_store.clone()
        } else {
            "down".to_string()
        };
        let status = if control_plane == "up" && historical_store == "up" {
            "ok"
        } else {
            "degraded"
        };

        ReadinessPayload {
            status: status.to_string(),
            service: self.inner.config.service_name.clone(),
            checks: ReadinessChecks {
                control_plane,
                historical_store,
            },
        }
    }

    pub async fn run_backtest(&self, request: BacktestRequest) -> Result<BacktestResponse> {
        let started_at = Instant::now();
        if let Err(error) = self.refresh_dependencies().await {
            self.inner
                .metrics
                .backtest_runs_total
                .with_label_values(&["error"])
                .inc();
            return Err(error);
        }

        let resolved = self.resolve_input(&request).await?;
        let completed = execute_backtest(
            &self.inner.config.service_name,
            resolved,
            self.inner.config.default_fee_bps,
            self.inner.config.default_slippage_bps,
            started_at.elapsed().as_millis() as i64,
        )?;
        let persisted_run = persisted_backtest_run(&completed.response)?;
        self.inner
            .historical_store
            .insert_backtest_run(&persisted_run)
            .await?;

        self.inner
            .metrics
            .backtest_runs_total
            .with_label_values(&["success"])
            .inc();
        self.inner
            .metrics
            .replayed_klines_total
            .inc_by(completed.response.dataset.replay_kline_count as u64);
        self.inner
            .metrics
            .emitted_signals_total
            .inc_by(completed.response.summary.signal_count as u64);
        self.inner
            .metrics
            .simulated_trades_total
            .inc_by(completed.response.summary.trade_count as u64);

        {
            let mut status = self.inner.status.write().await;
            status.last_backtest = Some(map_last_backtest_status(persisted_run_summary(
                &persisted_run,
            ))?);
        }

        Ok(completed.response)
    }

    pub async fn list_backtests(&self, limit: usize) -> Result<Vec<PersistedBacktestRunSummary>> {
        self.inner
            .historical_store
            .list_backtest_runs(limit.clamp(1, 100) as i64)
            .await?
            .into_iter()
            .map(map_persisted_backtest_summary)
            .collect()
    }

    pub async fn get_backtest(&self, backtest_id: &str) -> Result<Option<BacktestResponse>> {
        let Some(run) = self
            .inner
            .historical_store
            .get_backtest_run(backtest_id)
            .await?
        else {
            return Ok(None);
        };

        Ok(Some(serde_json::from_str::<BacktestResponse>(
            &run.response_json,
        )?))
    }

    async fn run_enabled_analysis_backtests(
        &self,
        research_settings_name: &str,
        window_kind: BacktestWindowKind,
    ) -> Result<usize> {
        let analyses = self
            .fetch_runtime_analysis_settings()
            .await?
            .into_iter()
            .filter(|analysis| analysis.enabled)
            .collect::<Vec<_>>();

        if analyses.is_empty() {
            warn!("no enabled analysis settings found for scheduled backtests");
            return Ok(0);
        }

        let mut ran = 0usize;
        let mut failed = 0usize;

        for analysis in analyses {
            let request = BacktestRequest {
                analysis_setting_id: analysis.id.clone(),
                research_settings_name: research_settings_name.to_string(),
                window_kind,
                start_time: None,
                end_time: None,
                warmup_candles: None,
                close_open_position_at_end: Some(true),
            };
            if let Err(error) = self.run_backtest(request).await {
                failed += 1;
                warn!(
                    error = %error,
                    analysis_setting_id = %analysis.id,
                    pair_code = %analysis.pair_code,
                    timeframe_code = %analysis.timeframe_code,
                    strategy_name = %analysis.strategy_name,
                    "scheduled backtest failed"
                );
            } else {
                ran += 1;
            }
        }

        info!(
            ran = ran,
            failed = failed,
            total = ran + failed,
            research_settings_name = %research_settings_name,
            window_kind = %window_kind.as_str(),
            "scheduled backtest batch completed"
        );

        Ok(ran)
    }

    async fn resolve_input(&self, request: &BacktestRequest) -> Result<ResolvedBacktestInput> {
        let analyses = self.fetch_runtime_analysis_settings().await?;
        let analysis = analyses
            .into_iter()
            .find(|record| record.id == request.analysis_setting_id)
            .with_context(|| {
                format!(
                    "analysis setting {} was not found in the resolved runtime config",
                    request.analysis_setting_id
                )
            })?;

        let research_settings = self
            .fetch_research_settings()
            .await?
            .into_iter()
            .find(|record| record.name == request.research_settings_name && record.enabled)
            .with_context(|| {
                format!(
                    "enabled research settings profile {} was not found",
                    request.research_settings_name
                )
            })?;

        let Some(spec) = build_analysis_spec(&analysis)? else {
            bail!(
                "analysis setting {} is not runnable offline because its strategy/runtime state is unsupported",
                analysis.id
            );
        };

        let time_window = resolve_time_window(
            &analysis,
            &research_settings,
            request,
            &spec,
            self.inner.config.default_warmup_multiplier,
        )?;
        let expected_candles = expected_candle_count(
            time_window.effective_warmup_start_time,
            time_window.requested_end_time,
            analysis.timeframe.period_ms,
        )?;
        if expected_candles > self.inner.config.max_backtest_klines {
            bail!(
                "requested replay needs {} klines, which exceeds BACKTEST_MAX_KLINES={}",
                expected_candles,
                self.inner.config.max_backtest_klines
            );
        }
        let expected_trades = self
            .inner
            .config
            .max_backtest_trades
            .min((expected_candles.saturating_mul(1_000)).max(10_000));
        let expected_book_tickers = self
            .inner
            .config
            .max_backtest_book_tickers
            .min((expected_candles.saturating_mul(2_000)).max(50_000));

        let rows = self
            .inner
            .historical_store
            .replay_klines(
                &analysis.pair_code,
                &analysis.timeframe_code,
                Some(time_window.effective_warmup_start_time),
                Some(time_window.requested_end_time),
                expected_candles as i64,
            )
            .await?
            .into_iter()
            .map(map_historical_kline_row)
            .filter(|row| row.closed)
            .collect::<Vec<_>>();
        let replay_trades = self
            .inner
            .historical_store
            .replay_trades(
                &analysis.pair_code,
                Some(time_window.requested_start_time),
                Some(time_window.requested_end_time),
                expected_trades as i64,
            )
            .await?
            .into_iter()
            .map(map_historical_trade_row)
            .collect::<Vec<_>>();
        let replay_book_tickers = self
            .inner
            .historical_store
            .replay_book_tickers(
                &analysis.pair_code,
                Some(time_window.requested_start_time),
                Some(time_window.requested_end_time),
                expected_book_tickers as i64,
            )
            .await?
            .into_iter()
            .map(map_historical_book_ticker_row)
            .collect::<Vec<_>>();

        let mut warmup_rows = Vec::new();
        let mut replay_rows = Vec::new();
        for row in rows {
            if row.open_time < time_window.requested_start_time {
                warmup_rows.push(row);
            } else if row.open_time >= time_window.requested_start_time
                && row.open_time < time_window.requested_end_time
            {
                replay_rows.push(row);
            }
        }

        if replay_rows.is_empty() {
            bail!(
                "no historical klines were found in ClickHouse for {} {} within {}..{}",
                analysis.pair_code,
                analysis.timeframe_code,
                time_window.requested_start_time,
                time_window.requested_end_time
            );
        }

        if replay_trades.is_empty() {
            // Enrich the error with a quick coverage snapshot so operators can
            // see what trade data exists for the requested window.
            let trade_coverage = self
                .inner
                .historical_store
                .trade_window_coverage_in_range(
                    &analysis.pair_code,
                    time_window.requested_start_time,
                    time_window.requested_end_time,
                )
                .await
                .unwrap_or_else(|error| {
                    warn!(
                        error = %error,
                        pair_code = %analysis.pair_code,
                        requested_start_time = time_window.requested_start_time,
                        requested_end_time = time_window.requested_end_time,
                        "failed to compute trade window coverage for empty backtest window"
                    );
                    trading_bot_market_data::db::WindowCoverage {
                        row_count: 0,
                        min_time: None,
                        max_time: None,
                    }
                });

            warn!(
                pair_code = %analysis.pair_code,
                timeframe_code = %analysis.timeframe_code,
                requested_start_time = time_window.requested_start_time,
                requested_end_time = time_window.requested_end_time,
                trade_row_count = trade_coverage.row_count,
                trade_min_time = ?trade_coverage.min_time,
                trade_max_time = ?trade_coverage.max_time,
                "backtest window has no historical aggregate trades; coverage snapshot for requested window"
            );

            bail!(
                "no historical aggregate trades were found in ClickHouse for {} within {}..{}; fill-aware backtesting needs market_data_trades coverage (trade_row_count={}, trade_min_time={:?}, trade_max_time={:?})",
                analysis.pair_code,
                time_window.requested_start_time,
                time_window.requested_end_time,
                trade_coverage.row_count,
                trade_coverage.min_time,
                trade_coverage.max_time
            );
        }

        Ok(ResolvedBacktestInput {
            analysis,
            research_settings,
            window_kind: request.window_kind,
            time_window,
            warmup_rows,
            replay_rows,
            replay_trades,
            replay_book_tickers,
            close_open_position_at_end: request.close_open_position_at_end.unwrap_or(true),
        })
    }

    async fn refresh_dependencies(&self) -> Result<DependencyStatus> {
        let mut last_error = None;
        let control_plane = match self.check_control_plane().await {
            Ok(()) => {
                self.inner.metrics.control_plane_connected.set(1);
                "up".to_string()
            }
            Err(error) => {
                self.inner.metrics.control_plane_connected.set(0);
                last_error = Some(error.to_string());
                "down".to_string()
            }
        };
        let historical_store = match self.inner.historical_store.ping().await {
            Ok(()) => {
                self.inner.metrics.historical_store_connected.set(1);
                "up".to_string()
            }
            Err(error) => {
                self.inner.metrics.historical_store_connected.set(0);
                last_error = Some(error.to_string());
                "down".to_string()
            }
        };

        let dependencies = DependencyStatus {
            control_plane,
            historical_store,
            last_checked_at: Some(Utc::now().to_rfc3339()),
            last_error,
        };

        let mut status = self.inner.status.write().await;
        status.dependencies = dependencies.clone();
        Ok(dependencies)
    }

    async fn check_control_plane(&self) -> Result<()> {
        let response = self
            .inner
            .control_plane_client
            .get(format!(
                "{}/health/readiness",
                self.inner.config.control_plane_base_url
            ))
            .send()
            .await?;

        if !response.status().is_success() {
            bail!(
                "control-plane readiness returned status {}",
                response.status()
            );
        }

        Ok(())
    }

    async fn fetch_runtime_analysis_settings(&self) -> Result<Vec<ResolvedAnalysisSettingsRecord>> {
        let response = self
            .inner
            .control_plane_client
            .get(format!(
                "{}/v1/runtime-config/analysis-settings",
                self.inner.config.control_plane_base_url
            ))
            .send()
            .await?;
        let response = response.error_for_status()?;
        Ok(response
            .json::<Vec<ResolvedAnalysisSettingsRecord>>()
            .await?)
    }

    async fn fetch_research_settings(&self) -> Result<Vec<ResearchSettingsRecord>> {
        let response = self
            .inner
            .control_plane_client
            .get(format!(
                "{}/v1/research-settings",
                self.inner.config.control_plane_base_url
            ))
            .send()
            .await?;
        let response = response.error_for_status()?;
        Ok(response.json::<Vec<ResearchSettingsRecord>>().await?)
    }
}

fn map_historical_kline_row(row: HistoricalKlineRecord) -> PersistedKlineRecord {
    PersistedKlineRecord {
        pair_code: row.pair_code,
        symbol: row.symbol,
        timeframe_code: row.timeframe_code,
        period_ms: row.period_ms,
        open_time: row.open_time,
        close_time: row.close_time,
        event_time: row.event_time,
        occurred_at: row.occurred_at,
        ingestion_mode: row.ingestion_mode,
        closed: row.closed,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        quote_volume: row.quote_volume,
        trade_count: row.trade_count,
        updated_at: row.updated_at,
    }
}

fn map_historical_trade_row(row: HistoricalTradeRecord) -> HistoricalTradeRecord {
    row
}

fn map_historical_book_ticker_row(row: HistoricalBookTickerRecord) -> HistoricalBookTickerRecord {
    row
}

fn persisted_backtest_run(response: &BacktestResponse) -> Result<StoredBacktestRunWrite> {
    Ok(StoredBacktestRunWrite {
        backtest_id: response.backtest_id.clone(),
        finished_at_ms: DateTime::parse_from_rfc3339(&response.finished_at)
            .with_context(|| format!("invalid finishedAt timestamp: {}", response.finished_at))?
            .timestamp_millis(),
        duration_ms: response.duration_ms,
        analysis_setting_id: response.analysis_setting_id.clone(),
        pair_code: response.analysis.pair_code.clone(),
        timeframe_code: response.analysis.timeframe_code.clone(),
        strategy_name: response.analysis.strategy_name.clone(),
        research_settings_name: response.research_settings_name.clone(),
        research_settings_id: response.research_settings_id.clone(),
        window_kind: response.window_kind.as_str().to_string(),
        requested_start_time: response.time_window.requested_start_time,
        requested_end_time: response.time_window.requested_end_time,
        effective_warmup_start_time: response.time_window.effective_warmup_start_time,
        effective_warmup_candles: response.time_window.effective_warmup_candles as i64,
        configured_duration_ms: response.time_window.configured_duration_ms,
        replay_kline_count: response.dataset.replay_kline_count as i64,
        replay_trade_count: response.dataset.replay_trade_count as i64,
        signal_count: response.summary.signal_count as i64,
        trade_count: response.summary.trade_count as i64,
        total_pnl_percent: response.summary.total_pnl_percent,
        closed_open_position_at_end: response.summary.closed_open_position_at_end,
        response_json: serde_json::to_string(response)?,
    })
}

fn persisted_run_summary(run: &StoredBacktestRunWrite) -> StoredBacktestRunSummary {
    StoredBacktestRunSummary {
        backtest_id: run.backtest_id.clone(),
        finished_at_ms: run.finished_at_ms,
        duration_ms: run.duration_ms,
        analysis_setting_id: run.analysis_setting_id.clone(),
        pair_code: run.pair_code.clone(),
        timeframe_code: run.timeframe_code.clone(),
        strategy_name: run.strategy_name.clone(),
        research_settings_name: run.research_settings_name.clone(),
        window_kind: run.window_kind.clone(),
        requested_start_time: run.requested_start_time,
        requested_end_time: run.requested_end_time,
        replay_kline_count: run.replay_kline_count,
        replay_trade_count: run.replay_trade_count,
        signal_count: run.signal_count,
        trade_count: run.trade_count,
        total_pnl_percent: run.total_pnl_percent,
    }
}

fn parse_backtest_window_kind(value: &str) -> Result<BacktestWindowKind> {
    match value {
        "backtesting" => Ok(BacktestWindowKind::Backtesting),
        "favorableTimeslots" => Ok(BacktestWindowKind::FavorableTimeslots),
        "optimizationValidity" => Ok(BacktestWindowKind::OptimizationValidity),
        _ => bail!("unknown persisted backtest window kind: {value}"),
    }
}

fn map_persisted_backtest_summary(
    row: StoredBacktestRunSummary,
) -> Result<PersistedBacktestRunSummary> {
    Ok(PersistedBacktestRunSummary {
        backtest_id: row.backtest_id,
        finished_at: millis_to_rfc3339(row.finished_at_ms)?,
        duration_ms: row.duration_ms,
        analysis_setting_id: row.analysis_setting_id,
        pair_code: row.pair_code,
        timeframe_code: row.timeframe_code,
        strategy_name: row.strategy_name,
        research_settings_name: row.research_settings_name,
        window_kind: parse_backtest_window_kind(&row.window_kind)?,
        requested_start_time: row.requested_start_time,
        requested_end_time: row.requested_end_time,
        replay_kline_count: row.replay_kline_count as usize,
        replay_trade_count: row.replay_trade_count as usize,
        signal_count: row.signal_count as usize,
        trade_count: row.trade_count as usize,
        total_pnl_percent: row.total_pnl_percent,
    })
}

fn map_last_backtest_status(row: StoredBacktestRunSummary) -> Result<LastBacktestStatus> {
    Ok(LastBacktestStatus {
        backtest_id: row.backtest_id,
        finished_at: millis_to_rfc3339(row.finished_at_ms)?,
        duration_ms: row.duration_ms,
        analysis_setting_id: row.analysis_setting_id,
        pair_code: row.pair_code,
        timeframe_code: row.timeframe_code,
        research_settings_name: row.research_settings_name,
        window_kind: parse_backtest_window_kind(&row.window_kind)?,
        replay_kline_count: row.replay_kline_count as usize,
        signal_count: row.signal_count as usize,
        trade_count: row.trade_count as usize,
    })
}

fn millis_to_rfc3339(value: i64) -> Result<String> {
    let timestamp = Utc
        .timestamp_millis_opt(value)
        .single()
        .with_context(|| format!("invalid unix timestamp in millis: {value}"))?;
    Ok(timestamp.to_rfc3339())
}

fn resolve_time_window(
    analysis: &ResolvedAnalysisSettingsRecord,
    research_settings: &ResearchSettingsRecord,
    request: &BacktestRequest,
    spec: &AnalysisSpec,
    default_warmup_multiplier: usize,
) -> Result<BacktestTimeWindow> {
    let configured_duration_ms = configured_duration_ms(
        research_settings,
        request.window_kind,
        &analysis.timeframe_code,
    )?;
    let (requested_start_time, requested_end_time, window_source) =
        match (request.start_time, request.end_time) {
            (Some(start_time), Some(end_time)) => {
                validate_time_window(start_time, end_time)?;
                (start_time, end_time, "request".to_string())
            }
            (Some(start_time), None) => {
                let end_time = start_time
                    .checked_add(configured_duration_ms)
                    .context("backtest endTime overflowed i64")?;
                validate_time_window(start_time, end_time)?;
                (start_time, end_time, "request".to_string())
            }
            (None, Some(end_time)) => {
                let start_time = end_time
                    .checked_sub(configured_duration_ms)
                    .context("backtest startTime overflowed i64")?;
                validate_time_window(start_time, end_time)?;
                (start_time, end_time, "request".to_string())
            }
            (None, None) => {
                let end_time = previous_midnight_utc(Utc::now()).timestamp_millis();
                let start_time = end_time
                    .checked_sub(configured_duration_ms)
                    .context("legacy-style backtest startTime overflowed i64")?;
                validate_time_window(start_time, end_time)?;
                (start_time, end_time, "researchSettings".to_string())
            }
        };

    let effective_warmup_candles = request.warmup_candles.unwrap_or_else(|| {
        spec.slow_period
            .saturating_mul(default_warmup_multiplier)
            .max(spec.slow_period)
    });
    let warmup_ms = (effective_warmup_candles as i64)
        .checked_mul(analysis.timeframe.period_ms)
        .context("warmup window overflowed i64")?;
    let effective_warmup_start_time = requested_start_time.saturating_sub(warmup_ms);

    Ok(BacktestTimeWindow {
        window_source,
        configured_duration_ms,
        requested_start_time,
        requested_end_time,
        effective_warmup_start_time,
        effective_warmup_candles,
        period_ms: analysis.timeframe.period_ms,
        end_time_is_exclusive: true,
    })
}

fn configured_duration_ms(
    research_settings: &ResearchSettingsRecord,
    window_kind: BacktestWindowKind,
    timeframe_code: &str,
) -> Result<i64> {
    let window = match window_kind {
        BacktestWindowKind::Backtesting => &research_settings.backtesting_timerange,
        BacktestWindowKind::FavorableTimeslots => {
            &research_settings.favorable_timeslots_backtesting_timerange
        }
        BacktestWindowKind::OptimizationValidity => &research_settings.optimization_validity_period,
    };

    let duration_ms = window.get(timeframe_code).copied().with_context(|| {
        format!(
            "research settings {} does not define {} for timeframe {}",
            research_settings.name,
            window_kind.as_str(),
            timeframe_code
        )
    })?;
    if duration_ms <= 0 {
        bail!(
            "research settings {} has invalid non-positive duration {} for timeframe {}",
            research_settings.name,
            duration_ms,
            timeframe_code
        );
    }
    Ok(duration_ms)
}

fn validate_time_window(start_time: i64, end_time: i64) -> Result<()> {
    if end_time <= start_time {
        bail!("endTime must be greater than startTime");
    }
    Ok(())
}

fn previous_midnight_utc(reference_time: DateTime<Utc>) -> DateTime<Utc> {
    let midnight_today = Utc
        .with_ymd_and_hms(
            reference_time.year(),
            reference_time.month(),
            reference_time.day(),
            0,
            0,
            0,
        )
        .single()
        .expect("valid midnight");
    midnight_today - Duration::days(1)
}

fn expected_candle_count(start_time: i64, end_time: i64, period_ms: i64) -> Result<usize> {
    if period_ms <= 0 {
        bail!("periodMs must be greater than zero");
    }
    let span_ms = end_time
        .checked_sub(start_time)
        .context("replay span overflowed i64")?;
    let count = (span_ms / period_ms) + 5;
    Ok(count.max(1) as usize)
}

fn execute_backtest(
    service_name: &str,
    input: ResolvedBacktestInput,
    fee_bps: f64,
    slippage_bps: f64,
    duration_ms: i64,
) -> Result<CompletedBacktest> {
    let backtest_id = Uuid::new_v4().to_string();
    let finished_at = Utc::now().to_rfc3339();
    let Some(spec) = build_analysis_spec(&input.analysis)? else {
        bail!(
            "analysis setting {} is not runnable offline because its strategy/runtime state is unsupported",
            input.analysis.id
        );
    };

    let mut evaluator = AnalysisEvaluator::new(spec.clone());
    evaluator.warm_from_klines(&input.warmup_rows);

    let mut signals = Vec::new();
    for row in &input.replay_rows {
        if let Some(emitted) =
            evaluator.process_live_kline(&synthetic_live_kline(row, &input.analysis))
        {
            signals.push(BacktestSignalRecord {
                sequence: signals.len() + 1,
                signal_direction: emitted.signal_direction,
                close_time: emitted.close_time,
                close_price: emitted.close_price,
                fast_ema: emitted.fast_ema,
                slow_ema: emitted.slow_ema,
                kline_event_id: emitted.kline_event_id,
            });
        }
    }

    let last_row = input.replay_rows.last().cloned();
    let trades = simulate_trade_replay(
        &signals,
        &input.replay_trades,
        &input.replay_book_tickers,
        &input.analysis,
        input.close_open_position_at_end,
        last_row.as_ref(),
        SimulationConfig {
            fee_bps,
            slippage_bps,
        },
    )?;
    let trades = resequence_trades(trades);
    let summary = summarize_backtest(&signals, &trades, input.close_open_position_at_end);
    let dataset = BacktestDatasetSummary {
        fetched_kline_count: input.warmup_rows.len() + input.replay_rows.len(),
        warmup_kline_count: input.warmup_rows.len(),
        replay_kline_count: input.replay_rows.len(),
        fetched_trade_count: input.replay_trades.len(),
        replay_trade_count: input.replay_trades.len(),
        fetched_book_ticker_count: input.replay_book_tickers.len(),
        replay_book_ticker_count: input.replay_book_tickers.len(),
        first_replay_open_time: input.replay_rows.first().map(|row| row.open_time),
        last_replay_close_time: input.replay_rows.last().map(|row| row.close_time),
        first_replay_trade_time: input.replay_trades.first().map(|row| row.trade_time),
        last_replay_trade_time: input.replay_trades.last().map(|row| row.trade_time),
        first_replay_book_ticker_time: input
            .replay_book_tickers
            .first()
            .and_then(|row| chrono::DateTime::parse_from_rfc3339(&row.occurred_at).ok())
            .map(|timestamp| timestamp.timestamp_millis()),
        last_replay_book_ticker_time: input
            .replay_book_tickers
            .last()
            .and_then(|row| chrono::DateTime::parse_from_rfc3339(&row.occurred_at).ok())
            .map(|timestamp| timestamp.timestamp_millis()),
    };

    Ok(CompletedBacktest {
        response: BacktestResponse {
            backtest_id,
            finished_at,
            duration_ms,
            service: service_name.to_string(),
            analysis_setting_id: input.analysis.id.clone(),
            research_settings_name: input.research_settings.name.clone(),
            research_settings_id: input.research_settings.id.clone(),
            window_kind: input.window_kind,
            time_window: input.time_window,
            analysis: input.analysis,
            research_settings: input.research_settings,
            dataset,
            execution_assumptions: BacktestExecutionAssumptions {
                fill_source: if input.replay_book_tickers.is_empty() {
                    "aggregateTrades".to_string()
                } else {
                    "bookTickersWithAggregateTradeFallback".to_string()
                },
                fee_bps,
                slippage_bps,
                stop_loss_source:
                    "bestBidAskQuotesWithAggregateTradeFallbackAndRiskProfileSwingGapClampedBetweenMinimumAndMaximum"
                        .to_string(),
                take_profit_source:
                    "bestBidAskQuotesWithAggregateTradeFallbackAndRiskProfileRrrAppliedToStopLossDistance"
                        .to_string(),
            },
            summary,
            signals,
            trades,
        },
    })
}

fn synthetic_live_kline(
    row: &PersistedKlineRecord,
    analysis: &ResolvedAnalysisSettingsRecord,
) -> MarketDataKlineEvent {
    MarketDataKlineEvent {
        event_id: format!(
            "replay:{}:{}:{}",
            analysis.id, row.timeframe_code, row.open_time
        ),
        event_type: "trading-bot.market-data.kline.v1".to_string(),
        source: "trading-bot.research-backtesting".to_string(),
        occurred_at: row.occurred_at.clone(),
        exchange: "binance".to_string(),
        ingestion_mode: "live".to_string(),
        stream_name: format!(
            "{}@kline_{}",
            row.symbol.to_ascii_lowercase(),
            row.timeframe_code
        ),
        pair_code: row.pair_code.clone(),
        symbol: row.symbol.clone(),
        timeframe_code: row.timeframe_code.clone(),
        period_ms: row.period_ms,
        open_time: row.open_time,
        close_time: row.close_time,
        event_time: row.event_time,
        closed: true,
        open: row.open.clone(),
        high: row.high.clone(),
        low: row.low.clone(),
        close: row.close.clone(),
        volume: row.volume.clone(),
        quote_volume: row.quote_volume.clone(),
        trade_count: row.trade_count,
        analysis_setting_ids: vec![analysis.id.clone()],
        strategy_names: vec![analysis.strategy_name.clone()],
    }
}

fn resequence_trades(trades: Vec<SimulatedTradeRecord>) -> Vec<SimulatedTradeRecord> {
    trades
        .into_iter()
        .enumerate()
        .map(|(index, mut trade)| {
            trade.trade_number = index + 1;
            trade
        })
        .collect()
}

fn summarize_backtest(
    signals: &[BacktestSignalRecord],
    trades: &[SimulatedTradeRecord],
    closed_open_position_at_end: bool,
) -> BacktestSummary {
    let long_signal_count = signals
        .iter()
        .filter(|signal| signal.signal_direction == "long")
        .count();
    let short_signal_count = signals.len().saturating_sub(long_signal_count);
    let winning_trade_count = trades.iter().filter(|trade| trade.pnl_usd > 0.0).count();
    let losing_trade_count = trades.iter().filter(|trade| trade.pnl_usd < 0.0).count();
    let flat_trade_count = trades.len() - winning_trade_count - losing_trade_count;
    let stop_loss_trade_count = trades
        .iter()
        .filter(|trade| trade.exit_reason == "stopLoss")
        .count();
    let take_profit_trade_count = trades
        .iter()
        .filter(|trade| trade.exit_reason == "takeProfit")
        .count();
    let reversal_trade_count = trades
        .iter()
        .filter(|trade| trade.exit_reason == "reversal")
        .count();
    let window_end_trade_count = trades
        .iter()
        .filter(|trade| trade.exit_reason == "windowEnd")
        .count();
    let total_fees_usd = trades.iter().map(|trade| trade.fees_usd).sum::<f64>();
    let total_pnl_percent = trades.iter().map(|trade| trade.pnl_percent).sum::<f64>();
    let trade_count = trades.len();
    let win_rate = if trade_count > 0 {
        winning_trade_count as f64 / trade_count as f64
    } else {
        0.0
    };

    BacktestSummary {
        signal_count: signals.len(),
        long_signal_count,
        short_signal_count,
        trade_count,
        winning_trade_count,
        losing_trade_count,
        flat_trade_count,
        stop_loss_trade_count,
        take_profit_trade_count,
        reversal_trade_count,
        window_end_trade_count,
        win_rate,
        total_fees_usd,
        total_pnl_percent,
        closed_open_position_at_end,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use trading_bot_market_data::models::PersistedTradeRecord;
    use trading_bot_strategy_engine::models::{
        PairRecord, RiskProfileRecord, StrategyRecord, TimeframeRecord, TradingDefaultsRecord,
    };

    use super::*;
    use crate::models::{BacktestRequest, ResearchSettingsRecord};

    fn analysis_record() -> ResolvedAnalysisSettingsRecord {
        ResolvedAnalysisSettingsRecord {
            id: "analysis-1".to_string(),
            pair_code: "BTCUSDT".to_string(),
            timeframe_code: "1m".to_string(),
            strategy_name: "emaCross".to_string(),
            risk_profile_name: "default".to_string(),
            trading_defaults_name: "default".to_string(),
            technical_analysis_settings: json!({
                "fastPeriod": 2,
                "slowPeriod": 3
            }),
            enabled: true,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            pair: PairRecord {
                id: "pair-1".to_string(),
                code: "BTCUSDT".to_string(),
                operable: true,
                origin_asset_needed_funds: Some(1000.0),
                destination_asset_needed_funds: Some(1000.0),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            timeframe: TimeframeRecord {
                id: "timeframe-1".to_string(),
                code: "1m".to_string(),
                longer_timeframe_code: "5m".to_string(),
                longer_timeframe_multiplier: 5,
                period_ms: 60_000,
                operable: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            strategy: StrategyRecord {
                id: "strategy-1".to_string(),
                name: "emaCross".to_string(),
                description: "ema cross".to_string(),
                activated: true,
                parameters: json!({
                    "kind": "emaCross",
                    "fastPeriod": 2,
                    "slowPeriod": 3
                }),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            risk_profile: RiskProfileRecord {
                id: "risk-1".to_string(),
                name: "default".to_string(),
                description: "default".to_string(),
                maximum_stop_loss: 3.0,
                minimum_stop_loss: 1.0,
                swing_gap: 1.0,
                rrr: 2.0,
                enabled: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            trading_defaults: TradingDefaultsRecord {
                id: "td-1".to_string(),
                name: "default".to_string(),
                description: "default".to_string(),
                default_position_notional_usd: 100.0,
                enabled: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
        }
    }

    fn research_settings() -> ResearchSettingsRecord {
        ResearchSettingsRecord {
            id: "research-1".to_string(),
            name: "default".to_string(),
            description: "default".to_string(),
            backtesting_timerange: [("1m".to_string(), DAY_MS), ("5m".to_string(), DAY_MS * 7)]
                .into_iter()
                .collect(),
            favorable_timeslots_backtesting_timerange: [("1m".to_string(), DAY_MS)]
                .into_iter()
                .collect(),
            optimization_validity_period: [("1m".to_string(), DAY_MS * 30)].into_iter().collect(),
            enabled: true,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn kline(open_time: i64, close: f64) -> PersistedKlineRecord {
        PersistedKlineRecord {
            pair_code: "BTCUSDT".to_string(),
            symbol: "BTCUSDT".to_string(),
            timeframe_code: "1m".to_string(),
            period_ms: 60_000,
            open_time,
            close_time: open_time + 59_999,
            event_time: open_time + 60_000,
            occurred_at: "2026-01-01T00:00:00Z".to_string(),
            ingestion_mode: "backfill".to_string(),
            closed: true,
            open: close.to_string(),
            high: close.to_string(),
            low: close.to_string(),
            close: close.to_string(),
            volume: "1".to_string(),
            quote_volume: "1".to_string(),
            trade_count: 1,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn trade(aggregate_trade_id: i64, trade_time: i64, price: f64) -> PersistedTradeRecord {
        PersistedTradeRecord {
            pair_code: "BTCUSDT".to_string(),
            symbol: "BTCUSDT".to_string(),
            aggregate_trade_id,
            ingestion_mode: "backfill".to_string(),
            price: price.to_string(),
            quantity: "0.5".to_string(),
            trade_time,
            market_maker: false,
            occurred_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn resolve_time_window_uses_research_settings_milliseconds() {
        let analysis = analysis_record();
        let research = research_settings();
        let spec = build_analysis_spec(&analysis)
            .expect("spec build")
            .expect("spec present");
        let request = BacktestRequest {
            analysis_setting_id: analysis.id.clone(),
            research_settings_name: research.name.clone(),
            window_kind: BacktestWindowKind::Backtesting,
            start_time: Some(1_000_000),
            end_time: None,
            warmup_candles: None,
            close_open_position_at_end: Some(true),
        };

        let window = resolve_time_window(&analysis, &research, &request, &spec, 3).expect("window");
        assert_eq!(window.requested_start_time, 1_000_000);
        assert_eq!(window.requested_end_time, 1_000_000 + DAY_MS);
        assert_eq!(window.effective_warmup_candles, 9);
    }

    #[test]
    fn execute_backtest_reuses_strategy_logic_offline() {
        let analysis = analysis_record();
        let research = research_settings();
        let input = ResolvedBacktestInput {
            analysis,
            research_settings: research,
            window_kind: BacktestWindowKind::Backtesting,
            time_window: BacktestTimeWindow {
                window_source: "request".to_string(),
                configured_duration_ms: DAY_MS,
                requested_start_time: 180_000,
                requested_end_time: 540_000,
                effective_warmup_start_time: 0,
                effective_warmup_candles: 3,
                period_ms: 60_000,
                end_time_is_exclusive: true,
            },
            warmup_rows: vec![kline(0, 10.0), kline(60_000, 9.0), kline(120_000, 8.0)],
            replay_rows: vec![
                kline(180_000, 9.0),
                kline(240_000, 10.0),
                kline(300_000, 11.0),
                kline(360_000, 10.0),
                kline(420_000, 9.0),
                kline(480_000, 8.0),
            ],
            replay_trades: vec![
                trade(1, 180_100, 9.0),
                trade(2, 240_100, 10.0),
                trade(3, 300_100, 11.0),
                trade(4, 360_100, 10.0),
                trade(5, 420_100, 9.0),
                trade(6, 480_100, 8.0),
            ],
            replay_book_tickers: vec![],
            close_open_position_at_end: true,
        };

        let completed = execute_backtest("svc", input, 0.0, 0.0, 42).expect("backtest");
        assert!(!completed.response.backtest_id.is_empty());
        assert!(
            chrono::DateTime::parse_from_rfc3339(&completed.response.finished_at).is_ok(),
            "finishedAt should be RFC3339"
        );
        assert_eq!(completed.response.duration_ms, 42);
        assert!(!completed.response.signals.is_empty());
        assert!(!completed.response.trades.is_empty());
        assert_eq!(completed.response.analysis.strategy_name, "emaCross");
    }
}
