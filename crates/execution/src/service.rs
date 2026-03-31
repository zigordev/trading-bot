use std::{collections::BTreeMap, sync::Arc, time::Duration};

use anyhow::{Context, Result, bail};
use futures_util::StreamExt;
use rdkafka::{
    ClientConfig, Message,
    consumer::{Consumer, StreamConsumer},
};
use reqwest::Client;
use serde::Serialize;
use tokio::{
    sync::{Mutex, RwLock},
    task::JoinHandle,
};
use tracing::{info, warn};
use trading_bot_market_data::models::{
    NormalizedKlineEvent, NormalizedTradeEvent, PersistedKlineRecord, PersistedTradeRecord,
};
use trading_bot_strategy_engine::{
    models::{MarketDataKlineEvent, PersistedKlineRecord as StrategyPersistedKlineRecord, ResolvedAnalysisSettingsRecord},
    strategy_logic::{AnalysisEvaluator, EmittedSignal, build_analysis_spec},
};

use crate::{
    binance_private::{BinancePrivateClient, ensure_no_open_orders, has_any_free_balance},
    config::AppConfig,
    metrics::Metrics,
    models::{
        ActiveExecutionContext, ExecutionPromotionRecord, ExecutionSummaryResponse,
        ExecutionTradeRecord, LocalPaperPosition,
    },
};

#[derive(Clone)]
pub struct ExecutionService {
    inner: Arc<Inner>,
}

struct Inner {
    config: AppConfig,
    metrics: Metrics,
    control_plane_client: Client,
    market_data_client: Client,
    binance_private: Option<BinancePrivateClient>,
    status: RwLock<RuntimeStatus>,
    runtime: Mutex<ExecutionRuntime>,
    task_handles: Mutex<Vec<JoinHandle<()>>>,
}

struct ExecutionRuntime {
    active_contexts: Vec<ActiveExecutionContext>,
    context_states: BTreeMap<String, ContextRuntimeState>,
    listen_key: Option<String>,
}

struct ContextRuntimeState {
    evaluator: Option<AnalysisEvaluator>,
    open_position: Option<LocalPaperPosition>,
    last_processed_kline_close_time: Option<i64>,
    last_checked_trade_time: Option<i64>,
}

fn analysis_matches_promotion(
    analysis: &ResolvedAnalysisSettingsRecord,
    promotion: &ExecutionPromotionRecord,
) -> bool {
    analysis.id == promotion.analysis_setting_id
        && analysis.symbol == promotion.symbol_code
        && analysis.timeframe_code == promotion.timeframe_code
        && analysis.strategy_name == promotion.strategy_name
        && analysis.risk_profile_name == promotion.risk_profile_name
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub started: bool,
    pub mode: String,
    pub control_plane: DependencyStatus,
    pub market_data: DependencyStatus,
    pub exchange: DependencyStatus,
    pub active_promotion: Option<ExecutionPromotionRecord>,
    pub active_promotions: Vec<ExecutionPromotionRecord>,
    pub active_analysis_id: Option<String>,
    pub active_analysis_ids: Vec<String>,
    pub paper_trade_count: usize,
    pub open_position: Option<LocalPaperPosition>,
    pub open_positions: Vec<LocalPaperPosition>,
    pub otel_exporter_configured: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub status: String,
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
    pub market_data: String,
    pub execution_context: String,
    pub exchange: String,
}

impl ExecutionService {
    pub async fn new(config: AppConfig) -> Result<Self> {
        let control_plane_client = Client::builder()
            .timeout(Duration::from_millis(config.control_plane_request_timeout_ms))
            .build()
            .context("failed to build execution control-plane HTTP client")?;
        let market_data_client = Client::builder()
            .timeout(Duration::from_millis(config.market_data_request_timeout_ms))
            .build()
            .context("failed to build execution market-data HTTP client")?;
        let metrics = Metrics::new()?;
        let binance_private = BinancePrivateClient::from_config(&config).transpose()?;

        let service = Self {
            inner: Arc::new(Inner {
                metrics,
                control_plane_client,
                market_data_client,
                binance_private,
                status: RwLock::new(RuntimeStatus {
                    started: true,
                    mode: config.default_mode.clone(),
                    control_plane: DependencyStatus {
                        status: "unknown".to_string(),
                        last_checked_at: None,
                        last_error: None,
                    },
                    market_data: DependencyStatus {
                        status: "unknown".to_string(),
                        last_checked_at: None,
                        last_error: None,
                    },
                    exchange: DependencyStatus {
                        status: if config.default_mode == "live" {
                            "unknown".to_string()
                        } else {
                            "disabled".to_string()
                        },
                        last_checked_at: None,
                        last_error: None,
                    },
                    active_promotion: None,
                    active_promotions: Vec::new(),
                    active_analysis_id: None,
                    active_analysis_ids: Vec::new(),
                    paper_trade_count: 0,
                    open_position: None,
                    open_positions: Vec::new(),
                    otel_exporter_configured: config.otel_exporter_otlp_endpoint.is_some(),
                }),
                runtime: Mutex::new(ExecutionRuntime {
                    active_contexts: Vec::new(),
                    context_states: BTreeMap::new(),
                    listen_key: None,
                }),
                task_handles: Mutex::new(Vec::new()),
                config,
            }),
        };

        service.refresh_from_control_plane().await?;
        service.run_startup_reconciliation().await?;
        service.spawn_loops().await;
        Ok(service)
    }

