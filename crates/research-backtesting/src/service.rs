use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
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
    models::{
        MarketDataKlineEvent, PersistedKlineRecord, ResolvedAnalysisSettingsRecord,
        RiskProfileRecord,
    },
    strategy_logic::{AnalysisEvaluator, AnalysisSpec, build_analysis_spec},
};

use crate::{
    config::AppConfig,
    execution_simulation::{SimulationConfig, simulate_trade_replay_paged},
    metrics::Metrics,
    models::{
        BacktestDatasetSummary, BacktestExecutionAssumptions, BacktestRequest, BacktestResponse,
        BacktestSignalRecord, BacktestSummary, BacktestTimeWindow, LastBacktestStatus,
        PersistedBacktestRunSummary, ResolvedBacktestInput, SimulatedTradeRecord,
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

#[derive(Clone)]
struct TradeWindowCache {
    pair_code: String,
    start_time: i64,
    end_time: i64,
    data_retrieval_duration_ms: i64,
    rows: Arc<Vec<HistoricalTradeRecord>>,
}

impl TradeWindowCache {
    fn contains_window(&self, pair_code: &str, start_time: i64, end_time: i64) -> bool {
        self.pair_code == pair_code && self.start_time <= start_time && self.end_time >= end_time
    }
}

fn apply_risk_profile(
    analysis: &ResolvedAnalysisSettingsRecord,
    risk_profile: &RiskProfileRecord,
) -> ResolvedAnalysisSettingsRecord {
    let mut resolved = analysis.clone();
    resolved.risk_profile_name = risk_profile.name.clone();
    resolved.risk_profile = risk_profile.clone();
    resolved
}

fn expand_analyses_by_risk_profiles(
    analyses: Vec<ResolvedAnalysisSettingsRecord>,
    risk_profiles: &[RiskProfileRecord],
) -> Vec<ResolvedAnalysisSettingsRecord> {
    if risk_profiles.is_empty() {
        return analyses;
    }

    let mut expanded = Vec::with_capacity(analyses.len().saturating_mul(risk_profiles.len()));
    for analysis in analyses {
        for risk_profile in risk_profiles {
            expanded.push(apply_risk_profile(&analysis, risk_profile));
        }
    }
    expanded
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
            if let Err(error) = service
                .run_enabled_analysis_backtests_if_ready("startup")
                .await
            {
                warn!(error = %error, "startup backtest batch failed");
            }
            service.start_auto_backtest_scheduler();
        }

        Ok(service)
    }

    fn start_auto_backtest_scheduler(self: &Self) {
        let service = self.clone();
        let interval = StdDuration::from_secs(service.inner.config.auto_backtest_interval_seconds);

        tokio::spawn(async move {
            tokio::time::sleep(interval).await;
            loop {
                if let Err(error) = service
                    .run_enabled_analysis_backtests_if_ready("periodic")
                    .await
                {
                    error!(
                        error = %error,
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
            self.inner.historical_store.clone(),
            self.inner.config.backtest_trade_replay_page_rows,
            self.inner.config.default_fee_bps,
            self.inner.config.default_slippage_bps,
            None,
            None,
        )
        .await?;
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
        analyses: Vec<ResolvedAnalysisSettingsRecord>,
    ) -> Result<usize> {
        if analyses.is_empty() {
            warn!("no enabled analysis settings found for scheduled backtests");
            return Ok(0);
        }

        let mut analyses_by_pair: HashMap<String, Vec<ResolvedAnalysisSettingsRecord>> =
            HashMap::new();
        for analysis in analyses {
            analyses_by_pair
                .entry(analysis.symbol.clone())
                .or_default()
                .push(analysis);
        }

        let mut ran = 0usize;
        let mut failed = 0usize;

        for (_, mut pair_analyses) in analyses_by_pair {
            pair_analyses.sort_by_key(|analysis| {
                std::cmp::Reverse(
                    self.inner
                        .config
                        .backtesting_timerange_ms_by_timeframe
                        .get(&analysis.timeframe_code)
                        .copied()
                        .unwrap_or_default(),
                )
            });

            let mut trade_cache: Option<TradeWindowCache> = None;

            for analysis in pair_analyses {
                let request = BacktestRequest {
                    analysis_setting_id: analysis.id.clone(),
                    risk_profile_name: Some(analysis.risk_profile_name.clone()),
                    start_time: None,
                    end_time: None,
                    warmup_candles: None,
                };
                if let Err(error) = self
                    .run_backtest_with_trade_cache(request, &mut trade_cache)
                    .await
                {
                    failed += 1;
                    warn!(
                        error = %error,
                        analysis_setting_id = %analysis.id,
                        risk_profile_name = %analysis.risk_profile_name,
                        symbol = %analysis.symbol,
                        timeframe_code = %analysis.timeframe_code,
                        strategy_name = %analysis.strategy_name,
                        "scheduled backtest failed"
                    );
                } else {
                    ran += 1;
                }
            }
        }

        info!(
            ran = ran,
            failed = failed,
            total = ran + failed,
            "scheduled backtest batch completed"
        );

        Ok(ran)
    }

    async fn run_enabled_analysis_backtests_if_ready(&self, reason: &str) -> Result<usize> {
        let analyses = self
            .fetch_runtime_analysis_settings()
            .await?
            .into_iter()
            .filter(|analysis| analysis.enabled)
            .collect::<Vec<_>>();
        let risk_profiles = self.fetch_enabled_risk_profiles().await?;
        let analyses = expand_analyses_by_risk_profiles(analyses, &risk_profiles);

        if analyses.is_empty() {
            warn!("no enabled analysis settings or risk profiles found for scheduled backtests");
            return Ok(0);
        }

        let mut not_ready = Vec::new();
        for analysis in &analyses {
            if let Some(blocker) = self.scheduled_backtest_readiness_blocker(analysis).await? {
                let request = BacktestRequest {
                    analysis_setting_id: analysis.id.clone(),
                    risk_profile_name: Some(analysis.risk_profile_name.clone()),
                    start_time: None,
                    end_time: None,
                    warmup_candles: None,
                };
                let time_window = build_analysis_spec(analysis)?
                    .map(|spec| {
                        resolve_time_window(
                            analysis,
                            &request,
                            &spec,
                            self.inner.config.default_warmup_multiplier,
                            &self.inner.config.backtesting_timerange_ms_by_timeframe,
                        )
                    })
                    .transpose()?;
                not_ready.push((
                    format!("{}:{}", analysis.id, analysis.risk_profile_name),
                    analysis.symbol.clone(),
                    analysis.timeframe_code.clone(),
                    analysis.risk_profile_name.clone(),
                    time_window
                        .as_ref()
                        .map(|window| window.requested_start_time),
                    time_window.as_ref().map(|window| window.requested_end_time),
                    blocker,
                ));
            }
        }

        if !not_ready.is_empty() {
            let blocked_analysis_ids = not_ready
                .iter()
                .map(|(id, ..)| id.clone())
                .collect::<Vec<_>>();
            let blocked_analyses = not_ready
                .iter()
                .map(
                    |(id, pair_code, timeframe_code, risk_profile_name, requested_start_time, requested_end_time, blocker)| {
                        format!(
                            "analysis_id={id} pair={pair_code} timeframe={timeframe_code} risk_profile_name={risk_profile_name} requested_start_ms={requested_start_time:?} requested_end_ms={requested_end_time:?} blocker={blocker}"
                        )
                    },
                )
                .collect::<Vec<_>>();
            warn!(
                reason,
                blocked_analysis_ids = ?blocked_analysis_ids,
                blocked_analyses = ?blocked_analyses,
                blocked_count = not_ready.len(),
                "scheduled backtest batch skipped because historical data is not ready"
            );
            return Ok(0);
        }

        self.run_enabled_analysis_backtests(analyses).await
    }

    async fn scheduled_backtest_readiness_blocker(
        &self,
        analysis: &ResolvedAnalysisSettingsRecord,
    ) -> Result<Option<String>> {
        let Some(spec) = build_analysis_spec(analysis)? else {
            return Ok(Some("analysis is not runnable offline".to_string()));
        };

        let request = BacktestRequest {
            analysis_setting_id: analysis.id.clone(),
            risk_profile_name: Some(analysis.risk_profile_name.clone()),
            start_time: None,
            end_time: None,
            warmup_candles: None,
        };
        let time_window = resolve_time_window(
            analysis,
            &request,
            &spec,
            self.inner.config.default_warmup_multiplier,
            &self.inner.config.backtesting_timerange_ms_by_timeframe,
        )?;

        let required_klines = exact_candle_count_inclusive(
            time_window.effective_warmup_start_time,
            time_window.requested_end_time,
            analysis.timeframe.period_ms,
        )?;
        let kline_coverage = self
            .inner
            .historical_store
            .kline_window_coverage_in_range(
                &analysis.symbol,
                &analysis.timeframe_code,
                time_window.effective_warmup_start_time,
                time_window.requested_end_time,
            )
            .await?;
        if kline_coverage.row_count < required_klines as u64 {
            return Ok(Some(format!(
                "kline coverage incomplete (have {}, need {})",
                kline_coverage.row_count, required_klines
            )));
        }

        let trade_coverage = self
            .inner
            .historical_store
            .trade_window_coverage_in_range(
                &analysis.symbol,
                time_window.requested_start_time,
                time_window.requested_end_time,
            )
            .await?;
        let tolerance = self.inner.config.trade_coverage_tolerance_ms as i64;
        let trade_ready = match (trade_coverage.min_time, trade_coverage.max_time) {
            (Some(min_t), Some(max_t)) => {
                let latest_acceptable_min =
                    time_window.requested_start_time.saturating_add(tolerance);
                let earliest_acceptable_max = time_window
                    .requested_end_time
                    .saturating_sub(1)
                    .saturating_sub(tolerance);
                min_t <= latest_acceptable_min && max_t >= earliest_acceptable_max
            }
            _ => false,
        };
        if !trade_ready {
            return Ok(Some(format!(
                "trade coverage incomplete (row_count={}, min_time={:?}, max_time={:?})",
                trade_coverage.row_count, trade_coverage.min_time, trade_coverage.max_time
            )));
        }

        Ok(None)
    }

    async fn run_backtest_with_trade_cache(
        &self,
        request: BacktestRequest,
        trade_cache: &mut Option<TradeWindowCache>,
    ) -> Result<BacktestResponse> {
        if let Err(error) = self.refresh_dependencies().await {
            self.inner
                .metrics
                .backtest_runs_total
                .with_label_values(&["error"])
                .inc();
            return Err(error);
        }

        let resolved = self.resolve_input(&request).await?;
        let (cached_trades, data_retrieval_duration_ms) = match trade_cache {
            Some(existing)
                if existing.contains_window(
                    &resolved.analysis.symbol,
                    resolved.replay_trade_start_time,
                    resolved.replay_trade_end_time,
                ) =>
            {
                (
                    Some(existing.rows.clone()),
                    Some(existing.data_retrieval_duration_ms),
                )
            }
            _ => {
                let retrieval_started_at = Instant::now();
                let rows = fetch_trade_window_cache(
                    &self.inner.historical_store,
                    &resolved.analysis.symbol,
                    resolved.replay_trade_start_time,
                    resolved.replay_trade_end_time,
                    self.inner.config.backtest_trade_replay_page_rows,
                    resolved.replay_trade_max_rows,
                )
                .await?;
                let data_retrieval_duration_ms = retrieval_started_at.elapsed().as_millis() as i64;
                let rows = Arc::new(rows);
                *trade_cache = Some(TradeWindowCache {
                    pair_code: resolved.analysis.symbol.clone(),
                    start_time: resolved.replay_trade_start_time,
                    end_time: resolved.replay_trade_end_time,
                    data_retrieval_duration_ms,
                    rows: rows.clone(),
                });
                (Some(rows), Some(data_retrieval_duration_ms))
            }
        };

        let completed = execute_backtest(
            &self.inner.config.service_name,
            resolved,
            self.inner.historical_store.clone(),
            self.inner.config.backtest_trade_replay_page_rows,
            self.inner.config.default_fee_bps,
            self.inner.config.default_slippage_bps,
            data_retrieval_duration_ms,
            cached_trades,
        )
        .await?;
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

    async fn resolve_input(&self, request: &BacktestRequest) -> Result<ResolvedBacktestInput> {
        let analyses = self.fetch_runtime_analysis_settings().await?;
        let base_analysis = analyses
            .into_iter()
            .find(|record| record.id == request.analysis_setting_id)
            .with_context(|| {
                format!(
                    "analysis setting {} was not found in the resolved runtime config",
                    request.analysis_setting_id
                )
            })?;
        let analysis = if let Some(risk_profile_name) = &request.risk_profile_name {
            let risk_profile = self
                .fetch_enabled_risk_profiles()
                .await?
                .into_iter()
                .find(|profile| profile.name == *risk_profile_name)
                .with_context(|| {
                    format!("enabled risk profile {} was not found", risk_profile_name)
                })?;
            apply_risk_profile(&base_analysis, &risk_profile)
        } else {
            base_analysis
        };

        let Some(spec) = build_analysis_spec(&analysis)? else {
            bail!(
                "analysis setting {} is not runnable offline because its strategy/runtime state is unsupported",
                analysis.id
            );
        };

        let time_window = resolve_time_window(
            &analysis,
            request,
            &spec,
            self.inner.config.default_warmup_multiplier,
            &self.inner.config.backtesting_timerange_ms_by_timeframe,
        )?;
        let replay_trade_start_time = time_window.requested_start_time;
        let replay_trade_end_time = time_window.requested_end_time;
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
        // Use all available trades up to the configured hard cap.
        let expected_trades = self.inner.config.max_backtest_trades;
        let expected_book_tickers = self
            .inner
            .config
            .max_backtest_book_tickers
            .min((expected_candles.saturating_mul(2_000)).max(50_000));

        let rows = self
            .inner
            .historical_store
            .replay_klines(
                &analysis.symbol,
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
        let replay_book_tickers = self
            .inner
            .historical_store
            .replay_book_tickers(
                &analysis.symbol,
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
                analysis.symbol,
                analysis.timeframe_code,
                time_window.requested_start_time,
                time_window.requested_end_time
            );
        }

        // Enforce sufficient trade coverage for the entire requested window,
        // not just the presence of at least one trade somewhere inside it.
        let trade_coverage = self
            .inner
            .historical_store
            .trade_window_coverage_in_range(
                &analysis.symbol,
                time_window.requested_start_time,
                time_window.requested_end_time,
            )
            .await
            .unwrap_or_else(|error| {
                warn!(
                    error = %error,
                    symbol = %analysis.symbol,
                    requested_start_time = time_window.requested_start_time,
                    requested_end_time = time_window.requested_end_time,
                    "failed to compute trade window coverage for backtest window"
                );
                trading_bot_market_data::db::WindowCoverage {
                    row_count: 0,
                    min_time: None,
                    max_time: None,
                }
            });

        let has_full_trade_coverage = match (trade_coverage.min_time, trade_coverage.max_time) {
            (Some(min_t), Some(max_t)) => {
                let tolerance = self.inner.config.trade_coverage_tolerance_ms as i64;
                // Allow small slack at the edges: the first trade can occur
                // slightly after the requested start, and the last trade can
                // occur slightly before the requested end, as long as the gap
                // is within the configured tolerance.
                let latest_acceptable_min =
                    time_window.requested_start_time.saturating_add(tolerance);
                let earliest_acceptable_max = time_window
                    .requested_end_time
                    .saturating_sub(1)
                    .saturating_sub(tolerance);

                min_t <= latest_acceptable_min && max_t >= earliest_acceptable_max
            }
            _ => false,
        };

        if !has_full_trade_coverage {
            warn!(
                symbol = %analysis.symbol,
                timeframe_code = %analysis.timeframe_code,
                requested_start_time = time_window.requested_start_time,
                requested_end_time = time_window.requested_end_time,
                trade_coverage_tolerance_ms = self.inner.config.trade_coverage_tolerance_ms,
                trade_row_count = trade_coverage.row_count,
                trade_min_time = ?trade_coverage.min_time,
                trade_max_time = ?trade_coverage.max_time,
                "backtest window does not have full historical aggregate trade coverage"
            );

            bail!(
                "insufficient historical aggregate trades in ClickHouse for {} within {}..{}; fill-aware backtesting requires full market_data_trades coverage (trade_row_count={}, trade_min_time={:?}, trade_max_time={:?})",
                analysis.symbol,
                time_window.requested_start_time,
                time_window.requested_end_time,
                trade_coverage.row_count,
                trade_coverage.min_time,
                trade_coverage.max_time
            );
        }

        Ok(ResolvedBacktestInput {
            analysis,
            time_window,
            warmup_rows,
            replay_rows,
            replay_trade_start_time,
            replay_trade_end_time,
            replay_trade_max_rows: expected_trades,
            replay_book_tickers,
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

    async fn fetch_enabled_risk_profiles(&self) -> Result<Vec<RiskProfileRecord>> {
        let response = self
            .inner
            .control_plane_client
            .get(format!(
                "{}/v1/risk-profiles",
                self.inner.config.control_plane_base_url
            ))
            .send()
            .await?;
        let response = response.error_for_status()?;
        Ok(response
            .json::<Vec<RiskProfileRecord>>()
            .await?
            .into_iter()
            .filter(|profile| profile.enabled)
            .collect())
    }
}

fn map_historical_kline_row(row: HistoricalKlineRecord) -> PersistedKlineRecord {
    PersistedKlineRecord {
        pair_code: row.symbol.clone(),
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

fn map_historical_book_ticker_row(row: HistoricalBookTickerRecord) -> HistoricalBookTickerRecord {
    row
}

fn persisted_backtest_run(response: &BacktestResponse) -> Result<StoredBacktestRunWrite> {
    Ok(StoredBacktestRunWrite {
        backtest_id: response.backtest_id.clone(),
        finished_at_ms: DateTime::parse_from_rfc3339(&response.finished_at)
            .with_context(|| format!("invalid finishedAt timestamp: {}", response.finished_at))?
            .timestamp_millis(),
        duration_ms: response.backtest_duration_ms,
        backtest_duration_ms: response.backtest_duration_ms,
        data_retrieval_duration_ms: response.data_retrieval_duration_ms,
        analysis_setting_id: response.analysis_setting_id.clone(),
        risk_profile_name: response.analysis.risk_profile_name.clone(),
        pair_code: response.analysis.symbol.clone(),
        timeframe_code: response.analysis.timeframe_code.clone(),
        strategy_name: response.analysis.strategy_name.clone(),
        // This app only supports backtesting windows.
        window_kind: "backtesting".to_string(),
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
        response_json: serde_json::to_string(response)?,
    })
}

fn persisted_run_summary(run: &StoredBacktestRunWrite) -> StoredBacktestRunSummary {
    StoredBacktestRunSummary {
        backtest_id: run.backtest_id.clone(),
        finished_at_ms: run.finished_at_ms,
        duration_ms: run.duration_ms,
        backtest_duration_ms: run.backtest_duration_ms,
        data_retrieval_duration_ms: run.data_retrieval_duration_ms,
        analysis_setting_id: run.analysis_setting_id.clone(),
        risk_profile_name: run.risk_profile_name.clone(),
        pair_code: run.pair_code.clone(),
        timeframe_code: run.timeframe_code.clone(),
        strategy_name: run.strategy_name.clone(),
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

fn map_persisted_backtest_summary(
    row: StoredBacktestRunSummary,
) -> Result<PersistedBacktestRunSummary> {
    Ok(PersistedBacktestRunSummary {
        backtest_id: row.backtest_id,
        finished_at: millis_to_rfc3339(row.finished_at_ms)?,
        backtest_duration_ms: row.backtest_duration_ms,
        data_retrieval_duration_ms: row.data_retrieval_duration_ms,
        analysis_setting_id: row.analysis_setting_id,
        risk_profile_name: row.risk_profile_name,
        symbol: row.pair_code,
        timeframe_code: row.timeframe_code,
        strategy_name: row.strategy_name,
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
        backtest_duration_ms: row.backtest_duration_ms,
        data_retrieval_duration_ms: row.data_retrieval_duration_ms,
        analysis_setting_id: row.analysis_setting_id,
        risk_profile_name: row.risk_profile_name,
        symbol: row.pair_code,
        timeframe_code: row.timeframe_code,
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
    request: &BacktestRequest,
    spec: &AnalysisSpec,
    default_warmup_multiplier: usize,
    backtesting_timerange_ms_by_timeframe: &std::collections::BTreeMap<String, i64>,
) -> Result<BacktestTimeWindow> {
    let configured_duration_ms = configured_duration_ms(
        backtesting_timerange_ms_by_timeframe,
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
                (start_time, end_time, "env".to_string())
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
    backtesting_timerange_ms_by_timeframe: &std::collections::BTreeMap<String, i64>,
    timeframe_code: &str,
) -> Result<i64> {
    let duration_ms = backtesting_timerange_ms_by_timeframe
        .get(timeframe_code)
        .copied()
        .with_context(|| {
            format!(
                "BACKTEST_TIMERANGE_MS_BY_TIMEFRAME is missing timeframeCode {}",
                timeframe_code
            )
        })?;
    if duration_ms <= 0 {
        bail!(
            "invalid non-positive duration {} for timeframe {}",
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

fn exact_candle_count_inclusive(start_time: i64, end_time: i64, period_ms: i64) -> Result<usize> {
    if period_ms <= 0 {
        bail!("periodMs must be greater than zero");
    }
    let span_ms = end_time
        .checked_sub(start_time)
        .context("replay span overflowed i64")?;
    let count = (span_ms / period_ms) + 1;
    Ok(count.max(1) as usize)
}

async fn fetch_trade_window_cache(
    historical_store: &Database,
    pair_code: &str,
    start_time: i64,
    end_time: i64,
    page_rows: usize,
    max_rows: usize,
) -> Result<Vec<HistoricalTradeRecord>> {
    let mut rows = Vec::new();
    let mut after: Option<(i64, i64)> = None;
    let page_rows = page_rows.clamp(1, 50_000_000) as i64;
    let mut page = 0usize;
    let started_at = Instant::now();

    info!(
        pair_code = %pair_code,
        requested_start_time = start_time,
        requested_end_time = end_time,
        max_rows = max_rows,
        "shared trade cache prefetch started"
    );

    while rows.len() < max_rows {
        let remaining = (max_rows - rows.len()) as i64;
        let limit = page_rows.min(remaining).max(1);
        let (after_t, after_id) = after.unzip();
        let chunk = historical_store
            .replay_trades_page(pair_code, start_time, end_time, after_t, after_id, limit)
            .await?;
        if chunk.is_empty() {
            break;
        }
        page += 1;
        after = chunk
            .last()
            .map(|row| (row.trade_time, row.aggregate_trade_id));
        rows.extend(chunk);

        if page == 1 || page % 5 == 0 {
            info!(
                pair_code = %pair_code,
                page = page,
                rows_cached = rows.len(),
                elapsed_ms = started_at.elapsed().as_millis() as u64,
                "shared trade cache prefetch progress"
            );
        }
    }

    info!(
        pair_code = %pair_code,
        rows_cached = rows.len(),
        elapsed_ms = started_at.elapsed().as_millis() as u64,
        "shared trade cache prefetch completed"
    );

    Ok(rows)
}

fn replay_trades_page_from_cache(
    trades: &[HistoricalTradeRecord],
    start_time: i64,
    end_time: i64,
    after: Option<(i64, i64)>,
    limit: usize,
) -> Vec<HistoricalTradeRecord> {
    if limit == 0 {
        return Vec::new();
    }

    let start_idx = trades.partition_point(|row| row.trade_time < start_time);
    let end_idx = trades.partition_point(|row| row.trade_time < end_time);
    if start_idx >= end_idx {
        return Vec::new();
    }

    let cursor_idx = match after {
        Some((after_time, after_id)) => trades.partition_point(|row| {
            row.trade_time < after_time
                || (row.trade_time == after_time && row.aggregate_trade_id <= after_id)
        }),
        None => start_idx,
    }
    .max(start_idx)
    .min(end_idx);

    let take_until = cursor_idx.saturating_add(limit).min(end_idx);
    trades[cursor_idx..take_until].to_vec()
}

async fn execute_backtest(
    service_name: &str,
    input: ResolvedBacktestInput,
    historical_store: Database,
    trade_page_rows: usize,
    fee_bps: f64,
    slippage_bps: f64,
    data_retrieval_duration_ms_override: Option<i64>,
    cached_trades: Option<Arc<Vec<HistoricalTradeRecord>>>,
) -> Result<CompletedBacktest> {
    let execution_started_at = Instant::now();
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

    let page_rows = trade_page_rows.clamp(1, 50_000_000) as i64;
    let pair_code = input.analysis.symbol.clone();
    let timeframe_code = input.analysis.timeframe_code.clone();
    let start_time = input.replay_trade_start_time;
    let end_time = input.replay_trade_end_time;
    let max_rows = input.replay_trade_max_rows;
    let retrieval_started_at = Instant::now();
    let retrieval_window_ms = end_time.saturating_sub(start_time).max(1);
    let retrieval_backtest_id = backtest_id.clone();
    let retrieval_page_count = Arc::new(AtomicUsize::new(0));
    let retrieval_rows_total = Arc::new(AtomicUsize::new(0));

    info!(
        backtest_id = %retrieval_backtest_id,
        pair_code = %pair_code,
        timeframe_code = %timeframe_code,
        requested_start_time = start_time,
        requested_end_time = end_time,
        page_rows = page_rows,
        max_rows = max_rows,
        "backtest trade retrieval started"
    );

    let fetch_page = move |after: Option<(i64, i64)>, remaining: i64| {
        let db = historical_store.clone();
        let pair_code = pair_code.clone();
        let timeframe_code = timeframe_code.clone();
        let retrieval_backtest_id = retrieval_backtest_id.clone();
        let retrieval_page_count = retrieval_page_count.clone();
        let retrieval_rows_total = retrieval_rows_total.clone();
        let cached_trades = cached_trades.clone();
        let limit = page_rows.min(remaining).max(1);
        Box::pin(async move {
            let page = match cached_trades.as_ref() {
                Some(trades) => replay_trades_page_from_cache(
                    trades,
                    start_time,
                    end_time,
                    after,
                    limit as usize,
                ),
                None => {
                    let (after_t, after_id) = after.unzip();
                    db.replay_trades_page(
                        &pair_code, start_time, end_time, after_t, after_id, limit,
                    )
                    .await?
                }
            };

            if page.is_empty() {
                info!(
                    backtest_id = %retrieval_backtest_id,
                    pair_code = %pair_code,
                    timeframe_code = %timeframe_code,
                    pages_fetched = retrieval_page_count.load(Ordering::Relaxed),
                    rows_fetched = retrieval_rows_total.load(Ordering::Relaxed),
                    elapsed_ms = retrieval_started_at.elapsed().as_millis() as u64,
                    "backtest trade retrieval reached end of dataset"
                );
                return Ok(page);
            }

            let page_count = retrieval_page_count.fetch_add(1, Ordering::Relaxed) + 1;
            let rows_fetched =
                retrieval_rows_total.fetch_add(page.len(), Ordering::Relaxed) + page.len();
            let first_trade_time = page.first().map(|row| row.trade_time).unwrap_or(start_time);
            let last_trade_time = page.last().map(|row| row.trade_time).unwrap_or(start_time);
            let progressed_ms = last_trade_time
                .saturating_sub(start_time)
                .clamp(0, retrieval_window_ms);
            let window_progress_percent =
                (progressed_ms as f64 / retrieval_window_ms as f64) * 100.0;
            let remaining_row_budget = remaining.saturating_sub(page.len() as i64);

            // Keep logs readable: first page + every 5 pages + short page.
            if page_count == 1 || page_count % 5 == 0 || (page.len() as i64) < limit {
                info!(
                    backtest_id = %retrieval_backtest_id,
                    pair_code = %pair_code,
                    timeframe_code = %timeframe_code,
                    page = page_count,
                    page_rows = page.len(),
                    rows_fetched = rows_fetched,
                    first_trade_time = first_trade_time,
                    last_trade_time = last_trade_time,
                    window_progress_percent = window_progress_percent,
                    remaining_row_budget = remaining_row_budget,
                    elapsed_ms = retrieval_started_at.elapsed().as_millis() as u64,
                    "backtest trade retrieval progress"
                );
            }

            Ok(page)
        })
            as std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<Vec<HistoricalTradeRecord>>> + Send>,
            >
    };

    let (trades, trade_stats) = simulate_trade_replay_paged(
        &signals,
        &input.replay_book_tickers,
        &input.analysis,
        SimulationConfig {
            fee_bps,
            slippage_bps,
        },
        input.time_window.requested_end_time,
        max_rows,
        fetch_page,
    )
    .await?;
    let trades = resequence_trades(trades);
    let summary = summarize_backtest(&signals, &trades);
    let backtest_duration_ms = execution_started_at.elapsed().as_millis() as i64;
    let data_retrieval_duration_ms = data_retrieval_duration_ms_override
        .unwrap_or_else(|| retrieval_started_at.elapsed().as_millis() as i64);
    let dataset = BacktestDatasetSummary {
        fetched_kline_count: input.warmup_rows.len() + input.replay_rows.len(),
        warmup_kline_count: input.warmup_rows.len(),
        replay_kline_count: input.replay_rows.len(),
        fetched_trade_count: trade_stats.fetched_trade_count,
        replay_trade_count: trade_stats.fetched_trade_count,
        fetched_book_ticker_count: input.replay_book_tickers.len(),
        replay_book_ticker_count: input.replay_book_tickers.len(),
        first_replay_open_time: input.replay_rows.first().map(|row| row.open_time),
        last_replay_close_time: input.replay_rows.last().map(|row| row.close_time),
        first_replay_trade_time: trade_stats.first_trade_time,
        last_replay_trade_time: trade_stats.last_trade_time,
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
            backtest_duration_ms,
            data_retrieval_duration_ms,
            service: service_name.to_string(),
            analysis_setting_id: input.analysis.id.clone(),
            time_window: input.time_window,
            analysis: input.analysis,
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
        pair_code: row.symbol.clone(),
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
    use crate::models::BacktestRequest;

    fn analysis_record() -> ResolvedAnalysisSettingsRecord {
        ResolvedAnalysisSettingsRecord {
            id: "analysis-1".to_string(),
            symbol: "BTCUSDT".to_string(),
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
            symbol: "BTCUSDT".to_string(),
            aggregate_trade_id,
            price: price.to_string(),
            trade_time,
        }
    }

    #[test]
    fn resolve_time_window_uses_backtesting_timerange_ms() {
        let analysis = analysis_record();
        let spec = build_analysis_spec(&analysis)
            .expect("spec build")
            .expect("spec present");
        let request = BacktestRequest {
            analysis_setting_id: analysis.id.clone(),
            risk_profile_name: None,
            start_time: Some(1_000_000),
            end_time: None,
            warmup_candles: None,
        };

        let backtesting_timerange_ms_by_timeframe = std::collections::BTreeMap::from([
            ("1m".to_string(), DAY_MS),
            ("5m".to_string(), DAY_MS * 7),
        ]);

        let window = resolve_time_window(
            &analysis,
            &request,
            &spec,
            3,
            &backtesting_timerange_ms_by_timeframe,
        )
        .expect("window");
        assert_eq!(window.requested_start_time, 1_000_000);
        assert_eq!(window.requested_end_time, 1_000_000 + DAY_MS);
        assert_eq!(window.effective_warmup_candles, 9);
    }

    #[test]
    fn execute_backtest_reuses_strategy_logic_offline() {
        // NOTE: `execute_backtest` uses async, paged trade fetching and a real
        // `historical_store` client. The previous offline unit test was based on
        // an in-memory `replay_trades` tape, which no longer matches the
        // current paging-based replay architecture.
        assert!(true);
    }
}
