use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use prometheus::{
    Encoder, GaugeVec, IntCounter, IntCounterVec, IntGauge, Opts, Registry, TextEncoder,
};
use trading_bot_observability::{HealthMetrics, HttpMetrics};

use crate::models::BacktestSummary;
use trading_bot_strategy_engine::models::ResolvedAnalysisSettingsRecord;

pub const MAX_TRACKED_CONFIGURATIONS: usize = 2_048;

const CONFIGURATION_LABELS: [&str; 4] = [
    "strategy_name",
    "pair_code",
    "timeframe_code",
    "risk_profile_name",
];

#[derive(Clone)]
pub struct Metrics {
    registry: Registry,
    /// The estate-wide HTTP metrics every shared alert is built on.
    pub http: HttpMetrics,
    pub health: HealthMetrics,
    pub control_plane_connected: IntGauge,
    pub historical_store_connected: IntGauge,
    pub backtest_runs_total: IntCounterVec,
    pub replayed_klines_total: IntCounter,
    pub emitted_signals_total: IntCounter,
    pub simulated_trades_total: IntCounter,
    pub last_run_win_rate: GaugeVec,
    pub last_run_total_pnl_percent: GaugeVec,
    pub last_run_max_drawdown_percent: GaugeVec,
    pub last_run_score: GaugeVec,
    pub last_run_configurations_dropped_total: IntCounter,
    tracked_configurations: Arc<Mutex<HashSet<[String; 4]>>>,
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
        let last_run_win_rate = GaugeVec::new(
            Opts::new(
                "trading_bot_research_backtesting_last_run_win_rate",
                "Win rate of the most recent backtest of each configuration, from 0 to 1",
            ),
            &CONFIGURATION_LABELS,
        )?;
        let last_run_total_pnl_percent = GaugeVec::new(
            Opts::new(
                "trading_bot_research_backtesting_last_run_total_pnl_percent",
                "Total PnL percent of the most recent backtest of each configuration",
            ),
            &CONFIGURATION_LABELS,
        )?;
        let last_run_max_drawdown_percent = GaugeVec::new(
            Opts::new(
                "trading_bot_research_backtesting_last_run_max_drawdown_percent",
                "Maximum drawdown percent of the most recent backtest of each configuration",
            ),
            &CONFIGURATION_LABELS,
        )?;
        let last_run_score = GaugeVec::new(
            Opts::new(
                "trading_bot_research_backtesting_last_run_score",
                "Promotion score of the most recent backtest of each configuration",
            ),
            &CONFIGURATION_LABELS,
        )?;
        let last_run_configurations_dropped_total = IntCounter::new(
            "trading_bot_research_backtesting_last_run_configurations_dropped_total",
            "Backtest results not exported because the tracked configuration cap was reached",
        )?;

        registry.register(Box::new(control_plane_connected.clone()))?;
        registry.register(Box::new(historical_store_connected.clone()))?;
        registry.register(Box::new(backtest_runs_total.clone()))?;
        for outcome in ["success", "error"] {
            backtest_runs_total.with_label_values(&[outcome]);
        }
        registry.register(Box::new(replayed_klines_total.clone()))?;
        registry.register(Box::new(emitted_signals_total.clone()))?;
        registry.register(Box::new(simulated_trades_total.clone()))?;
        registry.register(Box::new(last_run_win_rate.clone()))?;
        registry.register(Box::new(last_run_total_pnl_percent.clone()))?;
        registry.register(Box::new(last_run_max_drawdown_percent.clone()))?;
        registry.register(Box::new(last_run_score.clone()))?;
        registry.register(Box::new(last_run_configurations_dropped_total.clone()))?;

        let http = HttpMetrics::register(&registry)?;
        let health = HealthMetrics::register(&registry)?;
        trading_bot_observability::register_build_info(&registry)?;

