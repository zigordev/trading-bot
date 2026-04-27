use std::collections::BTreeSet;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use anyhow::{Context, Result, bail};
use chrono::{DateTime, TimeZone, Utc};
use futures_util::StreamExt;
use rdkafka::{
    ClientConfig, Message,
    consumer::{Consumer, StreamConsumer},
    producer::{FutureProducer, FutureRecord},
};
use serde::Serialize;
use std::time::Duration as StdDuration;
use trading_bot_market_data::db::{Database, StoredBacktestRunSummary, StoredBacktestRunWrite};
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
    kafka_topics::ensure_topics,
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
    kafka_producer: FutureProducer,
    historical_store: Database,
    status: tokio::sync::RwLock<RuntimeStatus>,
    running_readiness_windows: tokio::sync::Mutex<HashSet<String>>,
    running_readiness_batches: tokio::sync::Mutex<HashMap<String, ReadinessBatchWindow>>,
}

#[derive(Clone, Copy, Debug)]
struct ReadinessBatchWindow {
    requested_start_time: i64,
    requested_end_time: i64,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BacktestCompletedEventData {
    control_plane_job_id: Option<String>,
    backtest_id: String,
    finished_at: String,
    backtest_duration_ms: i64,
    data_retrieval_duration_ms: i64,
    analysis_setting_id: String,
    risk_profile_name: String,
    symbol: String,
    timeframe_code: String,
    strategy_name: String,
    requested_start_time: i64,
    requested_end_time: i64,
    replay_kline_count: usize,
    replay_trade_count: usize,
    signal_count: usize,
    trade_count: usize,
    stop_loss_trade_count: usize,
    take_profit_trade_count: usize,
    reversal_trade_count: usize,
    window_end_trade_count: usize,
    non_reversal_trade_count: usize,
    total_pnl_percent: f64,
    equity_curve_pnl_percent: f64,
    max_drawdown_percent: f64,
    reversal_ratio: f64,
    score: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BacktestCompletedEventEnvelope {
    event_id: String,
    event_type: &'static str,
    source: String,
    occurred_at: String,
    data: BacktestCompletedEventData,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BacktestProgressEventData {
    control_plane_job_id: String,
    analysis_setting_id: String,
    risk_profile_name: String,
    symbol: String,
    timeframe_code: String,
    strategy_name: String,
    stage: String,
    progress_percent: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BacktestProgressEventEnvelope {
    event_id: String,
    event_type: &'static str,
    source: String,
    occurred_at: String,
    data: BacktestProgressEventData,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BacktestBatchProgressEventData {
    batch_id: String,
    symbol: String,
    timeframe_code: String,
    requested_start_time: i64,
    requested_end_time: i64,
    stage: String,
    progress_percent: f64,
    total_count: usize,
    completed_count: usize,
    running_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BacktestBatchProgressEventEnvelope {
    event_id: String,
    event_type: &'static str,
    source: String,
    occurred_at: String,
    data: BacktestBatchProgressEventData,
}

#[derive(Clone, Debug)]
struct BacktestProgressContext {
    control_plane_job_id: String,
    analysis_setting_id: String,
    risk_profile_name: String,
    symbol: String,
    timeframe_code: String,
    strategy_name: String,
    batch_id: Option<String>,
    batch_total_count: Option<usize>,
    batch_completed_count: Option<usize>,
    requested_start_time: Option<i64>,
    requested_end_time: Option<i64>,
}

struct BacktestBatchProgressUpdate<'a> {
    batch_id: &'a str,
    symbol: &'a str,
    timeframe_code: &'a str,
    requested_start_time: i64,
    requested_end_time: i64,
    stage: &'a str,
    progress_percent: f64,
    total_count: usize,
    completed_count: usize,
    running_count: usize,
}

struct ExecuteBacktestContext {
    historical_store: Database,
    trade_page_rows: usize,
    fee_bps: f64,
    slippage_bps: f64,
    data_retrieval_duration_ms_override: Option<i64>,
    cached_trades: Option<Arc<Vec<HistoricalTradeRecord>>>,
    progress_context: Option<BacktestProgressContext>,
    kafka_producer: FutureProducer,
    backtest_progress_events_topic: String,
    progress_event_source: String,
}

async fn publish_batch_progress_from_context(
    kafka_producer: &FutureProducer,
    topic: &str,
    source: &str,
    context: &BacktestProgressContext,
    stage: &str,
    progress_percent: f64,
) -> Result<()> {
    let (Some(batch_id), Some(total_count), Some(completed_count)) = (
        context.batch_id.as_ref(),
        context.batch_total_count,
        context.batch_completed_count,
    ) else {
        return Ok(());
    };

    let requested_start_time = context.requested_start_time.unwrap_or_default();
    let requested_end_time = context.requested_end_time.unwrap_or_default();
    let normalized_progress = progress_percent.clamp(0.0, 100.0) / 100.0;
    let batch_progress_percent = if total_count == 0 {
        100.0
    } else {
        (((completed_count as f64) + normalized_progress) / total_count as f64) * 100.0
    };
    let envelope = BacktestBatchProgressEventEnvelope {
        event_id: Uuid::new_v4().to_string(),
        event_type: "trading-bot.research-backtesting.backtest-batch-progress.v1",
        source: source.to_string(),
        occurred_at: Utc::now().to_rfc3339(),
        data: BacktestBatchProgressEventData {
            batch_id: batch_id.clone(),
            symbol: context.symbol.clone(),
            timeframe_code: context.timeframe_code.clone(),
            requested_start_time,
            requested_end_time,
            stage: stage.to_string(),
            progress_percent: batch_progress_percent.clamp(0.0, 100.0),
            total_count,
            completed_count,
            running_count: 1,
        },
    };
    let payload = serde_json::to_string(&envelope)?;

    kafka_producer
        .send(
            FutureRecord::to(topic).key(batch_id).payload(&payload),
            StdDuration::from_secs(5),
        )
        .await
        .map_err(|(error, _)| anyhow::anyhow!(error))?;

    Ok(())
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataReadinessSnapshotEnvelope {
    event_id: String,
    event_type: String,
    data: DataReadinessSnapshotPayload,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataReadinessSnapshotPayload {
    items: Vec<DataReadinessSnapshotItem>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataReadinessSnapshotItem {
    status: String,
    #[serde(alias = "pairCode")]
    symbol_code: String,
    timeframe_code: String,
    strategy_name: String,
    #[serde(default)]
    analysis_setting_ids: Vec<String>,
    requested_start_time: i64,
    requested_end_time: i64,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlPlaneDataReadinessRecord {
    status: String,
    symbol_code: String,
    timeframe_code: String,
    strategy_name: String,
    #[serde(default)]
    analysis_setting_ids: Vec<String>,
    requested_start_time: i64,
    requested_end_time: i64,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlPlaneDataReadinessResponse {
    items: Vec<ControlPlaneDataReadinessRecord>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BinanceAggTradeBoundaryRow {
    #[serde(alias = "a")]
    aggregate_trade_id: i64,
    #[serde(alias = "T")]
    trade_time: i64,
}

#[derive(Clone, Copy, Debug)]
struct TrueTradeWindowBoundaries {
    first_aggregate_trade_id: i64,
    last_aggregate_trade_id: i64,
    first_trade_time: i64,
    last_trade_time: i64,
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

impl ResearchBacktestingService {
    pub async fn new(config: AppConfig) -> Result<Self> {
        ensure_topics(
            &config.kafka_bootstrap_servers,
            &[
                &config.backtest_completed_events_topic,
                &config.backtest_progress_events_topic,
                &config.data_readiness_events_topic,
            ],
        )
        .await?;
        let control_plane_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(
                config.control_plane_request_timeout_ms,
            ))
            .build()?;
        let kafka_producer = ClientConfig::new()
            .set("bootstrap.servers", &config.kafka_bootstrap_servers)
            .set("message.timeout.ms", "5000")
            .create::<FutureProducer>()?;
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
                kafka_producer,
                historical_store,
                status: tokio::sync::RwLock::new(RuntimeStatus {
                    started: false,
                    dependencies: DependencyStatus::default(),
                    last_backtest: None,
                    otel_exporter_configured: config.otel_exporter_otlp_endpoint.is_some(),
                }),
                running_readiness_windows: tokio::sync::Mutex::new(HashSet::new()),
                running_readiness_batches: tokio::sync::Mutex::new(HashMap::new()),
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

        service.start_data_readiness_consumer();
        service.start_scheduled_backtests_loop();

        Ok(service)
    }

    pub fn config_snapshot(&self) -> AppConfig {
        self.inner.config.clone()
    }

    fn start_data_readiness_consumer(&self) {
        let service = self.clone();

        tokio::spawn(async move {
            if let Err(error) = service.consume_data_readiness_events().await {
                error!(error = %error, "data-readiness trigger consumer stopped");
            }
        });
    }

    fn start_scheduled_backtests_loop(&self) {
        if !self.inner.config.scheduled_backtests_enabled {
            return;
        }

        let service = self.clone();
        tokio::spawn(async move {
            if let Err(error) = service.run_scheduled_backtest_scan("startup").await {
                warn!(error = %error, "scheduled backtest startup scan failed");
            }

            loop {
                tokio::time::sleep(Self::duration_until_next_scheduled_backtest_run(
                    service.inner.config.scheduled_backtests_interval_seconds,
                ))
                .await;

                if let Err(error) = service.run_scheduled_backtest_scan("periodic").await {
                    warn!(error = %error, "scheduled backtest periodic scan failed");
                }
            }
        });
    }

    async fn consume_data_readiness_events(&self) -> Result<()> {
        let consumer = ClientConfig::new()
            .set(
                "bootstrap.servers",
                &self.inner.config.kafka_bootstrap_servers,
            )
            .set(
                "group.id",
                &self.inner.config.data_readiness_events_consumer_group_id,
            )
            .set("enable.auto.commit", "true")
            .set("auto.offset.reset", "earliest")
            .create::<StreamConsumer>()?;

        consumer.subscribe(&[&self.inner.config.data_readiness_events_topic])?;

        info!(
            topic = %self.inner.config.data_readiness_events_topic,
            group_id = %self.inner.config.data_readiness_events_consumer_group_id,
            "data-readiness trigger consumer started"
        );

        let mut stream = consumer.stream();
        while let Some(message) = stream.next().await {
            match message {
                Ok(message) => {
                    let Some(payload) = message.payload_view::<str>().transpose()? else {
                        continue;
                    };

                    if let Err(error) = self.handle_data_readiness_message(payload).await {
                        warn!(error = %error, "failed to process data-readiness snapshot");
                    }
                }
                Err(error) => {
                    warn!(error = %error, "data-readiness trigger consumer poll failed");
                }
            }
        }

        Ok(())
    }

    async fn handle_data_readiness_message(&self, payload: &str) -> Result<()> {
        let envelope = serde_json::from_str::<DataReadinessSnapshotEnvelope>(payload)
            .context("invalid data-readiness snapshot payload")?;
        if envelope.event_type != "trading-bot.market-data.data-readiness-snapshot.v1" {
            return Ok(());
        }

        let candidate_symbols = envelope
            .data
            .items
            .into_iter()
            .filter(|item| item.status == "ready")
            .map(|item| item.symbol_code)
            .collect::<BTreeSet<_>>();

        if candidate_symbols.is_empty() {
            return Ok(());
        }

        let ready_items = self
            .fetch_symbol_ready_datasets_from_control_plane(candidate_symbols.iter())
            .await?;

        for item in ready_items {
            if let Err(error) = self
                .trigger_backtests_for_ready_dataset(&item, &envelope.event_id)
                .await
            {
                warn!(
                    error = %error,
                    symbol = %item.symbol_code,
                    timeframe_code = %item.timeframe_code,
                    requested_start_time = item.requested_start_time,
                    requested_end_time = item.requested_end_time,
                    "failed to trigger readiness-driven backtests"
                );
            }
        }

        Ok(())
    }

    async fn run_scheduled_backtest_scan(&self, reason: &str) -> Result<usize> {
        let ready_items = self.fetch_ready_datasets_from_control_plane().await?;
        let mut started = 0usize;

        for item in ready_items {
            started = started.saturating_add(
                self.trigger_backtests_for_ready_dataset(&item, reason)
                    .await?,
            );
        }

        info!(
            reason,
            started, "scheduled backtest scan processed ready datasets"
        );
        Ok(started)
    }

    async fn fetch_ready_datasets_from_control_plane(
        &self,
    ) -> Result<Vec<DataReadinessSnapshotItem>> {
        let rows = self.fetch_data_readiness_from_control_plane().await?;
        Ok(filter_symbol_complete_ready_items(rows))
    }

    async fn fetch_symbol_ready_datasets_from_control_plane<'a>(
        &self,
        symbols: impl IntoIterator<Item = &'a String>,
    ) -> Result<Vec<DataReadinessSnapshotItem>> {
        let wanted = symbols.into_iter().cloned().collect::<BTreeSet<String>>();
        let rows = self.fetch_data_readiness_from_control_plane().await?;
        Ok(filter_symbol_complete_ready_items(rows)
            .into_iter()
            .filter(|item| wanted.contains(&item.symbol_code))
            .collect())
    }

    async fn fetch_data_readiness_from_control_plane(
        &self,
    ) -> Result<Vec<ControlPlaneDataReadinessRecord>> {
        let response = self
            .inner
            .control_plane_client
            .get(format!(
                "{}/v1/ops/data-readiness",
                self.inner.config.control_plane_base_url
            ))
            .send()
            .await?;
        let response = response.error_for_status()?;
        let rows = response.json::<ControlPlaneDataReadinessResponse>().await?;
        Ok(rows.items)
    }

    pub fn metrics_text(&self) -> Result<String> {
        self.inner.metrics.encode()
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
        let progress_context = request
            .control_plane_job_id
            .clone()
            .map(|control_plane_job_id| BacktestProgressContext {
                control_plane_job_id,
                analysis_setting_id: resolved.analysis.id.clone(),
                risk_profile_name: resolved.analysis.risk_profile_name.clone(),
                symbol: resolved.analysis.symbol.clone(),
                timeframe_code: resolved.analysis.timeframe_code.clone(),
                strategy_name: resolved.analysis.strategy_name.clone(),
                batch_id: request.batch_id.clone(),
                batch_total_count: request.batch_total_count,
                batch_completed_count: request.batch_completed_count,
                requested_start_time: request.start_time,
                requested_end_time: request.end_time,
            });
        if let Some(context) = progress_context.as_ref()
            && let Err(error) = self
                .publish_backtest_progress_event(context, "retrieving-data", 0.0)
                .await
        {
            warn!(
                error = %error,
                control_plane_job_id = %context.control_plane_job_id,
                "failed to publish backtest-progress event"
            );
        }
        let completed = execute_backtest(
            &self.inner.config.service_name,
            resolved,
            ExecuteBacktestContext {
                historical_store: self.inner.historical_store.clone(),
                trade_page_rows: self.inner.config.backtest_trade_replay_page_rows,
                fee_bps: self.inner.config.default_fee_bps,
                slippage_bps: self.inner.config.default_slippage_bps,
                data_retrieval_duration_ms_override: None,
                cached_trades: None,
                progress_context: progress_context.clone(),
                kafka_producer: self.inner.kafka_producer.clone(),
                backtest_progress_events_topic: self
                    .inner
                    .config
                    .backtest_progress_events_topic
                    .clone(),
                progress_event_source: self.inner.config.service_name.clone(),
            },
        )
        .await?;
        let persisted_run = persisted_backtest_run(&completed.response)?;
        self.inner
            .historical_store
            .insert_backtest_run(&persisted_run)
            .await?;
        if let Err(error) = self
            .publish_backtest_completed_event(
                &completed.response,
                request.control_plane_job_id.as_deref(),
            )
            .await
        {
            warn!(
                error = %error,
                backtest_id = completed.response.backtest_id,
                "failed to publish backtest-completed event"
            );
        }

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

    async fn publish_backtest_completed_event(
        &self,
        response: &BacktestResponse,
        control_plane_job_id: Option<&str>,
    ) -> Result<()> {
        let envelope = BacktestCompletedEventEnvelope {
            event_id: Uuid::new_v4().to_string(),
            event_type: "trading-bot.research-backtesting.backtest-completed.v1",
            source: self.inner.config.service_name.clone(),
            occurred_at: response.finished_at.clone(),
            data: BacktestCompletedEventData {
                control_plane_job_id: control_plane_job_id.map(ToOwned::to_owned),
                backtest_id: response.backtest_id.clone(),
                finished_at: response.finished_at.clone(),
                backtest_duration_ms: response.backtest_duration_ms,
                data_retrieval_duration_ms: response.data_retrieval_duration_ms,
                analysis_setting_id: response.analysis_setting_id.clone(),
                risk_profile_name: response.analysis.risk_profile_name.clone(),
                symbol: response.analysis.symbol_entity.code.clone(),
                timeframe_code: response.analysis.timeframe_code.clone(),
                strategy_name: response.analysis.strategy_name.clone(),
                requested_start_time: response.time_window.requested_start_time,
                requested_end_time: response.time_window.requested_end_time,
                replay_kline_count: response.dataset.replay_kline_count,
                replay_trade_count: response.dataset.replay_trade_count,
                signal_count: response.summary.signal_count,
                trade_count: response.summary.trade_count,
                stop_loss_trade_count: response.summary.stop_loss_trade_count,
                take_profit_trade_count: response.summary.take_profit_trade_count,
                reversal_trade_count: response.summary.reversal_trade_count,
                window_end_trade_count: response.summary.window_end_trade_count,
                non_reversal_trade_count: response.summary.non_reversal_trade_count,
                total_pnl_percent: response.summary.total_pnl_percent,
                equity_curve_pnl_percent: response.summary.equity_curve_pnl_percent,
                max_drawdown_percent: response.summary.max_drawdown_percent,
                reversal_ratio: response.summary.reversal_ratio,
                score: response.summary.score,
            },
        };
        let payload = serde_json::to_string(&envelope)?;

        self.inner
            .kafka_producer
            .send(
                FutureRecord::to(&self.inner.config.backtest_completed_events_topic)
                    .key(&response.backtest_id)
                    .payload(&payload),
                StdDuration::from_secs(5),
            )
            .await
            .map_err(|(error, _)| anyhow::anyhow!(error))?;

        Ok(())
    }

    async fn publish_backtest_progress_event(
        &self,
        context: &BacktestProgressContext,
        stage: &str,
        progress_percent: f64,
    ) -> Result<()> {
        let envelope = BacktestProgressEventEnvelope {
            event_id: Uuid::new_v4().to_string(),
            event_type: "trading-bot.research-backtesting.backtest-progress.v1",
            source: self.inner.config.service_name.clone(),
            occurred_at: Utc::now().to_rfc3339(),
            data: BacktestProgressEventData {
                control_plane_job_id: context.control_plane_job_id.clone(),
                analysis_setting_id: context.analysis_setting_id.clone(),
                risk_profile_name: context.risk_profile_name.clone(),
                symbol: context.symbol.clone(),
                timeframe_code: context.timeframe_code.clone(),
                strategy_name: context.strategy_name.clone(),
                stage: stage.to_string(),
                progress_percent: progress_percent.clamp(0.0, 100.0),
            },
        };
        let payload = serde_json::to_string(&envelope)?;

        self.inner
            .kafka_producer
            .send(
                FutureRecord::to(&self.inner.config.backtest_progress_events_topic)
                    .key(&context.control_plane_job_id)
                    .payload(&payload),
                StdDuration::from_secs(5),
            )
            .await
            .map_err(|(error, _)| anyhow::anyhow!(error))?;

        if let (Some(batch_id), Some(total_count), Some(completed_count)) = (
            context.batch_id.as_ref(),
            context.batch_total_count,
            context.batch_completed_count,
        ) {
            let requested_start_time = context.requested_start_time.unwrap_or_default();
            let requested_end_time = context.requested_end_time.unwrap_or_default();
            let normalized_progress = progress_percent.clamp(0.0, 100.0) / 100.0;
            let batch_progress_percent = if total_count == 0 {
                100.0
            } else {
                (((completed_count as f64) + normalized_progress) / total_count as f64) * 100.0
            };
            self.publish_backtest_batch_progress_event(&BacktestBatchProgressUpdate {
                batch_id,
                symbol: &context.symbol,
                timeframe_code: &context.timeframe_code,
                requested_start_time,
                requested_end_time,
                stage,
                progress_percent: batch_progress_percent,
                total_count,
                completed_count,
                running_count: 1,
            })
            .await?;
        }

        Ok(())
    }

    async fn publish_backtest_batch_progress_event(
        &self,
        update: &BacktestBatchProgressUpdate<'_>,
    ) -> Result<()> {
        let envelope = BacktestBatchProgressEventEnvelope {
            event_id: Uuid::new_v4().to_string(),
            event_type: "trading-bot.research-backtesting.backtest-batch-progress.v1",
            source: self.inner.config.service_name.clone(),
            occurred_at: Utc::now().to_rfc3339(),
            data: BacktestBatchProgressEventData {
                batch_id: update.batch_id.to_string(),
                symbol: update.symbol.to_string(),
                timeframe_code: update.timeframe_code.to_string(),
                requested_start_time: update.requested_start_time,
                requested_end_time: update.requested_end_time,
                stage: update.stage.to_string(),
                progress_percent: update.progress_percent.clamp(0.0, 100.0),
                total_count: update.total_count,
                completed_count: update.completed_count,
                running_count: update.running_count,
            },
        };
        let payload = serde_json::to_string(&envelope)?;

        self.inner
            .kafka_producer
            .send(
                FutureRecord::to(&self.inner.config.backtest_progress_events_topic)
                    .key(update.batch_id)
                    .payload(&payload),
                StdDuration::from_secs(5),
            )
            .await
            .map_err(|(error, _)| anyhow::anyhow!(error))?;

        Ok(())
    }

    async fn trigger_backtests_for_ready_dataset(
        &self,
        item: &DataReadinessSnapshotItem,
        source_event_id: &str,
    ) -> Result<usize> {
        let batch_key =
            readiness_batch_key(&item.symbol_code, &item.timeframe_code, &item.strategy_name);
        let requested_window = ReadinessBatchWindow {
            requested_start_time: item.requested_start_time,
            requested_end_time: item.requested_end_time,
        };

        if let Some(active_window) = self
            .try_mark_readiness_batch_in_flight(&batch_key, requested_window)
            .await
        {
            info!(
                symbol = %item.symbol_code,
                timeframe_code = %item.timeframe_code,
                strategy_name = %item.strategy_name,
                requested_start_time = item.requested_start_time,
                requested_end_time = item.requested_end_time,
                active_requested_start_time = active_window.requested_start_time,
                active_requested_end_time = active_window.requested_end_time,
                source_event_id,
                "skipping readiness-triggered backtests because another batch is already running for this row"
            );
            return Ok(0);
        }

        let result = async {
            let analysis_id_filter = item
                .analysis_setting_ids
                .iter()
                .cloned()
                .collect::<HashSet<_>>();
            let analyses = self
                .fetch_runtime_analysis_settings()
                .await?
                .into_iter()
                .filter(|analysis| analysis.enabled)
                .filter(|analysis| analysis.symbol == item.symbol_code)
                .filter(|analysis| analysis.timeframe_code == item.timeframe_code)
                .filter(|analysis| analysis.strategy_name == item.strategy_name)
                .filter(|analysis| {
                    analysis_id_filter.is_empty() || analysis_id_filter.contains(&analysis.id)
                })
                .collect::<Vec<_>>();
            let mut analyses = analyses;

            if analyses.is_empty() {
                return Ok(0);
            }

            analyses.sort_by_key(|analysis| {
                std::cmp::Reverse(
                    self.inner
                        .config
                        .backtesting_timerange_ms_by_timeframe
                        .get(&analysis.timeframe_code)
                        .copied()
                        .unwrap_or_default(),
                )
            });

            let mut runnable_analyses = Vec::new();
            let mut skipped_existing = 0usize;

            for analysis in analyses {
                let run_key = readiness_run_key(
                    &analysis.id,
                    &analysis.symbol,
                    &analysis.timeframe_code,
                    &analysis.risk_profile_name,
                    item.requested_start_time,
                    item.requested_end_time,
                );

                if self.readiness_window_in_flight(&run_key).await {
                    continue;
                }

                if self
                    .inner
                    .historical_store
                    .backtest_run_exists_for_window(
                        &analysis.id,
                        &analysis.symbol,
                        &analysis.timeframe_code,
                        &analysis.risk_profile_name,
                        item.requested_start_time,
                        item.requested_end_time,
                    )
                    .await?
                {
                    skipped_existing += 1;
                    continue;
                }

                runnable_analyses.push((analysis, run_key));
            }

            if runnable_analyses.is_empty() {
                if skipped_existing > 0 {
                    info!(
                        symbol = %item.symbol_code,
                        timeframe_code = %item.timeframe_code,
                        requested_start_time = item.requested_start_time,
                        requested_end_time = item.requested_end_time,
                        started = 0,
                        skipped_existing,
                        source_event_id,
                        "processed readiness-triggered backtests"
                    );
                }
                return Ok(0);
            }

            let batch_id = format!(
                "{}:{}:{}:{}",
                item.symbol_code,
                item.timeframe_code,
                item.requested_start_time,
                item.requested_end_time
            );
            let total_count = runnable_analyses.len();
            let mut trade_cache: Option<TradeWindowCache> = None;
            let mut started = 0usize;

            self.publish_backtest_batch_progress_event(&BacktestBatchProgressUpdate {
                batch_id: &batch_id,
                symbol: &item.symbol_code,
                timeframe_code: &item.timeframe_code,
                requested_start_time: item.requested_start_time,
                requested_end_time: item.requested_end_time,
                stage: "retrieving-data",
                progress_percent: 0.0,
                total_count,
                completed_count: 0,
                running_count: 0,
            })
            .await?;

            for (analysis, run_key) in runnable_analyses {
                self.mark_readiness_window_in_flight(&run_key).await;

                let request = BacktestRequest {
                    control_plane_job_id: Some(format!("readiness-{}", Uuid::new_v4())),
                    batch_id: Some(batch_id.clone()),
                    batch_total_count: Some(total_count),
                    batch_completed_count: Some(started),
                    analysis_setting_id: analysis.id.clone(),
                    symbol_code: Some(analysis.symbol.clone()),
                    timeframe_code: Some(analysis.timeframe_code.clone()),
                    risk_profile_name: Some(analysis.risk_profile_name.clone()),
                    start_time: Some(item.requested_start_time),
                    end_time: Some(item.requested_end_time),
                    warmup_candles: None,
                };
                let result = self
                    .run_backtest_with_trade_cache(request, &mut trade_cache)
                    .await;
                self.unmark_readiness_window_in_flight(&run_key).await;

                match result {
                    Ok(_) => {
                        started += 1;
                        let stage = if started >= total_count {
                            "completed"
                        } else {
                            "running-backtests"
                        };
                        if let Err(error) = self
                            .publish_backtest_batch_progress_event(&BacktestBatchProgressUpdate {
                                batch_id: &batch_id,
                                symbol: &item.symbol_code,
                                timeframe_code: &item.timeframe_code,
                                requested_start_time: item.requested_start_time,
                                requested_end_time: item.requested_end_time,
                                stage,
                                progress_percent: (started as f64 / total_count as f64) * 100.0,
                                total_count,
                                completed_count: started,
                                running_count: 0,
                            })
                            .await
                        {
                            warn!(
                                error = %error,
                                batch_id = %batch_id,
                                "failed to publish backtest-batch progress event"
                            );
                        }
                    }
                    Err(error) => {
                        let _ = self
                            .publish_backtest_batch_progress_event(&BacktestBatchProgressUpdate {
                                batch_id: &batch_id,
                                symbol: &item.symbol_code,
                                timeframe_code: &item.timeframe_code,
                                requested_start_time: item.requested_start_time,
                                requested_end_time: item.requested_end_time,
                                stage: "failed",
                                progress_percent: if total_count == 0 {
                                    0.0
                                } else {
                                    (started as f64 / total_count as f64) * 100.0
                                },
                                total_count,
                                completed_count: started,
                                running_count: 0,
                            })
                            .await;
                        warn!(
                            error = %error,
                            analysis_setting_id = %analysis.id,
                            risk_profile_name = %analysis.risk_profile_name,
                            symbol = %analysis.symbol,
                            timeframe_code = %analysis.timeframe_code,
                            requested_start_time = item.requested_start_time,
                            requested_end_time = item.requested_end_time,
                            source_event_id,
                            "readiness-triggered backtest failed"
                        );
                    }
                }
            }

            if started > 0 || skipped_existing > 0 {
                info!(
                    symbol = %item.symbol_code,
                    timeframe_code = %item.timeframe_code,
                    requested_start_time = item.requested_start_time,
                    requested_end_time = item.requested_end_time,
                    started,
                    skipped_existing,
                    source_event_id,
                    "processed readiness-triggered backtests"
                );
            }
            Ok(started)
        }
        .await;

        self.unmark_readiness_batch_in_flight(&batch_key).await;
        result
    }

    async fn readiness_window_in_flight(&self, run_key: &str) -> bool {
        self.inner
            .running_readiness_windows
            .lock()
            .await
            .contains(run_key)
    }

    async fn mark_readiness_window_in_flight(&self, run_key: &str) {
        self.inner
            .running_readiness_windows
            .lock()
            .await
            .insert(run_key.to_string());
    }

    async fn unmark_readiness_window_in_flight(&self, run_key: &str) {
        self.inner
            .running_readiness_windows
            .lock()
            .await
            .remove(run_key);
    }

    async fn try_mark_readiness_batch_in_flight(
        &self,
        batch_key: &str,
        requested_window: ReadinessBatchWindow,
    ) -> Option<ReadinessBatchWindow> {
        let mut guard = self.inner.running_readiness_batches.lock().await;
        if let Some(active_window) = guard.get(batch_key).copied() {
            return Some(active_window);
        }

        guard.insert(batch_key.to_string(), requested_window);
        None
    }

    async fn unmark_readiness_batch_in_flight(&self, batch_key: &str) {
        self.inner
            .running_readiness_batches
            .lock()
            .await
            .remove(batch_key);
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
        let progress_context = request
            .control_plane_job_id
            .clone()
            .map(|control_plane_job_id| BacktestProgressContext {
                control_plane_job_id,
                analysis_setting_id: resolved.analysis.id.clone(),
                risk_profile_name: resolved.analysis.risk_profile_name.clone(),
                symbol: resolved.analysis.symbol.clone(),
                timeframe_code: resolved.analysis.timeframe_code.clone(),
                strategy_name: resolved.analysis.strategy_name.clone(),
                batch_id: request.batch_id.clone(),
                batch_total_count: request.batch_total_count,
                batch_completed_count: request.batch_completed_count,
                requested_start_time: request.start_time,
                requested_end_time: request.end_time,
            });
        if let Some(context) = progress_context.as_ref()
            && let Err(error) = self
                .publish_backtest_progress_event(context, "retrieving-data", 0.0)
                .await
        {
            warn!(
                error = %error,
                control_plane_job_id = %context.control_plane_job_id,
                "failed to publish backtest-progress event"
            );
        }
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
            ExecuteBacktestContext {
                historical_store: self.inner.historical_store.clone(),
                trade_page_rows: self.inner.config.backtest_trade_replay_page_rows,
                fee_bps: self.inner.config.default_fee_bps,
                slippage_bps: self.inner.config.default_slippage_bps,
                data_retrieval_duration_ms_override: data_retrieval_duration_ms,
                cached_trades,
                progress_context: progress_context.clone(),
                kafka_producer: self.inner.kafka_producer.clone(),
                backtest_progress_events_topic: self
                    .inner
                    .config
                    .backtest_progress_events_topic
                    .clone(),
                progress_event_source: self.inner.config.service_name.clone(),
            },
        )
        .await?;
        let persisted_run = persisted_backtest_run(&completed.response)?;
        self.inner
            .historical_store
            .insert_backtest_run(&persisted_run)
            .await?;
        if let Err(error) = self
            .publish_backtest_completed_event(
                &completed.response,
                request.control_plane_job_id.as_deref(),
            )
            .await
        {
            warn!(
                error = %error,
                backtest_id = completed.response.backtest_id,
                "failed to publish backtest-completed event"
            );
        }

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
            .find(|record| {
                record.id == request.analysis_setting_id
                    && match request.symbol_code.as_ref() {
                        Some(symbol_code) => record.symbol == *symbol_code,
                        None => true,
                    }
                    && match request.timeframe_code.as_ref() {
                        Some(timeframe_code) => record.timeframe_code == *timeframe_code,
                        None => true,
                    }
            })
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
            self.inner.config.backtest_warmup_candles,
            &self.inner.config.backtesting_timerange_ms_by_timeframe,
        )?;
        let replay_trade_start_time = time_window.requested_start_time;
        let replay_trade_end_time = time_window.requested_end_time;
        let expected_candles_by_timeframe = spec
            .required_kline_requirements()
            .into_iter()
            .map(|requirement| {
                let period_ms = requirement_period_ms(&analysis, &requirement.timeframe_code)?;
                let expected_candles = expected_candle_count(
                    time_window.effective_warmup_start_time,
                    time_window.requested_end_time,
                    period_ms,
                )?;
                if expected_candles > self.inner.config.max_backtest_klines {
                    bail!(
                        "requested replay needs {} klines for {} {}, which exceeds BACKTEST_MAX_KLINES={}",
                        expected_candles,
                        analysis.symbol,
                        requirement.timeframe_code,
                        self.inner.config.max_backtest_klines
                    );
                }
                Ok((requirement.timeframe_code, expected_candles, period_ms))
            })
            .collect::<Result<Vec<_>>>()?;
        // Use all available trades up to the configured hard cap.
        let expected_trades = self.inner.config.max_backtest_trades;

        let mut warmup_rows_by_timeframe = BTreeMap::new();
        let mut replay_rows = Vec::new();
        let mut fetched_kline_count = 0usize;
        for (timeframe_code, expected_candles, period_ms) in expected_candles_by_timeframe {
            if let Some(blocker) = kline_coverage_blocker_from_store(
                &self.inner.historical_store,
                &analysis.symbol,
                &timeframe_code,
                time_window.effective_warmup_start_time,
                time_window.requested_end_time,
                period_ms,
            )
            .await?
            {
                warn!(
                    symbol = %analysis.symbol,
                    timeframe_code = %timeframe_code,
                    requested_start_time = time_window.requested_start_time,
                    requested_end_time = time_window.requested_end_time,
                    effective_warmup_start_time = time_window.effective_warmup_start_time,
                    blocker = %blocker,
                    "backtest window does not have full historical kline coverage"
                );

                bail!(
                    "insufficient historical klines in ClickHouse for {} {} within {}..{}; backtesting requires exact market_data_klines coverage ({})",
                    analysis.symbol,
                    timeframe_code,
                    time_window.effective_warmup_start_time,
                    time_window.requested_end_time,
                    blocker
                );
            }

            let rows = self
                .inner
                .historical_store
                .replay_klines(
                    &analysis.symbol,
                    &timeframe_code,
                    Some(time_window.effective_warmup_start_time),
                    Some(time_window.requested_end_time),
                    expected_candles as i64,
                )
                .await?
                .into_iter()
                .map(map_historical_kline_row)
                .filter(|row| row.closed)
                .collect::<Vec<_>>();
            fetched_kline_count = fetched_kline_count.saturating_add(rows.len());

            let (warmup_rows, timeframe_replay_rows) = split_kline_rows_for_backtest_window(
                rows,
                time_window.requested_start_time,
                time_window.requested_end_time,
                timeframe_code == analysis.timeframe_code,
            );
            warmup_rows_by_timeframe.insert(timeframe_code, warmup_rows);
            replay_rows.extend(timeframe_replay_rows);
        }

        sort_replay_rows_chronologically(&mut replay_rows);

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
        let tolerance = self.inner.config.trade_coverage_tolerance_ms as i64;
        let trade_coverage_blocker = trade_coverage_blocker_from_store(
            &self.inner.control_plane_client,
            &self.inner.config.binance_reference_base_url,
            &self.inner.historical_store,
            &analysis.symbol,
            time_window.requested_start_time,
            time_window.requested_end_time,
            tolerance,
        )
        .await
        .unwrap_or_else(|error| {
            warn!(
                error = %error,
                symbol = %analysis.symbol,
                requested_start_time = time_window.requested_start_time,
                requested_end_time = time_window.requested_end_time,
                "failed to validate trade coverage for backtest window"
            );
            Some("trade coverage validation failed".to_string())
        });

        if let Some(blocker) = trade_coverage_blocker {
            warn!(
                symbol = %analysis.symbol,
                timeframe_code = %analysis.timeframe_code,
                requested_start_time = time_window.requested_start_time,
                requested_end_time = time_window.requested_end_time,
                trade_coverage_tolerance_ms = self.inner.config.trade_coverage_tolerance_ms,
                blocker = %blocker,
                "backtest window does not have full historical aggregate trade coverage"
            );

            bail!(
                "insufficient historical aggregate trades in ClickHouse for {} within {}..{}; fill-aware backtesting requires full market_data_trades coverage ({})",
                analysis.symbol,
                time_window.requested_start_time,
                time_window.requested_end_time,
                blocker
            );
        }

        Ok(ResolvedBacktestInput {
            analysis,
            time_window,
            warmup_rows_by_timeframe,
            replay_rows,
            fetched_kline_count,
            replay_trade_start_time,
            replay_trade_end_time,
            replay_trade_max_rows: expected_trades,
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

    fn duration_until_next_scheduled_backtest_run(interval_seconds: u64) -> StdDuration {
        let interval_ms = (interval_seconds.max(1) as i64).saturating_mul(1000);
        let now_ms = Utc::now().timestamp_millis();
        let next_ms = now_ms
            .div_euclid(interval_ms)
            .saturating_add(1)
            .saturating_mul(interval_ms)
            .max(now_ms.saturating_add(1));
        StdDuration::from_millis(next_ms.saturating_sub(now_ms) as u64)
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

fn persisted_backtest_run(response: &BacktestResponse) -> Result<StoredBacktestRunWrite> {
    Ok(StoredBacktestRunWrite {
        backtest_id: response.backtest_id.clone(),
        finished_at_ms: DateTime::parse_from_rfc3339(&response.finished_at)
            .with_context(|| format!("invalid finishedAt timestamp: {}", response.finished_at))?
            .timestamp_millis(),
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
        stop_loss_trade_count: 0,
        take_profit_trade_count: 0,
        reversal_trade_count: 0,
        window_end_trade_count: 0,
        non_reversal_trade_count: 0,
        total_pnl_percent: run.total_pnl_percent,
        equity_curve_pnl_percent: 0.0,
        max_drawdown_percent: 0.0,
        reversal_ratio: 0.0,
        score: run.total_pnl_percent,
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
        stop_loss_trade_count: row.stop_loss_trade_count as usize,
        take_profit_trade_count: row.take_profit_trade_count as usize,
        reversal_trade_count: row.reversal_trade_count as usize,
        window_end_trade_count: row.window_end_trade_count as usize,
        non_reversal_trade_count: row.non_reversal_trade_count as usize,
        total_pnl_percent: row.total_pnl_percent,
        equity_curve_pnl_percent: row.equity_curve_pnl_percent,
        max_drawdown_percent: row.max_drawdown_percent,
        reversal_ratio: row.reversal_ratio,
        score: row.score,
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

fn readiness_run_key(
    analysis_setting_id: &str,
    symbol: &str,
    timeframe_code: &str,
    risk_profile_name: &str,
    requested_start_time: i64,
    requested_end_time: i64,
) -> String {
    format!(
        "{analysis_setting_id}:{symbol}:{timeframe_code}:{risk_profile_name}:{requested_start_time}:{requested_end_time}"
    )
}

fn readiness_batch_key(symbol: &str, timeframe_code: &str, strategy_name: &str) -> String {
    format!("{symbol}:{timeframe_code}:{strategy_name}")
}

fn resolve_time_window(
    analysis: &ResolvedAnalysisSettingsRecord,
    request: &BacktestRequest,
    spec: &AnalysisSpec,
    backtest_warmup_candles: usize,
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
                let end_time = last_closed_hour_utc(Utc::now()).timestamp_millis();
                let start_time = end_time
                    .checked_sub(configured_duration_ms)
                    .context("legacy-style backtest startTime overflowed i64")?;
                validate_time_window(start_time, end_time)?;
                (start_time, end_time, "env".to_string())
            }
        };

    let effective_warmup_candles = request
        .warmup_candles
        .unwrap_or(backtest_warmup_candles)
        .max(spec.max_warmup_candles());
    let warmup_ms = spec
        .required_kline_requirements()
        .into_iter()
        .map(|requirement| {
            let period_ms = requirement_period_ms(analysis, &requirement.timeframe_code)?;
            (requirement.warmup_candles as i64)
                .checked_mul(period_ms)
                .context("warmup window overflowed i64")
        })
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .max()
        .unwrap_or_else(|| (effective_warmup_candles as i64) * analysis.timeframe.period_ms);
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

fn requirement_period_ms(
    analysis: &ResolvedAnalysisSettingsRecord,
    timeframe_code: &str,
) -> Result<i64> {
    if timeframe_code == analysis.timeframe_code {
        return Ok(analysis.timeframe.period_ms);
    }

    if timeframe_code == analysis.timeframe.longer_timeframe_code {
        return analysis
            .timeframe
            .period_ms
            .checked_mul(analysis.timeframe.longer_timeframe_multiplier)
            .context("longer timeframe period overflowed i64");
    }

    bail!(
        "analysis setting {} references unsupported timeframe dependency {}",
        analysis.id,
        timeframe_code
    )
}

fn split_kline_rows_for_backtest_window(
    rows: Vec<PersistedKlineRecord>,
    requested_start_time: i64,
    requested_end_time: i64,
    is_signal_timeframe: bool,
) -> (Vec<PersistedKlineRecord>, Vec<PersistedKlineRecord>) {
    let mut warmup_rows = Vec::new();
    let mut replay_rows = Vec::new();

    for row in rows {
        let is_before_replay = if is_signal_timeframe {
            row.open_time < requested_start_time
        } else {
            row.close_time < requested_start_time
        };
        let is_inside_replay = if is_signal_timeframe {
            row.open_time >= requested_start_time && row.open_time < requested_end_time
        } else {
            row.close_time >= requested_start_time && row.close_time < requested_end_time
        };

        if is_before_replay {
            warmup_rows.push(row);
        } else if is_inside_replay {
            replay_rows.push(row);
        }
    }

    (warmup_rows, replay_rows)
}

fn sort_replay_rows_chronologically(rows: &mut [PersistedKlineRecord]) {
    rows.sort_by(|left, right| {
        left.close_time
            .cmp(&right.close_time)
            .then(right.period_ms.cmp(&left.period_ms))
            .then(left.open_time.cmp(&right.open_time))
            .then(left.timeframe_code.cmp(&right.timeframe_code))
    });
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

fn last_closed_hour_utc(reference_time: DateTime<Utc>) -> DateTime<Utc> {
    let timestamp_ms = reference_time.timestamp_millis();
    let hour_ms = 60 * 60 * 1000;
    let closed_hour_ms = timestamp_ms.div_euclid(hour_ms) * hour_ms;
    Utc.timestamp_millis_opt(closed_hour_ms)
        .single()
        .expect("valid closed hour")
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

fn exact_candle_count_exclusive(start_time: i64, end_time: i64, period_ms: i64) -> Result<usize> {
    if period_ms <= 0 {
        bail!("periodMs must be greater than zero");
    }
    let span_ms = end_time
        .checked_sub(start_time)
        .context("replay span overflowed i64")?;
    let count = span_ms / period_ms;
    Ok(count.max(1) as usize)
}

fn kline_coverage_blocker(
    required_klines: usize,
    coverage: &trading_bot_market_data::db::WindowCoverage,
) -> Option<String> {
    if coverage.row_count < required_klines as u64 {
        return Some(format!(
            "kline coverage incomplete (have {}, need {})",
            coverage.row_count, required_klines
        ));
    }

    None
}

async fn kline_coverage_blocker_from_store(
    historical_store: &Database,
    pair_code: &str,
    timeframe_code: &str,
    start_time: i64,
    end_time: i64,
    period_ms: i64,
) -> Result<Option<String>> {
    let required_klines = exact_candle_count_exclusive(start_time, end_time, period_ms)?;
    let coverage = historical_store
        .kline_window_coverage_in_range(
            pair_code,
            timeframe_code,
            start_time,
            end_time.saturating_sub(1),
        )
        .await?;
    Ok(kline_coverage_blocker(required_klines, &coverage))
}

async fn trade_coverage_blocker_from_store(
    client: &reqwest::Client,
    binance_reference_base_url: &str,
    historical_store: &Database,
    pair_code: &str,
    requested_start_time: i64,
    requested_end_time: i64,
    tolerance_ms: i64,
) -> Result<Option<String>> {
    let coverage = historical_store
        .trade_window_coverage_in_range(pair_code, requested_start_time, requested_end_time)
        .await?;
    let aggregate_trade_id_coverage = historical_store
        .trade_aggregate_id_coverage_in_range(pair_code, requested_start_time, requested_end_time)
        .await?;
    let true_boundaries = fetch_true_trade_window_boundaries(
        client,
        binance_reference_base_url,
        pair_code,
        requested_start_time,
        requested_end_time,
    )
    .await?;

    Ok(trade_coverage_blocker(
        tolerance_ms,
        &coverage,
        &aggregate_trade_id_coverage,
        true_boundaries,
    ))
}

fn trade_coverage_blocker(
    tolerance_ms: i64,
    coverage: &trading_bot_market_data::db::WindowCoverage,
    aggregate_trade_id_coverage: &trading_bot_market_data::db::AggregateTradeIdCoverage,
    true_boundaries: Option<TrueTradeWindowBoundaries>,
) -> Option<String> {
    let Some(boundaries) = true_boundaries else {
        return Some(format!(
            "trade coverage incomplete (row_count={}, min_time={:?}, max_time={:?}, missing_trades=0, no true trade boundaries found)",
            coverage.row_count, coverage.min_time, coverage.max_time
        ));
    };

    let edge_ready = match (coverage.min_time, coverage.max_time) {
        (Some(min_t), Some(max_t)) => {
            let latest_acceptable_min = boundaries.first_trade_time.saturating_add(tolerance_ms);
            let earliest_acceptable_max = boundaries.last_trade_time.saturating_sub(tolerance_ms);
            min_t <= latest_acceptable_min && max_t >= earliest_acceptable_max
        }
        _ => false,
    };

    let expected_trade_count = boundaries
        .last_aggregate_trade_id
        .saturating_sub(boundaries.first_aggregate_trade_id)
        .saturating_add(1) as u64;
    let present_trade_count = aggregate_trade_id_coverage
        .distinct_trade_count
        .max(coverage.row_count);
    let missing_trade_count = expected_trade_count.saturating_sub(present_trade_count);

    if !edge_ready || missing_trade_count > 0 {
        return Some(format!(
            "trade coverage incomplete (row_count={}, min_time={:?}, max_time={:?}, expected_trades={}, present_trades={}, missing_trades={}, true_first_trade_time={}, true_last_trade_time={})",
            coverage.row_count,
            coverage.min_time,
            coverage.max_time,
            expected_trade_count,
            present_trade_count,
            missing_trade_count,
            boundaries.first_trade_time,
            boundaries.last_trade_time,
        ));
    }

    None
}

async fn fetch_true_trade_window_boundaries(
    client: &reqwest::Client,
    binance_reference_base_url: &str,
    pair_code: &str,
    start_time: i64,
    end_time: i64,
) -> Result<Option<TrueTradeWindowBoundaries>> {
    let Some(first_row) = fetch_first_agg_trade_in_window(
        client,
        binance_reference_base_url,
        pair_code,
        start_time,
        end_time,
    )
    .await?
    else {
        return Ok(None);
    };
    let Some(last_row) = fetch_last_agg_trade_in_window(
        client,
        binance_reference_base_url,
        pair_code,
        start_time,
        end_time,
    )
    .await?
    else {
        return Ok(None);
    };

    if last_row.aggregate_trade_id < first_row.aggregate_trade_id {
        return Ok(None);
    }

    Ok(Some(TrueTradeWindowBoundaries {
        first_aggregate_trade_id: first_row.aggregate_trade_id,
        last_aggregate_trade_id: last_row.aggregate_trade_id,
        first_trade_time: first_row.trade_time,
        last_trade_time: last_row.trade_time,
    }))
}

async fn fetch_first_agg_trade_in_window(
    client: &reqwest::Client,
    binance_reference_base_url: &str,
    pair_code: &str,
    start_time: i64,
    end_time: i64,
) -> Result<Option<BinanceAggTradeBoundaryRow>> {
    let symbol = to_binance_symbol(pair_code)?;
    let rows = fetch_binance_json::<Vec<BinanceAggTradeBoundaryRow>>(
        client,
        binance_reference_base_url,
        "/api/v3/aggTrades",
        &[
            ("symbol", symbol),
            ("startTime", start_time.to_string()),
            ("endTime", end_time.saturating_sub(1).to_string()),
            ("limit", "1".to_string()),
        ],
    )
    .await?;
    Ok(rows.into_iter().next())
}

async fn fetch_last_agg_trade_in_window(
    client: &reqwest::Client,
    binance_reference_base_url: &str,
    pair_code: &str,
    start_time: i64,
    end_time: i64,
) -> Result<Option<BinanceAggTradeBoundaryRow>> {
    let symbol = to_binance_symbol(pair_code)?;
    let rows = fetch_binance_json::<Vec<BinanceAggTradeBoundaryRow>>(
        client,
        binance_reference_base_url,
        "/api/v3/aggTrades",
        &[
            ("symbol", symbol.clone()),
            ("startTime", start_time.to_string()),
            ("endTime", end_time.saturating_sub(1).to_string()),
            ("limit", "1000".to_string()),
        ],
    )
    .await?;
    let Some(best_trade) = rows
        .into_iter()
        .max_by_key(|row| (row.trade_time, row.aggregate_trade_id))
    else {
        return Ok(None);
    };

    let mut last_trade = best_trade.clone();
    let mut next_from_id = best_trade.aggregate_trade_id;

    loop {
        let rows = fetch_binance_json::<Vec<BinanceAggTradeBoundaryRow>>(
            client,
            binance_reference_base_url,
            "/api/v3/aggTrades",
            &[
                ("symbol", symbol.clone()),
                ("fromId", next_from_id.to_string()),
                ("limit", "1000".to_string()),
            ],
        )
        .await?;

        if rows.is_empty() {
            break;
        }

        let mut advanced = false;
        for row in rows {
            if row.trade_time != best_trade.trade_time {
                return Ok(Some(last_trade));
            }
            if row.aggregate_trade_id >= last_trade.aggregate_trade_id {
                next_from_id = row.aggregate_trade_id.saturating_add(1);
                last_trade = row;
                advanced = true;
            }
        }

        if !advanced {
            break;
        }
    }

    Ok(Some(last_trade))
}

async fn fetch_binance_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    binance_reference_base_url: &str,
    path: &str,
    query: &[(&str, String)],
) -> Result<T> {
    let response = client
        .get(format!(
            "{}{}",
            binance_reference_base_url.trim_end_matches('/'),
            path
        ))
        .query(query)
        .send()
        .await?
        .error_for_status()?;

    Ok(response.json::<T>().await?)
}

fn to_binance_symbol(pair_code: &str) -> Result<String> {
    let symbol = pair_code.trim().to_uppercase();
    if symbol.is_empty() {
        bail!("pair_code must not be empty");
    }
    Ok(symbol)
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

        if page == 1 || page.is_multiple_of(5) {
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

fn filter_symbol_complete_ready_items(
    rows: Vec<ControlPlaneDataReadinessRecord>,
) -> Vec<DataReadinessSnapshotItem> {
    rows.into_iter()
        .filter(|row| row.status == "ready")
        .map(|row| DataReadinessSnapshotItem {
            status: row.status,
            symbol_code: row.symbol_code,
            timeframe_code: row.timeframe_code,
            strategy_name: row.strategy_name,
            analysis_setting_ids: row.analysis_setting_ids,
            requested_start_time: row.requested_start_time,
            requested_end_time: row.requested_end_time,
        })
        .collect()
}

async fn execute_backtest(
    service_name: &str,
    input: ResolvedBacktestInput,
    context: ExecuteBacktestContext,
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
    let warmup_rows = input
        .warmup_rows_by_timeframe
        .values()
        .flat_map(|rows| rows.iter().cloned())
        .collect::<Vec<_>>();
    evaluator.warm_from_klines(&warmup_rows);

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
                details: emitted.details,
            });
        }
    }

    let page_rows = context.trade_page_rows.clamp(1, 50_000_000) as i64;
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
    let progress_context_for_fetch = context.progress_context.clone();
    let kafka_producer_for_fetch = context.kafka_producer.clone();
    let backtest_progress_events_topic_for_fetch = context.backtest_progress_events_topic.clone();
    let progress_event_source_for_fetch = context.progress_event_source.clone();

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
        let db = context.historical_store.clone();
        let pair_code = pair_code.clone();
        let timeframe_code = timeframe_code.clone();
        let retrieval_backtest_id = retrieval_backtest_id.clone();
        let retrieval_page_count = retrieval_page_count.clone();
        let retrieval_rows_total = retrieval_rows_total.clone();
        let cached_trades = context.cached_trades.clone();
        let progress_context = progress_context_for_fetch.clone();
        let kafka_producer = kafka_producer_for_fetch.clone();
        let backtest_progress_events_topic = backtest_progress_events_topic_for_fetch.clone();
        let progress_event_source = progress_event_source_for_fetch.clone();
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
            if page_count == 1 || page_count.is_multiple_of(5) || (page.len() as i64) < limit {
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

                if let Some(context) = progress_context.as_ref() {
                    let envelope = BacktestProgressEventEnvelope {
                        event_id: Uuid::new_v4().to_string(),
                        event_type: "trading-bot.research-backtesting.backtest-progress.v1",
                        source: progress_event_source.clone(),
                        occurred_at: Utc::now().to_rfc3339(),
                        data: BacktestProgressEventData {
                            control_plane_job_id: context.control_plane_job_id.clone(),
                            analysis_setting_id: context.analysis_setting_id.clone(),
                            risk_profile_name: context.risk_profile_name.clone(),
                            symbol: context.symbol.clone(),
                            timeframe_code: context.timeframe_code.clone(),
                            strategy_name: context.strategy_name.clone(),
                            stage: "retrieving-data".to_string(),
                            progress_percent: window_progress_percent.clamp(0.0, 99.0),
                        },
                    };
                    if let Ok(payload) = serde_json::to_string(&envelope) {
                        let _ = kafka_producer
                            .send(
                                FutureRecord::to(&backtest_progress_events_topic)
                                    .key(&context.control_plane_job_id)
                                    .payload(&payload),
                                StdDuration::from_secs(5),
                            )
                            .await;
                        let _ = publish_batch_progress_from_context(
                            &kafka_producer,
                            &backtest_progress_events_topic,
                            &progress_event_source,
                            context,
                            "retrieving-data",
                            window_progress_percent.clamp(0.0, 99.0),
                        )
                        .await;
                    }
                }
            }

            Ok(page)
        })
            as std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<Vec<HistoricalTradeRecord>>> + Send>,
            >
    };

    let (trades, trade_stats) = simulate_trade_replay_paged(
        &signals,
        &input.analysis,
        SimulationConfig {
            fee_bps: context.fee_bps,
            slippage_bps: context.slippage_bps,
        },
        input.time_window.requested_end_time,
        max_rows,
        fetch_page,
    )
    .await?;
    if let Some(progress_context) = context.progress_context.as_ref() {
        let envelope = BacktestProgressEventEnvelope {
            event_id: Uuid::new_v4().to_string(),
            event_type: "trading-bot.research-backtesting.backtest-progress.v1",
            source: context.progress_event_source.clone(),
            occurred_at: Utc::now().to_rfc3339(),
            data: BacktestProgressEventData {
                control_plane_job_id: progress_context.control_plane_job_id.clone(),
                analysis_setting_id: progress_context.analysis_setting_id.clone(),
                risk_profile_name: progress_context.risk_profile_name.clone(),
                symbol: progress_context.symbol.clone(),
                timeframe_code: progress_context.timeframe_code.clone(),
                strategy_name: progress_context.strategy_name.clone(),
                stage: "simulating".to_string(),
                progress_percent: 100.0,
            },
        };
        if let Ok(payload) = serde_json::to_string(&envelope) {
            let _ = context
                .kafka_producer
                .send(
                    FutureRecord::to(&context.backtest_progress_events_topic)
                        .key(&progress_context.control_plane_job_id)
                        .payload(&payload),
                    StdDuration::from_secs(5),
                )
                .await;
            let _ = publish_batch_progress_from_context(
                &context.kafka_producer,
                &context.backtest_progress_events_topic,
                &context.progress_event_source,
                progress_context,
                "simulating",
                100.0,
            )
            .await;
        }
    }
    let trades = resequence_trades(trades);
    let summary = summarize_backtest(&signals, &trades);
    let backtest_duration_ms = execution_started_at.elapsed().as_millis() as i64;
    let data_retrieval_duration_ms = context
        .data_retrieval_duration_ms_override
        .unwrap_or_else(|| retrieval_started_at.elapsed().as_millis() as i64);
    let dataset = BacktestDatasetSummary {
        fetched_kline_count: input.fetched_kline_count,
        warmup_kline_count: input.warmup_rows_by_timeframe.values().map(Vec::len).sum(),
        replay_kline_count: input.replay_rows.len(),
        fetched_trade_count: trade_stats.fetched_trade_count,
        replay_trade_count: trade_stats.fetched_trade_count,
        first_replay_open_time: input.replay_rows.first().map(|row| row.open_time),
        last_replay_close_time: input.replay_rows.last().map(|row| row.close_time),
        first_replay_trade_time: trade_stats.first_trade_time,
        last_replay_trade_time: trade_stats.last_trade_time,
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
                fill_source: "aggregateTrades".to_string(),
                fee_bps: context.fee_bps,
                slippage_bps: context.slippage_bps,
                stop_loss_source:
                    "aggregateTradesWithRiskProfileSwingGapClampedBetweenMinimumAndMaximum"
                        .to_string(),
                take_profit_source: "aggregateTradesWithRiskProfileRrrAppliedToStopLossDistance"
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
    let non_reversal_trade_count = trades.len().saturating_sub(reversal_trade_count);
    let total_fees_usd = trades.iter().map(|trade| trade.fees_usd).sum::<f64>();
    let total_pnl_percent = trades.iter().map(|trade| trade.pnl_percent).sum::<f64>();
    let trade_count = trades.len();
    let win_rate = if trade_count > 0 {
        winning_trade_count as f64 / trade_count as f64
    } else {
        0.0
    };
    let reversal_ratio = if trade_count > 0 {
        reversal_trade_count as f64 / trade_count as f64
    } else {
        0.0
    };
    let (equity_curve_pnl_percent, max_drawdown_percent) = calculate_equity_curve_metrics(trades);
    let score = equity_curve_pnl_percent - (0.75 * max_drawdown_percent) - (12.0 * reversal_ratio);

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
        non_reversal_trade_count,
        reversal_ratio,
        win_rate,
        total_fees_usd,
        total_pnl_percent,
        equity_curve_pnl_percent,
        max_drawdown_percent,
        score,
    }
}

fn calculate_equity_curve_metrics(trades: &[SimulatedTradeRecord]) -> (f64, f64) {
    let mut equity = 100.0;
    let mut peak_equity = equity;
    let mut max_drawdown_percent = 0.0_f64;

    for trade in trades {
        let trade_return = 1.0 + (trade.pnl_percent / 100.0);
        equity *= trade_return.max(0.0);
        peak_equity = peak_equity.max(equity);
        if peak_equity > 0.0 {
            let drawdown_percent = ((peak_equity - equity) / peak_equity) * 100.0;
            max_drawdown_percent = max_drawdown_percent.max(drawdown_percent);
        }
    }

    let equity_curve_pnl_percent = ((equity / 100.0) - 1.0) * 100.0;
    (equity_curve_pnl_percent, max_drawdown_percent)
}

#[cfg(test)]
mod tests {
    use std::{
        future::Future,
        pin::Pin,
        sync::{Arc, Mutex},
    };

    use serde_json::json;
    use trading_bot_market_data::models::PersistedTradeRecord;
    use trading_bot_strategy_engine::models::{
        PairRecord, RiskProfileRecord, StrategyRecord, TimeframeRecord,
    };

    use super::*;
    use crate::models::BacktestRequest;
    use crate::{
        execution_simulation::{SimulationConfig, simulate_trade_replay_paged},
        models::{BacktestSignalRecord, PositionDirection},
    };

    fn analysis_record() -> ResolvedAnalysisSettingsRecord {
        ResolvedAnalysisSettingsRecord {
            id: "analysis-1".to_string(),
            symbol: "BTCUSDT".to_string(),
            timeframe_code: "1m".to_string(),
            strategy_name: "emaCross".to_string(),
            risk_profile_name: "default".to_string(),
            technical_analysis_settings: json!({
                "fastPeriod": 2,
                "slowPeriod": 3
            }),
            enabled: true,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            symbol_entity: PairRecord {
                id: "pair-1".to_string(),
                code: "BTCUSDT".to_string(),
                active: true,
                base_asset: "BTC".to_string(),
                destination_asset: "USDT".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            timeframe: TimeframeRecord {
                id: "timeframe-1".to_string(),
                code: "1m".to_string(),
                longer_timeframe_code: "5m".to_string(),
                longer_timeframe_multiplier: 5,
                period_ms: 60_000,
                active: true,
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

    fn kline(
        timeframe_code: &str,
        period_ms: i64,
        open_time: i64,
    ) -> PersistedKlineRecord {
        PersistedKlineRecord {
            pair_code: "BTCUSDT".to_string(),
            symbol: "BTCUSDT".to_string(),
            timeframe_code: timeframe_code.to_string(),
            period_ms,
            open_time,
            close_time: open_time + period_ms - 1,
            event_time: open_time + period_ms - 1,
            occurred_at: "2026-01-01T00:00:00Z".to_string(),
            ingestion_mode: "historical".to_string(),
            closed: true,
            open: "100".to_string(),
            high: "101".to_string(),
            low: "99".to_string(),
            close: "100".to_string(),
            volume: "1".to_string(),
            quote_volume: "1".to_string(),
            trade_count: 1,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn signal(
        sequence: usize,
        direction: &str,
        close_time: i64,
        close_price: f64,
    ) -> BacktestSignalRecord {
        BacktestSignalRecord {
            sequence,
            signal_direction: direction.to_string(),
            close_time,
            close_price,
            fast_ema: Some(1.0),
            slow_ema: Some(0.5),
            kline_event_id: format!("signal-{sequence}"),
            details: serde_json::json!({}),
        }
    }

    fn simulated_trade(
        trade_number: usize,
        pnl_percent: f64,
        exit_reason: &str,
    ) -> SimulatedTradeRecord {
        SimulatedTradeRecord {
            trade_number,
            direction: PositionDirection::Long,
            entry_signal_sequence: trade_number,
            exit_signal_sequence: Some(trade_number + 1),
            entry_time: 1_000,
            exit_time: 2_000,
            entry_price: 100.0,
            exit_price: 100.0,
            quantity: 1.0,
            notional_usd: 100.0,
            stop_loss_price: 98.0,
            take_profit_price: 106.0,
            fees_usd: 0.0,
            pnl_usd: pnl_percent,
            pnl_percent,
            entry_fill_source: "trade".to_string(),
            exit_fill_source: "trade".to_string(),
            exit_reason: exit_reason.to_string(),
        }
    }

    #[test]
    fn equity_curve_metrics_compound_returns_and_drawdown() {
        let trades = vec![
            simulated_trade(1, 10.0, "takeProfit"),
            simulated_trade(2, -10.0, "stopLoss"),
            simulated_trade(3, 5.0, "reversal"),
        ];

        let (equity_curve_pnl_percent, max_drawdown_percent) =
            calculate_equity_curve_metrics(&trades);

        assert!((equity_curve_pnl_percent - 3.95).abs() < 0.0001);
        assert!((max_drawdown_percent - 10.0).abs() < 0.0001);
    }

    #[test]
    fn summarize_backtest_uses_equity_curve_score_and_close_breakdown() {
        let signals = vec![
            signal(1, "long", 1_000, 100.0),
            signal(2, "short", 2_000, 101.0),
            signal(3, "long", 3_000, 102.0),
        ];
        let trades = vec![
            simulated_trade(1, 10.0, "takeProfit"),
            simulated_trade(2, -10.0, "reversal"),
            simulated_trade(3, 5.0, "windowEnd"),
        ];

        let summary = summarize_backtest(&signals, &trades);

        assert_eq!(summary.non_reversal_trade_count, 2);
        assert!((summary.reversal_ratio - (1.0 / 3.0)).abs() < 0.0001);
        assert!((summary.equity_curve_pnl_percent - 3.95).abs() < 0.0001);
        assert!((summary.max_drawdown_percent - 10.0).abs() < 0.0001);
        assert!((summary.score - (-7.55)).abs() < 0.0001);
    }

    #[test]
    fn resolve_time_window_uses_backtesting_timerange_ms() {
        let analysis = analysis_record();
        let spec = build_analysis_spec(&analysis)
            .expect("spec build")
            .expect("spec present");
        let request = BacktestRequest {
            control_plane_job_id: None,
            batch_id: None,
            batch_total_count: None,
            batch_completed_count: None,
            analysis_setting_id: analysis.id.clone(),
            symbol_code: Some(analysis.symbol.clone()),
            timeframe_code: Some(analysis.timeframe_code.clone()),
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
        assert_eq!(window.effective_warmup_candles, 4);
    }

    #[test]
    fn readiness_batch_key_is_stable_for_same_row() {
        let left = readiness_batch_key("ETHUSDT", "5m", "emaCross");
        let right = readiness_batch_key("ETHUSDT", "5m", "emaCross");

        assert_eq!(left, right);
    }

    #[test]
    fn readiness_run_key_distinguishes_different_windows() {
        let left = readiness_run_key("analysis-1", "ETHUSDT", "5m", "default", 100, 200);
        let right = readiness_run_key("analysis-1", "ETHUSDT", "5m", "default", 200, 300);

        assert_ne!(left, right);
    }

    #[test]
    fn trade_coverage_blocker_rejects_internal_aggregate_trade_hole() {
        let coverage = trading_bot_market_data::db::WindowCoverage {
            row_count: 7,
            min_time: Some(1_000),
            max_time: Some(2_000),
        };
        let aggregate_trade_id_coverage = trading_bot_market_data::db::AggregateTradeIdCoverage {
            first_aggregate_trade_id: Some(41),
            last_aggregate_trade_id: Some(50),
            distinct_trade_count: 7,
        };
        let true_boundaries = Some(TrueTradeWindowBoundaries {
            first_aggregate_trade_id: 41,
            last_aggregate_trade_id: 50,
            first_trade_time: 1_000,
            last_trade_time: 2_000,
        });

        let blocker =
            trade_coverage_blocker(5, &coverage, &aggregate_trade_id_coverage, true_boundaries);

        assert_eq!(
            blocker,
            Some(
                "trade coverage incomplete (row_count=7, min_time=Some(1000), max_time=Some(2000), expected_trades=10, present_trades=7, missing_trades=3, true_first_trade_time=1000, true_last_trade_time=2000)"
                    .to_string(),
            )
        );
    }

    #[test]
    fn kline_coverage_blocker_rejects_incomplete_window() {
        let coverage = trading_bot_market_data::db::WindowCoverage {
            row_count: 9,
            min_time: Some(1_000),
            max_time: Some(1_540_000),
        };

        let blocker = kline_coverage_blocker(10, &coverage);

        assert_eq!(
            blocker,
            Some("kline coverage incomplete (have 9, need 10)".to_string())
        );
    }

    #[test]
    fn exact_candle_count_exclusive_uses_end_exclusive_window() {
        let count = exact_candle_count_exclusive(1_000, 1_000 + (10 * 60_000), 60_000)
            .expect("count should compute");

        assert_eq!(count, 10);
    }

    #[test]
    fn split_kline_rows_uses_close_time_for_non_signal_timeframes() {
        let rows = vec![
            kline("15m", 900_000, 0),
            kline("15m", 900_000, 900_000),
        ];

        let (warmup_rows, replay_rows) =
            split_kline_rows_for_backtest_window(rows, 600_000, 1_800_000, false);

        assert_eq!(warmup_rows.len(), 0);
        assert_eq!(replay_rows.len(), 2);
        assert_eq!(replay_rows[0].open_time, 0);
        assert_eq!(replay_rows[1].open_time, 900_000);
    }

    #[test]
    fn sort_replay_rows_orders_longer_timeframe_before_operating_on_shared_close() {
        let mut rows = vec![
            kline("1m", 60_000, 780_000),
            kline("1m", 60_000, 840_000),
            kline("15m", 900_000, 0),
        ];

        sort_replay_rows_chronologically(&mut rows);

        assert_eq!(
            rows.iter()
                .map(|row| (row.timeframe_code.as_str(), row.open_time))
                .collect::<Vec<_>>(),
            vec![("1m", 780_000), ("15m", 0), ("1m", 840_000)]
        );
    }

    #[test]
    fn last_closed_hour_utc_matches_market_data_boundary() {
        let reference = Utc
            .with_ymd_and_hms(2026, 3, 20, 19, 2, 0)
            .single()
            .expect("valid timestamp");

        let hour = last_closed_hour_utc(reference);

        assert_eq!(hour.to_rfc3339(), "2026-03-20T19:00:00+00:00");
    }

    #[tokio::test]
    async fn execute_backtest_reuses_strategy_logic_offline() {
        let analysis = analysis_record();
        let signals = vec![
            signal(1, "long", 1_000, 100.0),
            signal(2, "short", 5_000, 102.0),
        ];
        let pages = Arc::new(Mutex::new(vec![
            vec![trade(1, 1_001, 100.0), trade(2, 2_000, 100.5)],
            vec![trade(3, 2_500, 102.5)],
            vec![trade(4, 5_001, 101.5), trade(5, 6_000, 100.0)],
            Vec::new(),
        ]));

        let (trades, stats) = simulate_trade_replay_paged(
            &signals,
            &analysis,
            SimulationConfig {
                fee_bps: 0.0,
                slippage_bps: 0.0,
            },
            7_000,
            10,
            {
                let pages = Arc::clone(&pages);
                move |_after, _limit| {
                    let page = pages.lock().expect("pages mutex poisoned").remove(0);
                    let fut = async move { Ok(page) };
                    Box::pin(fut)
                        as Pin<Box<dyn Future<Output = Result<Vec<PersistedTradeRecord>>> + Send>>
                }
            },
        )
        .await
        .expect("paged simulation should succeed");

        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].exit_reason, "takeProfit");
        assert_eq!(trades[0].entry_fill_source, "aggTrade");
        assert_eq!(trades[0].exit_fill_source, "aggTrade");
        assert_eq!(trades[0].entry_time, 1_001);
        assert_eq!(trades[0].exit_time, 2_500);
        assert_eq!(stats.fetched_trade_count, 5);
        assert_eq!(stats.first_trade_time, Some(1_001));
        assert_eq!(stats.last_trade_time, Some(6_000));
    }
}
