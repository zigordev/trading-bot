use std::{
    collections::HashMap,
    num::NonZeroUsize,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use lru::LruCache;
use rdkafka::{
    ClientConfig, Message,
    consumer::{Consumer, StreamConsumer},
    producer::{FutureProducer, FutureRecord},
};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use tokio::{
    sync::{Mutex, RwLock, mpsc, watch},
    task::JoinHandle,
    time::MissedTickBehavior,
};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message as WsMessage};

use crate::{
    config::AppConfig,
    db::{Database, TimeGap},
    events::{
        NormalizedWsEvent, normalize_rest_book_ticker, normalize_rest_kline, normalize_rest_trade,
        normalize_ws_message,
    },
    kafka_topics::ensure_topics,
    metrics::Metrics,
    models::{
        ActiveSubscriptions, KlineSubscription, NormalizedBookTickerEvent, NormalizedKlineEvent,
        NormalizedTradeEvent, PairStreamSubscription, PersistedBookTickerRecord,
        PersistedKlineRecord, PersistedTradeRecord, ResolvedAnalysisSettingsRecord,
    },
    subscriptions::{
        build_combined_stream_url, derive_active_subscriptions, should_refresh_for_config_resource,
    },
};

#[derive(Clone)]
pub struct MarketDataService {
    inner: Arc<Inner>,
}

#[derive(Debug, Deserialize)]
struct BinanceDepthBookTickerRestRow {
    #[serde(rename = "lastUpdateId")]
    last_update_id: i64,
    bids: Vec<[String; 2]>,
    asks: Vec<[String; 2]>,
}

struct Inner {
    config: AppConfig,
    metrics: Metrics,
    database: Database,
    http_client: reqwest::Client,
    kafka_producer: FutureProducer,
    runtime_status: RwLock<RuntimeStatus>,
    kline_by_stream: RwLock<HashMap<String, KlineSubscription>>,
    pair_by_stream: RwLock<HashMap<String, PairStreamSubscription>>,
    required_kline_history_ms: RwLock<HashMap<String, i64>>,
    required_trade_history_ms: RwLock<HashMap<String, i64>>,
    required_trade_gap_threshold_ms: RwLock<HashMap<String, i64>>,
    deduper: Mutex<LruCache<String, ()>>,
    maintenance_gate: Mutex<()>,
    compaction_gate: Mutex<()>,
    refresh_tx: mpsc::Sender<String>,
    live_trade_tx: mpsc::Sender<NormalizedTradeEvent>,
    subscriptions_tx: watch::Sender<ActiveSubscriptions>,
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

#[derive(Clone, Copy, Debug)]
enum TradeGapRepairMode {
    StartupDeep,
    Periodic,
}

#[derive(Clone, Debug, Default)]
struct RequiredHistoryPlan {
    kline_by_subscription_id: HashMap<String, i64>,
    trade_by_pair_code: HashMap<String, i64>,
    trade_gap_threshold_by_pair_code: HashMap<String, i64>,
}

impl MarketDataService {
    pub async fn new(config: AppConfig) -> Result<Self> {
        let database = Database::connect(&config).await?;
        database.ensure_schema().await?;
        ensure_topics(
            &config.kafka_bootstrap_servers,
            &[
                &config.config_change_events_topic,
                &config.market_data_klines_topic,
                &config.market_data_trades_topic,
                &config.market_data_book_tickers_topic,
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

        let kafka_producer = ClientConfig::new()
            .set("bootstrap.servers", &config.kafka_bootstrap_servers)
            .set("message.timeout.ms", "5000")
            .create::<FutureProducer>()?;

        let (refresh_tx, refresh_rx) = mpsc::channel::<String>(32);
        let (live_trade_tx, live_trade_rx) = mpsc::channel::<NormalizedTradeEvent>(
            config.live_trade_insert_batch_rows.saturating_mul(4).max(1_000),
        );
        let (subscriptions_tx, _) = watch::channel(ActiveSubscriptions::default());
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
            kafka_producer,
            runtime_status: RwLock::new(runtime_status),
            kline_by_stream: RwLock::new(HashMap::new()),
            pair_by_stream: RwLock::new(HashMap::new()),
            required_kline_history_ms: RwLock::new(HashMap::new()),
            required_trade_history_ms: RwLock::new(HashMap::new()),
            required_trade_gap_threshold_ms: RwLock::new(HashMap::new()),
            deduper: Mutex::new(LruCache::new(
                NonZeroUsize::new(10_000).expect("dedup capacity should be non-zero"),
            )),
            maintenance_gate: Mutex::new(()),
            compaction_gate: Mutex::new(()),
            refresh_tx,
            live_trade_tx,
            subscriptions_tx,
            shutdown_tx,
            task_handles: Mutex::new(Vec::new()),
        });

        let service = Self { inner };
        {
            let mut deduper = service.inner.deduper.lock().await;
            *deduper = LruCache::new(
                NonZeroUsize::new(service.inner.config.market_event_dedup_capacity)
                    .expect("dedup capacity must be non-zero"),
            );
        }

        service.start_with_refresh_loop(refresh_rx, live_trade_rx).await;
        Ok(service)
    }

