use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::Result;
use chrono::Utc;
use futures_util::StreamExt;
use rdkafka::{
    ClientConfig, Message,
    consumer::{Consumer, StreamConsumer},
    producer::{FutureProducer, FutureRecord},
};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use tokio::{
    sync::{Mutex, RwLock, mpsc, oneshot, watch},
    task::JoinHandle,
    time::MissedTickBehavior,
};
use uuid::Uuid;

use crate::{
    config::AppConfig,
    db::{AggregateTradeIdGap, Database, TimeGap, TimeInterval},
    events::{normalize_rest_kline, normalize_rest_trade},
    kafka_topics::ensure_topics,
    metrics::Metrics,
    models::{
        ActiveSubscriptions, KlineSubscription, NormalizedKlineEvent, PairStreamSubscription,
        PersistedKlineRecord, PersistedTradeRecord, ResolvedAnalysisSettingsRecord,
    },
    subscriptions::{derive_active_subscriptions, should_refresh_for_config_resource, to_binance_symbol},
};

#[derive(Clone)]
pub struct MarketDataService {
    inner: Arc<Inner>,
}

struct Inner {
    config: AppConfig,
    metrics: Metrics,
    database: Database,
    http_client: reqwest::Client,
    binance_weight_limiter: BinanceWeightLimiter,
    kafka_producer: FutureProducer,
    runtime_status: RwLock<RuntimeStatus>,
    required_kline_history_ms: RwLock<HashMap<String, i64>>,
    required_trade_history_ms: RwLock<HashMap<String, i64>>,
    required_trade_gap_threshold_ms: RwLock<HashMap<String, i64>>,
    current_readiness_targets: RwLock<HashMap<(String, String), DataReadinessTarget>>,
    readiness_publish_at_by_target: Mutex<HashMap<(String, String), Instant>>,
    maintenance_gate: Mutex<()>,
    compaction_gate: Mutex<()>,
    refresh_tx: mpsc::Sender<String>,
    shutdown_tx: watch::Sender<bool>,
    task_handles: Mutex<Vec<JoinHandle<()>>>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub started: bool,
    pub runtime_config: RuntimeConfigStatus,
    pub kafka: KafkaStatus,
    pub stream: StreamStatus,
    pub database: DatabaseStatus,
    pub subscriptions: ActiveSubscriptions,
    pub otel_exporter_configured: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigStatus {
    pub loaded: bool,
    pub last_refreshed_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KafkaStatus {
    pub producer_connected: bool,
    pub consumer_connected: bool,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamStatus {
    pub connected: bool,
    pub stream_url: Option<String>,
    pub last_message_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatus {
    pub connected: bool,
    pub last_backfill_at: Option<String>,
    pub last_backfill_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessDimension {
    pub row_count: u64,
    pub min_time: Option<i64>,
    pub max_time: Option<i64>,
    pub latest_time: Option<i64>,
    pub missing_count: u64,
    pub complete: bool,
    pub coverage_percent: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestDataReadiness {
    pub status: String,
    pub details: Option<String>,
    pub pair_code: String,
    pub timeframe_code: String,
    pub start_time: i64,
    pub end_time: i64,
    pub period_ms: i64,
    pub kline: ReadinessDimension,
    pub trades: ReadinessDimension,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DataReadinessSnapshotItem {
    status: String,
    pair_code: String,
    timeframe_code: String,
    analysis_setting_ids: Vec<String>,
    requested_start_time: i64,
    requested_end_time: i64,
    required_history_ms: i64,
    details: Option<String>,
    kline: ReadinessDimension,
    trades: ReadinessDimension,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DataReadinessSnapshotEnvelope {
    event_id: String,
    event_type: &'static str,
    source: String,
    occurred_at: String,
    data: DataReadinessSnapshotPayload,
}

#[derive(Clone, Debug, Deserialize)]
struct BinanceAggTradeBoundaryRow {
    #[serde(rename = "a")]
    aggregate_trade_id: i64,
    #[serde(rename = "T")]
    trade_time: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DataReadinessSnapshotPayload {
    items: Vec<DataReadinessSnapshotItem>,
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
    pub runtime_config: String,
    pub kafka_producer: String,
    pub kafka_consumer: String,
    pub market_stream: String,
    pub database: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigChangeEventEnvelope {
    resource_type: String,
    operation: String,
}

#[derive(Clone, Debug)]
struct DataReadinessTarget {
    pair_code: String,
    timeframe_code: String,
    period_ms: i64,
    analysis_setting_ids: Vec<String>,
    requested_start_time: i64,
    requested_end_time: i64,
    required_history_ms: i64,
}

#[derive(Clone, Copy, Debug)]
struct TrueTradeWindowBoundaries {
    first_aggregate_trade_id: i64,
    last_aggregate_trade_id: i64,
    first_trade_time: i64,
    last_trade_time: i64,
}

#[derive(Clone, Copy, Debug)]
enum TradeGapRepairMode {
    StartupDeep,
}

const IN_PROGRESS_READINESS_PUBLISH_THROTTLE_MS: u64 = 1_000;

#[derive(Clone, Debug, Default)]
struct RequiredHistoryPlan {
    kline_by_subscription_id: HashMap<String, i64>,
    trade_by_pair_code: HashMap<String, i64>,
    trade_gap_threshold_by_pair_code: HashMap<String, i64>,
}

#[derive(Clone)]
struct BinanceWeightLimiter {
    state: Arc<Mutex<BinanceWeightLimiterState>>,
}

#[derive(Debug)]
struct BinanceWeightLimiterState {
    current_window_minute: i64,
    reserved_weight: u64,
    observed_used_weight_1m: u64,
    last_warned_used_weight_1m: u64,
}

#[derive(Debug)]
struct BinanceWeightObservation {
    current_window_minute: i64,
    effective_used_weight_1m: u64,
    target_weight_1m: u64,
    limit_weight_1m: u64,
    warn_weight_1m: u64,
}

impl BinanceWeightLimiter {
    fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(BinanceWeightLimiterState {
                current_window_minute: current_binance_window_minute(),
                reserved_weight: 0,
                observed_used_weight_1m: 0,
                last_warned_used_weight_1m: 0,
            })),
        }
    }

    async fn acquire(
        &self,
        request_weight: u64,
        target_weight_1m: u64,
        metrics: &Metrics,
        path: &str,
    ) {
        loop {
            let maybe_wait_ms = {
                let mut state = self.state.lock().await;
                state.roll_window_if_needed();
                let used_weight_1m = state.reserved_weight.max(state.observed_used_weight_1m);
                if used_weight_1m.saturating_add(request_weight) <= target_weight_1m {
                    state.reserved_weight = used_weight_1m.saturating_add(request_weight);
                    metrics
                        .binance_rest_used_weight_1m
                        .set(state.reserved_weight.min(i64::MAX as u64) as i64);
                    None
                } else {
                    Some(millis_until_next_binance_minute_window())
                }
            };

            match maybe_wait_ms {
                None => return,
                Some(wait_ms) => {
                    metrics.binance_rest_limiter_waits_total.inc();
                    metrics.binance_rest_limiter_wait_ms_total.inc_by(wait_ms);
                    tracing::info!(
                        path,
                        request_weight,
                        target_weight_1m,
                        wait_ms,
                        "local Binance REQUEST_WEIGHT limiter delaying request until next minute window"
                    );
                    tokio::time::sleep(Duration::from_millis(wait_ms)).await;
                }
            }
        }
    }

    async fn observe_response(
        &self,
        used_weight_1m: Option<u64>,
        limit_weight_1m: u64,
        target_weight_1m: u64,
        warn_weight_1m: u64,
        metrics: &Metrics,
    ) -> Option<BinanceWeightObservation> {
        let mut state = self.state.lock().await;
        state.roll_window_if_needed();

        if let Some(used_weight_1m) = used_weight_1m {
            state.observed_used_weight_1m = state.observed_used_weight_1m.max(used_weight_1m);
            state.reserved_weight = state.reserved_weight.max(used_weight_1m);
        }

        let effective_used_weight_1m = state.reserved_weight.max(state.observed_used_weight_1m);
        metrics
            .binance_rest_used_weight_1m
            .set(effective_used_weight_1m.min(i64::MAX as u64) as i64);

        if effective_used_weight_1m >= warn_weight_1m
            && effective_used_weight_1m > state.last_warned_used_weight_1m
        {
            state.last_warned_used_weight_1m = effective_used_weight_1m;
            return Some(BinanceWeightObservation {
                current_window_minute: state.current_window_minute,
                effective_used_weight_1m,
                target_weight_1m,
                limit_weight_1m,
                warn_weight_1m,
            });
        }

        None
    }
}

impl BinanceWeightLimiterState {
    fn roll_window_if_needed(&mut self) {
        let current_window_minute = current_binance_window_minute();
        if self.current_window_minute != current_window_minute {
            self.current_window_minute = current_window_minute;
            self.reserved_weight = 0;
            self.observed_used_weight_1m = 0;
            self.last_warned_used_weight_1m = 0;
        }
    }
}

fn current_binance_window_minute() -> i64 {
    Utc::now().timestamp().div_euclid(60)
}

fn millis_until_next_binance_minute_window() -> u64 {
    let now_ms = Utc::now().timestamp_millis();
    let next_window_ms = now_ms
        .div_euclid(60_000)
        .saturating_add(1)
        .saturating_mul(60_000)
        .saturating_add(50);
    next_window_ms.saturating_sub(now_ms).max(1) as u64
}

fn compute_target_weight_1m(limit_weight_1m: u64, target_utilization_percent: u64) -> u64 {
    limit_weight_1m
        .saturating_mul(target_utilization_percent)
        .saturating_div(100)
        .max(1)
}

fn compute_warn_weight_1m(limit_weight_1m: u64, warn_utilization_percent: u64) -> u64 {
    limit_weight_1m
        .saturating_mul(warn_utilization_percent)
        .saturating_div(100)
        .max(1)
}

fn binance_request_weight_for_path(path: &str, query: &[(&str, String)]) -> u64 {
    match path {
        "/api/v3/aggTrades" => 4,
        "/api/v3/depth" => {
            let limit = query
                .iter()
                .find_map(|(key, value)| (*key == "limit").then_some(value))
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(100);
            match limit {
                0..=100 => 5,
                101..=500 => 25,
                501..=1000 => 50,
                _ => 250,
            }
        }
        "/api/v3/klines" | "/api/v3/uiKlines" => 2,
        "/api/v3/trades" | "/api/v3/historicalTrades" => 25,
        _ => 1,
    }
}

fn parse_used_weight_1m(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    headers
        .get("x-mbx-used-weight-1m")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
}

impl MarketDataService {
    pub async fn new(config: AppConfig) -> Result<Self> {
        let database = Database::connect(&config).await?;
        database.ensure_schema().await?;
        ensure_topics(
            &config.kafka_bootstrap_servers,
            &[
                &config.config_change_events_topic,
                &config.data_readiness_events_topic,
            ],
        )
        .await?;
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_millis(
                config.control_plane_request_timeout_ms,
            ))
            .build()?;
        let metrics = Metrics::new()?;
        metrics.database_connected.set(1);
        metrics.binance_rest_limit_weight_1m.set(
            config
                .binance_rest_request_weight_limit_per_minute
                .min(i64::MAX as u64) as i64,
        );
        metrics.binance_rest_target_weight_1m.set(
            compute_target_weight_1m(
                config.binance_rest_request_weight_limit_per_minute,
                config.binance_rest_target_utilization_percent,
            )
            .min(i64::MAX as u64) as i64,
        );

        let kafka_producer = ClientConfig::new()
            .set("bootstrap.servers", &config.kafka_bootstrap_servers)
            .set("message.timeout.ms", "5000")
            .create::<FutureProducer>()?;

        let (refresh_tx, refresh_rx) = mpsc::channel::<String>(32);
        let (shutdown_tx, _) = watch::channel(false);

        let runtime_status = RuntimeStatus {
            started: false,
            runtime_config: RuntimeConfigStatus::default(),
            kafka: KafkaStatus {
                producer_connected: true,
                consumer_connected: false,
                last_error: None,
            },
            stream: StreamStatus::default(),
            database: DatabaseStatus {
                connected: true,
                last_backfill_at: None,
                last_backfill_error: None,
            },
            subscriptions: ActiveSubscriptions::default(),
            otel_exporter_configured: config.otel_exporter_otlp_endpoint.is_some(),
        };

        let inner = Arc::new(Inner {
            config,
            metrics,
            database,
            http_client,
            binance_weight_limiter: BinanceWeightLimiter::new(),
            kafka_producer,
            runtime_status: RwLock::new(runtime_status),
            required_kline_history_ms: RwLock::new(HashMap::new()),
            required_trade_history_ms: RwLock::new(HashMap::new()),
            required_trade_gap_threshold_ms: RwLock::new(HashMap::new()),
            current_readiness_targets: RwLock::new(HashMap::new()),
            readiness_publish_at_by_target: Mutex::new(HashMap::new()),
            maintenance_gate: Mutex::new(()),
            compaction_gate: Mutex::new(()),
            refresh_tx,
            shutdown_tx,
            task_handles: Mutex::new(Vec::new()),
        });

        let service = Self { inner };
        service.start_with_refresh_loop(refresh_rx).await;
        Ok(service)
    }

    async fn start_with_refresh_loop(&self, refresh_rx: mpsc::Receiver<String>) {
        {
            let mut status = self.inner.runtime_status.write().await;
            status.started = true;
        }

        let refresh_service = self.clone();
        let startup_refresh_handle = tokio::spawn(async move {
            if let Err(error) = refresh_service.perform_refresh("startup").await {
                tracing::warn!(?error, "market-data startup refresh failed");
            }
        });

        let refresh_service = self.clone();
        let refresh_handle = tokio::spawn(async move {
            refresh_service.refresh_loop(refresh_rx).await;
        });

        let consumer_service = self.clone();
        let consumer_handle = tokio::spawn(async move {
            consumer_service.config_consumer_loop().await;
        });

        let periodic_service = self.clone();
        let periodic_handle = tokio::spawn(async move {
            periodic_service.periodic_refresh_loop().await;
        });

        let mut handles = self.inner.task_handles.lock().await;
        handles.extend([
            startup_refresh_handle,
            refresh_handle,
            consumer_handle,
            periodic_handle,
        ]);

        if self.inner.config.historical_store_compaction_enabled {
            let compaction_service = self.clone();
            let compaction_handle = tokio::spawn(async move {
                compaction_service.compaction_loop().await;
            });
            handles.push(compaction_handle);
        }
    }

    pub async fn stop(&self) {
        let _ = self.inner.shutdown_tx.send(true);
        let mut handles = self.inner.task_handles.lock().await;
        while let Some(handle) = handles.pop() {
            let _ = handle.await;
        }
    }

    pub async fn status(&self) -> RuntimeStatus {
        self.inner.runtime_status.read().await.clone()
    }

    pub fn config_snapshot(&self) -> AppConfig {
        self.inner.config.clone()
    }

    pub fn metrics_text(&self) -> Result<String> {
        self.inner.metrics.encode().map_err(Into::into)
    }

    pub async fn readiness(&self) -> ReadinessPayload {
        let db_ok = self.inner.database.ping().await.is_ok();
        self.inner
            .metrics
            .database_connected
            .set(if db_ok { 1 } else { 0 });

        let status = self.inner.runtime_status.read().await.clone();
        let runtime_config_max_age_ms = (self.inner.config.readiness_max_config_age_ms as i64)
            .max(2 * 60 * 60 * 1000);
        let runtime_config_ok = status.runtime_config.loaded
            && status
                .runtime_config
                .last_refreshed_at
                .as_ref()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .map(|timestamp| {
                    Utc::now()
                        .signed_duration_since(timestamp.with_timezone(&Utc))
                        .num_milliseconds()
                        <= runtime_config_max_age_ms
                })
                .unwrap_or(false);

        let runtime_config = if runtime_config_ok { "up" } else { "down" };
        let kafka_producer = if status.kafka.producer_connected {
            "up"
        } else {
            "down"
        };
        let kafka_consumer = if status.kafka.consumer_connected {
            "up"
        } else {
            "down"
        };
        let market_stream = "idle";
        let database = if db_ok { "up" } else { "down" };
        let status_text = if runtime_config == "up"
            && kafka_producer == "up"
            && kafka_consumer == "up"
            && market_stream == "idle"
            && database == "up"
        {
            "ok"
        } else {
            "degraded"
        };

        ReadinessPayload {
            status: status_text.to_string(),
            service: self.inner.config.service_name.clone(),
            checks: ReadinessChecks {
                runtime_config: runtime_config.to_string(),
                kafka_producer: kafka_producer.to_string(),
                kafka_consumer: kafka_consumer.to_string(),
                market_stream: market_stream.to_string(),
                database: database.to_string(),
            },
        }
    }

    pub async fn recent_klines(
        &self,
        pair_code: &str,
        timeframe_code: &str,
        limit: i64,
    ) -> Result<Vec<PersistedKlineRecord>> {
        self.inner
            .database
            .list_recent_klines(pair_code, timeframe_code, limit)
            .await
    }

    pub async fn replay_klines(
        &self,
        pair_code: &str,
        timeframe_code: &str,
        start_time: Option<i64>,
        end_time: Option<i64>,
        limit: i64,
    ) -> Result<Vec<PersistedKlineRecord>> {
        self.inner
            .database
            .replay_klines(pair_code, timeframe_code, start_time, end_time, limit)
            .await
    }

    pub async fn recent_trades(
        &self,
        pair_code: &str,
        limit: i64,
    ) -> Result<Vec<PersistedTradeRecord>> {
        self.inner
            .database
            .list_recent_trades(pair_code, limit)
            .await
    }

    pub async fn replay_trades(
        &self,
        pair_code: &str,
        start_time: Option<i64>,
        end_time: Option<i64>,
        limit: i64,
    ) -> Result<Vec<PersistedTradeRecord>> {
        self.inner
            .database
            .replay_trades(pair_code, start_time, end_time, limit)
            .await
    }

    pub async fn backtest_data_readiness(
        &self,
        pair_code: &str,
        timeframe_code: &str,
        start_time: i64,
        end_time: i64,
        period_ms: i64,
    ) -> Result<BacktestDataReadiness> {
        self.backtest_data_readiness_with_required_history(
            pair_code,
            timeframe_code,
            start_time,
            end_time,
            period_ms,
            end_time.saturating_sub(start_time),
        )
        .await
    }

    async fn backtest_data_readiness_with_required_history(
        &self,
        pair_code: &str,
        timeframe_code: &str,
        requested_start_time: i64,
        requested_end_time: i64,
        period_ms: i64,
        required_history_ms: i64,
    ) -> Result<BacktestDataReadiness> {
        let kline_start_time = requested_end_time.saturating_sub(required_history_ms.max(period_ms));
        let kline_coverage = self
            .inner
            .database
            .kline_window_coverage_in_range(
                pair_code,
                timeframe_code,
                kline_start_time,
                requested_end_time.saturating_sub(1),
            )
            .await?;
        let trade_coverage = self
            .inner
            .database
            .trade_window_coverage_in_range(pair_code, requested_start_time, requested_end_time)
            .await?;
        let trade_aggregate_id_coverage = self
            .inner
            .database
            .trade_aggregate_id_coverage_in_range(
                pair_code,
                requested_start_time,
                requested_end_time,
            )
            .await?;
        let binance_symbol = to_binance_symbol(pair_code)?;
        let trade_boundary_ids = self
            .fetch_true_trade_window_boundaries(
                &binance_symbol,
                requested_start_time,
                requested_end_time,
            )
            .await?;
        let trade_gap_threshold_ms = (period_ms / 4).clamp(1_000, 60_000);
        let latest_trade = self.inner.database.latest_trade_checkpoint(pair_code).await?;

        let required_klines =
            exact_candle_count_exclusive(kline_start_time, requested_end_time, period_ms)?;
        let missing_kline_count = missing_kline_count(&kline_coverage, required_klines);
        let kline = map_dimension(
            &kline_coverage,
            kline_coverage.max_time,
            missing_kline_count,
            required_klines,
        );
        let missing_trade_count = missing_trade_count(
            &trade_coverage,
            &trade_aggregate_id_coverage,
            trade_boundary_ids,
        );
        let trades = map_trade_dimension(
            &trade_coverage,
            latest_trade.map(|checkpoint| checkpoint.trade_time),
            missing_trade_count,
            trade_gap_threshold_ms,
            &trade_aggregate_id_coverage,
            trade_boundary_ids,
        );
        let kline_complete =
            kline_coverage_complete(required_klines, &kline_coverage, missing_kline_count);
        let kline = ReadinessDimension {
            complete: kline_complete,
            ..kline
        };

        let (status, details) = if kline.complete && trades.complete {
            ("ready".to_string(), None)
        } else if kline.row_count == 0 && trade_coverage.row_count == 0
        {
            (
                "missing".to_string(),
                Some("no replay-grade dataset was found for this pair/timeframe window".to_string()),
            )
        } else {
            (
                "partial".to_string(),
                Some("one or more replay inputs are incomplete for the requested window".to_string()),
            )
        };
        Ok(BacktestDataReadiness {
            status,
            details,
            pair_code: pair_code.to_string(),
            timeframe_code: timeframe_code.to_string(),
            start_time: requested_start_time,
            end_time: requested_end_time,
            period_ms,
            kline,
            trades,
        })
    }

    async fn refresh_loop(&self, mut refresh_rx: mpsc::Receiver<String>) {
        let mut shutdown_rx = self.inner.shutdown_tx.subscribe();
        loop {
            tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_ok() {
                        break;
                    }
                }
                message = refresh_rx.recv() => {
                    let Some(reason) = message else {
                        break;
                    };

                    tokio::time::sleep(Duration::from_millis(self.inner.config.config_refresh_debounce_ms)).await;
                    while refresh_rx.try_recv().is_ok() {}

                    if let Err(error) = self.perform_refresh(&reason).await {
                        tracing::warn!(?error, reason, "market-data refresh failed");
                    }
                }
            }
        }
    }

    async fn config_consumer_loop(&self) {
        let consumer = match ClientConfig::new()
            .set(
                "bootstrap.servers",
                &self.inner.config.kafka_bootstrap_servers,
            )
            .set(
                "group.id",
                format!("{}-config-change-consumer", self.inner.config.service_name),
            )
            .set("enable.partition.eof", "false")
            .set("session.timeout.ms", "6000")
            .set("enable.auto.commit", "true")
            .create::<StreamConsumer>()
        {
            Ok(consumer) => consumer,
            Err(error) => {
                self.mark_kafka_consumer(false, Some(error.to_string()))
                    .await;
                return;
            }
        };

        if let Err(error) = consumer.subscribe(&[&self.inner.config.config_change_events_topic]) {
            self.mark_kafka_consumer(false, Some(error.to_string()))
                .await;
            return;
        }

        self.mark_kafka_consumer(true, None).await;
        let mut shutdown_rx = self.inner.shutdown_tx.subscribe();
        let mut stream = consumer.stream();
        loop {
            tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_ok() {
                        break;
                    }
                }
                message = stream.next() => {
                    match message {
                        Some(Ok(message)) => {
                            if let Some(payload) = message.payload_view::<str>().transpose().ok().flatten() {
                                match serde_json::from_str::<ConfigChangeEventEnvelope>(payload) {
                                    Ok(event) if should_refresh_for_config_resource(&event.resource_type) => {
                                        let _ = self.inner.refresh_tx.send(format!("config-change:{}:{}", event.resource_type, event.operation)).await;
                                    }
                                    Ok(_) => {}
                                    Err(error) => tracing::warn!(?error, "failed to decode config-change event"),
                                }
                            }
                        }
                        Some(Err(error)) => {
                            self.mark_kafka_consumer(false, Some(error.to_string())).await;
                        }
                        None => break,
                    }
                }
            }
        }
    }

    async fn periodic_refresh_loop(&self) {
        let mut shutdown_rx = self.inner.shutdown_tx.subscribe();

        loop {
            let wait_duration = Self::duration_until_next_hour_boundary();
            tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_ok() {
                        break;
                    }
                }
                _ = tokio::time::sleep(wait_duration) => {
                    let _ = self.inner.refresh_tx.send("periodic-reconcile".to_string()).await;
                }
            }
        }
    }

