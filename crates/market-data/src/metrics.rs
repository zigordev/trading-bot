use anyhow::Result;
use prometheus::{Encoder, IntCounter, IntCounterVec, IntGauge, Registry, TextEncoder};

#[derive(Clone)]
pub struct Metrics {
    registry: Registry,
    pub runtime_config_loaded: IntGauge,
    pub kafka_producer_connected: IntGauge,
    pub kafka_consumer_connected: IntGauge,
    pub stream_connected: IntGauge,
    pub database_connected: IntGauge,
    pub active_kline_subscriptions: IntGauge,
    pub active_pair_subscriptions: IntGauge,
    pub binance_rest_used_weight_1m: IntGauge,
    pub binance_rest_target_weight_1m: IntGauge,
    pub binance_rest_limit_weight_1m: IntGauge,
    pub config_refresh_total: IntCounterVec,
    pub backfill_total: IntCounterVec,
    pub binance_rest_requests_total: IntCounterVec,
    pub binance_rest_rate_limit_responses_total: IntCounterVec,
    pub binance_rest_limiter_waits_total: IntCounter,
    pub binance_rest_limiter_wait_ms_total: IntCounter,
    pub kline_publish_total: IntCounter,
    pub trade_publish_total: IntCounter,
    pub book_ticker_publish_total: IntCounter,
    pub kline_store_failures_total: IntCounter,
    pub trade_store_failures_total: IntCounter,
    pub book_ticker_store_failures_total: IntCounter,
}

