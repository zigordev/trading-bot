use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
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
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};
use uuid::Uuid;

use crate::{
    config::AppConfig,
    db::{Database, TimeGap},
    events::{NormalizedWsEvent, normalize_rest_kline, normalize_rest_trade, normalize_ws_message},
    kafka_topics::ensure_topics,
    metrics::Metrics,
    models::{
        ActiveSubscriptions, KlineSubscription, NormalizedKlineEvent, PairStreamSubscription,
        PersistedKlineRecord, PersistedTradeRecord, ResolvedAnalysisSettingsRecord,
    },
    subscriptions::{
        derive_active_subscriptions, should_refresh_for_config_resource, to_binance_symbol,
    },
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
    current_readiness_targets: RwLock<HashMap<(String, String, String), DataReadinessTarget>>,
    trade_window_boundaries_cache:
        RwLock<HashMap<(String, i64, i64), Option<TrueTradeWindowBoundaries>>>,
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
pub struct KlineReadinessDimension {
    pub timeframe_code: String,
    #[serde(flatten)]
    pub dimension: ReadinessDimension,
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
    pub kline_dimensions: Vec<KlineReadinessDimension>,
    pub trades: ReadinessDimension,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DataReadinessSnapshotItem {
    status: String,
    pair_code: String,
    timeframe_code: String,
    strategy_name: String,
    analysis_setting_ids: Vec<String>,
    requested_start_time: i64,
    requested_end_time: i64,
    required_history_ms: i64,
    details: Option<String>,
    kline: ReadinessDimension,
    kline_dimensions: Vec<KlineReadinessDimension>,
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
    strategy_name: String,
    analysis_setting_ids: Vec<String>,
    requested_start_time: i64,
    requested_end_time: i64,
    required_history_ms: i64,
    kline_requirements: Vec<DataReadinessKlineRequirement>,
}

#[derive(Clone, Debug)]
struct DataReadinessKlineRequirement {
    timeframe_code: String,
    period_ms: i64,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AggregateTradeIdRange {
    start_id: i64,
    end_id_exclusive: i64,
}

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
                &config.market_data_kline_events_topic,
                &config.market_data_trade_events_topic,
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
            trade_window_boundaries_cache: RwLock::new(HashMap::new()),
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

        let stream_service = self.clone();
        let stream_handle = tokio::spawn(async move {
            stream_service.market_stream_loop().await;
        });

        let mut handles = self.inner.task_handles.lock().await;
        handles.extend([
            startup_refresh_handle,
            refresh_handle,
            consumer_handle,
            periodic_handle,
            stream_handle,
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
        self.inner.metrics.encode()
    }

    pub async fn readiness(&self) -> ReadinessPayload {
        let db_ok = self.inner.database.ping().await.is_ok();
        self.inner
            .metrics
            .database_connected
            .set(if db_ok { 1 } else { 0 });

        let status = self.inner.runtime_status.read().await.clone();
        let runtime_config_max_age_ms =
            (self.inner.config.readiness_max_config_age_ms as i64).max(2 * 60 * 60 * 1000);
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
        let market_stream = if status.stream.connected {
            "up"
        } else {
            "down"
        };
        let database = if db_ok { "up" } else { "down" };
        let status_text = if runtime_config == "up"
            && kafka_producer == "up"
            && kafka_consumer == "up"
            && market_stream == "up"
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
            &[DataReadinessKlineRequirement {
                timeframe_code: timeframe_code.to_string(),
                period_ms,
            }],
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
        kline_requirements: &[DataReadinessKlineRequirement],
        required_history_ms: i64,
    ) -> Result<BacktestDataReadiness> {
        let primary_period_ms = kline_requirements
            .iter()
            .find(|requirement| requirement.timeframe_code == timeframe_code)
            .map(|requirement| requirement.period_ms)
            .or_else(|| {
                kline_requirements
                    .first()
                    .map(|requirement| requirement.period_ms)
            })
            .unwrap_or(60_000);
        let kline_start_time = requested_end_time.saturating_sub(required_history_ms.max(1));
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
            .fetch_true_trade_window_boundaries_cached(
                &binance_symbol,
                requested_start_time,
                requested_end_time,
            )
            .await?;
        let trade_gap_threshold_ms = (primary_period_ms / 4).clamp(1_000, 60_000);
        let latest_trade = self
            .inner
            .database
            .latest_trade_checkpoint(pair_code)
            .await?;

        let mut kline_dimensions = Vec::with_capacity(kline_requirements.len());
        let mut aggregated_kline_rows = 0u64;
        let mut aggregated_missing_kline_count = 0u64;
        let mut all_kline_complete = true;
        let mut kline_min_time = None;
        let mut kline_max_time = None;
        let mut kline_latest_time = None;

        for requirement in kline_requirements {
            let kline_coverage = self
                .inner
                .database
                .kline_window_coverage_in_range(
                    pair_code,
                    &requirement.timeframe_code,
                    kline_start_time,
                    requested_end_time.saturating_sub(1),
                )
                .await?;
            let required_klines = exact_candle_count_exclusive(
                kline_start_time,
                requested_end_time,
                requirement.period_ms,
            )?;
            let missing_kline_count = missing_kline_count(&kline_coverage, required_klines);
            let dimension = map_dimension(
                &kline_coverage,
                kline_coverage.max_time,
                missing_kline_count,
                required_klines,
            );
            let complete =
                kline_coverage_complete(required_klines, &kline_coverage, missing_kline_count);
            aggregated_kline_rows = aggregated_kline_rows.saturating_add(dimension.row_count);
            aggregated_missing_kline_count =
                aggregated_missing_kline_count.saturating_add(dimension.missing_count);
            all_kline_complete &= complete;
            kline_min_time = min_option_i64(kline_min_time, dimension.min_time);
            kline_max_time = max_option_i64(kline_max_time, dimension.max_time);
            kline_latest_time = max_option_i64(kline_latest_time, dimension.latest_time);
            kline_dimensions.push((requirement, dimension, complete));
        }

        let per_timeframe_kline_dimensions = kline_dimensions
            .iter()
            .map(|(requirement, dimension, _)| KlineReadinessDimension {
                timeframe_code: requirement.timeframe_code.clone(),
                dimension: dimension.clone(),
            })
            .collect::<Vec<_>>();

        let kline = ReadinessDimension {
            row_count: aggregated_kline_rows,
            min_time: kline_min_time,
            max_time: kline_max_time,
            latest_time: kline_latest_time,
            missing_count: aggregated_missing_kline_count,
            complete: all_kline_complete,
            coverage_percent: if per_timeframe_kline_dimensions.is_empty() {
                0.0
            } else if all_kline_complete {
                100.0
            } else {
                kline_dimensions
                    .iter()
                    .map(|(_, dimension, _)| dimension.coverage_percent)
                    .fold(100.0, f64::min)
            },
        };
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

        let (status, details) = if kline.complete && trades.complete {
            ("ready".to_string(), None)
        } else if kline.row_count == 0 && trade_coverage.row_count == 0 {
            (
                "missing".to_string(),
                Some(
                    "no replay-grade dataset was found for this pair/timeframe window".to_string(),
                ),
            )
        } else {
            (
                "partial".to_string(),
                Some(if kline_requirements.len() > 1 {
                    format!(
                        "one or more replay inputs are incomplete for the requested window; required kline timeframes: {}",
                        kline_requirements
                            .iter()
                            .map(|requirement| requirement.timeframe_code.clone())
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                } else {
                    "one or more replay inputs are incomplete for the requested window".to_string()
                }),
            )
        };
        Ok(BacktestDataReadiness {
            status,
            details,
            pair_code: pair_code.to_string(),
            timeframe_code: timeframe_code.to_string(),
            start_time: requested_start_time,
            end_time: requested_end_time,
            period_ms: primary_period_ms,
            kline,
            kline_dimensions: per_timeframe_kline_dimensions,
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

    async fn market_stream_loop(&self) {
        let mut shutdown_rx = self.inner.shutdown_tx.subscribe();

        loop {
            let subscriptions = self.inner.runtime_status.read().await.subscriptions.clone();
            if subscriptions.stream_names.is_empty() {
                self.mark_stream(false, None, None, None).await;
                tokio::select! {
                    changed = shutdown_rx.changed() => {
                        if changed.is_ok() {
                            break;
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {}
                }
                continue;
            }

            let stream_names = subscriptions.stream_names.clone();
            let stream_signature = stream_names.join("/");
            let stream_url = format!(
                "{}/stream?streams={}",
                self.inner.config.binance_ws_base_url.trim_end_matches('/'),
                stream_signature
            );

            self.mark_stream(false, Some(stream_url.clone()), None, None)
                .await;

            let ws = connect_async(&stream_url).await;
            let (socket, _) = match ws {
                Ok(parts) => parts,
                Err(error) => {
                    self.mark_stream(
                        false,
                        Some(stream_url.clone()),
                        None,
                        Some(error.to_string()),
                    )
                    .await;
                    tokio::select! {
                        changed = shutdown_rx.changed() => {
                            if changed.is_ok() {
                                break;
                            }
                        }
                        _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                    }
                    continue;
                }
            };

            self.mark_stream(true, Some(stream_url.clone()), None, None)
                .await;

            let kline_by_stream = subscriptions
                .kline_subscriptions
                .iter()
                .cloned()
                .map(|subscription| (subscription.stream_name.to_lowercase(), subscription))
                .collect::<HashMap<_, _>>();
            let pair_by_stream = subscriptions
                .pair_subscriptions
                .iter()
                .cloned()
                .map(|subscription| (subscription.trade_stream_name.to_lowercase(), subscription))
                .collect::<HashMap<_, _>>();

            let (_, mut read) = socket.split();
            let mut subscription_check_interval = tokio::time::interval(Duration::from_secs(1));
            subscription_check_interval.set_missed_tick_behavior(MissedTickBehavior::Delay);

            loop {
                tokio::select! {
                    changed = shutdown_rx.changed() => {
                        if changed.is_ok() {
                            return;
                        }
                    }
                    _ = subscription_check_interval.tick() => {
                        let latest_signature = self.inner.runtime_status.read().await.subscriptions.stream_names.join("/");
                        if latest_signature != stream_signature {
                            break;
                        }
                    }
                    message = read.next() => {
                        match message {
                            Some(Ok(WsMessage::Text(text))) => {
                                let raw = text.to_string();
                                match normalize_ws_message(
                                    &raw,
                                    &kline_by_stream,
                                    &pair_by_stream,
                                    &self.inner.config.service_name,
                                ) {
                                    Ok(Some(event)) => {
                                        if let Err(error) = self.handle_live_ws_event(event).await {
                                            self.mark_stream(
                                                false,
                                                Some(stream_url.clone()),
                                                None,
                                                Some(error.to_string()),
                                            ).await;
                                            break;
                                        }
                                    }
                                    Ok(None) => {}
                                    Err(error) => {
                                        self.mark_stream(
                                            false,
                                            Some(stream_url.clone()),
                                            None,
                                            Some(error.to_string()),
                                        ).await;
                                        break;
                                    }
                                }
                            }
                            Some(Ok(WsMessage::Ping(_))) | Some(Ok(WsMessage::Pong(_))) => {}
                            Some(Ok(WsMessage::Binary(_))) => {}
                            Some(Ok(WsMessage::Frame(_))) => {}
                            Some(Ok(WsMessage::Close(frame))) => {
                                self.mark_stream(
                                    false,
                                    Some(stream_url.clone()),
                                    None,
                                    Some(format!("market stream closed: {frame:?}")),
                                ).await;
                                break;
                            }
                            Some(Err(error)) => {
                                self.mark_stream(
                                    false,
                                    Some(stream_url.clone()),
                                    None,
                                    Some(error.to_string()),
                                ).await;
                                break;
                            }
                            None => {
                                self.mark_stream(
                                    false,
                                    Some(stream_url.clone()),
                                    None,
                                    Some("market stream ended".to_string()),
                                ).await;
                                break;
                            }
                        }
                    }
                }
            }

            tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_ok() {
                        break;
                    }
                }
                _ = tokio::time::sleep(Duration::from_secs(1)) => {}
            }
        }
    }

    async fn handle_live_ws_event(&self, event: NormalizedWsEvent) -> Result<()> {
        match event {
            NormalizedWsEvent::Kline(event) => {
                self.inner.database.upsert_kline(&event).await?;
                self.publish_kline_event(&event).await?;
                self.inner.metrics.kline_publish_total.inc();
                self.mark_stream(true, None, Some(event.occurred_at.clone()), None)
                    .await;
            }
            NormalizedWsEvent::Trade(event) => {
                self.inner.database.upsert_trade(&event).await?;
                self.publish_trade_event(&event).await?;
                self.inner.metrics.trade_publish_total.inc();
                self.mark_stream(true, None, Some(event.occurred_at.clone()), None)
                    .await;
            }
        }
        Ok(())
    }

    async fn publish_kline_event(&self, event: &NormalizedKlineEvent) -> Result<()> {
        let payload = serde_json::to_string(event)?;
        self.inner
            .kafka_producer
            .send(
                FutureRecord::to(&self.inner.config.market_data_kline_events_topic)
                    .key(&event.event_id)
                    .payload(&payload),
                Duration::from_secs(5),
            )
            .await
            .map_err(|(error, _)| anyhow::anyhow!(error))
            .context("failed to publish market-data kline event")?;
        Ok(())
    }

    async fn publish_trade_event(&self, event: &crate::models::NormalizedTradeEvent) -> Result<()> {
        let payload = serde_json::to_string(event)?;
        self.inner
            .kafka_producer
            .send(
                FutureRecord::to(&self.inner.config.market_data_trade_events_topic)
                    .key(&event.event_id)
                    .payload(&payload),
                Duration::from_secs(5),
            )
            .await
            .map_err(|(error, _)| anyhow::anyhow!(error))
            .context("failed to publish market-data trade event")?;
        Ok(())
    }

    async fn mark_stream(
        &self,
        connected: bool,
        stream_url: Option<String>,
        last_message_at: Option<String>,
        error: Option<String>,
    ) {
        let mut status = self.inner.runtime_status.write().await;
        status.stream.connected = connected;
        if let Some(stream_url) = stream_url {
            status.stream.stream_url = Some(stream_url);
        }
        if let Some(last_message_at) = last_message_at {
            status.stream.last_message_at = Some(last_message_at);
        }
        status.stream.last_error = error;
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
                    (
                        target.pair_code.clone(),
                        target.timeframe_code.clone(),
                        target.strategy_name.clone(),
                    ),
                    target,
                )
            })
            .collect();
        self.inner
            .trade_window_boundaries_cache
            .write()
            .await
            .clear();
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

        let readiness_publish_handle =
            self.start_periodic_data_readiness_publish(records.clone(), reason.to_string());

        let refresh_result: Result<()> = async {
            self.run_backfill_and_gap_repair(&active, &required_history_plan)
                .await?;

            // Extra deep audit at startup: the existing backfill+repair pass is
            // anchored to a clamped "required lookback" window, which can leave
            // older leading gaps unfixed. The deep audit re-checks from the
            // earliest kline we have for each pair (bounded by config).
            if reason == "startup"
                && let Err(error) = self
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
            Ok(())
        }
        .await;

        if let Some((stop_tx, handle)) = readiness_publish_handle {
            let _ = stop_tx.send(());
            let _ = handle.await;
        }

        refresh_result?;

        if let Err(error) = self.publish_data_readiness_snapshot(&records).await {
            tracing::warn!(?error, reason, "failed to publish data-readiness snapshot");
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
        let mut grouped: HashMap<(String, String, String), DataReadinessTarget> = HashMap::new();

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
            let kline_requirements = Self::data_readiness_kline_requirements(
                record,
                self.inner.config.backtest_warmup_candles,
            );
            let warmup_ms = kline_requirements
                .iter()
                .map(|requirement| {
                    Self::required_warmup_candles(record, requirement.timeframe_code.as_str())
                        .saturating_mul(requirement.period_ms)
                })
                .max()
                .unwrap_or(record.timeframe.period_ms);
            let required_history_ms = configured_duration_ms.saturating_add(warmup_ms);
            let key = (
                record.symbol.clone(),
                record.timeframe_code.clone(),
                record.strategy_name.clone(),
            );

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
                    strategy_name: record.strategy_name.clone(),
                    analysis_setting_ids: vec![record.id.clone()],
                    requested_start_time: snapshot_end.saturating_sub(configured_duration_ms),
                    requested_end_time: snapshot_end,
                    required_history_ms,
                    kline_requirements,
                });
        }

        grouped.into_values().collect()
    }

    fn data_readiness_kline_requirements(
        record: &ResolvedAnalysisSettingsRecord,
        _default_backtest_warmup_candles: usize,
    ) -> Vec<DataReadinessKlineRequirement> {
        let mut requirements = vec![DataReadinessKlineRequirement {
            timeframe_code: record.timeframe_code.clone(),
            period_ms: record.timeframe.period_ms,
        }];

        let strategy_kind = record
            .strategy
            .parameters
            .as_object()
            .and_then(|parameters| parameters.get("kind"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_else(|| record.strategy_name.to_ascii_lowercase());

        if (strategy_kind == "strategy1" || strategy_kind == "strategy2")
            && !record.timeframe.longer_timeframe_code.is_empty()
            && record.timeframe.longer_timeframe_code != record.timeframe_code
        {
            let longer_period_ms = record
                .timeframe
                .period_ms
                .saturating_mul(record.timeframe.longer_timeframe_multiplier.max(1));
            requirements.push(DataReadinessKlineRequirement {
                timeframe_code: record.timeframe.longer_timeframe_code.clone(),
                period_ms: longer_period_ms,
            });
        }

        requirements
    }

    fn required_warmup_candles(
        record: &ResolvedAnalysisSettingsRecord,
        timeframe_code: &str,
    ) -> i64 {
        let default_warmup = 200i64;
        let strategy_kind = record
            .strategy
            .parameters
            .as_object()
            .and_then(|parameters| parameters.get("kind"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_else(|| record.strategy_name.to_ascii_lowercase());

        match strategy_kind.as_str() {
            "emacross" if timeframe_code == record.timeframe_code => record
                .technical_analysis_settings
                .as_object()
                .and_then(|settings| settings.get("slowPeriod"))
                .and_then(|value| json_usize(Some(value)))
                .map(|value| value as i64)
                .unwrap_or(21)
                .saturating_add(1)
                .max(default_warmup),
            "strategy1" | "strategy2" => 1000,
            _ => default_warmup,
        }
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
                strategy_name: target.strategy_name,
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
                kline_dimensions: target
                    .kline_requirements
                    .iter()
                    .map(|requirement| KlineReadinessDimension {
                        timeframe_code: requirement.timeframe_code.clone(),
                        dimension: ReadinessDimension {
                            row_count: 0,
                            min_time: None,
                            max_time: None,
                            latest_time: None,
                            missing_count: 0,
                            complete: false,
                            coverage_percent: 0.0,
                        },
                    })
                    .collect(),
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
                &target.kline_requirements,
                target.required_history_ms,
            )
            .await
        {
            Ok(readiness) => DataReadinessSnapshotItem {
                status: readiness.status,
                pair_code: readiness.pair_code,
                timeframe_code: readiness.timeframe_code,
                strategy_name: target.strategy_name,
                analysis_setting_ids: target.analysis_setting_ids,
                requested_start_time: target.requested_start_time,
                requested_end_time: target.requested_end_time,
                required_history_ms: target.required_history_ms,
                details: readiness.details,
                kline: readiness.kline,
                kline_dimensions: readiness.kline_dimensions,
                trades: readiness.trades,
            },
            Err(error) => DataReadinessSnapshotItem {
                status: "error".to_string(),
                pair_code: target.pair_code,
                timeframe_code: target.timeframe_code,
                strategy_name: target.strategy_name,
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
                kline_dimensions: target
                    .kline_requirements
                    .iter()
                    .map(|requirement| KlineReadinessDimension {
                        timeframe_code: requirement.timeframe_code.clone(),
                        dimension: ReadinessDimension {
                            row_count: 0,
                            min_time: None,
                            max_time: None,
                            latest_time: None,
                            missing_count: 0,
                            complete: false,
                            coverage_percent: 0.0,
                        },
                    })
                    .collect(),
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

    async fn publish_data_readiness_for_pair(&self, pair_code: &str) -> Result<()> {
        let targets: Vec<DataReadinessTarget> = self
            .inner
            .current_readiness_targets
            .read()
            .await
            .values()
            .filter(|target| target.pair_code == pair_code)
            .cloned()
            .collect();

        let mut items = Vec::with_capacity(targets.len());
        for target in targets {
            items.push(self.build_data_readiness_snapshot_item(target).await);
        }

        self.publish_data_readiness_items(&items).await
    }

    async fn publish_data_readiness_snapshot(
        &self,
        records: &[ResolvedAnalysisSettingsRecord],
    ) -> Result<()> {
        let targets = self.derive_data_readiness_targets(records);
        if targets.is_empty() {
            self.publish_data_readiness_items(&[]).await?;
            return Ok(());
        }

        let mut items = Vec::with_capacity(targets.len());
        for target in targets {
            let item = self.build_data_readiness_snapshot_item(target).await;
            items.push(item);
        }

        self.publish_data_readiness_items(&items).await?;
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
        Self::build_required_history_plan_from_settings(
            records,
            active,
            self.inner.config.historical_backfill_limit,
            &self.inner.config.backtesting_timerange_ms_by_timeframe,
            self.inner.config.backtest_kline_headroom_candles,
            self.inner.config.scheduled_backtest_history_headroom_ms,
            self.inner.config.backtest_warmup_candles,
            self.inner.config.trade_gap_repair_min_gap_ms,
        )
    }

    fn build_required_history_plan_from_settings(
        records: &[ResolvedAnalysisSettingsRecord],
        active: &ActiveSubscriptions,
        historical_backfill_limit: usize,
        backtesting_timerange_ms_by_timeframe: &BTreeMap<String, i64>,
        backtest_kline_headroom_candles: usize,
        scheduled_backtest_history_headroom_ms: u64,
        backtest_warmup_candles: usize,
        trade_gap_repair_min_gap_ms: u64,
    ) -> RequiredHistoryPlan {
        let mut kline_by_key: HashMap<(String, String), i64> = HashMap::new();
        let mut trade_by_pair_code: HashMap<String, i64> = HashMap::new();
        let mut trade_gap_threshold_by_pair_code: HashMap<String, i64> = HashMap::new();

        for subscription in &active.kline_subscriptions {
            let configured_duration_ms = Self::configured_backtest_duration_ms(
                backtesting_timerange_ms_by_timeframe,
                historical_backfill_limit,
                subscription.timeframe_code.as_str(),
                subscription.period_ms,
            );
            let kline_headroom_ms = (backtest_kline_headroom_candles as i64)
                .saturating_mul(subscription.period_ms.max(1));
            let required_kline_history_ms =
                configured_duration_ms.saturating_add(kline_headroom_ms);

            let key = (
                subscription.pair_code.clone(),
                subscription.timeframe_code.clone(),
            );
            kline_by_key
                .entry(key)
                .and_modify(|current| *current = (*current).max(required_kline_history_ms))
                .or_insert(required_kline_history_ms);
        }

        for record in records.iter().filter(|record| record.enabled) {
            let configured_duration_ms = Self::configured_backtest_duration_ms(
                backtesting_timerange_ms_by_timeframe,
                historical_backfill_limit,
                record.timeframe_code.as_str(),
                record.timeframe.period_ms,
            );
            let headroom_ms = scheduled_backtest_history_headroom_ms as i64;
            let required_trade_history_ms = configured_duration_ms.saturating_add(headroom_ms);
            let kline_requirements = Self::data_readiness_kline_requirements(
                record,
                backtest_warmup_candles,
            );
            let max_required_warmup_ms = kline_requirements
                .iter()
                .map(|requirement| {
                    Self::required_warmup_candles(record, requirement.timeframe_code.as_str())
                        .saturating_mul(requirement.period_ms.max(1))
                })
                .max()
                .unwrap_or(record.timeframe.period_ms.max(1));

            for requirement in kline_requirements {
                let kline_headroom_ms = (backtest_kline_headroom_candles as i64)
                    .saturating_mul(requirement.period_ms.max(1));
                let required_kline_history_ms = configured_duration_ms
                    .saturating_add(max_required_warmup_ms)
                    .saturating_add(kline_headroom_ms);
                let kline_key = (record.symbol.clone(), requirement.timeframe_code.clone());
                kline_by_key
                    .entry(kline_key)
                    .and_modify(|current| *current = (*current).max(required_kline_history_ms))
                    .or_insert(required_kline_history_ms);
            }

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
            let fallback_ms = (historical_backfill_limit as i64)
                .saturating_mul(subscription.period_ms.max(1));
            let required_ms = kline_by_key.get(&key).copied().unwrap_or(fallback_ms);
            kline_by_subscription_id.insert(subscription.subscription_id.clone(), required_ms);
            trade_gap_threshold_by_pair_code
                .entry(subscription.pair_code.clone())
                .and_modify(|current| *current = (*current).min(trade_gap_repair_min_gap_ms as i64))
                .or_insert(trade_gap_repair_min_gap_ms as i64);
        }

        RequiredHistoryPlan {
            kline_by_subscription_id,
            trade_by_pair_code,
            trade_gap_threshold_by_pair_code,
        }
    }

    fn configured_backtest_duration_ms(
        backtesting_timerange_ms_by_timeframe: &BTreeMap<String, i64>,
        historical_backfill_limit: usize,
        timeframe_code: &str,
        period_ms: i64,
    ) -> i64 {
        backtesting_timerange_ms_by_timeframe
            .get(timeframe_code)
            .copied()
            .unwrap_or_else(|| {
                (historical_backfill_limit as i64).saturating_mul(period_ms.max(1))
            })
            .max(period_ms.max(1))
    }

    async fn run_backfill_and_gap_repair(
        &self,
        active: &ActiveSubscriptions,
        required_history_plan: &RequiredHistoryPlan,
    ) -> Result<()> {
        let result: Result<()> = async {
            // Trade backfill anchors to the earliest persisted kline for each
            // pair. On an empty/stale store, run kline repair first so trade
            // backfill does not skip the current required window and fall
            // through to the much larger startup deep audit.
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
            .await?;
            Ok(())
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

                let missing_ranges = service
                    .missing_trade_id_ranges_for_pair(
                        &subscription.pair_code,
                        &subscription.symbol,
                        window_start_ms,
                        window_end_ms,
                    )
                    .await?;
                if missing_ranges.is_empty() {
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
                    .backfill_missing_trade_id_ranges_for_pair(
                        &subscription,
                        missing_ranges,
                        window_start_ms,
                        window_end_ms,
                        max_batch_rows,
                        max_batches,
                    )
                    .await?;

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

    fn merge_aggregate_trade_id_ranges(
        mut ranges: Vec<AggregateTradeIdRange>,
    ) -> Vec<AggregateTradeIdRange> {
        if ranges.is_empty() {
            return ranges;
        }
        ranges.sort_by_key(|range| range.start_id);
        let mut merged: Vec<AggregateTradeIdRange> = Vec::with_capacity(ranges.len());
        for range in ranges {
            if range.end_id_exclusive <= range.start_id {
                continue;
            }
            if let Some(last) = merged.last_mut()
                && range.start_id <= last.end_id_exclusive
            {
                last.end_id_exclusive = last.end_id_exclusive.max(range.end_id_exclusive);
            } else {
                merged.push(range);
            }
        }
        merged
    }

    async fn missing_trade_id_ranges_for_pair(
        &self,
        pair_code: &str,
        symbol: &str,
        window_start: i64,
        window_end: i64,
    ) -> Result<Vec<AggregateTradeIdRange>> {
        let Some(true_boundaries) = self
            .fetch_true_trade_window_boundaries_cached(symbol, window_start, window_end)
            .await?
        else {
            return Ok(Vec::new());
        };

        let coverage = self
            .inner
            .database
            .trade_aggregate_id_coverage_in_range(pair_code, window_start, window_end)
            .await?;

        let mut missing_ranges = Vec::new();
        match (
            coverage.first_aggregate_trade_id,
            coverage.last_aggregate_trade_id,
            coverage.distinct_trade_count,
        ) {
            (Some(first_stored_id), Some(last_stored_id), distinct_trade_count)
                if distinct_trade_count > 0 =>
            {
                if first_stored_id > true_boundaries.first_aggregate_trade_id {
                    missing_ranges.push(AggregateTradeIdRange {
                        start_id: true_boundaries.first_aggregate_trade_id,
                        end_id_exclusive: first_stored_id,
                    });
                }

                let internal_gaps = self
                    .inner
                    .database
                    .aggregate_trade_id_gaps_in_range(pair_code, window_start, window_end, 10_000)
                    .await?;
                missing_ranges.extend(internal_gaps.into_iter().map(|gap| AggregateTradeIdRange {
                    start_id: gap.previous_aggregate_trade_id.saturating_add(1),
                    end_id_exclusive: gap.next_aggregate_trade_id,
                }));

                if last_stored_id < true_boundaries.last_aggregate_trade_id {
                    missing_ranges.push(AggregateTradeIdRange {
                        start_id: last_stored_id.saturating_add(1),
                        end_id_exclusive: true_boundaries.last_aggregate_trade_id.saturating_add(1),
                    });
                }
            }
            _ => {
                missing_ranges.push(AggregateTradeIdRange {
                    start_id: true_boundaries.first_aggregate_trade_id,
                    end_id_exclusive: true_boundaries.last_aggregate_trade_id.saturating_add(1),
                });
            }
        }

        Ok(Self::merge_aggregate_trade_id_ranges(missing_ranges))
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
        let required_count =
            (required_end_ms.saturating_sub(required_start_ms)).saturating_div(period_ms) as usize;

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
            .publish_data_readiness_for_pair(&subscription.pair_code)
            .await
        {
            tracing::warn!(
                ?error,
                pair_code = %subscription.pair_code,
                timeframe_code = %subscription.timeframe_code,
                "failed to publish final kline data-readiness updates"
            );
        }

        Ok(())
    }

    async fn backfill_pair_trades_with_lookback(
        &self,
        subscription: PairStreamSubscription,
        required_history_ms: i64,
        _gap_threshold_ms: i64,
    ) -> Result<()> {
        let required_history_ms = required_history_ms.max(60_000);
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
            pair_chunk_concurrency = self
                .inner
                .config
                .historical_backfill_max_concurrency
                .min(self.inner.config.historical_trade_backfill_pair_max_concurrency)
                .max(1),
            "planning trade aggTradeId backfill for pair"
        );

        if window_end <= window_start {
            return Ok(());
        }

        self.backfill_missing_trade_id_ranges_until_complete(
            &subscription,
            window_start,
            window_end,
            max_batch_rows,
            max_batches,
        )
        .await?;
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
            .publish_data_readiness_for_pair(&subscription.pair_code)
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

    async fn backfill_missing_trade_id_ranges_until_complete(
        &self,
        subscription: &PairStreamSubscription,
        window_start: i64,
        window_end: i64,
        max_batch_rows: usize,
        max_batches: usize,
    ) -> Result<()> {
        const MAX_REPAIR_ROUNDS: usize = 3;

        for round in 1..=MAX_REPAIR_ROUNDS {
            let missing_ranges = self
                .missing_trade_id_ranges_for_pair(
                    &subscription.pair_code,
                    &subscription.symbol,
                    window_start,
                    window_end,
                )
                .await?;

            if missing_ranges.is_empty() {
                tracing::info!(
                    table = "market_data_trades",
                    pair_code = %subscription.pair_code,
                    window_start_ms = window_start,
                    window_end_ms = window_end,
                    round = round,
                    "trade aggTradeId backfill pass found no missing ranges"
                );
                break;
            }

            tracing::warn!(
                table = "market_data_trades",
                pair_code = %subscription.pair_code,
                window_start_ms = window_start,
                window_end_ms = window_end,
                round = round,
                missing_range_count = missing_ranges.len(),
                "trade aggTradeId backfill pass detected missing ranges; refilling"
            );

            self.backfill_missing_trade_id_ranges_for_pair(
                subscription,
                missing_ranges,
                window_start,
                window_end,
                max_batch_rows,
                max_batches,
            )
            .await?;
        }

        Ok(())
    }

    async fn backfill_missing_trade_id_ranges_for_pair(
        &self,
        subscription: &PairStreamSubscription,
        missing_ranges: Vec<AggregateTradeIdRange>,
        window_start: i64,
        window_end: i64,
        max_batch_rows: usize,
        max_batches: usize,
    ) -> Result<()> {
        for (index, range) in missing_ranges.into_iter().rev().enumerate() {
            tracing::warn!(
                table = "market_data_trades",
                pair_code = %subscription.pair_code,
                window_start_ms = window_start,
                window_end_ms = window_end,
                missing_range_index = index + 1,
                range_start_aggregate_trade_id = range.start_id,
                range_end_aggregate_trade_id_exclusive = range.end_id_exclusive,
                missing_trade_count = range.end_id_exclusive.saturating_sub(range.start_id),
                "trade aggTradeId backfill refilling missing range"
            );

            self.backfill_pair_trades_for_id_range(
                subscription,
                range,
                max_batch_rows,
                max_batches,
            )
            .await?;
        }

        Ok(())
    }

    async fn backfill_pair_trades_for_id_range(
        &self,
        subscription: &PairStreamSubscription,
        range: AggregateTradeIdRange,
        max_batch_rows: usize,
        max_batches: usize,
    ) -> Result<()> {
        let mut next_end_id_exclusive = range.end_id_exclusive.max(0);
        let mut batches_used = 0usize;
        let mut buffered_events = Vec::new();
        let page_rows = max_batch_rows.max(1);
        let insert_batch_rows = self
            .inner
            .config
            .historical_trade_backfill_insert_batch_rows
            .max(page_rows);
        let started_at = Instant::now();
        let mut total_rows_in_binance_responses = 0usize;
        let mut total_rows_accepted = 0usize;
        let mut total_rows_flushed_to_clickhouse = 0usize;
        let required_batches_for_range = range
            .end_id_exclusive
            .saturating_sub(range.start_id)
            .saturating_add(page_rows as i64)
            .saturating_sub(1)
            .saturating_div(page_rows as i64)
            .saturating_add(5) as usize;
        let allowed_batches = max_batches
            .saturating_mul(10)
            .max(required_batches_for_range);

        // Fill the newest side of the missing range first so readiness for the
        // active replay window converges before older retained history.
        while next_end_id_exclusive > range.start_id && batches_used < allowed_batches {
            let Some(page_start) =
                Self::next_trade_backfill_page_start(range, next_end_id_exclusive, page_rows)
            else {
                break;
            };
            let rows = self
                .fetch_binance_json::<Vec<Value>>(
                    "/api/v3/aggTrades",
                    &[
                        ("symbol", subscription.symbol.clone()),
                        ("fromId", page_start.to_string()),
                        ("limit", page_rows.to_string()),
                    ],
                )
                .await?;
            if rows.is_empty() {
                break;
            }

            total_rows_in_binance_responses =
                total_rows_in_binance_responses.saturating_add(rows.len());
            let mut accepted_this_page = 0usize;

            for row in rows {
                let event =
                    normalize_rest_trade(subscription, row, &self.inner.config.service_name)?;
                if event.aggregate_trade_id < range.start_id {
                    continue;
                }
                if event.aggregate_trade_id >= next_end_id_exclusive {
                    break;
                }

                accepted_this_page = accepted_this_page.saturating_add(1);
                buffered_events.push(event);

                if buffered_events.len() >= insert_batch_rows {
                    let inserted_rows = self
                        .inner
                        .database
                        .insert_trades_batch_fast(
                            &buffered_events,
                            self.inner
                                .config
                                .historical_trade_backfill_use_rowbinary_insert,
                        )
                        .await?;
                    total_rows_flushed_to_clickhouse =
                        total_rows_flushed_to_clickhouse.saturating_add(inserted_rows);
                    buffered_events.clear();
                }
            }

            total_rows_accepted = total_rows_accepted.saturating_add(accepted_this_page);
            batches_used = batches_used.saturating_add(1);
            next_end_id_exclusive = page_start;
        }

        if !buffered_events.is_empty() {
            let inserted_rows = self
                .inner
                .database
                .insert_trades_batch_fast(
                    &buffered_events,
                    self.inner
                        .config
                        .historical_trade_backfill_use_rowbinary_insert,
                )
                .await?;
            total_rows_flushed_to_clickhouse =
                total_rows_flushed_to_clickhouse.saturating_add(inserted_rows);
        }

        tracing::info!(
            table = "market_data_trades",
            pair_code = %subscription.pair_code,
            range_start_aggregate_trade_id = range.start_id,
            range_end_aggregate_trade_id_exclusive = range.end_id_exclusive,
            missing_aggregate_trade_count = range.end_id_exclusive.saturating_sub(range.start_id),
            total_rows_in_binance_responses,
            total_rows_accepted,
            total_rows_flushed_to_clickhouse,
            batches_used,
            elapsed_ms = started_at.elapsed().as_millis() as u64,
            "trade aggTradeId backfill finished refill attempt"
        );

        Ok(())
    }

    fn next_trade_backfill_page_start(
        range: AggregateTradeIdRange,
        next_end_id_exclusive: i64,
        max_batch_rows: usize,
    ) -> Option<i64> {
        if next_end_id_exclusive <= range.start_id {
            return None;
        }

        Some(
            next_end_id_exclusive
                .saturating_sub(max_batch_rows.max(1) as i64)
                .max(range.start_id)
                .max(0),
        )
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

    async fn fetch_true_trade_window_boundaries_cached(
        &self,
        symbol: &str,
        start_time: i64,
        end_time: i64,
    ) -> Result<Option<TrueTradeWindowBoundaries>> {
        let key = (symbol.to_string(), start_time, end_time);
        if let Some(boundaries) = self
            .inner
            .trade_window_boundaries_cache
            .read()
            .await
            .get(&key)
            .copied()
        {
            return Ok(boundaries);
        }

        let boundaries = self
            .fetch_true_trade_window_boundaries(symbol, start_time, end_time)
            .await?;
        self.inner
            .trade_window_boundaries_cache
            .write()
            .await
            .insert(key, boundaries);
        Ok(boundaries)
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
            let earliest_acceptable_max = boundaries.last_trade_time.saturating_sub(tolerance_ms);
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
        ((present_trade_count.min(expected_trade_count as u64) as f64)
            / expected_trade_count as f64
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

fn missing_kline_count(coverage: &crate::db::WindowCoverage, required_klines: u64) -> u64 {
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

fn json_usize(value: Option<&Value>) -> Option<usize> {
    match value {
        Some(Value::Number(number)) => number.as_u64().map(|parsed| parsed as usize),
        Some(Value::String(raw)) => raw.parse::<usize>().ok(),
        _ => None,
    }
}

fn min_option_i64(current: Option<i64>, next: Option<i64>) -> Option<i64> {
    match (current, next) {
        (Some(current), Some(next)) => Some(current.min(next)),
        (Some(current), None) => Some(current),
        (None, Some(next)) => Some(next),
        (None, None) => None,
    }
}

fn max_option_i64(current: Option<i64>, next: Option<i64>) -> Option<i64> {
    match (current, next) {
        (Some(current), Some(next)) => Some(current.max(next)),
        (Some(current), None) => Some(current),
        (None, Some(next)) => Some(next),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::{AggregateTradeIdRange, MarketDataService};
    use crate::{
        models::{
            PairRecord, ResolvedAnalysisSettingsRecord, RiskProfileRecord, StrategyRecord,
            TimeframeRecord,
        },
        subscriptions::derive_active_subscriptions,
    };

    #[test]
    fn merge_aggregate_trade_id_ranges_merges_overlaps_and_touching_ranges() {
        let merged = MarketDataService::merge_aggregate_trade_id_ranges(vec![
            AggregateTradeIdRange {
                start_id: 50,
                end_id_exclusive: 70,
            },
            AggregateTradeIdRange {
                start_id: 10,
                end_id_exclusive: 20,
            },
            AggregateTradeIdRange {
                start_id: 20,
                end_id_exclusive: 30,
            },
            AggregateTradeIdRange {
                start_id: 65,
                end_id_exclusive: 90,
            },
        ]);

        assert_eq!(
            merged,
            vec![
                AggregateTradeIdRange {
                    start_id: 10,
                    end_id_exclusive: 30,
                },
                AggregateTradeIdRange {
                    start_id: 50,
                    end_id_exclusive: 90,
                },
            ]
        );
    }

    #[test]
    fn next_trade_backfill_page_start_prioritizes_recent_ids() {
        let range = AggregateTradeIdRange {
            start_id: 10,
            end_id_exclusive: 35,
        };

        assert_eq!(
            MarketDataService::next_trade_backfill_page_start(range, 35, 10),
            Some(25)
        );
        assert_eq!(
            MarketDataService::next_trade_backfill_page_start(range, 25, 10),
            Some(15)
        );
        assert_eq!(
            MarketDataService::next_trade_backfill_page_start(range, 15, 10),
            Some(10)
        );
        assert_eq!(
            MarketDataService::next_trade_backfill_page_start(range, 10, 10),
            None
        );
    }

    #[test]
    fn required_trade_history_ignores_auxiliary_longer_timeframe_kline_subscriptions() {
        let mut record = resolved("analysis-1", "strategy1");
        record.strategy.parameters = json!({ "kind": "strategy1" });
        record.symbol = "BTCUSDT".to_string();
        record.symbol_entity.code = "BTCUSDT".to_string();
        record.timeframe_code = "3m".to_string();
        record.timeframe.code = "3m".to_string();
        record.timeframe.period_ms = 180_000;
        record.timeframe.longer_timeframe_code = "15m".to_string();
        record.timeframe.longer_timeframe_multiplier = 5;

        let active = derive_active_subscriptions(
            &[pair("BTCUSDT")],
            &[timeframe("3m", 180_000)],
            &[record.clone()],
        )
        .expect("subscriptions should derive");

        assert!(
            active
                .kline_subscriptions
                .iter()
                .any(|subscription| subscription.timeframe_code == "15m")
        );

        let plan = MarketDataService::build_required_history_plan_from_settings(
            &[record],
            &active,
            10_000,
            &BTreeMap::from([("3m".to_string(), 1_800_000_000)]),
            4,
            48 * 60 * 60 * 1000,
            200,
            15_000,
        );

        assert_eq!(
            plan.trade_by_pair_code.get("BTCUSDT").copied(),
            Some(1_972_800_000)
        );
    }

    fn resolved(id: &str, strategy_name: &str) -> ResolvedAnalysisSettingsRecord {
        ResolvedAnalysisSettingsRecord {
            id: id.to_string(),
            symbol: "BTC/USDT".to_string(),
            timeframe_code: "1m".to_string(),
            strategy_name: strategy_name.to_string(),
            risk_profile_name: "default-risk".to_string(),
            technical_analysis_settings: json!({ "fast": 9, "slow": 21 }),
            enabled: true,
            created_at: "2026-03-12T18:00:00Z".to_string(),
            updated_at: "2026-03-12T18:00:00Z".to_string(),
            symbol_entity: PairRecord {
                id: "pair-1".to_string(),
                code: "BTC/USDT".to_string(),
                active: true,
                base_asset: "BTC".to_string(),
                destination_asset: "USDT".to_string(),
                created_at: "2026-03-12T18:00:00Z".to_string(),
                updated_at: "2026-03-12T18:00:00Z".to_string(),
            },
            timeframe: TimeframeRecord {
                id: "timeframe-1".to_string(),
                code: "1m".to_string(),
                longer_timeframe_code: "5m".to_string(),
                longer_timeframe_multiplier: 5,
                period_ms: 60_000,
                active: true,
                created_at: "2026-03-12T18:00:00Z".to_string(),
                updated_at: "2026-03-12T18:00:00Z".to_string(),
            },
            strategy: StrategyRecord {
                id: format!("strategy-{strategy_name}"),
                name: strategy_name.to_string(),
                description: "strategy".to_string(),
                activated: true,
                parameters: json!({}),
                created_at: "2026-03-12T18:00:00Z".to_string(),
                updated_at: "2026-03-12T18:00:00Z".to_string(),
            },
            risk_profile: RiskProfileRecord {
                id: "risk-1".to_string(),
                name: "default-risk".to_string(),
                description: "risk".to_string(),
                maximum_stop_loss: 2.0,
                minimum_stop_loss: 1.0,
                swing_gap: 0.5,
                rrr: 2.0,
                enabled: true,
                created_at: "2026-03-12T18:00:00Z".to_string(),
                updated_at: "2026-03-12T18:00:00Z".to_string(),
            },
        }
    }

    fn pair(code: &str) -> PairRecord {
        PairRecord {
            id: format!("pair-{code}"),
            code: code.to_string(),
            active: true,
            base_asset: "BTC".to_string(),
            destination_asset: "USDT".to_string(),
            created_at: "2026-03-12T18:00:00Z".to_string(),
            updated_at: "2026-03-12T18:00:00Z".to_string(),
        }
    }

    fn timeframe(code: &str, period_ms: i64) -> TimeframeRecord {
        TimeframeRecord {
            id: format!("timeframe-{code}"),
            code: code.to_string(),
            longer_timeframe_code: "5m".to_string(),
            longer_timeframe_multiplier: 5,
            period_ms,
            active: true,
            created_at: "2026-03-12T18:00:00Z".to_string(),
            updated_at: "2026-03-12T18:00:00Z".to_string(),
        }
    }
}