    async fn compaction_loop(&self) {
        let mut shutdown_rx = self.inner.shutdown_tx.subscribe();
        let mut interval = tokio::time::interval(Duration::from_millis(
            self.inner.config.historical_store_compaction_interval_ms,
        ));
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);

        let maintenance = self.inner.maintenance_gate.lock().await;
        let startup_result = self.run_market_data_compaction("startup").await;
        drop(maintenance);
        if let Err(error) = startup_result {
            tracing::warn!(?error, "market-data store compaction failed");
        }
        interval.tick().await;

        loop {
            tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_ok() {
                        break;
                    }
                }
                _ = interval.tick() => {
                    let _maintenance = self.inner.maintenance_gate.lock().await;
                    if let Err(error) = self.run_market_data_compaction("periodic-reconcile").await {
                        tracing::warn!(?error, "market-data store compaction failed");
                    }
                }
            }
        }
    }

    async fn run_market_data_compaction(&self, reason: &str) -> Result<()> {
        let _permit = self.inner.compaction_gate.lock().await;
        tracing::info!(reason, "starting historical market-data compaction");
        let started = std::time::SystemTime::now();
        self.inner.database.compact_market_data_tables().await?;
        let elapsed_ms = started
            .elapsed()
            .ok()
            .map(|elapsed| elapsed.as_millis())
            .unwrap_or_default();
        tracing::info!(
            reason,
            elapsed_ms,
            "finished historical market-data compaction"
        );
        Ok(())
    }

    async fn perform_refresh(&self, reason: &str) -> Result<()> {
        let _maintenance = self.inner.maintenance_gate.lock().await;
        let symbols = self.fetch_symbols().await?;
        let timeframes = self.fetch_timeframes().await?;
        let records = self.fetch_resolved_analysis_settings().await?;
        let readiness_targets = self.derive_data_readiness_targets(&records);
        let active = derive_active_subscriptions(&symbols, &timeframes, &records)?;
        let required_history_plan = self.build_required_history_plan(&records, &active);

        {
            let mut status = self.inner.runtime_status.write().await;
            status.runtime_config.loaded = true;
            status.runtime_config.last_refreshed_at = Some(Utc::now().to_rfc3339());
            status.runtime_config.last_error = None;
            status.subscriptions = active.clone();
            status.database.connected = true;
        }

        self.inner
            .metrics
            .active_kline_subscriptions
            .set(active.kline_subscriptions.len() as i64);
        self.inner
            .metrics
            .active_pair_subscriptions
            .set(active.pair_subscriptions.len() as i64);
        self.inner.metrics.runtime_config_loaded.set(1);
        self.inner
            .metrics
            .config_refresh_total
            .with_label_values(&["success"])
            .inc();

        *self.inner.required_kline_history_ms.write().await =
            required_history_plan.kline_by_subscription_id.clone();
        *self.inner.required_trade_history_ms.write().await =
            required_history_plan.trade_by_pair_code.clone();
        *self.inner.required_trade_gap_threshold_ms.write().await = required_history_plan
            .trade_gap_threshold_by_pair_code
            .clone();
        *self.inner.current_readiness_targets.write().await = readiness_targets
            .iter()
            .cloned()
            .map(|target| {
                (
                    (target.pair_code.clone(), target.timeframe_code.clone()),
                    target,
                )
            })
            .collect();
        self.inner.readiness_publish_at_by_target.lock().await.clear();
        tracing::info!(
            reason,
            kline_subscriptions = active.kline_subscriptions.len(),
            pair_subscriptions = active.pair_subscriptions.len(),
            "refreshed market-data subscriptions from control-plane"
        );

        let placeholder_readiness_items =
            self.build_placeholder_data_readiness_items(&readiness_targets);
        if let Err(error) = self
            .publish_data_readiness_items(&placeholder_readiness_items)
            .await
        {
            tracing::warn!(
                ?error,
                reason,
                "failed to publish placeholder data-readiness snapshot"
            );
        }

        let readiness_publish_handle = self
            .start_periodic_data_readiness_publish(records.clone(), reason.to_string());

        let refresh_result: Result<()> = async {
            self.run_backfill_and_gap_repair(&active, &required_history_plan)
                .await?;

            // Extra deep audit at startup: the existing backfill+repair pass is
            // anchored to a clamped "required lookback" window, which can leave
            // older leading gaps unfixed. The deep audit re-checks from the
            // earliest kline we have for each pair (bounded by config).
            if reason == "startup" {
                if let Err(error) = self
                    .run_trade_gap_audit_and_repair(
                        &active,
                        &required_history_plan.trade_by_pair_code,
                        &required_history_plan.trade_gap_threshold_by_pair_code,
                        TradeGapRepairMode::StartupDeep,
                    )
                    .await
                {
                    tracing::warn!(
                        ?error,
                        reason,
                        "startup trade gap audit/repair failed (continuing)"
                    );
                }
            }
            Ok(())
        }
        .await;

        if let Some((stop_tx, handle)) = readiness_publish_handle {
            let _ = stop_tx.send(());
            let _ = handle.await;
        }

        refresh_result?;

        if let Err(error) = self.publish_data_readiness_snapshot(&records).await {
            tracing::warn!(
                ?error,
                reason,
                "failed to publish data-readiness snapshot"
            );
        }
        Ok(())
    }

    fn start_periodic_data_readiness_publish(
        &self,
        records: Vec<ResolvedAnalysisSettingsRecord>,
        reason: String,
    ) -> Option<(oneshot::Sender<()>, JoinHandle<()>)> {
        if records.is_empty() {
            return None;
        }

        let service = self.clone();
        let interval_ms = self
            .inner
            .config
            .data_readiness_publish_interval_ms
            .max(1_000);
        let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            if let Err(error) = service.publish_data_readiness_snapshot(&records).await {
                tracing::warn!(
                    ?error,
                    reason,
                    "failed to publish initial in-progress data-readiness snapshot"
                );
            }

            let mut interval = tokio::time::interval(Duration::from_millis(interval_ms));
            interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
            interval.tick().await;

            loop {
                tokio::select! {
                    _ = &mut stop_rx => {
                        break;
                    }
                    _ = interval.tick() => {
                        if let Err(error) = service.publish_data_readiness_snapshot(&records).await {
                            tracing::warn!(
                                ?error,
                                reason,
                                "failed to publish periodic data-readiness snapshot"
                            );
                        }
                    }
                }
            }
        });

        Some((stop_tx, handle))
    }

    async fn fetch_resolved_analysis_settings(
        &self,
    ) -> Result<Vec<ResolvedAnalysisSettingsRecord>> {
        self.fetch_control_plane_records("/v1/runtime-config/analysis-settings")
            .await
    }

    async fn fetch_symbols(&self) -> Result<Vec<crate::models::PairRecord>> {
        self.fetch_control_plane_records("/v1/symbols").await
    }

    async fn fetch_timeframes(&self) -> Result<Vec<crate::models::TimeframeRecord>> {
        self.fetch_control_plane_records("/v1/timeframes").await
    }

    async fn fetch_control_plane_records<T>(&self, path: &str) -> Result<Vec<T>>
    where
        T: serde::de::DeserializeOwned,
    {
        let url = format!(
            "{}{}",
            self.inner
                .config
                .control_plane_base_url
                .trim_end_matches('/'),
            path
        );
        let response = self
            .inner
            .http_client
            .get(url)
            .send()
            .await?
            .error_for_status()?;
        Ok(response.json::<Vec<T>>().await?)
    }

    fn derive_data_readiness_targets(
        &self,
        records: &[ResolvedAnalysisSettingsRecord],
    ) -> Vec<DataReadinessTarget> {
        let snapshot_end = Self::last_closed_hour_ms(Utc::now().timestamp_millis());
        let mut grouped: HashMap<(String, String), DataReadinessTarget> = HashMap::new();

        for record in records.iter().filter(|record| record.enabled) {
            let configured_duration_ms = self
                .inner
                .config
                .backtesting_timerange_ms_by_timeframe
                .get(&record.timeframe_code)
                .copied()
                .unwrap_or_else(|| {
                    (self.inner.config.historical_backfill_limit as i64)
                        .saturating_mul(record.timeframe.period_ms.max(1))
                })
                .max(record.timeframe.period_ms.max(1));
            let warmup_candles = self.inner.config.backtest_warmup_candles;
            let required_history_ms = configured_duration_ms
                .saturating_add((warmup_candles as i64).saturating_mul(record.timeframe.period_ms));
            let key = (record.symbol.clone(), record.timeframe_code.clone());

            grouped
                .entry(key)
                .and_modify(|target| {
                    target.required_history_ms =
                        target.required_history_ms.max(required_history_ms);
                    if !target.analysis_setting_ids.contains(&record.id) {
                        target.analysis_setting_ids.push(record.id.clone());
                    }
                })
                .or_insert_with(|| DataReadinessTarget {
                    pair_code: record.symbol.clone(),
                    timeframe_code: record.timeframe_code.clone(),
                    period_ms: record.timeframe.period_ms,
                    analysis_setting_ids: vec![record.id.clone()],
                    requested_start_time: snapshot_end.saturating_sub(configured_duration_ms),
                    requested_end_time: snapshot_end,
                    required_history_ms,
                });
        }

        grouped.into_values().collect()
    }

    fn build_placeholder_data_readiness_items(
        &self,
        targets: &[DataReadinessTarget],
    ) -> Vec<DataReadinessSnapshotItem> {
        targets
            .iter()
            .cloned()
            .map(|target| DataReadinessSnapshotItem {
                status: "partial".to_string(),
                pair_code: target.pair_code,
                timeframe_code: target.timeframe_code,
                analysis_setting_ids: target.analysis_setting_ids,
                requested_start_time: target.requested_start_time,
                requested_end_time: target.requested_end_time,
                required_history_ms: target.required_history_ms,
                details: None,
                kline: ReadinessDimension {
                    row_count: 0,
                    min_time: None,
                    max_time: None,
                    latest_time: None,
                    missing_count: 0,
                    complete: false,
                    coverage_percent: 0.0,
                },
                trades: ReadinessDimension {
                    row_count: 0,
                    min_time: None,
                    max_time: None,
                    latest_time: None,
                    missing_count: 0,
                    complete: false,
                    coverage_percent: 0.0,
                },
            })
            .collect()
    }

    async fn build_data_readiness_snapshot_item(
        &self,
        target: DataReadinessTarget,
    ) -> DataReadinessSnapshotItem {
        match self
            .backtest_data_readiness_with_required_history(
                &target.pair_code,
                &target.timeframe_code,
                target.requested_start_time,
                target.requested_end_time,
                target.period_ms,
                target.required_history_ms,
            )
            .await
        {
            Ok(readiness) => DataReadinessSnapshotItem {
                status: readiness.status,
                pair_code: readiness.pair_code,
                timeframe_code: readiness.timeframe_code,
                analysis_setting_ids: target.analysis_setting_ids,
                requested_start_time: target.requested_start_time,
                requested_end_time: target.requested_end_time,
                required_history_ms: target.required_history_ms,
                details: readiness.details,
                kline: readiness.kline,
                trades: readiness.trades,
            },
            Err(error) => DataReadinessSnapshotItem {
                status: "error".to_string(),
                pair_code: target.pair_code,
                timeframe_code: target.timeframe_code,
                analysis_setting_ids: target.analysis_setting_ids,
                requested_start_time: target.requested_start_time,
                requested_end_time: target.requested_end_time,
                required_history_ms: target.required_history_ms,
                details: Some(error.to_string()),
                kline: ReadinessDimension {
                    row_count: 0,
                    min_time: None,
                    max_time: None,
                    latest_time: None,
                    missing_count: 0,
                    complete: false,
                    coverage_percent: 0.0,
                },
                trades: ReadinessDimension {
                    row_count: 0,
                    min_time: None,
                    max_time: None,
                    latest_time: None,
                    missing_count: 0,
                    complete: false,
                    coverage_percent: 0.0,
                },
            },
        }
    }

    async fn publish_data_readiness_target_if_due(
        &self,
        pair_code: &str,
        timeframe_code: &str,
        force: bool,
    ) -> Result<()> {
        let key = (pair_code.to_string(), timeframe_code.to_string());
        let target = {
            self.inner
                .current_readiness_targets
                .read()
                .await
                .get(&key)
                .cloned()
        };
        let Some(target) = target else {
            return Ok(());
        };

        {
            let mut publish_at = self.inner.readiness_publish_at_by_target.lock().await;
            if !force
                && let Some(last_published_at) = publish_at.get(&key)
                && last_published_at.elapsed()
                    < Duration::from_millis(IN_PROGRESS_READINESS_PUBLISH_THROTTLE_MS)
            {
                return Ok(());
            }
            publish_at.insert(key, Instant::now());
        }

        let item = self.build_data_readiness_snapshot_item(target).await;
        self.publish_data_readiness_items(&[item]).await
    }

    async fn publish_data_readiness_for_pair_if_due(
        &self,
        pair_code: &str,
        force: bool,
    ) -> Result<()> {
        let targets: Vec<DataReadinessTarget> = self
            .inner
            .current_readiness_targets
            .read()
            .await
            .values()
            .filter(|target| target.pair_code == pair_code)
            .cloned()
            .collect();

        for target in targets {
            self.publish_data_readiness_target_if_due(
                &target.pair_code,
                &target.timeframe_code,
                force,
            )
            .await?;
        }

        Ok(())
    }

    async fn publish_data_readiness_snapshot(
        &self,
        records: &[ResolvedAnalysisSettingsRecord],
    ) -> Result<()> {
        let targets = self.derive_data_readiness_targets(records);
        let mut items = Vec::with_capacity(targets.len());

        if targets.is_empty() {
            self.publish_data_readiness_items(&items).await?;
            return Ok(());
        }

        for target in targets {
            let item = self.build_data_readiness_snapshot_item(target).await;
            items.push(item);
            self.publish_data_readiness_items(&items).await?;
        }

        Ok(())
    }

    async fn publish_data_readiness_items(
        &self,
        items: &[DataReadinessSnapshotItem],
    ) -> Result<()> {
        let envelope = DataReadinessSnapshotEnvelope {
            event_id: Uuid::new_v4().to_string(),
            event_type: "trading-bot.market-data.data-readiness-snapshot.v1",
            source: self.inner.config.service_name.clone(),
            occurred_at: Utc::now().to_rfc3339(),
            data: DataReadinessSnapshotPayload {
                items: items.to_vec(),
            },
        };
        let payload = serde_json::to_string(&envelope)?;

        self.inner
            .kafka_producer
            .send(
                FutureRecord::to(&self.inner.config.data_readiness_events_topic)
                    .key("snapshot")
                    .payload(&payload),
                Duration::from_secs(5),
            )
            .await
            .map_err(|(error, _)| anyhow::anyhow!(error))?;

        Ok(())
    }

    fn build_required_history_plan(
        &self,
        records: &[ResolvedAnalysisSettingsRecord],
        active: &ActiveSubscriptions,
    ) -> RequiredHistoryPlan {
        let mut kline_by_key: HashMap<(String, String), i64> = HashMap::new();
        let mut trade_by_pair_code: HashMap<String, i64> = HashMap::new();
        let mut trade_gap_threshold_by_pair_code: HashMap<String, i64> = HashMap::new();

        for subscription in &active.kline_subscriptions {
            let configured_duration_ms = self
                .inner
                .config
                .backtesting_timerange_ms_by_timeframe
                .get(&subscription.timeframe_code)
                .copied()
                .unwrap_or_else(|| {
                    (self.inner.config.historical_backfill_limit as i64)
                        .saturating_mul(subscription.period_ms.max(1))
                })
                .max(subscription.period_ms.max(1));
            let kline_headroom_ms = (self.inner.config.backtest_kline_headroom_candles as i64)
                .saturating_mul(subscription.period_ms.max(1));
            let headroom_ms = self.inner.config.scheduled_backtest_history_headroom_ms as i64;
            let required_kline_history_ms =
                configured_duration_ms.saturating_add(kline_headroom_ms);
            let required_trade_history_ms = configured_duration_ms.saturating_add(headroom_ms);

            let key = (
                subscription.pair_code.clone(),
                subscription.timeframe_code.clone(),
            );
            kline_by_key
                .entry(key)
                .and_modify(|current| *current = (*current).max(required_kline_history_ms))
                .or_insert(required_kline_history_ms);

            trade_by_pair_code
                .entry(subscription.pair_code.clone())
                .and_modify(|current| *current = (*current).max(required_trade_history_ms))
                .or_insert(required_trade_history_ms);
        }

        for record in records.iter().filter(|record| record.enabled) {
            let configured_duration_ms = self
                .inner
                .config
                .backtesting_timerange_ms_by_timeframe
                .get(&record.timeframe_code)
                .copied()
                .unwrap_or_else(|| {
                    (self.inner.config.historical_backfill_limit as i64)
                        .saturating_mul(record.timeframe.period_ms.max(1))
                })
                .max(record.timeframe.period_ms.max(1));

            let warmup_candles = self.inner.config.backtest_warmup_candles;
            let warmup_ms =
                (warmup_candles as i64).saturating_mul(record.timeframe.period_ms.max(1));
            let kline_headroom_ms = (self.inner.config.backtest_kline_headroom_candles as i64)
                .saturating_mul(record.timeframe.period_ms.max(1));
            let headroom_ms = self.inner.config.scheduled_backtest_history_headroom_ms as i64;
            let required_kline_history_ms = configured_duration_ms
                .saturating_add(warmup_ms)
                .saturating_add(kline_headroom_ms);
            let required_trade_history_ms = configured_duration_ms.saturating_add(headroom_ms);

            let kline_key = (record.symbol.clone(), record.timeframe_code.clone());
            kline_by_key
                .entry(kline_key)
                .and_modify(|current| *current = (*current).max(required_kline_history_ms))
                .or_insert(required_kline_history_ms);

            trade_by_pair_code
                .entry(record.symbol.clone())
                .and_modify(|current| *current = (*current).max(required_trade_history_ms))
                .or_insert(required_trade_history_ms);
        }

        let mut kline_by_subscription_id = HashMap::new();
        for subscription in &active.kline_subscriptions {
            let key = (
                subscription.pair_code.clone(),
                subscription.timeframe_code.clone(),
            );
            let fallback_ms = (self.inner.config.historical_backfill_limit as i64)
                .saturating_mul(subscription.period_ms.max(1));
            let required_ms = kline_by_key.get(&key).copied().unwrap_or(fallback_ms);
            kline_by_subscription_id.insert(subscription.subscription_id.clone(), required_ms);
            trade_gap_threshold_by_pair_code
                .entry(subscription.pair_code.clone())
                .and_modify(|current| {
                    *current = (*current).min(self.inner.config.trade_gap_repair_min_gap_ms as i64)
                })
                .or_insert(self.inner.config.trade_gap_repair_min_gap_ms as i64);
        }

        RequiredHistoryPlan {
            kline_by_subscription_id,
            trade_by_pair_code,
            trade_gap_threshold_by_pair_code,
        }
    }

    async fn run_backfill_and_gap_repair(
        &self,
        active: &ActiveSubscriptions,
        required_history_plan: &RequiredHistoryPlan,
    ) -> Result<()> {
        let result = async {
            self.run_kline_backfill_and_gap_repair(
                &active.kline_subscriptions,
                &required_history_plan.kline_by_subscription_id,
            )
            .await?;
            self.run_trade_backfill_and_gap_repair(
                &active.pair_subscriptions,
                &required_history_plan.trade_by_pair_code,
                &required_history_plan.trade_gap_threshold_by_pair_code,
            )
            .await
        }
        .await;

        let mut status = self.inner.runtime_status.write().await;
        status.database.last_backfill_at = Some(Utc::now().to_rfc3339());
        status.database.last_backfill_error = result.as_ref().err().map(|error| error.to_string());
        drop(status);

        if result.is_ok()
            && self.inner.config.historical_store_compact_after_refresh
            && let Err(error) = self.run_market_data_compaction("post-refresh").await
        {
            tracing::warn!(?error, "market-data post-refresh compaction failed");
        }

        self.inner
            .metrics
            .backfill_total
            .with_label_values(&[if result.is_ok() { "success" } else { "failure" }])
            .inc();
        result
    }

    async fn run_kline_backfill_and_gap_repair(
        &self,
        subscriptions: &[KlineSubscription],
        required_history_by_subscription_id: &HashMap<String, i64>,
    ) -> Result<()> {
        let max_concurrency = self.inner.config.historical_backfill_max_concurrency;
        let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency));
        let mut tasks = Vec::with_capacity(subscriptions.len());

        for subscription in subscriptions.iter().cloned() {
            let required_history_ms = required_history_by_subscription_id
                .get(&subscription.subscription_id)
                .copied()
                .unwrap_or_else(|| {
                    (self.inner.config.historical_backfill_limit as i64)
                        .saturating_mul(subscription.period_ms.max(1))
                });
            let service = self.clone();
            let permit = semaphore.clone().acquire_owned().await?;
            tasks.push(tokio::spawn(async move {
                let _permit = permit;
                service
                    .backfill_subscription(subscription, required_history_ms)
                    .await
            }));
        }

        let mut had_error = None;
        for task in tasks {
            match task.await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => had_error = Some(error.to_string()),
                Err(error) => had_error = Some(error.to_string()),
            }
        }

        if let Some(error) = had_error {
            return Err(anyhow::anyhow!(error));
        }
        Ok(())
    }

    async fn run_trade_backfill_and_gap_repair(
        &self,
        subscriptions: &[PairStreamSubscription],
        pair_required_trade_history_ms: &HashMap<String, i64>,
        pair_trade_gap_threshold_ms: &HashMap<String, i64>,
    ) -> Result<()> {
        let max_concurrency = self.inner.config.historical_backfill_max_concurrency;
        let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency));
        let mut tasks = Vec::with_capacity(subscriptions.len());

        for subscription in subscriptions.iter().cloned() {
            let service = self.clone();
            let permit = semaphore.clone().acquire_owned().await?;
            let required_history_ms = pair_required_trade_history_ms
                .get(&subscription.pair_code)
                .copied()
                .unwrap_or(60_000)
                .max(60_000);
            let gap_threshold_ms = pair_trade_gap_threshold_ms
                .get(&subscription.pair_code)
                .copied()
                .unwrap_or(60_000)
                .max(1);
            tasks.push(tokio::spawn(async move {
                let _permit = permit;
                service
                    .backfill_pair_trades_with_lookback(
                        subscription,
                        required_history_ms,
                        gap_threshold_ms,
                    )
                    .await
            }));
        }

        let mut had_error = None;
        for task in tasks {
            match task.await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => had_error = Some(error.to_string()),
                Err(error) => had_error = Some(error.to_string()),
            }
        }

        if let Some(error) = had_error {
            return Err(anyhow::anyhow!(error));
        }
        Ok(())
    }

    async fn run_trade_gap_audit_and_repair(
        &self,
        active: &ActiveSubscriptions,
        pair_required_trade_history_ms: &HashMap<String, i64>,
        pair_trade_gap_threshold_ms: &HashMap<String, i64>,
        mode: TradeGapRepairMode,
    ) -> Result<()> {
        if active.pair_subscriptions.is_empty() {
            return Ok(());
        }

        let end_limit_ms = Self::last_closed_hour_ms(Utc::now().timestamp_millis());

        let max_batch_rows = self.inner.config.historical_trade_backfill_limit.min(1000);
        let max_batches = self.inner.config.historical_trade_backfill_max_batches;

        let startup_cap_ms = self.inner.config.trade_gap_repair_startup_max_window_ms as i64;

        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(
            self.inner.config.historical_backfill_max_concurrency,
        ));
        let mut tasks: Vec<tokio::task::JoinHandle<Result<()>>> =
            Vec::with_capacity(active.pair_subscriptions.len());

        for subscription in active.pair_subscriptions.iter().cloned() {
            let permit = semaphore.clone().acquire_owned().await?;

            let service = self.clone();
            let required_history_ms = pair_required_trade_history_ms
                .get(&subscription.pair_code)
                .copied()
                .unwrap_or(60_000)
                .max(60_000);
            let gap_threshold_ms = pair_trade_gap_threshold_ms
                .get(&subscription.pair_code)
                .copied()
                .unwrap_or(60_000)
                .max(1);

            tasks.push(tokio::spawn(async move {
                let _permit = permit;

                let window_end_ms = end_limit_ms;
                if window_end_ms <= 0 {
                    return Ok(());
                }

                let window_start_ms = match mode {
                    TradeGapRepairMode::StartupDeep => {
                        let earliest_kline_time = service
                            .inner
                            .database
                            .earliest_pair_kline_open_time(&subscription.pair_code)
                            .await?;

                        let Some(earliest_kline_time) = earliest_kline_time else {
                            return Ok(());
                        };

                        let startup_window_ms = startup_cap_ms.max(required_history_ms);
                        let min_start = window_end_ms.saturating_sub(startup_window_ms);
                        earliest_kline_time.max(min_start)
                    }
                };

                if window_end_ms <= window_start_ms {
                    return Ok(());
                }

                tracing::info!(
                    table = "market_data_trades",
                    pair_code = %subscription.pair_code,
                    mode = ?mode,
                    window_start_ms = window_start_ms,
                    window_end_ms = window_end_ms,
                    required_history_ms = required_history_ms,
                    gap_threshold_ms = gap_threshold_ms,
                    max_batch_rows = max_batch_rows,
                    max_batches = max_batches,
                    "trade gap audit/repair begin"
                );

                let planned_gaps = service
                    .planned_trade_gaps_for_pair(
                        &subscription.pair_code,
                        window_start_ms,
                        window_end_ms,
                        gap_threshold_ms,
                        10_000,
                    )
                    .await?;
                if planned_gaps.is_empty() {
                    tracing::info!(
                        table = "market_data_trades",
                        pair_code = %subscription.pair_code,
                        mode = ?mode,
                        window_start_ms = window_start_ms,
                        window_end_ms = window_end_ms,
                        "trade gap audit/repair skipped because persisted coverage state already covers the required window"
                    );
                    return Ok(());
                }

                service
                    .repair_trade_gaps_for_pair(
                        &subscription,
                        window_start_ms,
                        window_end_ms,
                        max_batch_rows,
                        max_batches,
                        gap_threshold_ms,
                    )
                    .await?;

                if let Err(error) = service
                    .sync_trade_coverage_state_from_db(
                        &subscription.pair_code,
                        window_start_ms,
                        window_end_ms,
                        gap_threshold_ms,
                    )
                    .await
                {
                    tracing::warn!(
                        ?error,
                        table = "market_data_trades",
                        pair_code = %subscription.pair_code,
                        mode = ?mode,
                        window_start_ms = window_start_ms,
                        window_end_ms = window_end_ms,
                        "failed to sync trade coverage state after gap audit/repair"
                    );
                }

                tracing::info!(
                    table = "market_data_trades",
                    pair_code = %subscription.pair_code,
                    mode = ?mode,
                    window_start_ms = window_start_ms,
                    window_end_ms = window_end_ms,
                    "trade gap audit/repair finished"
                );

                Ok(())
            }));
        }

        let mut had_error: Option<String> = None;
        for task in tasks {
            match task.await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => had_error = Some(error.to_string()),
                Err(error) => had_error = Some(error.to_string()),
            }
        }

        if let Some(error) = had_error {
            return Err(anyhow::anyhow!(error));
        }

        Ok(())
    }

    fn align_to_period_ms(timestamp_ms: i64, period_ms: i64) -> i64 {
        if period_ms <= 0 || timestamp_ms <= 0 {
            return timestamp_ms.max(0);
        }
        timestamp_ms - (timestamp_ms % period_ms)
    }

    fn last_closed_hour_ms(reference_time_ms: i64) -> i64 {
        Self::align_to_period_ms(reference_time_ms.max(0), 60 * 60 * 1000)
    }

    fn duration_until_next_hour_boundary() -> Duration {
        let now_ms = Utc::now().timestamp_millis();
        let next_ms = Self::last_closed_hour_ms(now_ms)
            .saturating_add(60 * 60 * 1000)
            .max(now_ms.saturating_add(1));
        Duration::from_millis(next_ms.saturating_sub(now_ms) as u64)
    }

    fn value_to_i64(value: &Value) -> Option<i64> {
        value
            .as_i64()
            .or_else(|| value.as_str().and_then(|value| value.parse::<i64>().ok()))
    }

    // Merge overlapping/adjacent gaps to avoid duplicated refill work.
    fn merge_time_gaps(mut gaps: Vec<TimeGap>) -> Vec<TimeGap> {
        if gaps.is_empty() {
            return gaps;
        }
        gaps.sort_by_key(|gap| gap.start_time);
        let mut merged: Vec<TimeGap> = Vec::with_capacity(gaps.len());
        for gap in gaps {
            if gap.end_time <= gap.start_time {
                continue;
            }
            if let Some(last) = merged.last_mut()
                && gap.start_time <= last.end_time.saturating_add(1)
            {
                last.end_time = last.end_time.max(gap.end_time);
                last.gap_ms = last.end_time.saturating_sub(last.start_time);
            } else {
                merged.push(gap);
            }
        }
        merged
    }

    fn merge_time_intervals(mut intervals: Vec<TimeInterval>) -> Vec<TimeInterval> {
        if intervals.is_empty() {
            return intervals;
        }
        intervals.sort_by_key(|interval| interval.start_time);
        let mut merged: Vec<TimeInterval> = Vec::with_capacity(intervals.len());
        for interval in intervals {
            if interval.end_time <= interval.start_time {
                continue;
            }
            if let Some(last) = merged.last_mut()
                && interval.start_time <= last.end_time.saturating_add(1)
            {
                last.end_time = last.end_time.max(interval.end_time);
            } else {
                merged.push(interval);
            }
        }
        merged
    }

    fn covered_intervals_from_missing_ranges(
        window_start: i64,
        window_end: i64,
        missing_ranges: &[TimeGap],
    ) -> Vec<TimeInterval> {
        if window_end <= window_start {
            return Vec::new();
        }

        let mut covered = Vec::new();
        let mut cursor = window_start;
        let mut gaps = missing_ranges.to_vec();
        gaps.sort_by_key(|gap| gap.start_time);
        for gap in gaps {
            let gap_start = gap.start_time.max(window_start);
            let gap_end = gap.end_time.min(window_end);
            if gap_end <= gap_start {
                continue;
            }
            if cursor < gap_start {
                covered.push(TimeInterval {
                    start_time: cursor,
                    end_time: gap_start,
                });
            }
            cursor = cursor.max(gap_end);
            if cursor >= window_end {
                break;
            }
        }

        if cursor < window_end {
            covered.push(TimeInterval {
                start_time: cursor,
                end_time: window_end,
            });
        }

        Self::merge_time_intervals(covered)
    }

    fn replace_coverage_window(
        existing_intervals: Vec<TimeInterval>,
        window_start: i64,
        window_end: i64,
        replacement_intervals: Vec<TimeInterval>,
    ) -> Vec<TimeInterval> {
        let mut kept = Vec::new();
        for interval in existing_intervals {
            if interval.end_time <= window_start || interval.start_time >= window_end {
                kept.push(interval);
                continue;
            }

            if interval.start_time < window_start {
                kept.push(TimeInterval {
                    start_time: interval.start_time,
                    end_time: window_start,
                });
            }
            if interval.end_time > window_end {
                kept.push(TimeInterval {
                    start_time: window_end,
                    end_time: interval.end_time,
                });
            }
        }

        kept.extend(replacement_intervals);
        Self::merge_time_intervals(kept)
    }

    async fn sync_trade_coverage_state_from_db(
        &self,
        pair_code: &str,
        window_start: i64,
        window_end: i64,
        min_gap_ms: i64,
    ) -> Result<Vec<TimeInterval>> {
        let missing_ranges = self
            .detect_trade_gaps_from_db_for_pair(
                pair_code,
                window_start,
                window_end,
                min_gap_ms,
                10_000,
            )
            .await?;
        let replacement_intervals =
            Self::covered_intervals_from_missing_ranges(window_start, window_end, &missing_ranges);
        let existing_intervals = self
            .inner
            .database
            .trade_coverage_intervals(pair_code)
            .await?;
        let merged_intervals = Self::replace_coverage_window(
            existing_intervals,
            window_start,
            window_end,
            replacement_intervals,
        );
        self.inner
            .database
            .replace_trade_coverage_intervals(pair_code, &merged_intervals)
            .await?;
        Ok(merged_intervals)
    }

    async fn planned_trade_gaps_for_pair(
        &self,
        pair_code: &str,
        window_start: i64,
        window_end: i64,
        min_gap_ms: i64,
        limit: i64,
    ) -> Result<Vec<TimeGap>> {
        let missing_ranges = self
            .detect_trade_gaps_from_db_for_pair(
                pair_code,
                window_start,
                window_end,
                min_gap_ms,
                limit,
            )
            .await?;
        let covered_intervals =
            Self::covered_intervals_from_missing_ranges(window_start, window_end, &missing_ranges);
        self.inner
            .database
            .replace_trade_coverage_intervals(pair_code, &covered_intervals)
            .await?;
        tracing::info!(
            table = "market_data_trades",
            pair_code,
            window_start_ms = window_start,
            window_end_ms = window_end,
            covered_interval_count = covered_intervals.len(),
            missing_interval_count = missing_ranges.len(),
            "trade backfill planning refreshed persisted coverage state from raw trade scan"
        );
        Ok(missing_ranges)
    }

    async fn detect_trade_gaps_from_db_for_pair(
        &self,
        pair_code: &str,
        window_start: i64,
        window_end: i64,
        min_gap_ms: i64,
        limit: i64,
    ) -> Result<Vec<TimeGap>> {
        let coverage = self
            .inner
            .database
            .trade_window_coverage_in_range(pair_code, window_start, window_end)
            .await?;

        let mut gaps = Vec::<TimeGap>::new();
        match (coverage.min_time, coverage.max_time) {
            (Some(min_t), Some(max_t)) => {
                let leading_gap_ms = min_t.saturating_sub(window_start);
                if leading_gap_ms > min_gap_ms {
                    gaps.push(TimeGap {
                        start_time: window_start,
                        end_time: min_t,
                        gap_ms: leading_gap_ms,
                    });
                }

                let expected_max = window_end.saturating_sub(1);
                let trailing_gap_ms = expected_max.saturating_sub(max_t);
                if max_t < expected_max && trailing_gap_ms > min_gap_ms {
                    gaps.push(TimeGap {
                        start_time: max_t.saturating_add(1),
                        end_time: window_end,
                        gap_ms: trailing_gap_ms,
                    });
                }
            }
            _ => {
                gaps.push(TimeGap {
                    start_time: window_start,
                    end_time: window_end,
                    gap_ms: window_end.saturating_sub(window_start),
                });
                return Ok(gaps);
            }
        }

        let internal_gaps = self
            .inner
            .database
            .aggregate_trade_id_gaps_in_range(pair_code, window_start, window_end, limit)
            .await?;
        gaps.extend(internal_gaps.into_iter().map(|gap| TimeGap {
            start_time: gap.start_time,
            end_time: gap.end_time,
            gap_ms: gap.gap_ms,
        }));
        Ok(Self::merge_time_gaps(gaps))
    }

    async fn detect_kline_gaps_for_subscription(
        &self,
        subscription: &KlineSubscription,
        window_start: i64,
        window_end: i64,
        period_ms: i64,
        limit: i64,
    ) -> Result<Vec<TimeGap>> {
        let coverage = self
            .inner
            .database
            .kline_window_coverage_in_range(
                &subscription.pair_code,
                &subscription.timeframe_code,
                window_start,
                window_end,
            )
            .await?;

        let mut gaps = Vec::<TimeGap>::new();
        match (coverage.min_time, coverage.max_time) {
            (Some(min_t), Some(max_t)) => {
                let required_last_open_time = window_end.saturating_sub(period_ms);
                if min_t > window_start {
                    gaps.push(TimeGap {
                        start_time: window_start,
                        end_time: min_t,
                        gap_ms: min_t.saturating_sub(window_start),
                    });
                }

                if max_t < required_last_open_time {
                    gaps.push(TimeGap {
                        start_time: max_t.saturating_add(period_ms),
                        end_time: required_last_open_time.saturating_add(period_ms),
                        gap_ms: required_last_open_time.saturating_sub(max_t),
                    });
                }
            }
            _ => {
                gaps.push(TimeGap {
                    start_time: window_start,
                    end_time: window_end,
                    gap_ms: window_end.saturating_sub(window_start),
                });
                return Ok(gaps);
            }
        }

        let internal_gaps = self
            .inner
            .database
            .kline_time_gaps_in_range(
                &subscription.pair_code,
                &subscription.timeframe_code,
                window_start,
                window_end,
                period_ms,
                limit,
            )
            .await?;
        gaps.extend(internal_gaps);
        Ok(Self::merge_time_gaps(gaps))
    }

    async fn backfill_kline_range(
        &self,
        subscription: &KlineSubscription,
        range_start_ms: i64,
        range_end_ms: i64,
        batch_limit: usize,
    ) -> Result<()> {
        if range_end_ms <= range_start_ms {
            return Ok(());
        }

        let period_ms = subscription.period_ms.max(1);
        let insert_batch_rows = self
            .inner
            .config
            .historical_kline_backfill_insert_batch_rows
            .max(batch_limit);
        let mut next_start_ms = range_start_ms;
        let mut buffered_events: Vec<NormalizedKlineEvent> = Vec::new();

        while next_start_ms < range_end_ms {
            tracing::info!(
                table = "market_data_klines",
                pair_code = %subscription.pair_code,
                timeframe_code = %subscription.timeframe_code,
                binance_interval = %subscription.binance_interval,
                batch_limit,
                next_start_ms,
                range_start_ms,
                range_end_ms,
                "starting kline backfill batch for missing interval"
            );

            let rows = self
                .fetch_binance_json::<Vec<Vec<Value>>>(
                    "/api/v3/klines",
                    &[
                        ("symbol", subscription.symbol.clone()),
                        ("interval", subscription.binance_interval.clone()),
                        ("limit", batch_limit.to_string()),
                        ("startTime", next_start_ms.to_string()),
                    ],
                )
                .await?;
            if rows.is_empty() {
                break;
            }

            let mut last_open_time_in_range = None;
            for row in rows.iter() {
                let event =
                    normalize_rest_kline(subscription, row, &self.inner.config.service_name)?;
                if event.open_time < range_start_ms || event.open_time >= range_end_ms {
                    continue;
                }
                last_open_time_in_range = Some(event.open_time);
                buffered_events.push(event);
                if buffered_events.len() >= insert_batch_rows {
                    self.inner
                        .database
                        .upsert_klines_batch(&buffered_events)
                        .await?;
                    tracing::info!(
                        table = "market_data_klines",
                        pair_code = %subscription.pair_code,
                        timeframe_code = %subscription.timeframe_code,
                        binance_interval = %subscription.binance_interval,
                        buffered_rows = buffered_events.len(),
                        "flushed buffered kline backfill batch into ClickHouse"
                    );
                    buffered_events.clear();
                    if let Err(error) = self
                        .publish_data_readiness_target_if_due(
                            &subscription.pair_code,
                            &subscription.timeframe_code,
                            false,
                        )
                        .await
                    {
                        tracing::warn!(
                            ?error,
                            pair_code = %subscription.pair_code,
                            timeframe_code = %subscription.timeframe_code,
                            "failed to publish in-progress kline data-readiness update"
                        );
                    }
                }
            }

            let Some(last_row) = rows.last() else {
                break;
            };
            let Some(last_open_time) = last_row.first().and_then(Self::value_to_i64) else {
                break;
            };

            if last_open_time >= range_end_ms {
                break;
            }

            if let Some(last_in_range) = last_open_time_in_range {
                next_start_ms = last_in_range.saturating_add(period_ms);
            } else {
                next_start_ms = last_open_time.saturating_add(period_ms);
            }

            if rows.len() < batch_limit {
                break;
            }
        }

        if !buffered_events.is_empty() {
            self.inner
                .database
                .upsert_klines_batch(&buffered_events)
                .await?;
            tracing::info!(
                table = "market_data_klines",
                pair_code = %subscription.pair_code,
                timeframe_code = %subscription.timeframe_code,
                binance_interval = %subscription.binance_interval,
                buffered_rows = buffered_events.len(),
                "flushed final buffered kline backfill batch into ClickHouse"
            );
            if let Err(error) = self
                .publish_data_readiness_target_if_due(
                    &subscription.pair_code,
                    &subscription.timeframe_code,
                    false,
                )
                .await
            {
                tracing::warn!(
                    ?error,
                    pair_code = %subscription.pair_code,
                    timeframe_code = %subscription.timeframe_code,
                    "failed to publish in-progress kline data-readiness update"
                );
            }
        }

        Ok(())
    }

    async fn backfill_subscription(
        &self,
        subscription: KlineSubscription,
        required_history_ms: i64,
    ) -> Result<()> {
        let batch_limit = self.inner.config.historical_backfill_limit.min(1000);
        if batch_limit == 0 {
            return Ok(());
        }

        let period_ms = subscription.period_ms.max(1);
        let scheduled_backtest_end_ms = Self::last_closed_hour_ms(Utc::now().timestamp_millis());
        let required_end_ms = Self::align_to_period_ms(scheduled_backtest_end_ms, period_ms);
        let max_retention_lookback_ms = (self.inner.config.historical_kline_retention_days as i64)
            .saturating_mul(24 * 60 * 60 * 1000)
            .max(period_ms);
        let unclamped_required_lookback_ms = required_history_ms.max(period_ms);
        let required_lookback_ms = unclamped_required_lookback_ms.min(max_retention_lookback_ms);
        let required_start_ms = if required_end_ms > required_lookback_ms {
            Self::align_to_period_ms(
                required_end_ms.saturating_sub(required_lookback_ms),
                period_ms,
            )
        } else {
            0
        };
        let required_count = (required_end_ms.saturating_sub(required_start_ms))
            .saturating_div(period_ms) as usize;

        let current_count = self
            .inner
            .database
            .kline_open_time_count_in_range(
                &subscription.pair_code,
                &subscription.timeframe_code,
                required_start_ms,
                required_end_ms,
            )
            .await?;
        let gaps = self
            .detect_kline_gaps_for_subscription(
                &subscription,
                required_start_ms,
                required_end_ms,
                period_ms,
                10_000,
            )
            .await?;

        if unclamped_required_lookback_ms > max_retention_lookback_ms {
            tracing::warn!(
                table = "market_data_klines",
                pair_code = %subscription.pair_code,
                timeframe_code = %subscription.timeframe_code,
                unclamped_required_lookback_ms,
                max_retention_lookback_ms,
                required_start_ms,
                required_end_ms,
                "clamped kline required lookback to retention horizon"
            );
        }

        if gaps.is_empty() {
            tracing::info!(
                table = "market_data_klines",
                pair_code = %subscription.pair_code,
                timeframe_code = %subscription.timeframe_code,
                required_start_ms,
                required_end_ms,
                scheduled_backtest_end_ms,
                required_lookback_ms,
                required_count,
                current_count,
                "kline backfill skipped because required window is already covered"
            );
            return Ok(());
        }

        tracing::info!(
            table = "market_data_klines",
            pair_code = %subscription.pair_code,
            timeframe_code = %subscription.timeframe_code,
            required_start_ms,
            required_end_ms,
            scheduled_backtest_end_ms,
            required_lookback_ms,
            required_count,
            current_count,
            missing_interval_count = gaps.len(),
            "kline backfill planned only uncovered intervals"
        );

        for gap in gaps {
            tracing::info!(
                table = "market_data_klines",
                pair_code = %subscription.pair_code,
                timeframe_code = %subscription.timeframe_code,
                gap_start_ms = gap.start_time,
                gap_end_ms = gap.end_time,
                gap_ms = gap.gap_ms,
                "kline gap-repair refilling exact missing interval"
            );
            self.backfill_kline_range(&subscription, gap.start_time, gap.end_time, batch_limit)
                .await?;
        }

        // Log final coverage for the required window so operators can see what
        // ClickHouse contains for this subscription after backfill.
        match self
            .inner
            .database
            .kline_window_coverage_in_range(
                &subscription.pair_code,
                &subscription.timeframe_code,
                required_start_ms,
                required_end_ms,
            )
            .await
        {
            Ok(coverage) => {
                tracing::info!(
                    table = "market_data_klines",
                    pair_code = %subscription.pair_code,
                    timeframe_code = %subscription.timeframe_code,
                    required_start_ms,
                    required_end_ms,
                    row_count = coverage.row_count,
                    min_time = ?coverage.min_time,
                    max_time = ?coverage.max_time,
                    "kline backfill completed for subscription; window coverage in ClickHouse"
                );
            }
            Err(error) => {
                tracing::warn!(
                    ?error,
                    table = "market_data_klines",
                    pair_code = %subscription.pair_code,
                    timeframe_code = %subscription.timeframe_code,
                    required_start_ms,
                    required_end_ms,
                    "failed to compute kline window coverage after backfill"
                );
            }
        }

        if let Err(error) = self
            .publish_data_readiness_target_if_due(
                &subscription.pair_code,
                &subscription.timeframe_code,
                true,
            )
            .await
        {
            tracing::warn!(
                ?error,
                pair_code = %subscription.pair_code,
                timeframe_code = %subscription.timeframe_code,
                "failed to publish final kline data-readiness update"
            );
        }

        Ok(())
    }

    async fn backfill_pair_trades_with_lookback(
        &self,
        subscription: PairStreamSubscription,
        required_history_ms: i64,
        gap_threshold_ms: i64,
    ) -> Result<()> {
        let required_history_ms = required_history_ms.max(60_000);
        let gap_threshold_ms = gap_threshold_ms.max(1);
        let max_batch_rows = self.inner.config.historical_trade_backfill_limit.min(1000);
        let max_batches = self.inner.config.historical_trade_backfill_max_batches;

        // Anchor trade backfill to the earliest kline we have for this pair,
        // clamped by the required lookback window.
        let Some(earliest_kline_time) = self
            .inner
            .database
            .earliest_pair_kline_open_time(&subscription.pair_code)
            .await?
        else {
            return Ok(());
        };

        let snapshot_end_ms = Self::last_closed_hour_ms(Utc::now().timestamp_millis());
        let required_window_start = snapshot_end_ms.saturating_sub(required_history_ms);
        let window_start = earliest_kline_time.max(required_window_start);
        let window_end = snapshot_end_ms;

        tracing::info!(
            table = "market_data_trades",
            pair_code = %subscription.pair_code,
            window_start_ms = window_start,
            window_end_ms = window_end,
            gap_threshold_ms,
            pair_chunk_concurrency = self
                .inner
                .config
                .historical_backfill_max_concurrency
                .min(self.inner.config.historical_trade_backfill_pair_max_concurrency)
                .max(1),
            "planning trade backfill chunks for pair"
        );

        if window_end <= window_start {
            return Ok(());
        }

        let missing_ranges = self
            .planned_trade_gaps_for_pair(
                &subscription.pair_code,
                window_start,
                window_end,
                gap_threshold_ms,
                10_000,
            )
            .await?;

        if missing_ranges.is_empty() {
            tracing::info!(
                table = "market_data_trades",
                pair_code = %subscription.pair_code,
                window_start_ms = window_start,
                window_end_ms = window_end,
                "trade backfill skipped because required window is already covered"
            );
            return Ok(());
        }

        tracing::info!(
            table = "market_data_trades",
            pair_code = %subscription.pair_code,
            window_start_ms = window_start,
            window_end_ms = window_end,
            missing_interval_count = missing_ranges.len(),
            "trade backfill planned only uncovered intervals"
        );

        // Chunk only the uncovered intervals to allow per-pair parallelism
        // without repeatedly sweeping already-covered ranges.
        let chunk_ms: i64 = self
            .inner
            .config
            .historical_trade_backfill_chunk_ms
            .max(60_000) as i64;
        let mut chunks = Vec::new();
        for gap in &missing_ranges {
            let mut chunk_start = gap.start_time;
            while chunk_start < gap.end_time {
                let mut chunk_end = chunk_start.saturating_add(chunk_ms);
                if chunk_end > gap.end_time {
                    chunk_end = gap.end_time;
                }
                chunks.push((chunk_start, chunk_end));
                chunk_start = chunk_end;
            }
        }

        let pair_chunk_concurrency = self
            .inner
            .config
            .historical_backfill_max_concurrency
            .min(
                self.inner
                    .config
                    .historical_trade_backfill_pair_max_concurrency,
            )
            .max(1);
        let pair_semaphore =
            std::sync::Arc::new(tokio::sync::Semaphore::new(pair_chunk_concurrency));
        let mut tasks = Vec::with_capacity(chunks.len());
        for (start_ms, end_ms) in chunks {
            let permit = pair_semaphore.clone().acquire_owned().await?;
            let service = self.clone();
            let sub = subscription.clone();
            tasks.push(tokio::spawn(async move {
                let _permit = permit;
                service
                    .backfill_pair_trades_for_chunk(
                        sub,
                        start_ms,
                        end_ms,
                        max_batch_rows,
                        max_batches,
                    )
                    .await
            }));
        }

        let mut had_error = None;
        for task in tasks {
            match task.await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => had_error = Some(error.to_string()),
                Err(error) => had_error = Some(error.to_string()),
            }
        }

        if let Some(error) = had_error {
            return Err(anyhow::anyhow!(error));
        }

        // Repair pass: detect and refill leading/trailing/internal gaps in the
        // target window so future backtests can rely on complete trade coverage.
        self.repair_trade_gaps_for_pair(
            &subscription,
            window_start,
            window_end,
            max_batch_rows,
            max_batches,
            gap_threshold_ms,
        )
        .await?;
        if let Err(error) = self
            .sync_trade_coverage_state_from_db(
                &subscription.pair_code,
                window_start,
                window_end,
                gap_threshold_ms,
            )
            .await
        {
            tracing::warn!(
                ?error,
                table = "market_data_trades",
                pair_code = %subscription.pair_code,
                window_start_ms = window_start,
                window_end_ms = window_end,
                "failed to sync trade coverage state after trade backfill"
            );
        }
        // After backfilling all chunks for this pair, log what ClickHouse
        // actually contains for the requested window so operators can see
        // whether coverage is complete or there are still gaps.
        match self
            .inner
            .database
            .trade_window_coverage_in_range(&subscription.pair_code, window_start, window_end)
            .await
        {
            Ok(coverage) => {
                let has_full_coverage = match (coverage.min_time, coverage.max_time) {
                    (Some(min_t), Some(max_t)) => {
                        min_t <= window_start && max_t >= window_end.saturating_sub(1)
                    }
                    _ => false,
                };

                if has_full_coverage {
                    tracing::info!(
                        table = "market_data_trades",
                        pair_code = %subscription.pair_code,
                        window_start_ms = window_start,
                        window_end_ms = window_end,
                        row_count = coverage.row_count,
                        min_time = ?coverage.min_time,
                        max_time = ?coverage.max_time,
                        "trade backfill completed for pair; window coverage in ClickHouse"
                    );
                } else {
                    tracing::warn!(
                        table = "market_data_trades",
                        pair_code = %subscription.pair_code,
                        window_start_ms = window_start,
                        window_end_ms = window_end,
                        row_count = coverage.row_count,
                        min_time = ?coverage.min_time,
                        max_time = ?coverage.max_time,
                        "trade backfill for pair finished but window coverage is incomplete; consider increasing HISTORICAL_TRADE_BACKFILL_LIMIT or HISTORICAL_TRADE_BACKFILL_MAX_BATCHES"
                    );
                }
            }
            Err(error) => {
                tracing::warn!(
                    ?error,
                    table = "market_data_trades",
                    pair_code = %subscription.pair_code,
                    window_start_ms = window_start,
                    window_end_ms = window_end,
                    "failed to compute trade window coverage after backfill"
                );
            }
        }

        if let Err(error) = self
            .publish_data_readiness_for_pair_if_due(&subscription.pair_code, true)
            .await
        {
            tracing::warn!(
                ?error,
                pair_code = %subscription.pair_code,
                "failed to publish final trade data-readiness update"
            );
        }

        Ok(())
    }

    async fn repair_trade_gaps_for_pair(
        &self,
        subscription: &PairStreamSubscription,
        window_start: i64,
        window_end: i64,
        max_batch_rows: usize,
        max_batches: usize,
        _required_period_ms: i64,
    ) -> Result<()> {
        const MAX_REPAIR_ROUNDS: usize = 3;

        for round in 1..=MAX_REPAIR_ROUNDS {
            let gaps = self
                .inner
                .database
                .aggregate_trade_id_gaps_in_range(
                    &subscription.pair_code,
                    window_start,
                    window_end,
                    500,
                )
                .await?;

            if gaps.is_empty() {
                tracing::info!(
                    table = "market_data_trades",
                    pair_code = %subscription.pair_code,
                    window_start_ms = window_start,
                    window_end_ms = window_end,
                    round = round,
                    "trade gap-repair pass found no gaps"
                );
                break;
            }

            tracing::warn!(
                table = "market_data_trades",
                pair_code = %subscription.pair_code,
                window_start_ms = window_start,
                window_end_ms = window_end,
                round = round,
                gap_count = gaps.len(),
                "trade gap-repair pass detected gaps; refilling"
            );

            for (gap_index, gap) in gaps.into_iter().enumerate() {
                tracing::warn!(
                    table = "market_data_trades",
                    pair_code = %subscription.pair_code,
                    window_start_ms = window_start,
                    window_end_ms = window_end,
                    round = round,
                    gap_index = gap_index + 1,
                    previous_aggregate_trade_id = gap.previous_aggregate_trade_id,
                    next_aggregate_trade_id = gap.next_aggregate_trade_id,
                    missing_aggregate_trade_count = gap.missing_aggregate_trade_count,
                    gap_start_ms = gap.start_time,
                    gap_end_ms = gap.end_time,
                    gap_ms = gap.gap_ms,
                    "trade gap-repair refilling missing aggregate-trade-id span"
                );
                let required_batches_for_gap = gap
                    .missing_aggregate_trade_count
                    .saturating_add(max_batch_rows as i64)
                    .saturating_sub(1)
                    .saturating_div(max_batch_rows.max(1) as i64)
                    .saturating_add(5) as usize;
                self.backfill_pair_trades_for_aggregate_gap(
                    subscription,
                    &gap,
                    max_batch_rows,
                    max_batches
                        .saturating_mul(10)
                        .max(required_batches_for_gap),
                )
                .await?;
            }
        }

        Ok(())
    }

    async fn backfill_pair_trades_for_aggregate_gap(
        &self,
        subscription: &PairStreamSubscription,
        gap: &AggregateTradeIdGap,
        max_batch_rows: usize,
        max_batches: usize,
    ) -> Result<()> {
        let mut next_from_id = gap.previous_aggregate_trade_id.saturating_add(1);
        let mut batches_used = 0usize;
        let mut buffered_events = Vec::new();
        let insert_batch_rows = self
            .inner
            .config
            .historical_trade_backfill_insert_batch_rows
            .max(max_batch_rows);
        let started_at = Instant::now();
        let mut total_rows_in_binance_responses = 0usize;
        let mut total_rows_accepted = 0usize;
        let mut total_rows_flushed_to_clickhouse = 0usize;

        while next_from_id < gap.next_aggregate_trade_id && batches_used < max_batches {
            let rows = self
                .fetch_binance_json::<Vec<Value>>(
                    "/api/v3/aggTrades",
                    &trade_backfill_params(
                        &subscription.symbol,
                        max_batch_rows,
                        gap.start_time,
                        Some(next_from_id),
                    ),
                )
                .await?;
            if rows.is_empty() {
                break;
            }

            total_rows_in_binance_responses =
                total_rows_in_binance_responses.saturating_add(rows.len());
            let mut last_seen_aggregate_trade_id = None;
            let mut accepted_this_page = 0usize;

            for row in rows {
                let event =
                    normalize_rest_trade(subscription, row, &self.inner.config.service_name)?;
                last_seen_aggregate_trade_id = Some(event.aggregate_trade_id);

                if event.aggregate_trade_id <= gap.previous_aggregate_trade_id {
                    continue;
                }
                if event.aggregate_trade_id >= gap.next_aggregate_trade_id {
                    break;
                }

                accepted_this_page = accepted_this_page.saturating_add(1);
                buffered_events.push(event);

                if buffered_events.len() >= insert_batch_rows {
                    let inserted_rows = self
                        .inner
                        .database
                        .insert_new_trades_batch(
                            &buffered_events,
                            self.inner
                                .config
                                .historical_trade_backfill_use_rowbinary_insert,
                        )
                        .await?;
                    total_rows_flushed_to_clickhouse = total_rows_flushed_to_clickhouse
                        .saturating_add(inserted_rows);
                    buffered_events.clear();
                    if let Err(error) = self
                        .publish_data_readiness_for_pair_if_due(&subscription.pair_code, false)
                        .await
                    {
                        tracing::warn!(
                            ?error,
                            pair_code = %subscription.pair_code,
                            "failed to publish in-progress trade gap-repair data-readiness update"
                        );
                    }
                }
            }

            total_rows_accepted = total_rows_accepted.saturating_add(accepted_this_page);
            batches_used = batches_used.saturating_add(1);

            match last_seen_aggregate_trade_id {
                Some(last_seen) if last_seen >= gap.next_aggregate_trade_id.saturating_sub(1) => {
                    break;
                }
                Some(last_seen) if last_seen.saturating_add(1) > next_from_id => {
                    next_from_id = last_seen.saturating_add(1);
                }
                _ => break,
            }
        }

        if !buffered_events.is_empty() {
            let inserted_rows = self
                .inner
                .database
                .insert_new_trades_batch(
                    &buffered_events,
                    self.inner
                        .config
                        .historical_trade_backfill_use_rowbinary_insert,
                )
                .await?;
            total_rows_flushed_to_clickhouse =
                total_rows_flushed_to_clickhouse.saturating_add(inserted_rows);
            if let Err(error) = self
                .publish_data_readiness_for_pair_if_due(&subscription.pair_code, false)
                .await
            {
                tracing::warn!(
                    ?error,
                    pair_code = %subscription.pair_code,
                    "failed to publish in-progress trade gap-repair data-readiness update"
                );
            }
        }

        tracing::info!(
            table = "market_data_trades",
            pair_code = %subscription.pair_code,
            previous_aggregate_trade_id = gap.previous_aggregate_trade_id,
            next_aggregate_trade_id = gap.next_aggregate_trade_id,
            missing_aggregate_trade_count = gap.missing_aggregate_trade_count,
            total_rows_in_binance_responses,
            total_rows_accepted,
            total_rows_flushed_to_clickhouse,
            batches_used,
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            "trade gap-repair finished aggregate-trade-id refill attempt"
        );

        Ok(())
    }

    async fn backfill_pair_trades_for_chunk(
        &self,
        subscription: PairStreamSubscription,
        chunk_start_ms: i64,
        chunk_end_ms: i64,
        max_batch_rows: usize,
        max_batches: usize,
    ) -> Result<()> {
        let mut next_start = chunk_start_ms.max(0);
        let mut next_from_id: Option<i64> = None;
        let mut batches_used = 0usize;
        let mut buffered_events = Vec::new();
        let insert_batch_rows = self
            .inner
            .config
            .historical_trade_backfill_insert_batch_rows
            .max(max_batch_rows);

        let chunk_retrieval_started_at = Instant::now();
        let chunk_span_ms = chunk_end_ms.saturating_sub(chunk_start_ms).max(1) as f64;

        let mut binance_pages_fetched = 0usize;
        let mut total_rows_in_binance_responses = 0usize;
        let mut total_rows_accepted_in_chunk = 0usize;
        let mut total_rows_flushed_to_clickhouse = 0usize;

        tracing::info!(
            table = "market_data_trades",
            pair_code = %subscription.pair_code,
            chunk_start_ms,
            chunk_end_ms,
            binance_page_row_limit = max_batch_rows,
            clickhouse_insert_batch_rows_target = insert_batch_rows,
            max_binance_pages_per_chunk = max_batches,
            "historical trade backfill chunk started (Binance fetch + ClickHouse batching)"
        );

        while next_start < chunk_end_ms {
            let rows = self
                .fetch_binance_json::<Vec<Value>>(
                    "/api/v3/aggTrades",
                    &trade_backfill_params(
                        &subscription.symbol,
                        max_batch_rows,
                        next_start,
                        next_from_id,
                    ),
                )
                .await?;
            if rows.is_empty() {
                tracing::info!(
                    table = "market_data_trades",
                    pair_code = %subscription.pair_code,
                    chunk_start_ms,
                    chunk_end_ms,
                    binance_pages_fetched,
                    next_start_ms = next_start,
                    elapsed_ms = chunk_retrieval_started_at.elapsed().as_millis() as u64,
                    "historical trade backfill chunk reached empty Binance page"
                );
                break;
            }
            let row_count = rows.len();
            binance_pages_fetched = binance_pages_fetched.saturating_add(1);
            total_rows_in_binance_responses =
                total_rows_in_binance_responses.saturating_add(row_count);

            let mut first_trade_time_ms: Option<i64> = None;
            let mut last_trade_time_ms: Option<i64> = None;
            let mut last_trade_time_seen_in_page: Option<i64> = None;
            let mut last_aggregate_trade_id_seen_in_page: Option<i64> = None;
            let mut accepted_this_page = 0usize;
            for row in rows {
                let event =
                    normalize_rest_trade(&subscription, row, &self.inner.config.service_name)?;
                last_trade_time_seen_in_page = Some(event.trade_time);
                last_aggregate_trade_id_seen_in_page = Some(event.aggregate_trade_id);
                if event.trade_time < chunk_start_ms || event.trade_time >= chunk_end_ms {
                    // Skip trades outside this chunk; they will be handled by
                    // neighboring chunks if needed.
                    continue;
                }
                if first_trade_time_ms.is_none() {
                    first_trade_time_ms = Some(event.trade_time);
                }
                last_trade_time_ms = Some(event.trade_time);
                accepted_this_page = accepted_this_page.saturating_add(1);
                // Buffer backfill trades and flush to ClickHouse in larger
                // batches to reduce part counts and improve insert efficiency.
                buffered_events.push(event);
                if buffered_events.len() >= insert_batch_rows {
                    let flush_rows = buffered_events.len();
                    let flush_started = Instant::now();
                    let inserted_rows = self
                        .inner
                        .database
                        .insert_new_trades_batch(
                            &buffered_events,
                            self.inner
                                .config
                                .historical_trade_backfill_use_rowbinary_insert,
                        )
                        .await?;
                    let flush_ms = flush_started.elapsed().as_millis() as u64;
                    total_rows_flushed_to_clickhouse =
                        total_rows_flushed_to_clickhouse.saturating_add(inserted_rows);
                    let flush_rows_per_sec = if flush_ms > 0 {
                        (inserted_rows as u128)
                            .saturating_mul(1000)
                            .saturating_div(flush_ms as u128) as u64
                    } else {
                        0
                    };
                    tracing::info!(
                        table = "market_data_trades",
                        pair_code = %subscription.pair_code,
                        chunk_start_ms,
                        chunk_end_ms,
                        rows_buffered_this_flush = flush_rows,
                        rows_inserted_this_flush = inserted_rows,
                        skipped_duplicate_rows = flush_rows.saturating_sub(inserted_rows),
                        clickhouse_insert_batch_rows_target = insert_batch_rows,
                        total_rows_flushed_to_clickhouse,
                        pending_buffer_rows = 0usize,
                        binance_pages_fetched,
                        flush_duration_ms = flush_ms,
                        flush_rows_per_sec,
                        elapsed_chunk_ms = chunk_retrieval_started_at.elapsed().as_millis() as u64,
                        "historical trade backfill ClickHouse insert progress"
                    );
                    buffered_events.clear();
                    if let Err(error) = self
                        .publish_data_readiness_for_pair_if_due(&subscription.pair_code, false)
                        .await
                    {
                        tracing::warn!(
                            ?error,
                            pair_code = %subscription.pair_code,
                            "failed to publish in-progress trade data-readiness update"
                        );
                    }
                }
            }

            total_rows_accepted_in_chunk =
                total_rows_accepted_in_chunk.saturating_add(accepted_this_page);

            if let Some(last_aggregate_trade_id) = last_aggregate_trade_id_seen_in_page {
                next_from_id = Some(last_aggregate_trade_id.saturating_add(1));
            }

            let progressed_ms = last_trade_time_ms
                .unwrap_or(next_start)
                .saturating_sub(chunk_start_ms)
                .clamp(0, chunk_end_ms.saturating_sub(chunk_start_ms))
                as f64;
            let chunk_time_progress_percent = (progressed_ms / chunk_span_ms) * 100.0;

            // Readable logs: first page, every 5 pages, short/partial Binance page.
            if binance_pages_fetched == 1
                || binance_pages_fetched % 5 == 0
                || row_count < max_batch_rows
            {
                tracing::info!(
                    table = "market_data_trades",
                    pair_code = %subscription.pair_code,
                    chunk_start_ms,
                    chunk_end_ms,
                    binance_page = binance_pages_fetched,
                    binance_response_rows = row_count,
                    binance_rows_accepted_this_page = accepted_this_page,
                    total_rows_in_binance_responses,
                    total_rows_accepted_in_chunk,
                    pending_buffer_rows = buffered_events.len(),
                    total_rows_flushed_to_clickhouse,
                    first_trade_time_ms = first_trade_time_ms,
                    last_trade_time_ms = last_trade_time_ms,
                    next_start_ms_before_advance = next_start,
                    chunk_time_progress_percent,
                    batches_used_so_far = batches_used.saturating_add(1),
                    max_batches,
                    elapsed_chunk_ms = chunk_retrieval_started_at.elapsed().as_millis() as u64,
                    "historical trade backfill Binance fetch progress"
                );
            }

            batches_used = batches_used.saturating_add(1);
            if let Some(last_time_seen) = last_trade_time_seen_in_page
                && last_time_seen >= chunk_end_ms
            {
                break;
            } else if let Some(last_time) = last_trade_time_ms {
                // Advance to just after the last trade we saw, but never past
                // the chunk end.
                let advanced = last_time.saturating_add(1);
                if advanced <= next_start {
                    // No progress; nudge forward slightly to avoid a tight loop.
                    next_start = next_start.saturating_add(1000);
                } else {
                    next_start = advanced;
                }
            } else {
                // No trades within chunk in this batch; move forward by a small step.
                next_start = next_start.saturating_add(60_000);
                next_from_id = None;
            }
        }

        // Flush any remaining buffered events for this chunk.
        if !buffered_events.is_empty() {
            let flush_rows = buffered_events.len();
            let flush_started = Instant::now();
            let inserted_rows = self
                .inner
                .database
                .insert_new_trades_batch(
                    &buffered_events,
                    self.inner
                        .config
                        .historical_trade_backfill_use_rowbinary_insert,
                )
                .await?;
            let flush_ms = flush_started.elapsed().as_millis() as u64;
            total_rows_flushed_to_clickhouse =
                total_rows_flushed_to_clickhouse.saturating_add(inserted_rows);
            let flush_rows_per_sec = if flush_ms > 0 {
                (inserted_rows as u128)
                    .saturating_mul(1000)
                    .saturating_div(flush_ms as u128) as u64
            } else {
                0
            };
            tracing::info!(
                table = "market_data_trades",
                pair_code = %subscription.pair_code,
                chunk_start_ms,
                chunk_end_ms,
                rows_buffered_this_flush = flush_rows,
                rows_inserted_this_flush = inserted_rows,
                skipped_duplicate_rows = flush_rows.saturating_sub(inserted_rows),
                clickhouse_insert_batch_rows_target = insert_batch_rows,
                total_rows_flushed_to_clickhouse,
                flush_duration_ms = flush_ms,
                flush_rows_per_sec,
                binance_pages_fetched,
                elapsed_chunk_ms = chunk_retrieval_started_at.elapsed().as_millis() as u64,
                "historical trade backfill final ClickHouse insert progress"
            );
            if let Err(error) = self
                .publish_data_readiness_for_pair_if_due(&subscription.pair_code, false)
                .await
            {
                tracing::warn!(
                    ?error,
                    pair_code = %subscription.pair_code,
                    "failed to publish in-progress trade data-readiness update"
                );
            }
        }

        tracing::info!(
            table = "market_data_trades",
            pair_code = %subscription.pair_code,
            chunk_start_ms,
            chunk_end_ms,
            binance_pages_fetched,
            total_rows_in_binance_responses,
            total_rows_accepted_in_chunk,
            total_rows_flushed_to_clickhouse,
            batches_used,
            elapsed_chunk_ms = chunk_retrieval_started_at.elapsed().as_millis() as u64,
            "historical trade backfill chunk finished"
        );

        Ok(())
    }

    async fn fetch_binance_json<T>(&self, path: &str, query: &[(&str, String)]) -> Result<T>
    where
        T: DeserializeOwned,
    {
        let url = format!("{}{}", self.inner.config.binance_rest_base_url, path);
        let mut backoff_ms = self.inner.config.binance_rest_retry_backoff_ms;
        let request_weight = binance_request_weight_for_path(path, query);
        let limit_weight_1m = self
            .inner
            .config
            .binance_rest_request_weight_limit_per_minute;
        let target_weight_1m = compute_target_weight_1m(
            limit_weight_1m,
            self.inner.config.binance_rest_target_utilization_percent,
        );
        let warn_weight_1m = compute_warn_weight_1m(
            limit_weight_1m,
            self.inner.config.binance_rest_warn_utilization_percent,
        );

        for attempt in 0..=self.inner.config.binance_rest_max_retries {
            self.inner
                .binance_weight_limiter
                .acquire(request_weight, target_weight_1m, &self.inner.metrics, path)
                .await;
            let response = self.inner.http_client.get(&url).query(query).send().await?;
            let status = response.status();
            let used_weight_1m = parse_used_weight_1m(response.headers());

            if let Some(observation) = self
                .inner
                .binance_weight_limiter
                .observe_response(
                    used_weight_1m,
                    limit_weight_1m,
                    target_weight_1m,
                    warn_weight_1m,
                    &self.inner.metrics,
                )
                .await
            {
                tracing::warn!(
                    path,
                    used_weight_1m = observation.effective_used_weight_1m,
                    warn_weight_1m = observation.warn_weight_1m,
                    target_weight_1m = observation.target_weight_1m,
                    limit_weight_1m = observation.limit_weight_1m,
                    current_window_minute = observation.current_window_minute,
                    "Binance REQUEST_WEIGHT usage is approaching the configured minute ceiling"
                );
            }

            if status.is_success() {
                self.inner
                    .metrics
                    .binance_rest_requests_total
                    .with_label_values(&[path, "success"])
                    .inc();
                return Ok(response.json::<T>().await?);
            }

            let retry_after_ms = response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .map(|seconds| seconds.saturating_mul(1000));
            let body = response.text().await.unwrap_or_default();
            let should_retry = status == StatusCode::TOO_MANY_REQUESTS
                || status.is_server_error()
                || status.as_u16() == 418;

            if status == StatusCode::TOO_MANY_REQUESTS || status.as_u16() == 418 {
                self.inner
                    .metrics
                    .binance_rest_rate_limit_responses_total
                    .with_label_values(&[path, status.as_str()])
                    .inc();
            }

            if should_retry && attempt < self.inner.config.binance_rest_max_retries {
                self.inner
                    .metrics
                    .binance_rest_requests_total
                    .with_label_values(&[path, "retry"])
                    .inc();
                tracing::warn!(
                    path,
                    status = %status,
                    attempt,
                    max_retries = self.inner.config.binance_rest_max_retries,
                    request_weight,
                    retry_after_ms,
                    used_weight_1m,
                    body,
                    "Binance REST request failed; backing off before retry"
                );
                tokio::time::sleep(Duration::from_millis(retry_after_ms.unwrap_or(backoff_ms)))
                    .await;
                backoff_ms = backoff_ms.saturating_mul(2);
                continue;
            }

            self.inner
                .metrics
                .binance_rest_requests_total
                .with_label_values(&[path, "error"])
                .inc();

            return Err(anyhow::anyhow!(
                "Binance REST {} failed with status {}: {}",
                path,
                status,
                body
            ));
        }

        unreachable!("retry loop should have returned on success or terminal failure");
    }

    async fn fetch_first_agg_trade_in_window(
        &self,
        symbol: &str,
        start_time: i64,
        end_time: i64,
    ) -> Result<Option<BinanceAggTradeBoundaryRow>> {
        if end_time <= start_time {
            return Ok(None);
        }

        let rows = self
            .fetch_binance_json::<Vec<BinanceAggTradeBoundaryRow>>(
                "/api/v3/aggTrades",
                &[
                    ("symbol", symbol.to_string()),
                    ("startTime", start_time.to_string()),
                    ("endTime", end_time.saturating_sub(1).to_string()),
                    ("limit", "1".to_string()),
                ],
            )
            .await?;

        Ok(rows.into_iter().next())
    }

    async fn fetch_last_agg_trade_in_window(
        &self,
        symbol: &str,
        start_time: i64,
        end_time: i64,
    ) -> Result<Option<BinanceAggTradeBoundaryRow>> {
        if end_time <= start_time {
            return Ok(None);
        }

        let mut low = start_time;
        let mut high = end_time.saturating_sub(1);
        let mut best: Option<BinanceAggTradeBoundaryRow> = None;

        while low <= high {
            let mid = low + (high.saturating_sub(low) / 2);
            match self
                .fetch_first_agg_trade_in_window(symbol, mid, end_time)
                .await?
            {
                Some(candidate) => {
                    best = Some(candidate.clone());
                    let next_low = candidate.trade_time.max(mid).saturating_add(1);
                    if next_low <= low {
                        break;
                    }
                    low = next_low;
                }
                None => {
                    if mid == 0 {
                        break;
                    }
                    high = mid.saturating_sub(1);
                }
            }
        }

        let Some(best_trade) = best else {
            return Ok(None);
        };

        let mut last_trade = best_trade.clone();
        let mut next_from_id = best_trade.aggregate_trade_id;

        loop {
            let rows = self
                .fetch_binance_json::<Vec<BinanceAggTradeBoundaryRow>>(
                    "/api/v3/aggTrades",
                    &[
                        ("symbol", symbol.to_string()),
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

    async fn fetch_true_trade_window_boundaries(
        &self,
        symbol: &str,
        start_time: i64,
        end_time: i64,
    ) -> Result<Option<TrueTradeWindowBoundaries>> {
        let first = self
            .fetch_first_agg_trade_in_window(symbol, start_time, end_time)
            .await?;
        let last = self
            .fetch_last_agg_trade_in_window(symbol, start_time, end_time)
            .await?;

        match (first, last) {
            (Some(first_row), Some(last_row))
                if last_row.aggregate_trade_id >= first_row.aggregate_trade_id =>
            {
                Ok(Some(TrueTradeWindowBoundaries {
                    first_aggregate_trade_id: first_row.aggregate_trade_id,
                    last_aggregate_trade_id: last_row.aggregate_trade_id,
                    first_trade_time: first_row.trade_time,
                    last_trade_time: last_row.trade_time,
                }))
            }
            _ => Ok(None),
        }
    }

    async fn mark_kafka_consumer(&self, connected: bool, error: Option<String>) {
        self.inner
            .metrics
            .kafka_consumer_connected
            .set(if connected { 1 } else { 0 });
        let mut status = self.inner.runtime_status.write().await;
        status.kafka.consumer_connected = connected;
        if let Some(error) = error {
            status.kafka.last_error = Some(error);
        }
    }

}

fn map_dimension(
    coverage: &crate::db::WindowCoverage,
    latest_time: Option<i64>,
    missing_count: u64,
    expected_row_count: u64,
) -> ReadinessDimension {
    let complete = coverage.row_count > 0 && missing_count == 0;
    let coverage_percent = if coverage.row_count == 0 || expected_row_count == 0 {
        0.0
    } else {
        ((coverage.row_count.min(expected_row_count) as f64 / expected_row_count as f64) * 100.0)
            .clamp(0.0, 100.0)
    };

    ReadinessDimension {
        row_count: coverage.row_count,
        min_time: coverage.min_time,
        max_time: coverage.max_time,
        latest_time,
        missing_count,
        complete,
        coverage_percent,
    }
}

fn map_trade_dimension(
    coverage: &crate::db::WindowCoverage,
    latest_time: Option<i64>,
    missing_count: u64,
    tolerance_ms: i64,
    aggregate_trade_id_coverage: &crate::db::AggregateTradeIdCoverage,
    true_boundaries: Option<TrueTradeWindowBoundaries>,
) -> ReadinessDimension {
    let edge_ready = match (coverage.min_time, coverage.max_time, true_boundaries) {
        (Some(min_t), Some(max_t), Some(boundaries)) => {
            let latest_acceptable_min = boundaries.first_trade_time.saturating_add(tolerance_ms);
            let earliest_acceptable_max = boundaries
                .last_trade_time
                .saturating_sub(tolerance_ms);
            min_t <= latest_acceptable_min && max_t >= earliest_acceptable_max
        }
        _ => false,
    };
    let expected_trade_count = match true_boundaries {
        Some(boundaries)
            if boundaries.last_aggregate_trade_id >= boundaries.first_aggregate_trade_id =>
        {
            boundaries
                .last_aggregate_trade_id
                .saturating_sub(boundaries.first_aggregate_trade_id)
                .saturating_add(1)
        }
        _ => 0,
    };
    let present_trade_count = expected_trade_count
        .saturating_sub(missing_count as i64)
        .max(0) as u64;
    let complete = coverage.row_count > 0 && edge_ready && missing_count == 0;
    let coverage_percent = if coverage.row_count == 0 || expected_trade_count <= 0 {
        0.0
    } else {
        ((present_trade_count.min(expected_trade_count as u64) as f64) / expected_trade_count as f64
            * 100.0)
            .clamp(0.0, 100.0)
    };

    ReadinessDimension {
        row_count: aggregate_trade_id_coverage
            .distinct_trade_count
            .max(coverage.row_count),
        min_time: coverage.min_time,
        max_time: coverage.max_time,
        latest_time,
        missing_count,
        complete,
        coverage_percent,
    }
}

fn exact_candle_count_exclusive(start_time: i64, end_time: i64, period_ms: i64) -> Result<u64> {
    if period_ms <= 0 {
        anyhow::bail!("period_ms must be greater than zero");
    }
    if end_time <= start_time {
        return Ok(0);
    }

    let span_ms = end_time.saturating_sub(start_time);
    Ok(span_ms.div_euclid(period_ms) as u64)
}

fn kline_coverage_complete(
    required_klines: u64,
    coverage: &crate::db::WindowCoverage,
    missing_count: u64,
) -> bool {
    coverage.row_count >= required_klines && missing_count == 0
}

fn missing_kline_count(
    coverage: &crate::db::WindowCoverage,
    required_klines: u64,
) -> u64 {
    let present_count = coverage.row_count.min(required_klines);
    required_klines.saturating_sub(present_count)
}

fn missing_trade_count(
    coverage: &crate::db::WindowCoverage,
    aggregate_trade_id_coverage: &crate::db::AggregateTradeIdCoverage,
    true_boundaries: Option<TrueTradeWindowBoundaries>,
) -> u64 {
    let expected_trade_count = match true_boundaries {
        Some(boundaries)
            if boundaries.last_aggregate_trade_id >= boundaries.first_aggregate_trade_id =>
        {
            boundaries
                .last_aggregate_trade_id
                .saturating_sub(boundaries.first_aggregate_trade_id)
                .saturating_add(1) as u64
        }
        _ => 0,
    };
    let present_trade_count = aggregate_trade_id_coverage
        .distinct_trade_count
        .max(coverage.row_count);
    expected_trade_count.saturating_sub(present_trade_count)
}

fn trade_backfill_params(
    symbol: &str,
    max_batch_rows: usize,
    next_start: i64,
    next_from_id: Option<i64>,
) -> Vec<(&'static str, String)> {
    let mut params = vec![
        ("symbol", symbol.to_string()),
        ("limit", max_batch_rows.to_string()),
    ];
    if let Some(from_id) = next_from_id {
        params.push(("fromId", from_id.to_string()));
    } else {
        params.push(("startTime", next_start.to_string()));
    }
    params
}

#[cfg(test)]
mod tests {
    use super::MarketDataService;
    use crate::db::{TimeGap, TimeInterval};

    #[test]
    fn covered_intervals_from_missing_ranges_inverts_gaps() {
        let gaps = vec![
            TimeGap {
                start_time: 100,
                end_time: 105,
                gap_ms: 5,
            },
            TimeGap {
                start_time: 200,
                end_time: 250,
                gap_ms: 50,
            },
        ];

        let covered = MarketDataService::covered_intervals_from_missing_ranges(0, 300, &gaps);

        assert_eq!(
            covered,
            vec![
                TimeInterval {
                    start_time: 0,
                    end_time: 100,
                },
                TimeInterval {
                    start_time: 105,
                    end_time: 200,
                },
                TimeInterval {
                    start_time: 250,
                    end_time: 300,
                },
            ]
        );
    }

    #[test]
    fn replace_coverage_window_replaces_only_requested_slice() {
        let existing = vec![
            TimeInterval {
                start_time: 0,
                end_time: 100,
            },
            TimeInterval {
                start_time: 200,
                end_time: 300,
            },
        ];
        let replacement = vec![TimeInterval {
            start_time: 120,
            end_time: 180,
        }];

        let merged = MarketDataService::replace_coverage_window(existing, 50, 250, replacement);

        assert_eq!(
            merged,
            vec![
                TimeInterval {
                    start_time: 0,
                    end_time: 50,
                },
                TimeInterval {
                    start_time: 120,
                    end_time: 180,
                },
                TimeInterval {
                    start_time: 250,
                    end_time: 300,
                },
            ]
        );
    }
}