    pub fn config_snapshot(&self) -> AppConfig {
        self.inner.config.clone()
    }

    pub async fn status(&self) -> RuntimeStatus {
        self.inner.status.read().await.clone()
    }

    pub async fn readiness(&self) -> ReadinessPayload {
        let status = self.status().await;
        let control_plane_ok = status.control_plane.status == "up";
        let market_data_ok = status.market_data.status == "up" || status.market_data.status == "idle";
        let execution_context_ok =
            !status.active_promotions.is_empty() || self.inner.config.default_mode == "paper";
        let exchange_ok = if status.mode == "live" {
            status.exchange.status == "up"
        } else {
            true
        };

        ReadinessPayload {
            status: if control_plane_ok && market_data_ok && execution_context_ok && exchange_ok {
                "ok".to_string()
            } else {
                "degraded".to_string()
            },
            service: self.inner.config.service_name.clone(),
            checks: ReadinessChecks {
                control_plane: if control_plane_ok { "up" } else { "down" }.to_string(),
                market_data: if market_data_ok { "up" } else { "down" }.to_string(),
                execution_context: if execution_context_ok { "up" } else { "down" }.to_string(),
                exchange: if exchange_ok { "up" } else { "down" }.to_string(),
            },
        }
    }

    pub fn metrics_text(&self) -> Result<String> {
        self.inner.metrics.encode()
    }

    pub async fn active_promotion(&self) -> Option<ExecutionPromotionRecord> {
        self.inner.status.read().await.active_promotion.clone()
    }

    pub async fn stop(&self) {
        let mut handles = self.inner.task_handles.lock().await;
        while let Some(handle) = handles.pop() {
            handle.abort();
        }
    }

