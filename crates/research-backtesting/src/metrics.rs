use anyhow::Result;
use prometheus::{Encoder, IntCounter, IntCounterVec, IntGauge, Registry, TextEncoder};
use trading_bot_observability::HttpMetrics;

#[derive(Clone)]
pub struct Metrics {
    registry: Registry,
    /// The estate-wide HTTP metrics every shared alert is built on.
    pub http: HttpMetrics,
    pub control_plane_connected: IntGauge,
    pub historical_store_connected: IntGauge,
    pub backtest_runs_total: IntCounterVec,
    pub replayed_klines_total: IntCounter,
    pub emitted_signals_total: IntCounter,
    pub simulated_trades_total: IntCounter,
}

impl Metrics {
    pub fn new() -> Result<Self> {
        let registry = Registry::new();

        let control_plane_connected = IntGauge::new(
            "trading_bot_research_backtesting_control_plane_connected",
            "Whether the research-backtesting service can reach the control-plane",
        )?;
        let historical_store_connected = IntGauge::new(
            "trading_bot_research_backtesting_historical_store_connected",
            "Whether the research-backtesting service can reach ClickHouse",
        )?;
        let backtest_runs_total = IntCounterVec::new(
            prometheus::Opts::new(
                "trading_bot_research_backtesting_runs_total",
                "Number of completed backtest requests",
            ),
            &["outcome"],
        )?;
        let replayed_klines_total = IntCounter::new(
            "trading_bot_research_backtesting_replayed_klines_total",
            "Total historical klines replayed offline",
        )?;
        let emitted_signals_total = IntCounter::new(
            "trading_bot_research_backtesting_emitted_signals_total",
            "Total offline signals emitted during backtests",
        )?;
        let simulated_trades_total = IntCounter::new(
            "trading_bot_research_backtesting_simulated_trades_total",
            "Total simulated trades closed during backtests",
        )?;

        registry.register(Box::new(control_plane_connected.clone()))?;
        registry.register(Box::new(historical_store_connected.clone()))?;
        registry.register(Box::new(backtest_runs_total.clone()))?;
        registry.register(Box::new(replayed_klines_total.clone()))?;
        registry.register(Box::new(emitted_signals_total.clone()))?;
        registry.register(Box::new(simulated_trades_total.clone()))?;

        let http = HttpMetrics::register(&registry)?;

        Ok(Self {
            registry,
            http,
            control_plane_connected,
            historical_store_connected,
            backtest_runs_total,
            replayed_klines_total,
            emitted_signals_total,
            simulated_trades_total,
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
