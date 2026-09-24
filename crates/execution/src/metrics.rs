use anyhow::Result;
use prometheus::{
    CounterVec, Encoder, IntCounter, IntCounterVec, IntGauge, Opts, Registry, TextEncoder,
};
use trading_bot_observability::{HealthMetrics, HttpMetrics};

pub const TRADE_SIDES: [&str; 2] = ["long", "short"];
pub const TRADE_CLOSE_REASONS: [&str; 4] = ["stopLoss", "takeProfit", "reversal", "riskExit"];

const TRADE_LABELS: [&str; 5] = [
    "mode",
    "pair_code",
    "timeframe_code",
    "strategy_name",
    "side",
];

#[derive(Clone)]
pub struct Metrics {
    registry: Registry,
    /// The estate-wide HTTP metrics every shared alert is built on.
    pub http: HttpMetrics,
    pub health: HealthMetrics,
    pub control_plane_connected: IntGauge,
    pub active_promotion_loaded: IntGauge,
    pub paper_mode_enabled: IntGauge,
    pub refresh_total: IntCounter,
    pub trades_opened_total: IntCounterVec,
    pub trades_closed_total: IntCounterVec,
    pub realized_profit_usd_total: CounterVec,
    pub realized_loss_usd_total: CounterVec,
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
        let trades_opened_total = IntCounterVec::new(
            Opts::new(
                "trading_bot_execution_trades_opened_total",
                "Trades opened by the execution service, by promoted configuration and side",
            ),
            &[
                "mode",
                "pair_code",
                "timeframe_code",
                "strategy_name",
                "side",
            ],
        )?;
        let trades_closed_total = IntCounterVec::new(
            Opts::new(
                "trading_bot_execution_trades_closed_total",
                "Trades closed by the execution service, by promoted configuration, side and reason",
            ),
            &[
                "mode",
                "pair_code",
                "timeframe_code",
                "strategy_name",
                "side",
                "close_reason",
            ],
        )?;

        let realized_profit_usd_total = CounterVec::new(
            Opts::new(
                "trading_bot_execution_realized_profit_usd_total",
                "Cumulative realized profit in USD from closed trades, by promoted configuration and side",
            ),
            &TRADE_LABELS,
        )?;
        let realized_loss_usd_total = CounterVec::new(
            Opts::new(
                "trading_bot_execution_realized_loss_usd_total",
                "Cumulative realized loss in USD from closed trades, as a positive magnitude",
            ),
            &TRADE_LABELS,
        )?;

        registry.register(Box::new(control_plane_connected.clone()))?;
        registry.register(Box::new(active_promotion_loaded.clone()))?;
        registry.register(Box::new(paper_mode_enabled.clone()))?;
        registry.register(Box::new(refresh_total.clone()))?;
        registry.register(Box::new(trades_opened_total.clone()))?;
        registry.register(Box::new(trades_closed_total.clone()))?;
        registry.register(Box::new(realized_profit_usd_total.clone()))?;
        registry.register(Box::new(realized_loss_usd_total.clone()))?;

        let http = HttpMetrics::register(&registry)?;
        let health = HealthMetrics::register(&registry)?;
        trading_bot_observability::register_build_info(&registry)?;