impl Metrics {
    pub fn new() -> Result<Self> {
        let registry = Registry::new();
        let runtime_config_loaded = IntGauge::new(
            "trading_bot_market_data_runtime_config_loaded",
            "Whether runtime-config has been refreshed recently enough",
        )?;
        let kafka_producer_connected = IntGauge::new(
            "trading_bot_market_data_kafka_producer_connected",
            "Whether the Kafka producer is connected",
        )?;
        let kafka_consumer_connected = IntGauge::new(
            "trading_bot_market_data_kafka_consumer_connected",
            "Whether the config-change consumer is connected",
        )?;
        let stream_connected = IntGauge::new(
            "trading_bot_market_data_stream_connected",
            "Whether the Binance websocket is connected",
        )?;
        let database_connected = IntGauge::new(
            "trading_bot_market_data_database_connected",
            "Whether the market-data service can reach the historical store",
        )?;
        let active_kline_subscriptions = IntGauge::new(
            "trading_bot_market_data_active_kline_subscriptions",
            "Number of active kline subscriptions",
        )?;
        let active_pair_subscriptions = IntGauge::new(
            "trading_bot_market_data_active_pair_subscriptions",
            "Number of active pair-level subscriptions",
        )?;
        let binance_rest_used_weight_1m = IntGauge::new(
            "trading_bot_market_data_binance_rest_used_weight_1m",
            "Latest observed Binance REQUEST_WEIGHT usage for the current 1-minute window",
        )?;
        let binance_rest_target_weight_1m = IntGauge::new(
            "trading_bot_market_data_binance_rest_target_weight_1m",
            "Local Binance REQUEST_WEIGHT target budget per 1-minute window",
        )?;
        let binance_rest_limit_weight_1m = IntGauge::new(
            "trading_bot_market_data_binance_rest_limit_weight_1m",
            "Configured Binance REQUEST_WEIGHT ceiling per 1-minute window",
        )?;
        let config_refresh_total = IntCounterVec::new(
            prometheus::Opts::new(
                "trading_bot_market_data_config_refresh_total",
                "Number of config refresh attempts",
            ),
            &["outcome"],
        )?;
        let backfill_total = IntCounterVec::new(
            prometheus::Opts::new(
                "trading_bot_market_data_backfill_total",
                "Number of backfill and gap-repair runs",
            ),
            &["outcome"],
        )?;
        let binance_rest_requests_total = IntCounterVec::new(
            prometheus::Opts::new(
                "trading_bot_market_data_binance_rest_requests_total",
                "Number of Binance REST requests by endpoint and result",
            ),
            &["path", "outcome"],
        )?;
        let binance_rest_rate_limit_responses_total = IntCounterVec::new(
            prometheus::Opts::new(
                "trading_bot_market_data_binance_rest_rate_limit_responses_total",
                "Number of Binance REST 429/418 responses by endpoint and status",
            ),
            &["path", "status"],
        )?;
        let binance_rest_limiter_waits_total = IntCounter::new(
            "trading_bot_market_data_binance_rest_limiter_waits_total",
            "Number of times the local Binance REQUEST_WEIGHT limiter delayed requests",
        )?;
        let binance_rest_limiter_wait_ms_total = IntCounter::new(
            "trading_bot_market_data_binance_rest_limiter_wait_ms_total",
            "Total milliseconds spent waiting on the local Binance REQUEST_WEIGHT limiter",
        )?;
        let kline_publish_total = IntCounter::new(
            "trading_bot_market_data_kline_publish_total",
            "Number of kline events published",
        )?;
        let trade_publish_total = IntCounter::new(
            "trading_bot_market_data_trade_publish_total",
            "Number of aggregate trade events published",
        )?;
        let book_ticker_publish_total = IntCounter::new(
            "trading_bot_market_data_book_ticker_publish_total",
            "Number of book-ticker events published",
        )?;
        let kline_store_failures_total = IntCounter::new(
            "trading_bot_market_data_kline_store_failures_total",
            "Number of kline persistence failures",
        )?;
        let trade_store_failures_total = IntCounter::new(
            "trading_bot_market_data_trade_store_failures_total",
            "Number of aggregate trade persistence failures",
        )?;
        let book_ticker_store_failures_total = IntCounter::new(
            "trading_bot_market_data_book_ticker_store_failures_total",
            "Number of book-ticker persistence failures",
        )?;

        registry.register(Box::new(runtime_config_loaded.clone()))?;
        registry.register(Box::new(kafka_producer_connected.clone()))?;
        registry.register(Box::new(kafka_consumer_connected.clone()))?;
        registry.register(Box::new(stream_connected.clone()))?;
        registry.register(Box::new(database_connected.clone()))?;
        registry.register(Box::new(active_kline_subscriptions.clone()))?;
        registry.register(Box::new(active_pair_subscriptions.clone()))?;
        registry.register(Box::new(binance_rest_used_weight_1m.clone()))?;
        registry.register(Box::new(binance_rest_target_weight_1m.clone()))?;
        registry.register(Box::new(binance_rest_limit_weight_1m.clone()))?;
        registry.register(Box::new(config_refresh_total.clone()))?;
        registry.register(Box::new(backfill_total.clone()))?;
        registry.register(Box::new(binance_rest_requests_total.clone()))?;
        registry.register(Box::new(binance_rest_rate_limit_responses_total.clone()))?;
        registry.register(Box::new(binance_rest_limiter_waits_total.clone()))?;
        registry.register(Box::new(binance_rest_limiter_wait_ms_total.clone()))?;
        registry.register(Box::new(kline_publish_total.clone()))?;
        registry.register(Box::new(trade_publish_total.clone()))?;
        registry.register(Box::new(book_ticker_publish_total.clone()))?;
        registry.register(Box::new(kline_store_failures_total.clone()))?;
        registry.register(Box::new(trade_store_failures_total.clone()))?;
        registry.register(Box::new(book_ticker_store_failures_total.clone()))?;

        Ok(Self {
            registry,
            runtime_config_loaded,
            kafka_producer_connected,
            kafka_consumer_connected,
            stream_connected,
            database_connected,
            active_kline_subscriptions,
            active_pair_subscriptions,
            binance_rest_used_weight_1m,
            binance_rest_target_weight_1m,
            binance_rest_limit_weight_1m,
            config_refresh_total,
            backfill_total,
            binance_rest_requests_total,
            binance_rest_rate_limit_responses_total,
            binance_rest_limiter_waits_total,
            binance_rest_limiter_wait_ms_total,
            kline_publish_total,
            trade_publish_total,
            book_ticker_publish_total,
            kline_store_failures_total,
            trade_store_failures_total,
            book_ticker_store_failures_total,
        })
    }

    pub fn encode(&self) -> Result<String> {
        let encoder = TextEncoder::new();
        let families = self.registry.gather();
        let mut buffer = Vec::new();
        encoder.encode(&families, &mut buffer)?;
        Ok(String::from_utf8(buffer)?)
    }
}
