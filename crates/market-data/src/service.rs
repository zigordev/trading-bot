use std::{
    collections::HashMap,
    num::NonZeroUsize,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
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
    db::Database,
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
    deduper: Mutex<LruCache<String, ()>>,
    compaction_gate: Mutex<()>,
    refresh_tx: mpsc::Sender<String>,
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
            deduper: Mutex::new(LruCache::new(
                NonZeroUsize::new(10_000).expect("dedup capacity should be non-zero"),
            )),
            compaction_gate: Mutex::new(()),
            refresh_tx,
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

        let websocket_service = self.clone();
        let websocket_handle = tokio::spawn(async move {
            websocket_service.websocket_loop().await;
        });

    let mut handles = self.inner.task_handles.lock().await;
        handles.extend([
            startup_refresh_handle,
            refresh_handle,
            consumer_handle,
            periodic_handle,
            websocket_handle,
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

    async fn compaction_loop(&self) {
        let mut shutdown_rx = self.inner.shutdown_tx.subscribe();
        let mut interval = tokio::time::interval(Duration::from_millis(
            self.inner.config.historical_store_compaction_interval_ms,
        ));
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);

        if let Err(error) = self.run_market_data_compaction("startup").await {
            tracing::warn!(?error, "market-data store compaction failed");
        }

        loop {
            tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_ok() {
                        break;
                    }
                }
                _ = interval.tick() => {
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
        let records = self.fetch_resolved_analysis_settings().await?;
        let active = derive_active_subscriptions(&records)?;
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
        let _ = self.inner.subscriptions_tx.send(active.clone());

        tracing::info!(
            reason,
            kline_subscriptions = active.kline_subscriptions.len(),
            pair_subscriptions = active.pair_subscriptions.len(),
            "refreshed market-data subscriptions from control-plane"
        );

        self.run_backfill_and_gap_repair(&active).await?;
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

    async fn run_backfill_and_gap_repair(&self, active: &ActiveSubscriptions) -> Result<()> {
        let mut pair_required_period_ms = HashMap::new();
        for subscription in &active.kline_subscriptions {
            let entry = pair_required_period_ms
                .entry(subscription.pair_code.clone())
                .or_insert(subscription.period_ms);
            if subscription.period_ms > *entry {
                *entry = subscription.period_ms;
            }
        }

        let result = async {
            self.run_kline_backfill_and_gap_repair(&active.kline_subscriptions)
                .await?;
            self.run_trade_backfill_and_gap_repair(
                &active.pair_subscriptions,
                &pair_required_period_ms,
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
    ) -> Result<()> {
        let max_concurrency = self.inner.config.historical_backfill_max_concurrency;
        let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency));
        let mut tasks = Vec::with_capacity(subscriptions.len());

        for subscription in subscriptions.iter().cloned() {
            let service = self.clone();
            let permit = semaphore.clone().acquire_owned().await?;
            tasks.push(tokio::spawn(async move {
                let _permit = permit;
                service.backfill_subscription(subscription).await
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
        pair_required_period_ms: &HashMap<String, i64>,
    ) -> Result<()> {
        let max_concurrency = self.inner.config.historical_backfill_max_concurrency;
        let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency));
        let mut tasks = Vec::with_capacity(subscriptions.len());

        for subscription in subscriptions.iter().cloned() {
            let service = self.clone();
            let permit = semaphore.clone().acquire_owned().await?;
            let required_lookback_ms = pair_required_period_ms
                .get(&subscription.pair_code)
                .copied()
                .unwrap_or(60_000);
            tasks.push(tokio::spawn(async move {
                let _permit = permit;
                service
                    .backfill_pair_trades_with_lookback(subscription, required_lookback_ms)
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

    async fn backfill_subscription(&self, subscription: KlineSubscription) -> Result<()> {
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
        let required_lookback_ms =
            (self.inner.config.historical_backfill_limit as i64).saturating_mul(period_ms);
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

        while next_start_ms <= required_end_ms && remaining_loops > 0 {
            tracing::info!(
                pair_code = %subscription.pair_code,
                timeframe_code = %subscription.timeframe_code,
                binance_interval = %subscription.binance_interval,
                batch_limit,
                next_start_ms,
                required_start_ms,
                required_end_ms,
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
                self.process_kline_event(event).await?;
            }

            tracing::info!(
                pair_code = %subscription.pair_code,
                timeframe_code = %subscription.timeframe_code,
                binance_interval = %subscription.binance_interval,
                inserted_rows = rows.len(),
                "inserted kline backfill batch into ClickHouse"
            );

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
        required_period_ms: i64,
    ) -> Result<()> {
        let required_period_ms = required_period_ms.max(1);
        let max_batch_rows = self.inner.config.historical_trade_backfill_limit.min(1000);
        let max_batches = self.inner.config.historical_trade_backfill_max_batches;
        let Some(start_time) = self
            .inner
            .database
            .earliest_pair_kline_open_time(&subscription.pair_code)
            .await?
        else {
            return Ok(());
        };

        let latest_trade_checkpoint = self
            .inner
            .database
            .latest_trade_checkpoint(&subscription.pair_code)
            .await?;

        let required_window_start = Utc::now().timestamp_millis().saturating_sub(
            self.inner
                .config
                .historical_backfill_limit
                .saturating_mul(required_period_ms.max(1) as usize) as i64,
        );
        let retro_start = start_time.max(required_window_start);

        // Always run at least one time-based backfill batch from the required
        // window start (or earliest kline), even if we already have a
        // checkpoint inside the window. This allows trade history to grow
        // backwards when kline history is extended, at the cost of some
        // duplicate rows (which ClickHouse's ReplacingMergeTree can handle).
        let mut use_start_time_backfill = true;
        let mut next_start_time = Some(retro_start);
        let mut next_from_id = None;

        if let Some(checkpoint) = latest_trade_checkpoint.as_ref() {
            if checkpoint.trade_time < required_window_start {
                // Checkpoint is older than our required window; ignore it and
                // rebuild trades for the current window from time-based
                // backfill.
                tracing::info!(
                    pair_code = %subscription.pair_code,
                    required_window_start_ms = required_window_start,
                    checkpoint_trade_time_ms = checkpoint.trade_time,
                    earliest_kline_open_time = start_time,
                    "trade checkpoint is before required lookback window; rebuilding historical trades from required window start"
                );
            } else {
                // Checkpoint is within the required window. We'll first run a
                // time-based batch from retro_start, then continue forward from
                // the checkpoint using fromId pagination.
                next_from_id = Some(checkpoint.aggregate_trade_id + 1);
                tracing::info!(
                    pair_code = %subscription.pair_code,
                    required_window_start_ms = required_window_start,
                    checkpoint_trade_time_ms = checkpoint.trade_time,
                    earliest_kline_open_time = start_time,
                    "trade checkpoint is within required lookback window; running time-based repair then continuing from checkpoint"
                );
            }
        } else {
            tracing::info!(
                pair_code = %subscription.pair_code,
                earliest_kline_open_time = start_time,
                required_window_start_ms = required_window_start,
                "trade checkpoint not found; repairing trade history from earliest kline/required window start"
            );
        }

        let mut hit_batch_cap = false;
        let required_window_end = Utc::now().timestamp_millis();

        for batch_idx in 0..max_batches {
            let mut query = vec![
                ("symbol", subscription.symbol.clone()),
                ("limit", max_batch_rows.to_string()),
            ];

            if use_start_time_backfill {
                if let Some(start_time) = next_start_time {
                    query.push(("startTime", start_time.to_string()));
                }
            } else if let Some(from_id) = next_from_id {
                query.push(("fromId", from_id.to_string()));
            } else if let Some(start_time) = next_start_time {
                query.push(("startTime", start_time.to_string()));
            }

            let rows = self
                .fetch_binance_json::<Vec<Value>>("/api/v3/aggTrades", &query)
                .await?;
            if rows.is_empty() {
                break;
            }
            let row_count = rows.len();

            let mut first_trade_time_ms: Option<i64> = None;
            let mut last_trade_time_ms: Option<i64> = None;
            let mut last_trade_id = None;
            for row in rows {
                let event =
                    normalize_rest_trade(&subscription, row, &self.inner.config.service_name)?;
                if first_trade_time_ms.is_none() {
                    first_trade_time_ms = Some(event.trade_time);
                }
                last_trade_time_ms = Some(event.trade_time);
                last_trade_id = Some(event.aggregate_trade_id);
                self.process_trade_event(event).await?;
            }

            tracing::info!(
                pair_code = %subscription.pair_code,
                inserted_rows = row_count,
                first_trade_time_ms = first_trade_time_ms,
                last_trade_time_ms = last_trade_time_ms,
                "inserted trade backfill batch into ClickHouse"
            );

            let Some(last_trade_id) = last_trade_id else {
                break;
            };

            if use_start_time_backfill {
                use_start_time_backfill = false;
            }
            next_from_id = Some(last_trade_id + 1);
            next_start_time = None;

            if batch_idx == max_batches - 1 && row_count >= max_batch_rows {
                hit_batch_cap = true;
            }

            // Stop when we've paged through the required window; otherwise
            // continue advancing, even if the current batch is smaller than
            // max_batch_rows, so we don't prematurely stop in sparse periods.
            if let Some(last_time) = last_trade_time_ms {
                if last_time >= required_window_end {
                    break;
                }
            }
        }

        if hit_batch_cap {
            tracing::warn!(
                pair_code = %subscription.pair_code,
                batch_limit = max_batches,
                batch_size = max_batch_rows,
                required_window_start_ms = required_window_start,
                "trade backfill stopped after reaching max batches; consider increasing HISTORICAL_TRADE_BACKFILL_MAX_BATCHES"
            );
        }

        // Log final trade coverage for the required window so operators can see
        // what ClickHouse contains for this pair after trade backfill.
        let coverage_end_ms = Utc::now().timestamp_millis();
        match self
            .inner
            .database
            .trade_window_coverage_in_range(
                &subscription.pair_code,
                required_window_start,
                coverage_end_ms,
            )
            .await
        {
            Ok(coverage) => {
                tracing::info!(
                    pair_code = %subscription.pair_code,
                    coverage_start_ms = required_window_start,
                    coverage_end_ms,
                    row_count = coverage.row_count,
                    min_time = ?coverage.min_time,
                    max_time = ?coverage.max_time,
                    "trade backfill completed for pair; window coverage in ClickHouse"
                );
            }
            Err(error) => {
                tracing::warn!(
                    ?error,
                    pair_code = %subscription.pair_code,
                    coverage_start_ms = required_window_start,
                    coverage_end_ms,
                    "failed to compute trade window coverage after backfill"
                );
            }
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

        if let Err(error) = self.inner.database.upsert_trade(&event).await {
            self.inner.metrics.trade_store_failures_total.inc();
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
