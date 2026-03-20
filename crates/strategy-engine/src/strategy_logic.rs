use std::collections::VecDeque;

use anyhow::{Result, bail};
use serde_json::Value;

use crate::models::{
    AnalysisSummary, MarketDataKlineEvent, PersistedKlineRecord, ResolvedAnalysisSettingsRecord,
    StrategySignalEvent,
};

#[derive(Clone, Debug)]
pub struct AnalysisSpec {
    pub analysis_setting_id: String,
    pub symbol: String,
    pub timeframe_code: String,
    pub strategy_name: String,
    pub strategy_kind: String,
    pub fast_period: usize,
    pub slow_period: usize,
    pub technical_analysis_settings: Value,
    pub risk_profile_name: String,
    pub risk_profile: crate::models::RiskProfileRecord,
    pub trading_defaults_name: String,
    pub trading_defaults: crate::models::TradingDefaultsRecord,
}

#[derive(Clone, Debug)]
pub struct EmittedSignal {
    pub signal_direction: String,
    pub close_time: i64,
    pub close_price: f64,
    pub fast_ema: f64,
    pub slow_ema: f64,
    pub kline_event_id: String,
    pub exchange: String,
    pub occurred_at: String,
}

#[derive(Clone, Debug)]
pub struct AnalysisEvaluator {
    spec: AnalysisSpec,
    recent_closes: VecDeque<f64>,
    last_fast_ema: Option<f64>,
    last_slow_ema: Option<f64>,
    last_close_time: Option<i64>,
}