    async fn start_with_refresh_loop(
        &self,
        refresh_rx: mpsc::Receiver<String>,
        live_trade_rx: mpsc::Receiver<NormalizedTradeEvent>,
    ) {
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

        let websocket_service = self.clone();
        let websocket_handle = tokio::spawn(async move {
            websocket_service.websocket_loop().await;
        });

        let trade_writer_service = self.clone();
        let trade_writer_handle = tokio::spawn(async move {
            trade_writer_service.live_trade_writer_loop(live_trade_rx).await;
        });

        let mut handles = self.inner.task_handles.lock().await;
        handles.extend([
            startup_refresh_handle,
            refresh_handle,
            consumer_handle,
            periodic_handle,
            websocket_handle,
            trade_writer_handle,
        ]);

        if self.inner.config.trade_gap_repair_enabled {
            let gap_repair_service = self.clone();
            let gap_repair_handle = tokio::spawn(async move {
                gap_repair_service.trade_gap_repair_loop().await;
            });
            handles.push(gap_repair_handle);
        }

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
                        <= self.inner.config.readiness_max_config_age_ms as i64
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
        let market_stream = if status.subscriptions.stream_names.is_empty() {
            "idle"
        } else if status.stream.connected {
            "up"
        } else {
            "down"
        };
        let database = if db_ok { "up" } else { "down" };
        let status_text = if runtime_config == "up"
            && kafka_producer == "up"
            && kafka_consumer == "up"
            && (market_stream == "up" || market_stream == "idle")
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

    pub async fn recent_book_tickers(
        &self,
        pair_code: &str,
        limit: i64,
    ) -> Result<Vec<PersistedBookTickerRecord>> {
        self.inner
            .database
            .list_recent_book_tickers(pair_code, limit)
            .await
    }

    pub async fn replay_book_tickers(
        &self,
        pair_code: &str,
        start_time: Option<i64>,
        end_time: Option<i64>,
        limit: i64,
    ) -> Result<Vec<PersistedBookTickerRecord>> {
        self.inner
            .database
            .replay_book_tickers(pair_code, start_time, end_time, limit)
            .await
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
        let mut interval = tokio::time::interval(Duration::from_millis(
            self.inner.config.runtime_config_refresh_interval_ms,
        ));
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
        interval.tick().await;

        loop {
            tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_ok() {
                        break;
                    }
                }
                _ = interval.tick() => {
                    let _ = self.inner.refresh_tx.send("periodic-reconcile".to_string()).await;
                }
            }
        }
    }

