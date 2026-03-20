use std::{collections::HashMap, sync::Arc, time::Duration};

use anyhow::Result;
use chrono::Utc;
use futures_util::StreamExt;
use rdkafka::{
    ClientConfig, Message,
    consumer::{Consumer, StreamConsumer},
    producer::{FutureProducer, FutureRecord},
};
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{Mutex, RwLock, mpsc, watch},
    task::JoinHandle,
    time::MissedTickBehavior,
};

use crate::{
    config::AppConfig,
    kafka_topics::ensure_topics,
    metrics::Metrics,
    models::{
        AnalysisSummary, MarketDataKlineEvent, PersistedKlineRecord, ResolvedAnalysisSettingsRecord,
    },
    strategy_logic::{AnalysisEvaluator, build_analysis_spec},
};

#[derive(Clone)]
pub struct StrategyEngineService {
    inner: Arc<Inner>,
}

struct Inner {
    config: AppConfig,
    metrics: Metrics,
    control_plane_client: reqwest::Client,
    market_data_client: reqwest::Client,
    kafka_producer: FutureProducer,
    runtime_status: RwLock<RuntimeStatus>,
    analyses_by_id: Mutex<HashMap<String, AnalysisEvaluator>>,
    analyses_by_subscription: RwLock<HashMap<String, Vec<String>>>,
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
    pub analyses: AnalysesStatus,
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
    pub consumer_connected: bool,
    pub producer_connected: bool,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysesStatus {
    pub active_count: usize,
    pub ignored_count: usize,
    pub last_signal_at: Option<String>,
    pub last_signal_error: Option<String>,
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
    pub kafka_consumer: String,
    pub kafka_producer: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigChangeEventEnvelope {
    resource_type: String,
}

impl StrategyEngineService {
    pub async fn new(config: AppConfig) -> Result<Self> {
        ensure_topics(
            &config.kafka_bootstrap_servers,
            &[
                &config.config_change_events_topic,
                &config.market_data_klines_topic,
                &config.strategy_signals_topic,
            ],
        )
        .await?;
        let control_plane_client = reqwest::Client::builder()
            .timeout(Duration::from_millis(
                config.control_plane_request_timeout_ms,
            ))
            .build()?;
        let market_data_client = reqwest::Client::builder()
            .timeout(Duration::from_millis(config.market_data_request_timeout_ms))
            .build()?;
        let metrics = Metrics::new()?;

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
                consumer_connected: false,
                producer_connected: true,
                last_error: None,
            },
            analyses: AnalysesStatus::default(),
            otel_exporter_configured: config.otel_exporter_otlp_endpoint.is_some(),
        };

        let inner = Arc::new(Inner {
            config,
            metrics,
            control_plane_client,
            market_data_client,
            kafka_producer,
            runtime_status: RwLock::new(runtime_status),
            analyses_by_id: Mutex::new(HashMap::new()),
            analyses_by_subscription: RwLock::new(HashMap::new()),
            refresh_tx,
            shutdown_tx,
            task_handles: Mutex::new(Vec::new()),
        });

        let service = Self { inner };
        service.start(refresh_rx).await?;
        Ok(service)
    }

    async fn start(&self, refresh_rx: mpsc::Receiver<String>) -> Result<()> {
        self.perform_refresh("startup").await?;
        {
            let mut status = self.inner.runtime_status.write().await;
            status.started = true;
        }

        let refresh_service = self.clone();
        let refresh_handle = tokio::spawn(async move {
            refresh_service.refresh_loop(refresh_rx).await;
        });

        let kafka_service = self.clone();
        let kafka_handle = tokio::spawn(async move {
            kafka_service.kafka_consumer_loop().await;
        });

        let periodic_service = self.clone();
        let periodic_handle = tokio::spawn(async move {
            periodic_service.periodic_refresh_loop().await;
        });

        let mut handles = self.inner.task_handles.lock().await;
        handles.extend([refresh_handle, kafka_handle, periodic_handle]);
        Ok(())
    }

    pub async fn stop(&self) {
        let _ = self.inner.shutdown_tx.send(true);
        let mut handles = self.inner.task_handles.lock().await;
        while let Some(handle) = handles.pop() {
            let _ = handle.await;
        }
    }

    pub fn config_snapshot(&self) -> AppConfig {
        self.inner.config.clone()
    }

    pub fn metrics_text(&self) -> Result<String> {
        self.inner.metrics.encode().map_err(Into::into)
    }

    pub async fn status(&self) -> RuntimeStatus {
        self.inner.runtime_status.read().await.clone()
    }

