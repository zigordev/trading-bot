use anyhow::Result;
use prometheus::{Encoder, IntCounter, IntGauge, Registry, TextEncoder};
use trading_bot_observability::HttpMetrics;

#[derive(Clone)]
pub struct Metrics {
    registry: Registry,
    /// The estate-wide HTTP metrics every shared alert is built on.
    pub http: HttpMetrics,
    pub control_plane_connected: IntGauge,
    pub active_promotion_loaded: IntGauge,
    pub paper_mode_enabled: IntGauge,
    pub refresh_total: IntCounter,
}

impl Metrics {
    pub fn new() -> Result<Self> {
        let registry = Registry::new();

        let control_plane_connected = IntGauge::new(
            "trading_bot_execution_control_plane_connected",
            "Whether the execution service can reach the control-plane",
        )?;
        let active_promotion_loaded = IntGauge::new(
            "trading_bot_execution_active_promotion_loaded",
            "Whether an active promoted execution configuration is currently loaded",
        )?;
        let paper_mode_enabled = IntGauge::new(
            "trading_bot_execution_paper_mode_enabled",
            "Whether the loaded execution context is running in paper mode",
        )?;
        let refresh_total = IntCounter::new(
            "trading_bot_execution_refresh_total",
            "Number of control-plane refresh cycles executed by the execution service",
        )?;

        registry.register(Box::new(control_plane_connected.clone()))?;
        registry.register(Box::new(active_promotion_loaded.clone()))?;
        registry.register(Box::new(paper_mode_enabled.clone()))?;
        registry.register(Box::new(refresh_total.clone()))?;

        let http = HttpMetrics::register(&registry)?;

        Ok(Self {
            registry,
            http,
            control_plane_connected,
            active_promotion_loaded,
            paper_mode_enabled,
            refresh_total,
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