    async fn spawn_loops(&self) {
        let refresh_service = self.clone();
        let refresh_interval_ms = self.inner.config.refresh_interval_ms;
        let refresh_handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(refresh_interval_ms));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                interval.tick().await;
                if let Err(error) = refresh_service.refresh_from_control_plane().await {
                    warn!(error = %error, "execution control-plane refresh failed");
                }
            }
        });

        let consumer_service = self.clone();
        let consumer_handle = tokio::spawn(async move {
            consumer_service.market_data_consumer_loop().await;
        });

        let mut handles = self.inner.task_handles.lock().await;
        handles.push(refresh_handle);
        handles.push(consumer_handle);
    }

    async fn refresh_from_control_plane(&self) -> Result<()> {
        self.inner.metrics.refresh_total.inc();

        let summary = self
            .fetch_json::<ExecutionSummaryResponse>("/v1/ops/execution/summary")
            .await;
        let analyses = self
            .fetch_json::<Vec<ResolvedAnalysisSettingsRecord>>("/v1/runtime-config/analysis-settings")
            .await;

        let now = current_timestamp();
        let (summary, analyses) = match (summary, analyses) {
            (Ok(summary), Ok(analyses)) => (summary, analyses),
            (Err(error), _) | (_, Err(error)) => {
                self.inner.metrics.control_plane_connected.set(0);
                self.inner.metrics.active_promotion_loaded.set(0);
                let mut status = self.inner.status.write().await;
                status.control_plane = DependencyStatus {
                    status: "down".to_string(),
                    last_checked_at: Some(now),
                    last_error: Some(error.to_string()),
                };
                return Err(error);
            }
        };

        self.inner.metrics.control_plane_connected.set(1);
        let active_promotions = if summary.active_promotions.is_empty() {
            summary.active_promotion.clone().into_iter().collect::<Vec<_>>()
        } else {
            summary.active_promotions.clone()
        };
        self.inner
            .metrics
            .active_promotion_loaded
            .set(if active_promotions.is_empty() { 0 } else { 1 });

        let next_contexts = active_promotions
            .into_iter()
            .filter_map(|promotion| {
                analyses
                    .iter()
                    .find(|analysis| analysis_matches_promotion(analysis, &promotion))
                    .cloned()
                    .map(|analysis| ActiveExecutionContext { promotion, analysis })
            })
            .collect::<Vec<_>>();

        let previous_keys;
        let next_keys = next_contexts
            .iter()
            .map(|context| context.promotion.promotion_id.clone())
            .collect::<Vec<_>>();
        {
            let mut runtime = self.inner.runtime.lock().await;
            previous_keys = runtime
                .active_contexts
                .iter()
                .map(|context| context.promotion.promotion_id.clone())
                .collect::<Vec<_>>();
            runtime
                .context_states
                .retain(|promotion_id, state| {
                    next_keys.iter().any(|key| key == promotion_id) || state.open_position.is_some()
                });
            for context in &next_contexts {
                runtime
                    .context_states
                    .entry(context.promotion.promotion_id.clone())
                    .or_insert(ContextRuntimeState {
                        evaluator: None,
                        open_position: None,
                        last_processed_kline_close_time: None,
                        last_checked_trade_time: None,
                    });
            }
            runtime.active_contexts = next_contexts.clone();
        }

        let added_contexts = next_contexts
            .iter()
            .filter(|context| !previous_keys.iter().any(|key| key == &context.promotion.promotion_id))
            .cloned()
            .collect::<Vec<_>>();
        if next_contexts.is_empty() {
            self.mark_market_data("idle", None).await;
        } else {
            for context in &added_contexts {
                self.warm_context_from_market_data(context).await?;
            }
        }

        let mode = next_contexts
            .first()
            .map(|item| item.promotion.mode.clone())
            .unwrap_or_else(|| self.inner.config.default_mode.clone());
        self.inner
            .metrics
            .paper_mode_enabled
            .set(if mode == "paper" { 1 } else { 0 });

        let open_positions = {
            let runtime = self.inner.runtime.lock().await;
            runtime
                .context_states
                .values()
                .filter_map(|state| state.open_position.clone())
                .collect::<Vec<_>>()
        };
        let active_promotion = next_contexts.first().map(|context| context.promotion.clone());
        let mut status = self.inner.status.write().await;
        status.mode = mode;
        status.control_plane = DependencyStatus {
            status: "up".to_string(),
            last_checked_at: Some(now),
            last_error: None,
        };
        status.active_promotion = active_promotion.clone();
        status.active_promotions = next_contexts
            .iter()
            .map(|context| context.promotion.clone())
            .collect();
        status.active_analysis_id = next_contexts.first().map(|context| context.analysis.id.clone());
        status.active_analysis_ids = next_contexts
            .iter()
            .map(|context| context.analysis.id.clone())
            .collect();
        status.paper_trade_count = summary.recent_trades.len();
        status.open_position = open_positions.first().cloned();
        status.open_positions = open_positions;

        Ok(())
    }

    async fn warm_context_from_market_data(&self, context: &ActiveExecutionContext) -> Result<()> {
        let klines = self
            .fetch_market_json::<Vec<PersistedKlineRecord>>(&format!(
                "/v1/klines/{}/{}?limit=250",
                context.promotion.symbol_code, context.promotion.timeframe_code
            ))
            .await?;
        self.rebuild_evaluator_if_needed(context, &klines).await?;
        self.mark_market_data("up", None).await;
        Ok(())
    }

    async fn run_startup_reconciliation(&self) -> Result<()> {
        if self.inner.config.default_mode != "live" {
            return Ok(());
        }

        let Some(binance) = self.inner.binance_private.as_ref() else {
            bail!("live mode requested without Binance private client");
        };

        let open_orders = binance.get_open_orders().await?;
        ensure_no_open_orders(&open_orders)?;
        let account = binance.get_account_information().await?;
        if !has_any_free_balance(&account) {
            warn!("live startup reconciliation found no free balance");
        }

        let listen_key = binance.create_listen_key().await?;
        let now = current_timestamp();
        self.inner.runtime.lock().await.listen_key = Some(listen_key);
        let mut status = self.inner.status.write().await;
        status.exchange = DependencyStatus {
            status: "up".to_string(),
            last_checked_at: Some(now),
            last_error: None,
        };
        Ok(())
    }

    async fn market_data_consumer_loop(&self) {
        let consumer = match ClientConfig::new()
            .set(
                "bootstrap.servers",
                &self.inner.config.kafka_bootstrap_servers,
            )
            .set(
                "group.id",
                &self.inner.config.market_data_events_consumer_group_id,
            )
            .set("enable.partition.eof", "false")
            .set("session.timeout.ms", "6000")
            .set("enable.auto.commit", "true")
            .create::<StreamConsumer>()
        {
            Ok(consumer) => consumer,
            Err(error) => {
                self.mark_market_data("down", Some(error.to_string())).await;
                return;
            }
        };

        if let Err(error) = consumer.subscribe(&[
            &self.inner.config.market_data_kline_events_topic,
            &self.inner.config.market_data_trade_events_topic,
        ]) {
            self.mark_market_data("down", Some(error.to_string())).await;
            return;
        }

        self.mark_market_data("up", None).await;

        let mut stream = consumer.stream();
        while let Some(message) = stream.next().await {
            match message {
                Ok(message) => {
                    let topic = message.topic().to_string();
                    let payload = match message.payload_view::<str>() {
                        Some(Ok(payload)) => payload,
                        Some(Err(error)) => {
                            self.mark_market_data("down", Some(error.to_string())).await;
                            continue;
                        }
                        None => continue,
                    };

                    if topic == self.inner.config.market_data_kline_events_topic {
                        match serde_json::from_str::<NormalizedKlineEvent>(payload) {
                            Ok(event) => {
                                if let Err(error) = self.process_live_kline_event(event).await {
                                    warn!(error = %error, "execution failed to process live kline event");
                                }
                            }
                            Err(error) => {
                                warn!(error = %error, "execution failed to deserialize live kline event");
                            }
                        }
                    } else if topic == self.inner.config.market_data_trade_events_topic {
                        match serde_json::from_str::<NormalizedTradeEvent>(payload) {
                            Ok(event) => {
                                if let Err(error) = self.process_live_trade_event(event).await {
                                    warn!(error = %error, "execution failed to process live trade event");
                                }
                            }
                            Err(error) => {
                                warn!(error = %error, "execution failed to deserialize live trade event");
                            }
                        }
                    }
                    self.mark_market_data("up", None).await;
                }
                Err(error) => {
                    self.mark_market_data("down", Some(error.to_string())).await;
                }
            }
        }
    }

    async fn process_live_kline_event(&self, event: NormalizedKlineEvent) -> Result<()> {
        let contexts = {
            let runtime = self.inner.runtime.lock().await;
            runtime.active_contexts.clone()
        };
        if contexts.is_empty() {
            self.mark_market_data("idle", None).await;
            return Ok(());
        }

        if !event.closed || event.ingestion_mode != "live" {
            return Ok(());
        }

        for context in contexts.into_iter().filter(|context| {
            event.pair_code == context.promotion.symbol_code
                && event.timeframe_code == context.promotion.timeframe_code
                && event
                    .analysis_setting_ids
                    .iter()
                    .any(|id| id == &context.analysis.id)
        }) {
            let promotion_id = context.promotion.promotion_id.clone();
            let signal = {
                let mut runtime = self.inner.runtime.lock().await;
                let Some(state) = runtime.context_states.get_mut(&promotion_id) else {
                    continue;
                };
                if event.close_time <= state.last_processed_kline_close_time.unwrap_or(i64::MIN) {
                    continue;
                }

                let Some(evaluator) = state.evaluator.as_mut() else {
                    warn!(
                        symbol = %context.promotion.symbol_code,
                        timeframe = %context.promotion.timeframe_code,
                        promotion_id = %promotion_id,
                        "execution skipped live kline because evaluator is not warmed yet"
                    );
                    continue;
                };

                let signal = evaluator.process_live_kline(&MarketDataKlineEvent {
                    event_id: event.event_id.clone(),
                    event_type: event.event_type.clone(),
                    source: event.source.clone(),
                    occurred_at: event.occurred_at.clone(),
                    exchange: event.exchange.clone(),
                    ingestion_mode: event.ingestion_mode.clone(),
                    stream_name: event.stream_name.clone(),
                    pair_code: event.pair_code.clone(),
                    symbol: event.symbol.clone(),
                    timeframe_code: event.timeframe_code.clone(),
                    period_ms: event.period_ms,
                    open_time: event.open_time,
                    close_time: event.close_time,
                    event_time: event.event_time,
                    closed: event.closed,
                    open: event.open.clone(),
                    high: event.high.clone(),
                    low: event.low.clone(),
                    close: event.close.clone(),
                    volume: event.volume.clone(),
                    quote_volume: event.quote_volume.clone(),
                    trade_count: event.trade_count,
                    analysis_setting_ids: event.analysis_setting_ids.clone(),
                    strategy_names: event.strategy_names.clone(),
                });
                state.last_processed_kline_close_time = Some(event.close_time);
                signal
            };

            if let Some(signal) = signal {
                self.handle_signal_with_fill(&context, &signal, signal.close_price)
                    .await?;
            }
        }

        Ok(())
    }

    async fn process_live_trade_event(&self, event: NormalizedTradeEvent) -> Result<()> {
        let maybe_closes = {
            let mut runtime = self.inner.runtime.lock().await;
            runtime
                .context_states
                .iter_mut()
                .filter_map(|(_, state)| {
                    state.last_checked_trade_time = Some(
                        state
                            .last_checked_trade_time
                            .unwrap_or(0)
                            .max(event.trade_time),
                    );
                    let position = state.open_position.clone()?;
                    if position.symbol_code != event.pair_code {
                        return None;
                    }

                    let Ok(price) = event.price.parse::<f64>() else {
                        return None;
                    };

                    let hit = if position.side == "long" {
                        price <= position.stop_loss_price || price >= position.take_profit_price
                    } else {
                        price >= position.stop_loss_price || price <= position.take_profit_price
                    };

                    if !hit {
                        return None;
                    }

                    state.open_position = None;
                    Some((
                        position,
                        PersistedTradeRecord {
                            symbol: event.symbol.clone(),
                            aggregate_trade_id: event.aggregate_trade_id,
                            price: event.price.clone(),
                            trade_time: event.trade_time,
                        },
                    ))
                })
                .collect::<Vec<_>>()
        };

        for (position, trade) in maybe_closes {
            self.close_paper_trade(position, trade, "riskExit").await?;
        }

        Ok(())
    }

    async fn run_signal_cycle(&self) -> Result<()> {
        let contexts = {
            let runtime = self.inner.runtime.lock().await;
            runtime.active_contexts.clone()
        };
        if contexts.is_empty() {
            self.mark_market_data("idle", None).await;
            return Ok(());
        }
        for context in contexts {
            let snapshot = self.fetch_market_snapshot(&context).await?;
            self.mark_market_data("up", None).await;
            self.rebuild_evaluator_if_needed(&context, &snapshot.klines).await?;
            self.process_trade_exits(&context, &snapshot.trades).await?;
            self.process_signal_entries(&context, &snapshot.klines, &snapshot.trades)
                .await?;
        }
        Ok(())
    }

    async fn fetch_market_snapshot(
        &self,
        context: &ActiveExecutionContext,
    ) -> Result<crate::models::MarketSnapshot> {
        let klines = self
            .fetch_market_json::<Vec<PersistedKlineRecord>>(&format!(
                "/v1/klines/{}/{}?limit=250",
                context.promotion.symbol_code, context.promotion.timeframe_code
            ))
            .await?;
        let trades = match self
            .fetch_market_json::<Vec<PersistedTradeRecord>>(&format!(
                "/v1/trades/{}?limit=100",
                context.promotion.symbol_code
            ))
            .await
        {
            Ok(rows) => rows,
            Err(error) => {
                warn!(
                    symbol = %context.promotion.symbol_code,
                    timeframe = %context.promotion.timeframe_code,
                    error = %error,
                    "execution proceeding without recent trades; paper fills will fall back to kline close",
                );
                Vec::new()
            }
        };

        Ok(crate::models::MarketSnapshot { klines, trades })
    }

    async fn rebuild_evaluator_if_needed(
        &self,
        context: &ActiveExecutionContext,
        klines: &[PersistedKlineRecord],
    ) -> Result<()> {
        let mut runtime = self.inner.runtime.lock().await;
        let Some(state) = runtime
            .context_states
            .get_mut(&context.promotion.promotion_id)
        else {
            return Ok(());
        };
        if state.evaluator.is_some() {
            return Ok(());
        }

        let Some(spec) = build_analysis_spec(&context.analysis)? else {
            bail!("active execution analysis is not evaluable");
        };

        let mut evaluator = AnalysisEvaluator::new(spec);
        let warmup = klines
            .iter()
            .map(|row| StrategyPersistedKlineRecord {
                pair_code: context.promotion.symbol_code.clone(),
                symbol: row.symbol.clone(),
                timeframe_code: row.timeframe_code.clone(),
                period_ms: row.period_ms,
                open_time: row.open_time,
                close_time: row.close_time,
                event_time: row.event_time,
                occurred_at: row.occurred_at.clone(),
                ingestion_mode: row.ingestion_mode.clone(),
                closed: row.closed,
                open: row.open.clone(),
                high: row.high.clone(),
                low: row.low.clone(),
                close: row.close.clone(),
                volume: row.volume.clone(),
                quote_volume: row.quote_volume.clone(),
                trade_count: row.trade_count,
                updated_at: row.updated_at.clone(),
            })
            .collect::<Vec<_>>();
        evaluator.warm_from_klines(&warmup);
        state.evaluator = Some(evaluator);
        state.last_processed_kline_close_time = klines.iter().map(|row| row.close_time).max();
        state.last_checked_trade_time = None;
        Ok(())
    }

    async fn process_trade_exits(
        &self,
        context: &ActiveExecutionContext,
        trades: &[PersistedTradeRecord],
    ) -> Result<()> {
        let maybe_close = {
            let runtime = self.inner.runtime.lock().await;
            let Some(state) = runtime.context_states.get(&context.promotion.promotion_id) else {
                return Ok(());
            };
            let Some(position) = state.open_position.clone() else {
                return Ok(());
            };

            let next_trade = trades
                .iter()
                .filter(|trade| trade.trade_time > state.last_checked_trade_time.unwrap_or(0))
                .find(|trade| {
                    let Ok(price) = trade.price.parse::<f64>() else {
                        return false;
                    };
                    if position.side == "long" {
                        price <= position.stop_loss_price || price >= position.take_profit_price
                    } else {
                        price >= position.stop_loss_price || price <= position.take_profit_price
                    }
                })
                .cloned();

            next_trade.map(|trade| (position, trade))
        };

        if let Some((position, trade)) = maybe_close {
            self.close_paper_trade(position, trade, "riskExit").await?;
        }

        let latest_trade_time = trades_max_time(trades);
        if latest_trade_time.is_some() {
            let mut runtime = self.inner.runtime.lock().await;
            if let Some(state) = runtime.context_states.get_mut(&context.promotion.promotion_id) {
                state.last_checked_trade_time = latest_trade_time;
            }
        }
        Ok(())
    }

    async fn process_signal_entries(
        &self,
        context: &ActiveExecutionContext,
        klines: &[PersistedKlineRecord],
        trades: &[PersistedTradeRecord],
    ) -> Result<()> {
        let pending_rows = {
            let runtime = self.inner.runtime.lock().await;
            let last_processed_close_time = runtime
                .context_states
                .get(&context.promotion.promotion_id)
                .and_then(|state| state.last_processed_kline_close_time)
                .unwrap_or(i64::MIN);
            klines
                .iter()
                .filter(|row| row.closed)
                .filter(|row| {
                    row.close_time > last_processed_close_time
                })
                .cloned()
                .collect::<Vec<_>>()
        };

        for row in pending_rows {
            let signal = {
                let mut runtime = self.inner.runtime.lock().await;
                let Some(state) = runtime.context_states.get_mut(&context.promotion.promotion_id) else {
                    continue;
                };
                let Some(evaluator) = state.evaluator.as_mut() else {
                    continue;
                };
                evaluator.process_live_kline(&synthetic_live_kline(
                    &row,
                    &context.analysis,
                ))
            };

            if let Some(signal) = signal {
                self.handle_signal(context, &signal, trades).await?;
            }

            let mut runtime = self.inner.runtime.lock().await;
            if let Some(state) = runtime.context_states.get_mut(&context.promotion.promotion_id) {
                state.last_processed_kline_close_time = Some(row.close_time);
            }
        }

        Ok(())
    }

    async fn handle_signal(
        &self,
        context: &ActiveExecutionContext,
        signal: &EmittedSignal,
        trades: &[PersistedTradeRecord],
    ) -> Result<()> {
        let fill = first_trade_fill_after(trades, signal.close_time)
            .unwrap_or(signal.close_price);

        self.handle_signal_with_fill(context, signal, fill).await
    }

    async fn handle_signal_with_fill(
        &self,
        context: &ActiveExecutionContext,
        signal: &EmittedSignal,
        fill: f64,
    ) -> Result<()> {
        if context.promotion.mode == "paper" {
            self.handle_paper_signal(context, signal, fill).await
        } else {
            self.handle_live_signal(context, signal, fill).await
        }
    }

    async fn handle_paper_signal(
        &self,
        context: &ActiveExecutionContext,
        signal: &EmittedSignal,
        fill_price: f64,
    ) -> Result<()> {
        let existing = self
            .inner
            .runtime
            .lock()
            .await
            .context_states
            .get(&context.promotion.promotion_id)
            .and_then(|state| state.open_position.clone());
        if let Some(position) = existing.clone() {
            if position.side == signal.signal_direction {
                return Ok(());
            }

            let closing_trade = PersistedTradeRecord {
                symbol: context.promotion.symbol_code.clone(),
                aggregate_trade_id: 0,
                price: fill_price.to_string(),
                trade_time: signal.close_time,
            };
            self.close_paper_trade(position, closing_trade, "reversal").await?;
        }

        self.open_paper_trade(context, signal, fill_price).await
    }

    async fn handle_live_signal(
        &self,
        context: &ActiveExecutionContext,
        signal: &EmittedSignal,
        fill_price: f64,
    ) -> Result<()> {
        let Some(binance) = self.inner.binance_private.as_ref() else {
            bail!("live mode active but Binance private client is not configured");
        };

        let quantity = (self.inner.config.default_position_notional_usd / fill_price).max(0.000001);
        let side = if signal.signal_direction == "long" { "BUY" } else { "SELL" };
        let order = binance
            .place_market_order(&context.promotion.symbol_code, side, quantity)
            .await?;

        let trade = ExecutionTradeRecord {
            trade_id: format!("live:{}:{}", context.promotion.promotion_id, signal.close_time),
            external_order_id: order.order_id.map(|id| id.to_string()),
            position_id: Some(format!("live-position:{}", context.promotion.analysis_setting_id)),
            source_backtest_id: context.promotion.source_backtest_id.clone(),
            analysis_setting_id: context.promotion.analysis_setting_id.clone(),
            execution_settings_name: Some(context.promotion.execution_settings_name.clone()),
            symbol_code: context.promotion.symbol_code.clone(),
            timeframe_code: context.promotion.timeframe_code.clone(),
            strategy_name: context.promotion.strategy_name.clone(),
            risk_profile_name: context.promotion.risk_profile_name.clone(),
            mode: "live".to_string(),
            side: signal.signal_direction.clone(),
            status: "open".to_string(),
            close_reason: None,
            opened_at: timestamp_from_millis(signal.close_time),
            closed_at: None,
            duration_ms: None,
            entry_price: fill_price,
            exit_price: None,
            quantity,
            notional_usd: self.inner.config.default_position_notional_usd,
            stop_loss_price: None,
            take_profit_price: None,
            realized_pnl_percent: None,
            realized_pnl_usd: None,
            fees_usd: 0.0,
        };
        self.post_execution_trade(&trade).await?;
        Ok(())
    }

    async fn open_paper_trade(
        &self,
        context: &ActiveExecutionContext,
        signal: &EmittedSignal,
        fill_price: f64,
    ) -> Result<()> {
        let quantity = self.inner.config.default_position_notional_usd / fill_price;
        let risk = &context.analysis.risk_profile;
        let stop_distance = risk.swing_gap.max(risk.minimum_stop_loss).min(risk.maximum_stop_loss);
        let (stop_loss_price, take_profit_price) = if signal.signal_direction == "long" {
            (
                fill_price * (1.0 - stop_distance / 100.0),
                fill_price * (1.0 + ((stop_distance * risk.rrr) / 100.0)),
            )
        } else {
            (
                fill_price * (1.0 + stop_distance / 100.0),
                fill_price * (1.0 - ((stop_distance * risk.rrr) / 100.0)),
            )
        };

        let trade_id = format!(
            "paper:{}:{}",
            context.promotion.promotion_id, signal.close_time
        );
        let opened_at = timestamp_from_millis(signal.close_time);
        let position = LocalPaperPosition {
            promotion_id: context.promotion.promotion_id.clone(),
            trade_id: trade_id.clone(),
            analysis_setting_id: context.promotion.analysis_setting_id.clone(),
            symbol_code: context.promotion.symbol_code.clone(),
            timeframe_code: context.promotion.timeframe_code.clone(),
            strategy_name: context.promotion.strategy_name.clone(),
            risk_profile_name: context.promotion.risk_profile_name.clone(),
            side: signal.signal_direction.clone(),
            opened_at: opened_at.clone(),
            opened_at_ms: signal.close_time,
            entry_price: fill_price,
            quantity,
            notional_usd: self.inner.config.default_position_notional_usd,
            stop_loss_price,
            take_profit_price,
            source_backtest_id: context.promotion.source_backtest_id.clone(),
        };

        let trade = ExecutionTradeRecord {
            trade_id: trade_id.clone(),
            external_order_id: None,
            position_id: Some(format!("position:{trade_id}")),
            source_backtest_id: context.promotion.source_backtest_id.clone(),
            analysis_setting_id: context.promotion.analysis_setting_id.clone(),
            execution_settings_name: Some(context.promotion.execution_settings_name.clone()),
            symbol_code: context.promotion.symbol_code.clone(),
            timeframe_code: context.promotion.timeframe_code.clone(),
            strategy_name: context.promotion.strategy_name.clone(),
            risk_profile_name: context.promotion.risk_profile_name.clone(),
            mode: "paper".to_string(),
            side: signal.signal_direction.clone(),
            status: "open".to_string(),
            close_reason: None,
            opened_at,
            closed_at: None,
            duration_ms: None,
            entry_price: fill_price,
            exit_price: None,
            quantity,
            notional_usd: self.inner.config.default_position_notional_usd,
            stop_loss_price: Some(stop_loss_price),
            take_profit_price: Some(take_profit_price),
            realized_pnl_percent: None,
            realized_pnl_usd: None,
            fees_usd: 0.0,
        };
        self.post_execution_trade(&trade).await?;
        let open_positions = {
            let mut runtime = self.inner.runtime.lock().await;
            if let Some(state) = runtime.context_states.get_mut(&context.promotion.promotion_id) {
                state.open_position = Some(position);
            }
            runtime
                .context_states
                .values()
                .filter_map(|state| state.open_position.clone())
                .collect::<Vec<_>>()
        };
        let mut status = self.inner.status.write().await;
        status.open_position = open_positions.first().cloned();
        status.open_positions = open_positions;
        Ok(())
    }

    async fn close_paper_trade(
        &self,
        position: LocalPaperPosition,
        trade: PersistedTradeRecord,
        close_reason: &str,
    ) -> Result<()> {
        let exit_price = trade.price.parse::<f64>().unwrap_or(position.entry_price);
        let pnl_percent = if position.side == "long" {
            ((exit_price - position.entry_price) / position.entry_price) * 100.0
        } else {
            ((position.entry_price - exit_price) / position.entry_price) * 100.0
        };
        let pnl_usd = position.notional_usd * (pnl_percent / 100.0);
        let closed_at = timestamp_from_millis(trade.trade_time);
        let normalized_close_reason = normalize_close_reason(&position, exit_price, close_reason);
        let trade_record = ExecutionTradeRecord {
            trade_id: position.trade_id.clone(),
            external_order_id: None,
            position_id: Some(format!("position:{}", position.trade_id)),
            source_backtest_id: position.source_backtest_id.clone(),
            analysis_setting_id: position.analysis_setting_id.clone(),
            execution_settings_name: None,
            symbol_code: position.symbol_code.clone(),
            timeframe_code: position.timeframe_code.clone(),
            strategy_name: position.strategy_name.clone(),
            risk_profile_name: position.risk_profile_name.clone(),
            mode: "paper".to_string(),
            side: position.side.clone(),
            status: "closed".to_string(),
            close_reason: Some(normalized_close_reason.clone()),
            opened_at: position.opened_at.clone(),
            closed_at: Some(closed_at),
            duration_ms: Some(trade.trade_time.saturating_sub(position.opened_at_ms)),
            entry_price: position.entry_price,
            exit_price: Some(exit_price),
            quantity: position.quantity,
            notional_usd: position.notional_usd,
            stop_loss_price: Some(position.stop_loss_price),
            take_profit_price: Some(position.take_profit_price),
            realized_pnl_percent: Some(pnl_percent),
            realized_pnl_usd: Some(pnl_usd),
            fees_usd: 0.0,
        };
        self.post_execution_trade(&trade_record).await?;
        info!(trade_id = %position.trade_id, close_reason = %normalized_close_reason, pnl_percent, "paper trade closed");
        let open_positions = {
            let mut runtime = self.inner.runtime.lock().await;
            if let Some(state) = runtime.context_states.get_mut(
                &position.promotion_id,
            ) {
                state.open_position = None;
            }
            runtime
                .context_states
                .values()
                .filter_map(|state| state.open_position.clone())
                .collect::<Vec<_>>()
        };
        let mut status = self.inner.status.write().await;
        status.open_position = open_positions.first().cloned();
        status.open_positions = open_positions;
        Ok(())
    }

    async fn post_execution_trade(&self, trade: &ExecutionTradeRecord) -> Result<()> {
        let url = format!(
            "{}/v1/ops/execution/trades",
            self.inner.config.control_plane_base_url.trim_end_matches('/')
        );
        self.inner
            .control_plane_client
            .post(url)
            .json(trade)
            .send()
            .await
            .context("failed to post execution trade projection to control-plane")?
            .error_for_status()
            .context("control-plane rejected execution trade projection")?;
        Ok(())
    }

    async fn fetch_json<T>(&self, path: &str) -> Result<T>
    where
        T: for<'de> serde::Deserialize<'de>,
    {
        let url = format!(
            "{}{}",
            self.inner.config.control_plane_base_url.trim_end_matches('/'),
            path
        );
        self.inner
            .control_plane_client
            .get(url)
            .send()
            .await
            .with_context(|| format!("failed to request {path} from control-plane"))?
            .error_for_status()
            .with_context(|| format!("control-plane returned non-success for {path}"))?
            .json::<T>()
            .await
            .with_context(|| format!("failed to deserialize control-plane response for {path}"))
    }

    async fn fetch_market_json<T>(&self, path: &str) -> Result<T>
    where
        T: for<'de> serde::Deserialize<'de>,
    {
        let url = format!(
            "{}{}",
            self.inner.config.market_data_base_url.trim_end_matches('/'),
            path
        );
        self.inner
            .market_data_client
            .get(url)
            .send()
            .await
            .with_context(|| format!("failed to request {path} from market-data"))?
            .error_for_status()
            .with_context(|| format!("market-data returned non-success for {path}"))?
            .json::<T>()
            .await
            .with_context(|| format!("failed to deserialize market-data response for {path}"))
    }

    async fn mark_market_data(&self, status_text: &str, error: Option<String>) {
        let mut status = self.inner.status.write().await;
        status.market_data = DependencyStatus {
            status: status_text.to_string(),
            last_checked_at: Some(current_timestamp()),
            last_error: error,
        };
    }
}