    async fn trade_gap_repair_loop(&self) {
        if !self.inner.config.trade_gap_repair_enabled {
            return;
        }

        let mut shutdown_rx = self.inner.shutdown_tx.subscribe();
        let mut interval = tokio::time::interval(Duration::from_millis(
            self.inner.config.trade_gap_repair_interval_ms,
        ));
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
        interval.tick().await;

        loop {
            tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_ok() {
                        break;
                    }
                }
                _ = interval.tick() => {
                    let (ready, active) = {
                        let status = self.inner.runtime_status.read().await;
                        (status.runtime_config.loaded, status.subscriptions.clone())
                    };

                    if !ready || active.pair_subscriptions.is_empty() {
                        continue;
                    }

                    let started = SystemTime::now();
                    let _maintenance = self.inner.maintenance_gate.lock().await;
                    let required_trade_history_ms =
                        self.inner.required_trade_history_ms.read().await.clone();
                    let required_trade_gap_threshold_ms =
                        self.inner.required_trade_gap_threshold_ms.read().await.clone();
                    let result = self
                        .run_trade_gap_audit_and_repair(
                            &active,
                            &required_trade_history_ms,
                            &required_trade_gap_threshold_ms,
                            TradeGapRepairMode::Periodic,
                        )
                        .await;

                    let elapsed_ms = started
                        .elapsed()
                        .map(|d| d.as_millis())
                        .unwrap_or_default();

                    if let Err(error) = result {
                        tracing::warn!(
                            ?error,
                            elapsed_ms,
                            pair_subscriptions = active.pair_subscriptions.len(),
                            "periodic trade gap audit/repair failed"
                        );
                    } else {
                        tracing::info!(
                            elapsed_ms,
                            pair_subscriptions = active.pair_subscriptions.len(),
                            "periodic trade gap audit/repair finished"
                        );
                    }
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

    async fn websocket_loop(&self) {
        let mut subscriptions_rx = self.inner.subscriptions_tx.subscribe();
        let mut shutdown_rx = self.inner.shutdown_tx.subscribe();

        loop {
            let active = subscriptions_rx.borrow().clone();
            if active.stream_names.is_empty() {
                self.mark_stream(false, None, None, None).await;
                tokio::select! {
                    changed = subscriptions_rx.changed() => {
                        if changed.is_err() {
                            break;
                        }
                        continue;
                    }
                    changed = shutdown_rx.changed() => {
                        if changed.is_ok() {
                            break;
                        }
                    }
                }
            }

            let stream_url = match build_combined_stream_url(
                &self.inner.config.binance_stream_base_url,
                &active,
            ) {
                Ok(url) => url,
                Err(error) => {
                    self.mark_stream(false, None, None, Some(error.to_string()))
                        .await;
                    tokio::time::sleep(Duration::from_millis(
                        self.inner.config.binance_reconnect_backoff_ms,
                    ))
                    .await;
                    continue;
                }
            };

            match connect_async(&stream_url).await {
                Ok((socket, _response)) => {
                    self.mark_stream(true, Some(stream_url.clone()), None, None)
                        .await;
                    let (mut writer, mut reader) = socket.split();

                    loop {
                        tokio::select! {
                            changed = shutdown_rx.changed() => {
                                if changed.is_ok() {
                                    let _ = writer.close().await;
                                    return;
                                }
                            }
                            changed = subscriptions_rx.changed() => {
                                if changed.is_ok() {
                                    let _ = writer.close().await;
                                    break;
                                }
                            }
                            message = reader.next() => {
                                match message {
                                    Some(Ok(WsMessage::Text(text))) => {
                                        if let Err(error) = self.handle_ws_text(text.as_str()).await {
                                            self.mark_stream(false, Some(stream_url.clone()), None, Some(error.to_string())).await;
                                        } else {
                                            self.mark_stream(true, Some(stream_url.clone()), Some(Utc::now().to_rfc3339()), None).await;
                                        }
                                    }
                                    Some(Ok(WsMessage::Ping(payload))) => {
                                        let _ = writer.send(WsMessage::Pong(payload)).await;
                                    }
                                    Some(Ok(WsMessage::Close(_))) | None => {
                                        self.mark_stream(false, Some(stream_url.clone()), None, Some("binance stream closed".to_string())).await;
                                        break;
                                    }
                                    Some(Err(error)) => {
                                        self.mark_stream(false, Some(stream_url.clone()), None, Some(error.to_string())).await;
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
                Err(error) => {
                    self.mark_stream(false, Some(stream_url), None, Some(error.to_string()))
                        .await;
                    tokio::time::sleep(Duration::from_millis(
                        self.inner.config.binance_reconnect_backoff_ms,
                    ))
                    .await;
                }
            }
        }
    }

    async fn handle_ws_text(&self, text: &str) -> Result<()> {
        let kline_by_stream = self.inner.kline_by_stream.read().await.clone();
        let pair_by_stream = self.inner.pair_by_stream.read().await.clone();
        let event = normalize_ws_message(
            text,
            &kline_by_stream,
            &pair_by_stream,
            &self.inner.config.service_name,
        )?;

        match event {
            Some(NormalizedWsEvent::Kline(event)) => {
                self.process_kline_event(event).await?;
            }
            Some(NormalizedWsEvent::Trade(event)) => {
                self.process_trade_event(event).await?;
            }
            Some(NormalizedWsEvent::BookTicker(event)) => {
                self.process_book_ticker_event(event).await?;
            }
            None => {}
        }

        Ok(())
    }

    async fn perform_refresh(&self, reason: &str) -> Result<()> {
        let _maintenance = self.inner.maintenance_gate.lock().await;
        let records = self.fetch_resolved_analysis_settings().await?;
        let active = derive_active_subscriptions(&records)?;
        let required_history_plan = self.build_required_history_plan(&records, &active);
        let (kline_by_stream, pair_by_stream) = build_stream_maps(&active);

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

        *self.inner.kline_by_stream.write().await = kline_by_stream;
        *self.inner.pair_by_stream.write().await = pair_by_stream;
        *self.inner.required_kline_history_ms.write().await =
            required_history_plan.kline_by_subscription_id.clone();
        *self.inner.required_trade_history_ms.write().await =
            required_history_plan.trade_by_pair_code.clone();
        *self.inner.required_trade_gap_threshold_ms.write().await =
            required_history_plan.trade_gap_threshold_by_pair_code.clone();
        let _ = self.inner.subscriptions_tx.send(active.clone());

        tracing::info!(
            reason,
            kline_subscriptions = active.kline_subscriptions.len(),
            pair_subscriptions = active.pair_subscriptions.len(),
            "refreshed market-data subscriptions from control-plane"
        );

        self.run_backfill_and_gap_repair(&active, &required_history_plan)
            .await?;

        // Extra deep audit at startup: the existing backfill+repair pass is
        // anchored to a clamped "required lookback" window, which can leave
        // older leading gaps unfixed. The deep audit re-checks from the
        // earliest kline we have for each pair (bounded by config).
        if reason == "startup" && self.inner.config.trade_gap_repair_enabled {
            if let Err(error) =
                self.run_trade_gap_audit_and_repair(
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

    async fn fetch_resolved_analysis_settings(
        &self,
    ) -> Result<Vec<ResolvedAnalysisSettingsRecord>> {
        let url = format!(
            "{}/v1/runtime-config/analysis-settings",
            self.inner
                .config
                .control_plane_base_url
                .trim_end_matches('/')
        );
        let response = self
            .inner
            .http_client
            .get(url)
            .send()
            .await?
            .error_for_status()?;
        let payload = response
            .json::<Vec<ResolvedAnalysisSettingsRecord>>()
            .await?;
        Ok(payload)
    }

    fn build_required_history_plan(
        &self,
        records: &[ResolvedAnalysisSettingsRecord],
        active: &ActiveSubscriptions,
    ) -> RequiredHistoryPlan {
        let mut kline_by_key: HashMap<(String, String), i64> = HashMap::new();
        let mut trade_by_pair_code: HashMap<String, i64> = HashMap::new();
        let mut trade_gap_threshold_by_pair_code: HashMap<String, i64> = HashMap::new();

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

            let warmup_candles = estimate_warmup_candles(
                record,
                self.inner.config.default_warmup_multiplier,
            );
            let warmup_ms = (warmup_candles as i64).saturating_mul(record.timeframe.period_ms.max(1));
            let required_kline_history_ms = configured_duration_ms.saturating_add(warmup_ms);

            let kline_key = (record.pair_code.clone(), record.timeframe_code.clone());
            kline_by_key
                .entry(kline_key)
                .and_modify(|current| *current = (*current).max(required_kline_history_ms))
                .or_insert(required_kline_history_ms);

            trade_by_pair_code
                .entry(record.pair_code.clone())
                .and_modify(|current| *current = (*current).max(configured_duration_ms))
                .or_insert(configured_duration_ms);
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
                .and_modify(|current| *current = (*current).max(subscription.period_ms.max(1)))
                .or_insert(subscription.period_ms.max(1));
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
            .await?;
            self.run_book_ticker_backfill_and_gap_repair(&active.pair_subscriptions)
                .await
        }
        .await;

        let mut status = self.inner.runtime_status.write().await;
        status.database.last_backfill_at = Some(Utc::now().to_rfc3339());
        status.database.last_backfill_error = result.as_ref().err().map(|error| error.to_string());
        drop(status);

        if result.is_ok()
            && self.inner.config.historical_store_compact_after_refresh
            && let Err(error) = self
                .run_market_data_compaction("post-refresh")
                .await
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

        let now_ms = Utc::now().timestamp_millis();
        let end_grace_ms = self.inner.config.trade_gap_repair_end_grace_ms as i64;
        let end_limit_ms = now_ms.saturating_sub(end_grace_ms).max(0);

        let max_batch_rows = self
            .inner
            .config
            .historical_trade_backfill_limit
            .min(1000);
        let max_batches = self
            .inner
            .config
            .historical_trade_backfill_max_batches
            .saturating_mul(self.inner.config.trade_gap_repair_max_batches_multiplier);

        let startup_cap_ms = self.inner.config.trade_gap_repair_startup_max_window_ms as i64;
        let periodic_lookback_ms = self.inner.config.trade_gap_repair_periodic_lookback_ms as i64;

        let semaphore =
            std::sync::Arc::new(tokio::sync::Semaphore::new(self.inner.config.historical_backfill_max_concurrency));
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
                    TradeGapRepairMode::Periodic => {
                        let lookback_ms = required_history_ms.max(periodic_lookback_ms);
                        window_end_ms.saturating_sub(lookback_ms)
                    }
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

    async fn run_book_ticker_backfill_and_gap_repair(
        &self,
        subscriptions: &[PairStreamSubscription],
    ) -> Result<()> {
        let max_concurrency = self.inner.config.historical_backfill_max_concurrency;
        let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency));
        let mut tasks = Vec::with_capacity(subscriptions.len());

        for subscription in subscriptions.iter().cloned() {
            let service = self.clone();
            let permit = semaphore.clone().acquire_owned().await?;
            tasks.push(tokio::spawn(async move {
                let _permit = permit;
                service.backfill_pair_book_ticker(subscription).await
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

    fn align_to_period_ms(timestamp_ms: i64, period_ms: i64) -> i64 {
        if period_ms <= 0 || timestamp_ms <= 0 {
            return timestamp_ms.max(0);
        }
        timestamp_ms - (timestamp_ms % period_ms)
    }

    fn value_to_i64(value: &Value) -> Option<i64> {
        value
            .as_i64()
            .or_else(|| value.as_str().and_then(|value| value.parse::<i64>().ok()))
    }

    async fn live_trade_writer_loop(&self, mut rx: mpsc::Receiver<NormalizedTradeEvent>) {
        let flush_interval = Duration::from_millis(
            self.inner.config.live_trade_insert_flush_interval_ms,
        );
        let batch_size = self.inner.config.live_trade_insert_batch_rows.max(1);
        let mut shutdown_rx = self.inner.shutdown_tx.subscribe();
        let mut buffer = Vec::with_capacity(batch_size);
        let mut interval = tokio::time::interval(flush_interval);
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_ok() {
                        if let Err(error) = self.flush_live_trade_buffer(&mut buffer).await {
                            tracing::warn!(?error, buffered_rows = buffer.len(), "failed to flush live trade buffer during shutdown");
                        }
                        break;
                    }
                }
                maybe_event = rx.recv() => {
                    match maybe_event {
                        Some(event) => {
                            buffer.push(event);
                            if buffer.len() >= batch_size
                                && let Err(error) = self.flush_live_trade_buffer(&mut buffer).await
                            {
                                tracing::warn!(?error, "failed to flush live trade batch");
                            }
                        }
                        None => {
                            if let Err(error) = self.flush_live_trade_buffer(&mut buffer).await {
                                tracing::warn!(?error, buffered_rows = buffer.len(), "failed to flush live trade buffer after channel close");
                            }
                            break;
                        }
                    }
                }
                _ = interval.tick() => {
                    if !buffer.is_empty()
                        && let Err(error) = self.flush_live_trade_buffer(&mut buffer).await
                    {
                        tracing::warn!(?error, "failed to flush live trade batch on timer");
                    }
                }
            }
        }
    }

    async fn flush_live_trade_buffer(
        &self,
        buffer: &mut Vec<NormalizedTradeEvent>,
    ) -> Result<()> {
        if buffer.is_empty() {
            return Ok(());
        }

        let flush_rows = buffer.len();
        if self.inner.config.historical_trade_backfill_use_rowbinary_insert {
            self.inner
                .database
                .upsert_trades_batch_rowbinary(buffer)
                .await?;
        } else {
            self.inner.database.upsert_trades_batch(buffer).await?;
        }
        buffer.clear();
        self.inner.metrics.database_connected.set(1);
        tracing::debug!(
            table = "market_data_trades",
            inserted_rows = flush_rows,
            "flushed live trade batch into ClickHouse"
        );
        Ok(())
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

    async fn backfill_subscription(
        &self,
        subscription: KlineSubscription,
        required_history_ms: i64,
    ) -> Result<()> {
        let batch_limit = self.inner.config.historical_backfill_limit.min(1000);
        if batch_limit == 0 {
            return Ok(());
        }

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("system clock is before unix epoch")?
            .as_millis() as i64;

        let period_ms = subscription.period_ms.max(1);
        let required_end_ms = Self::align_to_period_ms(now_ms, period_ms);
        let required_lookback_ms = required_history_ms.max(period_ms);
        let required_start_ms = if required_end_ms > required_lookback_ms {
            Self::align_to_period_ms(
                required_end_ms.saturating_sub(required_lookback_ms),
                period_ms,
            )
        } else {
            0
        };
        let required_count = (required_end_ms.saturating_sub(required_start_ms))
            .saturating_div(period_ms)
            .saturating_add(1) as usize;

        let latest_open_time = self
            .inner
            .database
            .latest_kline_open_time(&subscription.pair_code, &subscription.timeframe_code)
            .await?;
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

        let mut next_start_ms = if current_count >= required_count {
            match latest_open_time {
                Some(open_time) if open_time >= required_end_ms => return Ok(()),
                Some(open_time) => {
                    Self::align_to_period_ms(open_time.saturating_add(period_ms), period_ms)
                }
                None => required_start_ms,
            }
        } else {
            required_start_ms
        };

        if next_start_ms > required_end_ms {
            return Ok(());
        }

        let mut remaining_needed = required_count.saturating_sub(current_count);
        let mut remaining_loops = remaining_needed
            .saturating_div(batch_limit)
            .saturating_add(1);
        let mut buffered_events: Vec<NormalizedKlineEvent> = Vec::new();
        let insert_batch_rows = self
            .inner
            .config
            .historical_kline_backfill_insert_batch_rows
            .max(batch_limit);

        while next_start_ms <= required_end_ms && remaining_loops > 0 {
            tracing::info!(
                table = "market_data_klines",
                pair_code = %subscription.pair_code,
                timeframe_code = %subscription.timeframe_code,
                binance_interval = %subscription.binance_interval,
                batch_limit,
                next_start_ms,
                required_start_ms,
                required_end_ms,
                required_lookback_ms,
                required_count,
                current_count,
                remaining_needed,
                "starting kline backfill batch for subscription"
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

            for row in rows.iter() {
                let event =
                    normalize_rest_kline(&subscription, row, &self.inner.config.service_name)?;
                // Buffer backfill klines and flush to ClickHouse in larger
                // batches to reduce part counts and improve insert efficiency.
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

            remaining_needed = remaining_needed.saturating_sub(rows.len());
            next_start_ms = last_open_time.saturating_add(period_ms);
            remaining_loops = remaining_loops.saturating_sub(1);

            if rows.len() < batch_limit || remaining_needed == 0 {
                break;
            }
        }

        // Flush any remaining buffered klines for this subscription.
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

        let now_ms = Utc::now().timestamp_millis();
        let required_window_start = now_ms.saturating_sub(required_history_ms);
        let window_start = earliest_kline_time.max(required_window_start);
        let window_end = now_ms;

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
            "planning trade backfill chunks for pair"
        );

        if window_end <= window_start {
            return Ok(());
        }

        // Chunk the window into contiguous time ranges to allow per-pair
        // parallelism while keeping each chunk self-contained and idempotent.
        let chunk_ms: i64 = self
            .inner
            .config
            .historical_trade_backfill_chunk_ms
            .max(60_000) as i64;
        let mut chunks = Vec::new();
        let mut chunk_start = window_start;
        while chunk_start < window_end {
            let mut chunk_end = chunk_start.saturating_add(chunk_ms);
            if chunk_end > window_end {
                chunk_end = window_end;
            }
            chunks.push((chunk_start, chunk_end));
            chunk_start = chunk_end;
        }

        let pair_chunk_concurrency = self
            .inner
            .config
            .historical_backfill_max_concurrency
            .min(self.inner.config.historical_trade_backfill_pair_max_concurrency)
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
                    .backfill_pair_trades_for_chunk(sub, start_ms, end_ms, max_batch_rows, max_batches)
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
        // After backfilling all chunks for this pair, log what ClickHouse
        // actually contains for the requested window so operators can see
        // whether coverage is complete or there are still gaps.
        match self
            .inner
            .database
            .trade_window_coverage_in_range(
                &subscription.pair_code,
                window_start,
                window_end,
            )
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

        Ok(())
    }

    async fn repair_trade_gaps_for_pair(
        &self,
        subscription: &PairStreamSubscription,
        window_start: i64,
        window_end: i64,
        max_batch_rows: usize,
        max_batches: usize,
        required_period_ms: i64,
    ) -> Result<()> {
        const MAX_REPAIR_ROUNDS: usize = 3;
        const MAX_GAP_ROWS: i64 = 500;
        let min_gap_ms = required_period_ms.max(60_000);

        for round in 1..=MAX_REPAIR_ROUNDS {
            let coverage = self
                .inner
                .database
                .trade_window_coverage_in_range(&subscription.pair_code, window_start, window_end)
                .await?;

            let mut gaps = Vec::<TimeGap>::new();
            if let Some(min_t) = coverage.min_time {
                if min_t > window_start {
                    gaps.push(TimeGap {
                        start_time: window_start,
                        end_time: min_t,
                        gap_ms: min_t.saturating_sub(window_start),
                    });
                }
            }
            if let Some(max_t) = coverage.max_time {
                let expected_max = window_end.saturating_sub(1);
                if max_t < expected_max {
                    gaps.push(TimeGap {
                        start_time: max_t.saturating_add(1),
                        end_time: window_end,
                        gap_ms: expected_max.saturating_sub(max_t),
                    });
                }
            }

            let internal_gaps = self
                .inner
                .database
                .trade_time_gaps_in_range(
                    &subscription.pair_code,
                    window_start,
                    window_end,
                    min_gap_ms,
                    MAX_GAP_ROWS,
                )
                .await?;
            gaps.extend(internal_gaps);
            gaps = Self::merge_time_gaps(gaps);

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
                min_gap_ms = min_gap_ms,
                "trade gap-repair pass detected gaps; refilling"
            );

            for gap in gaps {
                self.backfill_pair_trades_for_range(
                    subscription,
                    gap.start_time,
                    gap.end_time,
                    max_batch_rows,
                    max_batches.saturating_mul(10),
                )
                .await?;
            }
        }

        Ok(())
    }

    async fn backfill_pair_trades_for_range(
        &self,
        subscription: &PairStreamSubscription,
        range_start_ms: i64,
        range_end_ms: i64,
        max_batch_rows: usize,
        max_batches: usize,
    ) -> Result<()> {
        if range_end_ms <= range_start_ms {
            return Ok(());
        }
        let chunk_ms: i64 = self
            .inner
            .config
            .historical_trade_backfill_chunk_ms
            .max(60_000) as i64;
        let mut chunk_start = range_start_ms;
        while chunk_start < range_end_ms {
            let chunk_end = chunk_start.saturating_add(chunk_ms).min(range_end_ms);
            self.backfill_pair_trades_for_chunk(
                subscription.clone(),
                chunk_start,
                chunk_end,
                max_batch_rows,
                max_batches,
            )
            .await?;
            chunk_start = chunk_end;
        }
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

        while next_start < chunk_end_ms && batches_used < max_batches {
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
                    if self.inner.config.historical_trade_backfill_use_rowbinary_insert {
                        self.inner
                            .database
                            .upsert_trades_batch_rowbinary(&buffered_events)
                            .await?;
                    } else {
                        self.inner
                            .database
                            .upsert_trades_batch(&buffered_events)
                            .await?;
                    }
                    let flush_ms = flush_started.elapsed().as_millis() as u64;
                    total_rows_flushed_to_clickhouse =
                        total_rows_flushed_to_clickhouse.saturating_add(flush_rows);
                    let flush_rows_per_sec = if flush_ms > 0 {
                        (flush_rows as u128)
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
                        rows_this_flush = flush_rows,
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
                .clamp(0, chunk_end_ms.saturating_sub(chunk_start_ms)) as f64;
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
            if self.inner.config.historical_trade_backfill_use_rowbinary_insert {
                self.inner
                    .database
                    .upsert_trades_batch_rowbinary(&buffered_events)
                    .await?;
            } else {
                self.inner
                    .database
                    .upsert_trades_batch(&buffered_events)
                    .await?;
            }
            let flush_ms = flush_started.elapsed().as_millis() as u64;
            total_rows_flushed_to_clickhouse =
                total_rows_flushed_to_clickhouse.saturating_add(flush_rows);
            let flush_rows_per_sec = if flush_ms > 0 {
                (flush_rows as u128)
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
                rows_this_flush = flush_rows,
                clickhouse_insert_batch_rows_target = insert_batch_rows,
                total_rows_flushed_to_clickhouse,
                flush_duration_ms = flush_ms,
                flush_rows_per_sec,
                binance_pages_fetched,
                elapsed_chunk_ms = chunk_retrieval_started_at.elapsed().as_millis() as u64,
                "historical trade backfill final ClickHouse insert progress"
            );
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

        if batches_used >= max_batches {
            tracing::warn!(
                table = "market_data_trades",
                pair_code = %subscription.pair_code,
                chunk_start_ms,
                chunk_end_ms,
                batch_limit = max_batches,
                batch_size = max_batch_rows,
                "trade backfill for chunk stopped after reaching max batches; consider increasing HISTORICAL_TRADE_BACKFILL_MAX_BATCHES"
            );
        }

        Ok(())
    }

    async fn backfill_pair_book_ticker(&self, subscription: PairStreamSubscription) -> Result<()> {
        let now_ms = Utc::now().timestamp_millis();
        let stale_after_ms = self
            .inner
            .config
            .historical_book_ticker_backfill_interval_ms as i64;

        let should_fetch = match self
            .inner
            .database
            .latest_book_ticker_checkpoint(&subscription.pair_code)
            .await?
        {
            Some(checkpoint)
                if now_ms.saturating_sub(checkpoint.latest_occurred_at_ms) <= stale_after_ms =>
            {
                false
            }
            Some(checkpoint) => {
                tracing::info!(
                    pair_code = %subscription.pair_code,
                    latest_book_ticker_ms = checkpoint.latest_occurred_at_ms,
                    checkpoint_order_book_update_id = checkpoint.order_book_update_id,
                    stale_after_ms,
                    "book-ticker checkpoint stale; requesting Binance REST snapshot"
                );
                true
            }
            None => {
                tracing::info!(
                    pair_code = %subscription.pair_code,
                    "no book-ticker checkpoint found; requesting initial Binance REST snapshot"
                );
                true
            }
        };

        if !should_fetch {
            return Ok(());
        }

        let row = self
            .fetch_binance_json::<BinanceDepthBookTickerRestRow>(
                "/api/v3/depth",
                &[
                    ("symbol", subscription.symbol.clone()),
                    ("limit", "5".to_string()),
                ],
            )
            .await?;

        let top_bid = row
            .bids
            .first()
            .context("depth response returned empty bids")?;
        let top_ask = row
            .asks
            .first()
            .context("depth response returned empty asks")?;
        let row = serde_json::json!({
            "symbol": &subscription.symbol,
            "bidPrice": top_bid[0],
            "bidQty": top_bid[1],
            "askPrice": top_ask[0],
            "askQty": top_ask[1],
            "updateId": row.last_update_id,
        });

        let event =
            normalize_rest_book_ticker(&subscription, row, &self.inner.config.service_name)?;
        self.process_book_ticker_event(event).await?;
        tracing::info!(
            table = "market_data_book_tickers",
            pair_code = %subscription.pair_code,
            inserted_rows = 1,
            "inserted book-ticker backfill snapshot into ClickHouse"
        );
        Ok(())
    }

    async fn process_kline_event(&self, event: NormalizedKlineEvent) -> Result<()> {
        if self.dedup(&event.event_id).await {
            return Ok(());
        }

        if let Err(error) = self.inner.database.upsert_kline(&event).await {
            self.inner.metrics.kline_store_failures_total.inc();
            self.inner.metrics.database_connected.set(0);
            {
                let mut status = self.inner.runtime_status.write().await;
                status.database.connected = false;
                status.database.last_backfill_error = Some(error.to_string());
            }
            return Err(error);
        }

        self.inner.metrics.database_connected.set(1);
        self.publish_json(
            &self.inner.config.market_data_klines_topic,
            format!(
                "{}:{}:{}",
                event.pair_code, event.timeframe_code, event.open_time
            ),
            &event,
        )
        .await?;
        self.inner.metrics.kline_publish_total.inc();
        self.mark_kafka_producer(true, None).await;
        tracing::debug!(
            table = "market_data_klines",
            pair_code = %event.pair_code,
            timeframe_code = %event.timeframe_code,
            ingestion_mode = %event.ingestion_mode,
            inserted_rows = 1,
            "stored kline row in ClickHouse"
        );
        Ok(())
    }

    async fn process_trade_event(&self, event: NormalizedTradeEvent) -> Result<()> {
        if self.dedup(&event.event_id).await {
            return Ok(());
        }

        if event.ingestion_mode == "live" {
            self.inner
                .live_trade_tx
                .send(event.clone())
                .await
                .context("live trade writer channel closed")?;
        } else if let Err(error) = self.inner.database.upsert_trade(&event).await {
                self.inner.metrics.trade_store_failures_total.inc();
                self.inner.metrics.database_connected.set(0);
                {
                    let mut status = self.inner.runtime_status.write().await;
                    status.database.connected = false;
                    status.database.last_backfill_error = Some(error.to_string());
                }
                return Err(error);
        }

        if event.ingestion_mode != "live" {
            self.inner.metrics.database_connected.set(1);
        }

        if event.ingestion_mode == "live" {
            self.publish_json(
                &self.inner.config.market_data_trades_topic,
                format!("{}:{}", event.pair_code, event.aggregate_trade_id),
                &event,
            )
            .await?;
            self.inner.metrics.trade_publish_total.inc();
            self.mark_kafka_producer(true, None).await;
        }
        tracing::debug!(
            table = "market_data_trades",
            pair_code = %event.pair_code,
            ingestion_mode = %event.ingestion_mode,
            inserted_rows = 1,
            "stored trade row in ClickHouse"
        );
        Ok(())
    }

    async fn process_book_ticker_event(&self, event: NormalizedBookTickerEvent) -> Result<()> {
        if self.dedup(&event.event_id).await {
            return Ok(());
        }

        if let Err(error) = self.inner.database.upsert_book_ticker(&event).await {
            self.inner.metrics.book_ticker_store_failures_total.inc();
            self.inner.metrics.database_connected.set(0);
            {
                let mut status = self.inner.runtime_status.write().await;
                status.database.connected = false;
                status.database.last_backfill_error = Some(error.to_string());
            }
            return Err(error);
        }

        self.inner.metrics.database_connected.set(1);

        if event.ingestion_mode == "live" {
            self.publish_json(
                &self.inner.config.market_data_book_tickers_topic,
                format!("{}:{}", event.pair_code, event.order_book_update_id),
                &event,
            )
            .await?;
            self.inner.metrics.book_ticker_publish_total.inc();
            self.mark_kafka_producer(true, None).await;
        }
        tracing::debug!(
            table = "market_data_book_tickers",
            pair_code = %event.pair_code,
            ingestion_mode = %event.ingestion_mode,
            inserted_rows = 1,
            "stored book-ticker row in ClickHouse"
        );
        Ok(())
    }

    async fn fetch_binance_json<T>(&self, path: &str, query: &[(&str, String)]) -> Result<T>
    where
        T: DeserializeOwned,
    {
        let url = format!("{}{}", self.inner.config.binance_rest_base_url, path);
        let mut backoff_ms = self.inner.config.binance_rest_retry_backoff_ms;

        for attempt in 0..=self.inner.config.binance_rest_max_retries {
            let response = self.inner.http_client.get(&url).query(query).send().await?;

            if response.status().is_success() {
                return Ok(response.json::<T>().await?);
            }

            let status = response.status();
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

            if should_retry && attempt < self.inner.config.binance_rest_max_retries {
                tokio::time::sleep(Duration::from_millis(retry_after_ms.unwrap_or(backoff_ms)))
                    .await;
                backoff_ms = backoff_ms.saturating_mul(2);
                continue;
            }

            return Err(anyhow::anyhow!(
                "Binance REST {} failed with status {}: {}",
                path,
                status,
                body
            ));
        }

        unreachable!("retry loop should have returned on success or terminal failure");
    }

    async fn publish_json<T: Serialize>(&self, topic: &str, key: String, value: &T) -> Result<()> {
        let payload = serde_json::to_string(value)?;
        self.inner
            .kafka_producer
            .send(
                FutureRecord::to(topic).payload(&payload).key(&key),
                Duration::from_secs(5),
            )
            .await
            .map_err(|(error, _)| anyhow::anyhow!(error.to_string()))?;
        Ok(())
    }

    async fn dedup(&self, key: &str) -> bool {
        let mut deduper = self.inner.deduper.lock().await;
        if deduper.contains(&key.to_string()) {
            return true;
        }

        deduper.put(key.to_string(), ());
        false
    }

    async fn mark_kafka_producer(&self, connected: bool, error: Option<String>) {
        self.inner
            .metrics
            .kafka_producer_connected
            .set(if connected { 1 } else { 0 });
        let mut status = self.inner.runtime_status.write().await;
        status.kafka.producer_connected = connected;
        if let Some(error) = error {
            status.kafka.last_error = Some(error);
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

    async fn mark_stream(
        &self,
        connected: bool,
        stream_url: Option<String>,
        last_message_at: Option<String>,
        last_error: Option<String>,
    ) {
        self.inner
            .metrics
            .stream_connected
            .set(if connected { 1 } else { 0 });
        let mut status = self.inner.runtime_status.write().await;
        status.stream.connected = connected;
        status.stream.stream_url = stream_url;
        if let Some(last_message_at) = last_message_at {
            status.stream.last_message_at = Some(last_message_at);
        }
        if let Some(last_error) = last_error {
            status.stream.last_error = Some(last_error);
        }
    }
}

fn estimate_warmup_candles(
    record: &ResolvedAnalysisSettingsRecord,
    default_warmup_multiplier: usize,
) -> usize {
    let slow_period = resolve_slow_period(record).unwrap_or(21);
    slow_period
        .saturating_mul(default_warmup_multiplier)
        .max(slow_period)
}

fn resolve_slow_period(record: &ResolvedAnalysisSettingsRecord) -> Option<usize> {
    let strategy_kind = record
        .strategy
        .parameters
        .as_object()
        .and_then(|parameters| parameters.get("kind"))
        .and_then(Value::as_str)
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| record.strategy.name.to_ascii_lowercase());

    if strategy_kind != "emacross" {
        return None;
    }

    json_usize(
        record
            .technical_analysis_settings
            .as_object()
            .and_then(|settings| settings.get("slowPeriod")),
    )
    .or_else(|| {
        json_usize(
            record
                .strategy
                .parameters
                .as_object()
                .and_then(|parameters| parameters.get("slowPeriod")),
        )
    })
}

fn json_usize(value: Option<&Value>) -> Option<usize> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
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

fn build_stream_maps(
    active: &ActiveSubscriptions,
) -> (
    HashMap<String, KlineSubscription>,
    HashMap<String, PairStreamSubscription>,
) {
    let kline_by_stream = active
        .kline_subscriptions
        .iter()
        .cloned()
        .map(|subscription| (subscription.stream_name.to_lowercase(), subscription))
        .collect::<HashMap<_, _>>();
    let mut pair_by_stream = HashMap::new();
    for subscription in &active.pair_subscriptions {
        pair_by_stream.insert(
            subscription.trade_stream_name.to_lowercase(),
            subscription.clone(),
        );
        pair_by_stream.insert(
            subscription.book_ticker_stream_name.to_lowercase(),
            subscription.clone(),
        );
    }

    (kline_by_stream, pair_by_stream)
}
