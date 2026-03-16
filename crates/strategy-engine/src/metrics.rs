use anyhow::Result;
use prometheus::{Encoder, IntCounter, IntGauge, Registry, TextEncoder};

#[derive(Clone)]
pub struct Metrics {
    registry: Registry,
    pub runtime_config_loaded: IntGauge,
    pub kafka_consumer_connected: IntGauge,
    pub kafka_producer_connected: IntGauge,
    pub active_analyses: IntGauge,
    pub ignored_analyses: IntGauge,
    pub config_refresh_total: IntCounter,
    pub processed_closed_klines_total: IntCounter,
    pub emitted_signals_total: IntCounter,
}

impl Metrics {
    pub fn new() -> Result<Self> {
        let registry = Registry::new();

        let runtime_config_loaded = IntGauge::new(
            "strategy_engine_runtime_config_loaded",
            "Whether the strategy-engine has a loaded runtime configuration",
        )?;
        let kafka_consumer_connected = IntGauge::new(
            "strategy_engine_kafka_consumer_connected",
            "Whether the strategy-engine Kafka consumer is connected",
        )?;
        let kafka_producer_connected = IntGauge::new(
            "strategy_engine_kafka_producer_connected",
            "Whether the strategy-engine Kafka producer is connected",
        )?;
        let active_analyses = IntGauge::new(
            "strategy_engine_active_analyses",
            "Number of supported active analyses in memory",
        )?;
        let ignored_analyses = IntGauge::new(
            "strategy_engine_ignored_analyses",
            "Number of resolved analyses ignored because the strategy kind is unsupported",
        )?;
        let config_refresh_total = IntCounter::new(
            "strategy_engine_config_refresh_total",
            "Total successful runtime config refreshes",
        )?;
        let processed_closed_klines_total = IntCounter::new(
            "strategy_engine_processed_closed_klines_total",
            "Total live closed klines processed by the strategy-engine",
        )?;
        let emitted_signals_total = IntCounter::new(
            "strategy_engine_emitted_signals_total",
            "Total signals emitted by the strategy-engine",
        )?;

        registry.register(Box::new(runtime_config_loaded.clone()))?;
        registry.register(Box::new(kafka_consumer_connected.clone()))?;
        registry.register(Box::new(kafka_producer_connected.clone()))?;
        registry.register(Box::new(active_analyses.clone()))?;
        registry.register(Box::new(ignored_analyses.clone()))?;
        registry.register(Box::new(config_refresh_total.clone()))?;
        registry.register(Box::new(processed_closed_klines_total.clone()))?;
        registry.register(Box::new(emitted_signals_total.clone()))?;

        Ok(Self {
            registry,
            runtime_config_loaded,
            kafka_consumer_connected,
            kafka_producer_connected,
            active_analyses,
            ignored_analyses,
            config_refresh_total,
            processed_closed_klines_total,
            emitted_signals_total,
        })
    }

    pub fn encode(&self) -> Result<String> {
        let encoder = TextEncoder::new();
        let metric_families = self.registry.gather();
        let mut buffer = Vec::new();
        encoder.encode(&metric_families, &mut buffer)?;
        Ok(String::from_utf8(buffer)?)
    }
}