fn normalized_name(value: &str) -> String {
    value
        .chars()
        .filter(|char| char.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn json_usize(value: Option<&Value>) -> Option<usize> {
    value.and_then(|value| match value {
        Value::Number(number) => number.as_u64().map(|value| value as usize),
        Value::String(string) => string.parse::<usize>().ok(),
        _ => None,
    })
}

pub fn build_analysis_spec(
    record: &ResolvedAnalysisSettingsRecord,
) -> Result<Option<AnalysisSpec>> {
    if !record.enabled
        || !record.pair.operable
        || !record.timeframe.operable
        || !record.strategy.activated
    {
        return Ok(None);
    }

    let parameters = record.strategy.parameters.as_object();
    let technical_analysis_settings = record.technical_analysis_settings.as_object();

    let strategy_kind = parameters
        .and_then(|parameters| parameters.get("kind"))
        .and_then(Value::as_str)
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| normalized_name(&record.strategy.name));

    if strategy_kind != "emacross" {
        return Ok(None);
    }

    let fast_period =
        json_usize(technical_analysis_settings.and_then(|settings| settings.get("fastPeriod")))
            .or_else(|| json_usize(parameters.and_then(|parameters| parameters.get("fastPeriod"))))
            .unwrap_or(9);
    let slow_period =
        json_usize(technical_analysis_settings.and_then(|settings| settings.get("slowPeriod")))
            .or_else(|| json_usize(parameters.and_then(|parameters| parameters.get("slowPeriod"))))
            .unwrap_or(21);

    if fast_period == 0 || slow_period == 0 || slow_period <= fast_period {
        bail!(
            "analysis setting {} has invalid emaCross periods: fastPeriod={}, slowPeriod={}",
            record.id,
            fast_period,
            slow_period
        );
    }

    Ok(Some(AnalysisSpec {
        analysis_setting_id: record.id.clone(),
        symbol: record.symbol.clone(),
        timeframe_code: record.timeframe_code.clone(),
        strategy_name: record.strategy_name.clone(),
        strategy_kind: "emaCross".to_string(),
        fast_period,
        slow_period,
        technical_analysis_settings: record.technical_analysis_settings.clone(),
        risk_profile_name: record.risk_profile_name.clone(),
        risk_profile: record.risk_profile.clone(),
        trading_defaults_name: record.trading_defaults_name.clone(),
        trading_defaults: record.trading_defaults.clone(),
    }))
}

impl AnalysisEvaluator {
    pub fn new(spec: AnalysisSpec) -> Self {
        Self {
            spec,
            recent_closes: VecDeque::new(),
            last_fast_ema: None,
            last_slow_ema: None,
            last_close_time: None,
        }
    }

    pub fn spec(&self) -> &AnalysisSpec {
        &self.spec
    }

    pub fn warm_from_klines(&mut self, rows: &[PersistedKlineRecord]) {
        let mut sorted_rows = rows.iter().filter(|row| row.closed).collect::<Vec<_>>();
        sorted_rows.sort_by_key(|row| row.open_time);

        for row in sorted_rows {
            if let Ok(close_price) = row.close.parse::<f64>() {
                let _ = self.apply_close(close_price, row.close_time, None, false);
            }
        }
    }

    pub fn process_live_kline(&mut self, event: &MarketDataKlineEvent) -> Option<EmittedSignal> {
        if !event.closed || event.ingestion_mode != "live" {
            return None;
        }

        let close_price = event.close.parse::<f64>().ok()?;
        self.apply_close(close_price, event.close_time, Some(event), true)
    }

    pub fn summary(&self) -> AnalysisSummary {
        AnalysisSummary {
            analysis_setting_id: self.spec.analysis_setting_id.clone(),
            pair_code: self.spec.symbol.clone(),
            symbol: self.spec.symbol.clone(),
            timeframe_code: self.spec.timeframe_code.clone(),
            strategy_name: self.spec.strategy_name.clone(),
            strategy_kind: self.spec.strategy_kind.clone(),
            fast_period: self.spec.fast_period,
            slow_period: self.spec.slow_period,
            warmed: self.last_fast_ema.is_some() && self.last_slow_ema.is_some(),
            last_close_time: self.last_close_time,
            last_fast_ema: self.last_fast_ema,
            last_slow_ema: self.last_slow_ema,
        }
    }

    pub fn to_signal_event(&self, emitted: EmittedSignal, source: &str) -> StrategySignalEvent {
        StrategySignalEvent {
            event_id: format!(
                "{}:{}:{}",
                self.spec.analysis_setting_id, emitted.close_time, emitted.signal_direction
            ),
            event_type: "trading-bot.strategy-engine.signal.v1".to_string(),
            source: source.to_string(),
            occurred_at: emitted.occurred_at,
            exchange: emitted.exchange,
            analysis_setting_id: self.spec.analysis_setting_id.clone(),
            pair_code: self.spec.symbol.clone(),
            symbol: self.spec.symbol.clone(),
            timeframe_code: self.spec.timeframe_code.clone(),
            strategy_name: self.spec.strategy_name.clone(),
            strategy_kind: self.spec.strategy_kind.clone(),
            signal_kind: "entry".to_string(),
            signal_direction: emitted.signal_direction,
            close_time: emitted.close_time,
            close_price: emitted.close_price,
            kline_event_id: emitted.kline_event_id,
            fast_ema: emitted.fast_ema,
            slow_ema: emitted.slow_ema,
            risk_profile_name: self.spec.risk_profile_name.clone(),
            risk_profile: self.spec.risk_profile.clone(),
            trading_defaults_name: self.spec.trading_defaults_name.clone(),
            trading_defaults: self.spec.trading_defaults.clone(),
            technical_analysis_settings: self.spec.technical_analysis_settings.clone(),
        }
    }

    fn apply_close(
        &mut self,
        close_price: f64,
        close_time: i64,
        event: Option<&MarketDataKlineEvent>,
        emit_signal: bool,
    ) -> Option<EmittedSignal> {
        if self
            .last_close_time
            .map(|last_close_time| close_time <= last_close_time)
            .unwrap_or(false)
        {
            return None;
        }

        self.recent_closes.push_back(close_price);
        while self.recent_closes.len() > self.spec.slow_period {
            self.recent_closes.pop_front();
        }

        let previous_fast_ema = self.last_fast_ema;
        let previous_slow_ema = self.last_slow_ema;

        let (next_fast_ema, next_slow_ema) = match (
            self.last_fast_ema,
            self.last_slow_ema,
            self.recent_closes.len(),
        ) {
            (_, _, len) if len < self.spec.slow_period => {
                self.last_close_time = Some(close_time);
                return None;
            }
            (Some(last_fast_ema), Some(last_slow_ema), _) => (
                ema_step(last_fast_ema, close_price, self.spec.fast_period),
                ema_step(last_slow_ema, close_price, self.spec.slow_period),
            ),
            _ => (
                sma(&self.recent_closes, self.spec.fast_period),
                sma(&self.recent_closes, self.spec.slow_period),
            ),
        };

        self.last_fast_ema = Some(next_fast_ema);
        self.last_slow_ema = Some(next_slow_ema);
        self.last_close_time = Some(close_time);

        if !emit_signal {
            return None;
        }

        let (Some(previous_fast_ema), Some(previous_slow_ema), Some(event)) =
            (previous_fast_ema, previous_slow_ema, event)
        else {
            return None;
        };

        let signal_direction =
            if previous_fast_ema <= previous_slow_ema && next_fast_ema > next_slow_ema {
                Some("long".to_string())
            } else if previous_fast_ema >= previous_slow_ema && next_fast_ema < next_slow_ema {
                Some("short".to_string())
            } else {
                None
            }?;

        Some(EmittedSignal {
            signal_direction,
            close_time,
            close_price,
            fast_ema: next_fast_ema,
            slow_ema: next_slow_ema,
            kline_event_id: event.event_id.clone(),
            exchange: event.exchange.clone(),
            occurred_at: event.occurred_at.clone(),
        })
    }
}

fn sma(values: &VecDeque<f64>, period: usize) -> f64 {
    let count = values.len();
    let start = count.saturating_sub(period);
    let window = values.iter().skip(start).collect::<Vec<_>>();
    window.iter().copied().sum::<f64>() / window.len() as f64
}

fn ema_step(previous: f64, current: f64, period: usize) -> f64 {
    let alpha = 2.0 / (period as f64 + 1.0);
    current * alpha + previous * (1.0 - alpha)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{AnalysisEvaluator, build_analysis_spec};
    use crate::models::{
        MarketDataKlineEvent, PairRecord, ResolvedAnalysisSettingsRecord, RiskProfileRecord,
        StrategyRecord, TimeframeRecord, TradingDefaultsRecord,
    };

    fn record_with_kind(kind: &str) -> ResolvedAnalysisSettingsRecord {
        ResolvedAnalysisSettingsRecord {
            id: "analysis-1".to_string(),
            pair_code: "BTCUSDT".to_string(),
            timeframe_code: "1m".to_string(),
            strategy_name: "ema-cross".to_string(),
            risk_profile_name: "default-risk".to_string(),
            trading_defaults_name: "default-trading".to_string(),
            technical_analysis_settings: json!({"fastPeriod": 2, "slowPeriod": 3}),
            enabled: true,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            pair: PairRecord {
                id: "pair-1".to_string(),
                code: "BTCUSDT".to_string(),
                operable: true,
                origin_asset_needed_funds: None,
                destination_asset_needed_funds: None,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            timeframe: TimeframeRecord {
                id: "timeframe-1".to_string(),
                code: "1m".to_string(),
                longer_timeframe_code: "5m".to_string(),
                longer_timeframe_multiplier: 5,
                period_ms: 60_000,
                operable: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            strategy: StrategyRecord {
                id: "strategy-1".to_string(),
                name: "ema-cross".to_string(),
                description: "ema crossover".to_string(),
                activated: true,
                parameters: json!({ "kind": kind }),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            risk_profile: RiskProfileRecord {
                id: "risk-1".to_string(),
                name: "default-risk".to_string(),
                description: "risk".to_string(),
                maximum_stop_loss: 5.0,
                minimum_stop_loss: 1.0,
                swing_gap: 1.5,
                rrr: 2.0,
                enabled: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            trading_defaults: TradingDefaultsRecord {
                id: "trading-1".to_string(),
                name: "default-trading".to_string(),
                description: "trading".to_string(),
                default_position_notional_usd: 100.0,
                enabled: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
        }
    }

    fn live_closed_event(close: &str, close_time: i64) -> MarketDataKlineEvent {
        MarketDataKlineEvent {
            event_id: format!("event-{close_time}"),
            event_type: "trading-bot.market-data.kline.v1".to_string(),
            source: "test".to_string(),
            occurred_at: "2026-01-01T00:00:00Z".to_string(),
            exchange: "binance".to_string(),
            ingestion_mode: "live".to_string(),
            stream_name: "btcusdt@kline_1m".to_string(),
            pair_code: "BTCUSDT".to_string(),
            symbol: "BTCUSDT".to_string(),
            timeframe_code: "1m".to_string(),
            period_ms: 60_000,
            open_time: close_time - 60_000,
            close_time,
            event_time: close_time,
            closed: true,
            open: close.to_string(),
            high: close.to_string(),
            low: close.to_string(),
            close: close.to_string(),
            volume: "1".to_string(),
            quote_volume: "1".to_string(),
            trade_count: 1,
            analysis_setting_ids: vec!["analysis-1".to_string()],
            strategy_names: vec!["ema-cross".to_string()],
        }
    }

    #[test]
    fn build_analysis_spec_ignores_unsupported_kind() {
        let record = record_with_kind("unsupported");
        let spec = build_analysis_spec(&record).expect("spec build should succeed");
        assert!(spec.is_none());
    }

    #[test]
    fn ema_cross_emits_long_then_short_signal() {
        let record = record_with_kind("emaCross");
        let spec = build_analysis_spec(&record)
            .expect("spec build should succeed")
            .expect("emaCross should be supported");
        let mut evaluator = AnalysisEvaluator::new(spec);

        evaluator.warm_from_klines(&[
            crate::models::PersistedKlineRecord {
                pair_code: "BTCUSDT".to_string(),
                symbol: "BTCUSDT".to_string(),
                timeframe_code: "1m".to_string(),
                period_ms: 60_000,
                open_time: 1,
                close_time: 2,
                event_time: 2,
                occurred_at: "2026-01-01T00:00:00Z".to_string(),
                ingestion_mode: "backfill".to_string(),
                closed: true,
                open: "10".to_string(),
                high: "10".to_string(),
                low: "10".to_string(),
                close: "10".to_string(),
                volume: "1".to_string(),
                quote_volume: "1".to_string(),
                trade_count: 1,
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            crate::models::PersistedKlineRecord {
                pair_code: "BTCUSDT".to_string(),
                symbol: "BTCUSDT".to_string(),
                timeframe_code: "1m".to_string(),
                period_ms: 60_000,
                open_time: 2,
                close_time: 3,
                event_time: 3,
                occurred_at: "2026-01-01T00:00:00Z".to_string(),
                ingestion_mode: "backfill".to_string(),
                closed: true,
                open: "9".to_string(),
                high: "9".to_string(),
                low: "9".to_string(),
                close: "9".to_string(),
                volume: "1".to_string(),
                quote_volume: "1".to_string(),
                trade_count: 1,
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            crate::models::PersistedKlineRecord {
                pair_code: "BTCUSDT".to_string(),
                symbol: "BTCUSDT".to_string(),
                timeframe_code: "1m".to_string(),
                period_ms: 60_000,
                open_time: 3,
                close_time: 4,
                event_time: 4,
                occurred_at: "2026-01-01T00:00:00Z".to_string(),
                ingestion_mode: "backfill".to_string(),
                closed: true,
                open: "8".to_string(),
                high: "8".to_string(),
                low: "8".to_string(),
                close: "8".to_string(),
                volume: "1".to_string(),
                quote_volume: "1".to_string(),
                trade_count: 1,
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
        ]);

        let long_signal = evaluator
            .process_live_kline(&live_closed_event("12", 5))
            .expect("long signal should be emitted");
        assert_eq!(long_signal.signal_direction, "long");

        let short_signal = evaluator
            .process_live_kline(&live_closed_event("6", 6))
            .expect("short signal should be emitted");
        assert_eq!(short_signal.signal_direction, "short");
    }
}