        Ok(Self {
            registry,
            http,
            health,
            control_plane_connected,
            active_promotion_loaded,
            paper_mode_enabled,
            refresh_total,
            trades_opened_total,
            trades_closed_total,
            realized_profit_usd_total,
            realized_loss_usd_total,
        })
    }

    pub fn start_trade_counters_at_zero(
        &self,
        mode: &str,
        pair_code: &str,
        timeframe_code: &str,
        strategy_name: &str,
    ) {
        for side in TRADE_SIDES {
            let trade_labels = [mode, pair_code, timeframe_code, strategy_name, side];
            self.trades_opened_total.with_label_values(&trade_labels);
            self.realized_profit_usd_total
                .with_label_values(&trade_labels);
            self.realized_loss_usd_total
                .with_label_values(&trade_labels);
            for close_reason in TRADE_CLOSE_REASONS {
                self.trades_closed_total.with_label_values(&[
                    mode,
                    pair_code,
                    timeframe_code,
                    strategy_name,
                    side,
                    close_reason,
                ]);
            }
        }
    }

    pub fn count_trade_opened(
        &self,
        mode: &str,
        pair_code: &str,
        timeframe_code: &str,
        strategy_name: &str,
        side: &str,
    ) {
        self.trades_opened_total
            .with_label_values(&[mode, pair_code, timeframe_code, strategy_name, side])
            .inc();
    }

    pub fn count_trade_closed(
        &self,
        mode: &str,
        pair_code: &str,
        timeframe_code: &str,
        strategy_name: &str,
        side: &str,
        close_reason: &str,
    ) {
        self.trades_closed_total
            .with_label_values(&[
                mode,
                pair_code,
                timeframe_code,
                strategy_name,
                side,
                close_reason,
            ])
            .inc();
    }

    pub fn record_realized_pnl(
        &self,
        mode: &str,
        pair_code: &str,
        timeframe_code: &str,
        strategy_name: &str,
        side: &str,
        realized_pnl_usd: f64,
    ) {
        if !realized_pnl_usd.is_finite() {
            return;
        }

        let trade_labels = [mode, pair_code, timeframe_code, strategy_name, side];
        if realized_pnl_usd >= 0.0 {
            self.realized_profit_usd_total
                .with_label_values(&trade_labels)
                .inc_by(realized_pnl_usd);
        } else {
            self.realized_loss_usd_total
                .with_label_values(&trade_labels)
                .inc_by(-realized_pnl_usd);
        }
    }

    pub fn encode(&self) -> Result<String> {
        let encoder = TextEncoder::new();
        let families = self.registry.gather();
        let mut buffer = Vec::new();
        encoder.encode(&families, &mut buffer)?;
        Ok(String::from_utf8(buffer)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opened_and_closed_trades_share_the_labels_a_comparison_needs() {
        let metrics = Metrics::new().expect("metrics");

        metrics.count_trade_opened("paper", "BTCUSDT", "1m", "emaCross", "long");
        metrics.count_trade_opened("paper", "BTCUSDT", "1m", "emaCross", "long");
        metrics.count_trade_closed("paper", "BTCUSDT", "1m", "emaCross", "long", "takeProfit");

        let encoded = metrics.encode().expect("encode");

        assert!(encoded.contains(
            "trading_bot_execution_trades_opened_total{mode=\"paper\",pair_code=\"BTCUSDT\",side=\"long\",strategy_name=\"emaCross\",timeframe_code=\"1m\"} 2"
        ));
        assert!(encoded.contains(
            "trading_bot_execution_trades_closed_total{close_reason=\"takeProfit\",mode=\"paper\",pair_code=\"BTCUSDT\",side=\"long\",strategy_name=\"emaCross\",timeframe_code=\"1m\"} 1"
        ));
    }

    #[test]
    fn realized_pnl_splits_into_two_counters_that_only_ever_rise() {
        let metrics = Metrics::new().expect("metrics");

        metrics.record_realized_pnl("paper", "BTCUSDT", "1m", "emaCross", "long", 12.5);
        metrics.record_realized_pnl("paper", "BTCUSDT", "1m", "emaCross", "long", -4.25);
        metrics.record_realized_pnl("paper", "BTCUSDT", "1m", "emaCross", "long", 2.0);

        let encoded = metrics.encode().expect("encode");

        assert!(encoded.contains(
            "trading_bot_execution_realized_profit_usd_total{mode=\"paper\",pair_code=\"BTCUSDT\",side=\"long\",strategy_name=\"emaCross\",timeframe_code=\"1m\"} 14.5"
        ));
        assert!(encoded.contains(
            "trading_bot_execution_realized_loss_usd_total{mode=\"paper\",pair_code=\"BTCUSDT\",side=\"long\",strategy_name=\"emaCross\",timeframe_code=\"1m\"} 4.25"
        ));
    }

    #[test]
    fn a_realized_pnl_that_is_not_a_number_never_reaches_a_counter() {
        let metrics = Metrics::new().expect("metrics");

        metrics.record_realized_pnl("paper", "BTCUSDT", "1m", "emaCross", "long", f64::NAN);
        metrics.record_realized_pnl("paper", "BTCUSDT", "1m", "emaCross", "long", f64::INFINITY);

        let encoded = metrics.encode().expect("encode");

        assert!(!encoded.contains("trading_bot_execution_realized_profit_usd_total"));
        assert!(!encoded.contains("trading_bot_execution_realized_loss_usd_total"));
    }

    #[test]
    fn a_loaded_promotion_starts_both_counters_at_zero() {
        let metrics = Metrics::new().expect("metrics");

        metrics.start_trade_counters_at_zero("paper", "ETHUSDT", "5m", "strategy1");

        let encoded = metrics.encode().expect("encode");

        assert!(encoded.contains(
            "trading_bot_execution_trades_opened_total{mode=\"paper\",pair_code=\"ETHUSDT\",side=\"short\",strategy_name=\"strategy1\",timeframe_code=\"5m\"} 0"
        ));
        assert!(encoded.contains(
            "trading_bot_execution_trades_closed_total{close_reason=\"riskExit\",mode=\"paper\",pair_code=\"ETHUSDT\",side=\"short\",strategy_name=\"strategy1\",timeframe_code=\"5m\"} 0"
        ));

        assert!(encoded.contains(
            "trading_bot_execution_realized_profit_usd_total{mode=\"paper\",pair_code=\"ETHUSDT\",side=\"long\",strategy_name=\"strategy1\",timeframe_code=\"5m\"} 0"
        ));
        assert!(encoded.contains(
            "trading_bot_execution_realized_loss_usd_total{mode=\"paper\",pair_code=\"ETHUSDT\",side=\"short\",strategy_name=\"strategy1\",timeframe_code=\"5m\"} 0"
        ));

        let zero_started = encoded
            .lines()
            .filter(|line| line.starts_with("trading_bot_execution_trades_"))
            .count();
        assert_eq!(
            zero_started,
            TRADE_SIDES.len() + TRADE_SIDES.len() * TRADE_CLOSE_REASONS.len()
        );
    }
}