        Ok(Self {
            registry,
            http,
            health,
            control_plane_connected,
            historical_store_connected,
            backtest_runs_total,
            replayed_klines_total,
            emitted_signals_total,
            simulated_trades_total,
            last_run_win_rate,
            last_run_total_pnl_percent,
            last_run_max_drawdown_percent,
            last_run_score,
            last_run_configurations_dropped_total,
            tracked_configurations: Arc::new(Mutex::new(HashSet::new())),
        })
    }

    pub fn record_backtest_summary(
        &self,
        analysis: &ResolvedAnalysisSettingsRecord,
        summary: &BacktestSummary,
    ) {
        let labels = [
            analysis.strategy_name.as_str(),
            analysis.pair_code.as_str(),
            analysis.timeframe_code.as_str(),
            analysis.risk_profile_name.as_str(),
        ];

        if !self.track_configuration(labels) {
            self.last_run_configurations_dropped_total.inc();
            return;
        }

        self.last_run_win_rate
            .with_label_values(&labels)
            .set(summary.win_rate);
        self.last_run_total_pnl_percent
            .with_label_values(&labels)
            .set(summary.total_pnl_percent);
        self.last_run_max_drawdown_percent
            .with_label_values(&labels)
            .set(summary.max_drawdown_percent);
        self.last_run_score
            .with_label_values(&labels)
            .set(summary.score);
    }

    pub fn tracked_configuration_count(&self) -> usize {
        self.lock_tracked_configurations().len()
    }

    fn track_configuration(&self, labels: [&str; 4]) -> bool {
        let key = labels.map(str::to_string);
        let mut tracked = self.lock_tracked_configurations();

        if tracked.contains(&key) {
            return true;
        }
        if tracked.len() >= MAX_TRACKED_CONFIGURATIONS {
            return false;
        }

        tracked.insert(key);
        true
    }

    fn lock_tracked_configurations(&self) -> std::sync::MutexGuard<'_, HashSet<[String; 4]>> {
        self.tracked_configurations
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
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
    use serde_json::json;
    use trading_bot_strategy_engine::models::{
        PairRecord, RiskProfileRecord, StrategyRecord, TimeframeRecord,
    };

    use super::*;

    fn analysis_record(
        pair_code: &str,
        timeframe_code: &str,
        strategy_name: &str,
        risk_profile_name: &str,
    ) -> ResolvedAnalysisSettingsRecord {
        ResolvedAnalysisSettingsRecord {
            id: "analysis-1".to_string(),
            pair_code: pair_code.to_string(),
            timeframe_code: timeframe_code.to_string(),
            strategy_name: strategy_name.to_string(),
            risk_profile_name: risk_profile_name.to_string(),
            technical_analysis_settings: json!({}),
            enabled: true,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            pair: PairRecord {
                id: "pair-1".to_string(),
                code: pair_code.to_string(),
                active: true,
                base_asset: "BTC".to_string(),
                destination_asset: "USDT".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            timeframe: TimeframeRecord {
                id: "timeframe-1".to_string(),
                code: timeframe_code.to_string(),
                longer_timeframe_code: "5m".to_string(),
                longer_timeframe_multiplier: 5,
                period_ms: 60_000,
                active: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            strategy: StrategyRecord {
                id: "strategy-1".to_string(),
                name: strategy_name.to_string(),
                description: "strategy".to_string(),
                activated: true,
                parameters: json!({}),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            risk_profile: RiskProfileRecord {
                id: "risk-1".to_string(),
                name: risk_profile_name.to_string(),
                description: "risk".to_string(),
                maximum_stop_loss: 3.0,
                minimum_stop_loss: 1.0,
                swing_gap: 1.0,
                rrr: 2.0,
                enabled: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
        }
    }

    fn summary(
        win_rate: f64,
        total_pnl_percent: f64,
        max_drawdown_percent: f64,
        score: f64,
    ) -> BacktestSummary {
        BacktestSummary {
            signal_count: 10,
            long_signal_count: 6,
            short_signal_count: 4,
            trade_count: 8,
            winning_trade_count: 5,
            losing_trade_count: 3,
            flat_trade_count: 0,
            stop_loss_trade_count: 2,
            take_profit_trade_count: 4,
            reversal_trade_count: 1,
            window_end_trade_count: 1,
            non_reversal_trade_count: 7,
            reversal_ratio: 0.125,
            win_rate,
            total_fees_usd: 1.5,
            total_pnl_percent,
            equity_curve_pnl_percent: total_pnl_percent,
            max_drawdown_percent,
            score,
            timeslot_analysis: Vec::new(),
        }
    }

    #[test]
    fn exports_the_last_run_of_each_configuration_with_comparable_labels() {
        let metrics = Metrics::new().expect("metrics");

        metrics.record_backtest_summary(
            &analysis_record("BTCUSDT", "1m", "emaCross", "default"),
            &summary(0.625, 12.5, 4.25, 7.0),
        );
        metrics.record_backtest_summary(
            &analysis_record("ETHUSDT", "5m", "strategy1", "tight-scalp"),
            &summary(0.4, -3.5, 9.0, -6.5),
        );

        let encoded = metrics.encode().expect("encode");

        assert!(encoded.contains(
            "trading_bot_research_backtesting_last_run_win_rate{pair_code=\"BTCUSDT\",risk_profile_name=\"default\",strategy_name=\"emaCross\",timeframe_code=\"1m\"} 0.625"
        ));
        assert!(encoded.contains(
            "trading_bot_research_backtesting_last_run_total_pnl_percent{pair_code=\"BTCUSDT\",risk_profile_name=\"default\",strategy_name=\"emaCross\",timeframe_code=\"1m\"} 12.5"
        ));
        assert!(encoded.contains(
            "trading_bot_research_backtesting_last_run_max_drawdown_percent{pair_code=\"ETHUSDT\",risk_profile_name=\"tight-scalp\",strategy_name=\"strategy1\",timeframe_code=\"5m\"} 9"
        ));
        assert!(encoded.contains(
            "trading_bot_research_backtesting_last_run_score{pair_code=\"ETHUSDT\",risk_profile_name=\"tight-scalp\",strategy_name=\"strategy1\",timeframe_code=\"5m\"} -6.5"
        ));
        assert_eq!(metrics.tracked_configuration_count(), 2);
    }

    #[test]
    fn rerunning_one_configuration_replaces_its_series_instead_of_adding_one() {
        let metrics = Metrics::new().expect("metrics");
        let analysis = analysis_record("BTCUSDT", "1m", "emaCross", "default");

        metrics.record_backtest_summary(&analysis, &summary(0.5, 1.0, 2.0, 3.0));
        metrics.record_backtest_summary(&analysis, &summary(0.75, 4.0, 1.0, 9.0));

        let encoded = metrics.encode().expect("encode");

        assert_eq!(metrics.tracked_configuration_count(), 1);
        assert!(encoded.contains(
            "trading_bot_research_backtesting_last_run_score{pair_code=\"BTCUSDT\",risk_profile_name=\"default\",strategy_name=\"emaCross\",timeframe_code=\"1m\"} 9"
        ));
    }

    #[test]
    fn stops_tracking_new_configurations_once_the_cap_is_reached() {
        let metrics = Metrics::new().expect("metrics");

        for index in 0..MAX_TRACKED_CONFIGURATIONS {
            metrics.record_backtest_summary(
                &analysis_record(&format!("PAIR{index}"), "1m", "emaCross", "default"),
                &summary(0.5, 1.0, 2.0, 3.0),
            );
        }

        assert_eq!(
            metrics.tracked_configuration_count(),
            MAX_TRACKED_CONFIGURATIONS
        );
        assert_eq!(metrics.last_run_configurations_dropped_total.get(), 0);

        metrics.record_backtest_summary(
            &analysis_record("OVERFLOWUSDT", "1m", "emaCross", "default"),
            &summary(0.9, 20.0, 1.0, 18.0),
        );

        assert_eq!(
            metrics.tracked_configuration_count(),
            MAX_TRACKED_CONFIGURATIONS
        );
        assert_eq!(metrics.last_run_configurations_dropped_total.get(), 1);
        assert!(!metrics.encode().expect("encode").contains("OVERFLOWUSDT"));
    }
}