fn synthetic_live_kline(
    row: &PersistedKlineRecord,
    analysis: &ResolvedAnalysisSettingsRecord,
) -> MarketDataKlineEvent {
    MarketDataKlineEvent {
        event_id: format!("persisted:{}:{}", analysis.id, row.close_time),
        event_type: "trading-bot.market-data.kline.v1".to_string(),
        source: "trading-bot-execution".to_string(),
        occurred_at: row.occurred_at.clone(),
        exchange: "binance".to_string(),
        ingestion_mode: "live".to_string(),
        stream_name: format!("{}:{}", row.symbol, row.timeframe_code),
        pair_code: analysis.symbol.clone(),
        symbol: row.symbol.clone(),
        timeframe_code: row.timeframe_code.clone(),
        period_ms: row.period_ms,
        open_time: row.open_time,
        close_time: row.close_time,
        event_time: row.event_time,
        closed: row.closed,
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

fn first_trade_fill_after(trades: &[PersistedTradeRecord], close_time: i64) -> Option<f64> {
    trades
        .iter()
        .filter(|trade| trade.trade_time >= close_time)
        .find_map(|trade| trade.price.parse::<f64>().ok())
}

fn trades_max_time(trades: &[PersistedTradeRecord]) -> Option<i64> {
    trades.iter().map(|trade| trade.trade_time).max()
}

fn current_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn normalize_close_reason(
    position: &LocalPaperPosition,
    exit_price: f64,
    close_reason: &str,
) -> String {
    if close_reason != "riskExit" {
        return close_reason.to_string();
    }

    if position.side == "long" {
        if exit_price <= position.stop_loss_price {
            return "stopLoss".to_string();
        }
        if exit_price >= position.take_profit_price {
            return "takeProfit".to_string();
        }
    } else {
        if exit_price >= position.stop_loss_price {
            return "stopLoss".to_string();
        }
        if exit_price <= position.take_profit_price {
            return "takeProfit".to_string();
        }
    }

    "riskExit".to_string()
}

fn timestamp_from_millis(timestamp_ms: i64) -> String {
    let rounded_ms = if timestamp_ms.rem_euclid(60_000) == 0 {
        timestamp_ms
    } else {
        (timestamp_ms.div_euclid(60_000) + 1) * 60_000
    };

    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(rounded_ms)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::load_config;

    #[tokio::test]
    async fn readiness_is_ok_in_paper_mode_without_promotion() {
        let config = load_config().expect("config should load");
        let service = ExecutionService {
            inner: Arc::new(Inner {
                metrics: Metrics::new().expect("metrics should initialize"),
                control_plane_client: Client::new(),
                market_data_client: Client::new(),
                binance_private: None,
                status: RwLock::new(RuntimeStatus {
                    started: true,
                    mode: "paper".to_string(),
                    control_plane: DependencyStatus {
                        status: "up".to_string(),
                        last_checked_at: Some("2026-03-28T00:00:00Z".to_string()),
                        last_error: None,
                    },
                    market_data: DependencyStatus {
                        status: "idle".to_string(),
                        last_checked_at: Some("2026-03-28T00:00:00Z".to_string()),
                        last_error: None,
                    },
                    exchange: DependencyStatus {
                        status: "disabled".to_string(),
                        last_checked_at: None,
                        last_error: None,
                    },
                    active_promotion: None,
                    active_promotions: Vec::new(),
                    active_analysis_id: None,
                    active_analysis_ids: Vec::new(),
                    paper_trade_count: 0,
                    open_position: None,
                    open_positions: Vec::new(),
                    otel_exporter_configured: false,
                }),
                runtime: Mutex::new(ExecutionRuntime {
                    active_contexts: Vec::new(),
                    context_states: BTreeMap::new(),
                    listen_key: None,
                }),
                task_handles: Mutex::new(Vec::new()),
                config,
            }),
        };

        let readiness = service.readiness().await;
        assert_eq!(readiness.status, "ok");
    }

    #[test]
    fn timestamp_rounds_up_to_next_whole_minute() {
        let timestamp_ms = chrono::DateTime::parse_from_rfc3339("2026-03-31T15:25:59+00:00")
            .expect("timestamp should parse")
            .timestamp_millis();
        assert_eq!(
            timestamp_from_millis(timestamp_ms),
            "2026-03-31T15:26:00+00:00"
        );
    }

    #[test]
    fn timestamp_preserves_exact_whole_minute() {
        let timestamp_ms = chrono::DateTime::parse_from_rfc3339("2026-03-31T15:26:00+00:00")
            .expect("timestamp should parse")
            .timestamp_millis();
        assert_eq!(
            timestamp_from_millis(timestamp_ms),
            "2026-03-31T15:26:00+00:00"
        );
    }
}