    pub async fn readiness(&self) -> ReadinessPayload {
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
        let kafka_consumer = if status.kafka.consumer_connected {
            "up"
        } else {
            "down"
        };
        let kafka_producer = if status.kafka.producer_connected {
            "up"
        } else {
            "down"
        };
        let status_text =
            if runtime_config == "up" && kafka_consumer == "up" && kafka_producer == "up" {
                "ok"
            } else {
                "degraded"
            };

        ReadinessPayload {
            status: status_text.to_string(),
            service: self.inner.config.service_name.clone(),
            checks: ReadinessChecks {
                runtime_config: runtime_config.to_string(),
                kafka_consumer: kafka_consumer.to_string(),
                kafka_producer: kafka_producer.to_string(),
            },
        }
    }

    pub async fn analyses(&self) -> Vec<AnalysisSummary> {
        self.inner
            .analyses_by_id
            .lock()
            .await
            .values()
            .map(AnalysisEvaluator::summary)
            .collect()
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
                        tracing::warn!(?error, reason, "strategy-engine refresh failed");
                        let mut status = self.inner.runtime_status.write().await;
                        status.runtime_config.last_error = Some(error.to_string());
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

    async fn kafka_consumer_loop(&self) {
        let consumer = match ClientConfig::new()
            .set(
                "bootstrap.servers",
                &self.inner.config.kafka_bootstrap_servers,
            )
            .set(
                "group.id",
                format!("{}-consumer", self.inner.config.service_name),
            )
            .set("enable.partition.eof", "false")
            .set("session.timeout.ms", "6000")
            .set("enable.auto.commit", "true")
            .set("auto.offset.reset", "latest")
            .create::<StreamConsumer>()
        {
            Ok(consumer) => consumer,
            Err(error) => {
                self.mark_kafka_consumer(false, Some(error.to_string()))
                    .await;
                return;
            }
        };

        if let Err(error) = consumer.subscribe(&[
            &self.inner.config.config_change_events_topic,
            &self.inner.config.market_data_klines_topic,
        ]) {
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
                            let topic = message.topic().to_string();
                            if let Some(payload) = message.payload_view::<str>().transpose().ok().flatten() {
                                if topic == self.inner.config.config_change_events_topic {
                                    if let Ok(event) = serde_json::from_str::<ConfigChangeEventEnvelope>(payload)
                                        && should_refresh_for_config_resource(&event.resource_type) {
                                        let _ = self.inner.refresh_tx.send(format!("config-change:{}", event.resource_type)).await;
                                    }
                                } else if topic == self.inner.config.market_data_klines_topic
                                    && let Ok(event) = serde_json::from_str::<MarketDataKlineEvent>(payload) {
                                    if let Err(error) = self.process_kline_event(event).await {
                                        tracing::warn!(?error, "failed to process market-data kline");
                                    }
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

    async fn perform_refresh(&self, reason: &str) -> Result<()> {
        let records = self.fetch_resolved_analysis_settings().await?;
        let mut grouped_history_limits = HashMap::<String, usize>::new();
        let mut supported_specs = Vec::new();
        let mut ignored_count = 0usize;

        for record in &records {
            match build_analysis_spec(record)? {
                Some(spec) => {
                    let key = subscription_key(&spec.symbol, &spec.timeframe_code);
                    let limit =
                        (spec.slow_period + 2).min(self.inner.config.strategy_warmup_history_limit);
                    grouped_history_limits
                        .entry(key)
                        .and_modify(|current| *current = (*current).max(limit))
                        .or_insert(limit);
                    supported_specs.push(spec);
                }
                None => ignored_count += 1,
            }
        }

        let mut history_by_subscription = HashMap::<String, Vec<PersistedKlineRecord>>::new();
        for (key, limit) in &grouped_history_limits {
            let (pair_code, timeframe_code) = key
                .split_once(':')
                .expect("subscription key should contain pair/timeframe");
            let rows = self
                .fetch_recent_klines(pair_code, timeframe_code, *limit)
                .await
                .unwrap_or_default();
            history_by_subscription.insert(key.clone(), rows);
        }

        let mut analyses_by_id = HashMap::new();
        let mut analyses_by_subscription = HashMap::<String, Vec<String>>::new();
        for spec in supported_specs {
            let key = subscription_key(&spec.symbol, &spec.timeframe_code);
            let history = history_by_subscription
                .get(&key)
                .cloned()
                .unwrap_or_default();
            let analysis_setting_id = spec.analysis_setting_id.clone();
            let mut evaluator = AnalysisEvaluator::new(spec);
            evaluator.warm_from_klines(&history);
            analyses_by_subscription
                .entry(key)
                .or_default()
                .push(analysis_setting_id.clone());
            analyses_by_id.insert(analysis_setting_id, evaluator);
        }

        {
            let mut active_analyses = self.inner.analyses_by_id.lock().await;
            *active_analyses = analyses_by_id;
        }
        *self.inner.analyses_by_subscription.write().await = analyses_by_subscription;

        {
            let active_count = self.inner.analyses_by_id.lock().await.len();
            let mut status = self.inner.runtime_status.write().await;
            status.runtime_config.loaded = true;
            status.runtime_config.last_refreshed_at = Some(Utc::now().to_rfc3339());
            status.runtime_config.last_error = None;
            status.analyses.active_count = active_count;
            status.analyses.ignored_count = ignored_count;
        }

        self.inner.metrics.runtime_config_loaded.set(1);
        let active_count = self.inner.analyses_by_id.lock().await.len();
        self.inner.metrics.active_analyses.set(active_count as i64);
        self.inner
            .metrics
            .ignored_analyses
            .set(ignored_count as i64);
        self.inner.metrics.config_refresh_total.inc();

        tracing::info!(
            reason,
            active_analyses = active_count,
            ignored_analyses = ignored_count,
            "refreshed strategy-engine analyses from control-plane"
        );
        Ok(())
    }

    async fn process_kline_event(&self, event: MarketDataKlineEvent) -> Result<()> {
        if !event.closed || event.ingestion_mode != "live" {
            return Ok(());
        }

        self.inner.metrics.processed_closed_klines_total.inc();
        let subscription_key = subscription_key(&event.pair_code, &event.timeframe_code);
        let analysis_ids = self
            .inner
            .analyses_by_subscription
            .read()
            .await
            .get(&subscription_key)
            .cloned()
            .unwrap_or_default();
        if analysis_ids.is_empty() {
            return Ok(());
        }

        let mut analyses_by_id = self.inner.analyses_by_id.lock().await;
        for analysis_id in analysis_ids {
            let Some(analysis) = analyses_by_id.get_mut(&analysis_id) else {
                continue;
            };
            if let Some(signal) = analysis.process_live_kline(&event) {
                let payload = analysis.to_signal_event(signal, &self.inner.config.service_name);
                self.publish_json(
                    &self.inner.config.strategy_signals_topic,
                    format!("{}:{}", payload.analysis_setting_id, payload.close_time),
                    &payload,
                )
                .await?;
                self.inner.metrics.emitted_signals_total.inc();
                self.mark_kafka_producer(true, None).await;

                let mut status = self.inner.runtime_status.write().await;
                status.analyses.last_signal_at = Some(Utc::now().to_rfc3339());
                status.analyses.last_signal_error = None;
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
            .control_plane_client
            .get(url)
            .send()
            .await?
            .error_for_status()?;
        Ok(response
            .json::<Vec<ResolvedAnalysisSettingsRecord>>()
            .await?)
    }

    async fn fetch_recent_klines(
        &self,
        pair_code: &str,
        timeframe_code: &str,
        limit: usize,
    ) -> Result<Vec<PersistedKlineRecord>> {
        let url = format!(
            "{}/v1/klines/{}/{}",
            self.inner.config.market_data_base_url.trim_end_matches('/'),
            pair_code,
            timeframe_code
        );
        let response = self
            .inner
            .market_data_client
            .get(url)
            .query(&[("limit", limit)])
            .send()
            .await?
            .error_for_status()?;
        Ok(response.json::<Vec<PersistedKlineRecord>>().await?)
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

    async fn mark_kafka_producer(&self, connected: bool, error: Option<String>) {
        self.inner
            .metrics
            .kafka_producer_connected
            .set(if connected { 1 } else { 0 });
        let mut status = self.inner.runtime_status.write().await;
        status.kafka.producer_connected = connected;
        if let Some(error) = error {
            status.kafka.last_error = Some(error.clone());
            status.analyses.last_signal_error = Some(error);
        }
    }
}

fn subscription_key(pair_code: &str, timeframe_code: &str) -> String {
    format!("{pair_code}:{timeframe_code}")
}

fn should_refresh_for_config_resource(resource_type: &str) -> bool {
    matches!(
        resource_type,
        "pairs"
            | "timeframes"
            | "strategies"
            | "risk_profiles"
            | "trading_defaults"
            | "analysis_settings"
    )
}
