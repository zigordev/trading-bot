use std::collections::{BTreeMap, VecDeque};

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use tracing::info;

use crate::models::{MarketDataKlineEvent, PersistedKlineRecord, ResolvedAnalysisSettingsRecord};

const LEGACY_WINDOW_CANDLES: usize = 1000;
const STOCHASTIC_OVERSELL_LEVEL: f64 = 20.0;
const STOCHASTIC_OVERBUY_LEVEL: f64 = 80.0;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KlineRequirement {
    pub timeframe_code: String,
    pub period_multiplier: i64,
    pub warmup_candles: usize,
    pub emits_signals: bool,
}

#[derive(Clone, Debug)]
pub struct AnalysisSpec {
    pub analysis_setting_id: String,
    pub symbol: String,
    pub timeframe_code: String,
    pub strategy_name: String,
    pub strategy_kind: String,
    pub technical_analysis_settings: Value,
    pub risk_profile_name: String,
    pub risk_profile: crate::models::RiskProfileRecord,
    strategy_definition: StrategyDefinition,
}

#[derive(Clone, Debug)]
enum StrategyDefinition {
    EmaCross(EmaCrossConfig),
    LegacyStrategy1(LegacyTrendPullbackConfig),
    LegacyStrategy2(LegacyMomentumConfirmationConfig),
}

#[derive(Clone, Debug)]
struct EmaCrossConfig {
    fast_period: usize,
    slow_period: usize,
}

#[derive(Clone, Debug)]
struct LegacyTrendPullbackConfig {
    longer_timeframe_code: String,
    longer_timeframe_multiplier: i64,
    longer_timeframe_ema_periods: usize,
    macd_fast_periods: usize,
    macd_slow_periods: usize,
    macd_signal_periods: usize,
    stochastic_periods: usize,
    stochastic_signal_periods: usize,
}

#[derive(Clone, Debug)]
struct LegacyMomentumConfirmationConfig {
    longer_timeframe_code: String,
    longer_timeframe_multiplier: i64,
    longer_timeframe_ema_periods: usize,
    macd_fast_periods: usize,
    macd_slow_periods: usize,
    macd_signal_periods: usize,
    stochastic_periods: usize,
    stochastic_signal_periods: usize,
    rsi_periods: usize,
}

#[derive(Clone, Debug)]
pub struct EmittedSignal {
    pub signal_direction: String,
    pub close_time: i64,
    pub close_price: f64,
    pub fast_ema: Option<f64>,
    pub slow_ema: Option<f64>,
    pub kline_event_id: String,
    pub exchange: String,
    pub occurred_at: String,
    pub details: Value,
}

#[derive(Clone, Debug)]
pub struct AnalysisEvaluator {
    spec: AnalysisSpec,
    candles_by_timeframe: BTreeMap<String, VecDeque<Candle>>,
    last_seen_close_time_by_timeframe: BTreeMap<String, i64>,
    strategy2_state: Strategy2State,
}

#[derive(Clone, Debug, Default)]
struct Strategy2State {
    stochastic_oversell_level_reached: bool,
    stochastic_overbuy_level_reached: bool,
}

#[derive(Clone, Debug)]
struct Candle {
    close_time: i64,
    close: f64,
    high: f64,
    low: f64,
}

#[derive(Clone, Debug)]
struct IndicatorSnapshot {
    close_time: i64,
    close_price: f64,
    details: Value,
}

#[derive(Clone, Debug)]
struct MacdPoint {
    macd: f64,
    signal: f64,
    histogram: f64,
}

#[derive(Clone, Debug)]
struct StochasticPoint {
    k: f64,
    d: f64,
}

impl AnalysisSpec {
    pub fn required_kline_requirements(&self) -> Vec<KlineRequirement> {
        match &self.strategy_definition {
            StrategyDefinition::EmaCross(config) => vec![KlineRequirement {
                timeframe_code: self.timeframe_code.clone(),
                period_multiplier: 1,
                warmup_candles: config.slow_period.saturating_add(1),
                emits_signals: true,
            }],
            StrategyDefinition::LegacyStrategy1(config) => vec![
                KlineRequirement {
                    timeframe_code: config.longer_timeframe_code.clone(),
                    period_multiplier: config.longer_timeframe_multiplier,
                    warmup_candles: LEGACY_WINDOW_CANDLES,
                    emits_signals: false,
                },
                KlineRequirement {
                    timeframe_code: self.timeframe_code.clone(),
                    period_multiplier: 1,
                    warmup_candles: LEGACY_WINDOW_CANDLES,
                    emits_signals: true,
                },
            ],
            StrategyDefinition::LegacyStrategy2(config) => vec![
                KlineRequirement {
                    timeframe_code: config.longer_timeframe_code.clone(),
                    period_multiplier: config.longer_timeframe_multiplier,
                    warmup_candles: LEGACY_WINDOW_CANDLES,
                    emits_signals: false,
                },
                KlineRequirement {
                    timeframe_code: self.timeframe_code.clone(),
                    period_multiplier: 1,
                    warmup_candles: LEGACY_WINDOW_CANDLES,
                    emits_signals: true,
                },
            ],
        }
    }

    pub fn required_timeframe_codes(&self) -> Vec<String> {
        self.required_kline_requirements()
            .into_iter()
            .map(|requirement| requirement.timeframe_code)
            .collect()
    }

    pub fn signal_timeframe_code(&self) -> &str {
        &self.timeframe_code
    }

    pub fn max_warmup_candles(&self) -> usize {
        self.required_kline_requirements()
            .into_iter()
            .map(|requirement| requirement.warmup_candles)
            .max()
            .unwrap_or(0)
    }
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

fn required_json_usize(
    settings: Option<&serde_json::Map<String, Value>>,
    key: &str,
    analysis_setting_id: &str,
) -> Result<usize> {
    let value = json_usize(settings.and_then(|settings| settings.get(key))).with_context(|| {
        format!(
            "analysis setting {analysis_setting_id} is missing required technicalAnalysisSettings.{key}"
        )
    })?;
    if value == 0 {
        bail!(
            "analysis setting {} has invalid technicalAnalysisSettings.{}=0",
            analysis_setting_id,
            key
        );
    }
    Ok(value)
}

pub fn build_analysis_spec(
    record: &ResolvedAnalysisSettingsRecord,
) -> Result<Option<AnalysisSpec>> {
    if !record.enabled
        || !record.symbol_entity.active
        || !record.timeframe.active
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

    let strategy_definition = match strategy_kind.as_str() {
        "emacross" => {
            let fast_period = json_usize(
                technical_analysis_settings.and_then(|settings| settings.get("fastPeriod")),
            )
            .or_else(|| json_usize(parameters.and_then(|parameters| parameters.get("fastPeriod"))))
            .unwrap_or(9);
            let slow_period = json_usize(
                technical_analysis_settings.and_then(|settings| settings.get("slowPeriod")),
            )
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

            StrategyDefinition::EmaCross(EmaCrossConfig {
                fast_period,
                slow_period,
            })
        }
        "strategy1" => StrategyDefinition::LegacyStrategy1(LegacyTrendPullbackConfig {
            longer_timeframe_code: record.timeframe.longer_timeframe_code.clone(),
            longer_timeframe_multiplier: record.timeframe.longer_timeframe_multiplier,
            longer_timeframe_ema_periods: required_json_usize(
                technical_analysis_settings,
                "longerTimeframeEmaPeriods",
                &record.id,
            )?,
            macd_fast_periods: required_json_usize(
                technical_analysis_settings,
                "macdFastPeriods",
                &record.id,
            )?,
            macd_slow_periods: required_json_usize(
                technical_analysis_settings,
                "macdSlowPeriods",
                &record.id,
            )?,
            macd_signal_periods: required_json_usize(
                technical_analysis_settings,
                "macdSignalPeriods",
                &record.id,
            )?,
            stochastic_periods: required_json_usize(
                technical_analysis_settings,
                "stochasticPeriods",
                &record.id,
            )?,
            stochastic_signal_periods: required_json_usize(
                technical_analysis_settings,
                "stochasticSignalPeriods",
                &record.id,
            )?,
        }),
        "strategy2" => StrategyDefinition::LegacyStrategy2(LegacyMomentumConfirmationConfig {
            longer_timeframe_code: record.timeframe.longer_timeframe_code.clone(),
            longer_timeframe_multiplier: record.timeframe.longer_timeframe_multiplier,
            longer_timeframe_ema_periods: required_json_usize(
                technical_analysis_settings,
                "longerTimeframeEmaPeriods",
                &record.id,
            )?,
            macd_fast_periods: required_json_usize(
                technical_analysis_settings,
                "macdFastPeriods",
                &record.id,
            )?,
            macd_slow_periods: required_json_usize(
                technical_analysis_settings,
                "macdSlowPeriods",
                &record.id,
            )?,
            macd_signal_periods: required_json_usize(
                technical_analysis_settings,
                "macdSignalPeriods",
                &record.id,
            )?,
            stochastic_periods: required_json_usize(
                technical_analysis_settings,
                "stochasticPeriods",
                &record.id,
            )?,
            stochastic_signal_periods: required_json_usize(
                technical_analysis_settings,
                "stochasticSignalPeriods",
                &record.id,
            )?,
            rsi_periods: required_json_usize(
                technical_analysis_settings,
                "rsiPeriods",
                &record.id,
            )?,
        }),
        _ => return Ok(None),
    };

    Ok(Some(AnalysisSpec {
        analysis_setting_id: record.id.clone(),
        symbol: record.symbol.clone(),
        timeframe_code: record.timeframe_code.clone(),
        strategy_name: record.strategy_name.clone(),
        strategy_kind: match &strategy_definition {
            StrategyDefinition::EmaCross(_) => "emaCross".to_string(),
            StrategyDefinition::LegacyStrategy1(_) => "strategy1".to_string(),
            StrategyDefinition::LegacyStrategy2(_) => "strategy2".to_string(),
        },
        technical_analysis_settings: record.technical_analysis_settings.clone(),
        risk_profile_name: record.risk_profile_name.clone(),
        risk_profile: record.risk_profile.clone(),
        strategy_definition,
    }))
}

impl AnalysisEvaluator {
    pub fn new(spec: AnalysisSpec) -> Self {
        let mut candles_by_timeframe = BTreeMap::new();
        for requirement in spec.required_kline_requirements() {
            candles_by_timeframe.insert(requirement.timeframe_code, VecDeque::new());
        }

        Self {
            spec,
            candles_by_timeframe,
            last_seen_close_time_by_timeframe: BTreeMap::new(),
            strategy2_state: Strategy2State::default(),
        }
    }

    pub fn spec(&self) -> &AnalysisSpec {
        &self.spec
    }

    pub fn warm_from_klines(&mut self, rows: &[PersistedKlineRecord]) {
        let mut sorted_rows = rows.iter().filter(|row| row.closed).collect::<Vec<_>>();
        sorted_rows.sort_by(|left, right| {
            left.close_time.cmp(&right.close_time).then_with(|| {
                timeframe_priority(self.spec.signal_timeframe_code(), &left.timeframe_code).cmp(
                    &timeframe_priority(self.spec.signal_timeframe_code(), &right.timeframe_code),
                )
            })
        });

        for row in sorted_rows {
            let event = MarketDataKlineEvent {
                event_id: format!(
                    "warmup:{}:{}",
                    self.spec.analysis_setting_id, row.close_time
                ),
                event_type: "warmup".to_string(),
                source: "warmup".to_string(),
                occurred_at: row.occurred_at.clone(),
                exchange: "binance".to_string(),
                ingestion_mode: "historical".to_string(),
                stream_name: format!("{}:{}", row.symbol, row.timeframe_code),
                pair_code: row.pair_code.clone(),
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
                analysis_setting_ids: vec![self.spec.analysis_setting_id.clone()],
                strategy_names: vec![self.spec.strategy_name.clone()],
            };
            let _ = self.process_event(&event, false);
        }
    }

    pub fn process_live_kline(&mut self, event: &MarketDataKlineEvent) -> Option<EmittedSignal> {
        if !event.closed {
            return None;
        }

        self.process_event(event, true)
    }

    fn process_event(
        &mut self,
        event: &MarketDataKlineEvent,
        emit_signal: bool,
    ) -> Option<EmittedSignal> {
        if !self
            .candles_by_timeframe
            .contains_key(event.timeframe_code.as_str())
        {
            return None;
        }

        if self
            .last_seen_close_time_by_timeframe
            .get(event.timeframe_code.as_str())
            .map(|close_time| event.close_time <= *close_time)
            .unwrap_or(false)
        {
            return None;
        }

        let candle = Candle {
            close_time: event.close_time,
            close: event.close.parse::<f64>().ok()?,
            high: event.high.parse::<f64>().ok()?,
            low: event.low.parse::<f64>().ok()?,
        };
        self.store_candle(&event.timeframe_code, candle);
        self.last_seen_close_time_by_timeframe
            .insert(event.timeframe_code.clone(), event.close_time);

        if event.timeframe_code != self.spec.signal_timeframe_code() || !emit_signal {
            return None;
        }

        let strategy_definition = self.spec.strategy_definition.clone();
        let snapshot = match &strategy_definition {
            StrategyDefinition::EmaCross(config) => self.evaluate_ema_cross(config),
            StrategyDefinition::LegacyStrategy1(config) => self.evaluate_legacy_strategy1(config),
            StrategyDefinition::LegacyStrategy2(config) => self.evaluate_legacy_strategy2(config),
        }?;

        info!(
            analysis_setting_id = %self.spec.analysis_setting_id,
            symbol = %self.spec.symbol,
            timeframe_code = %self.spec.timeframe_code,
            strategy_name = %self.spec.strategy_name,
            risk_profile_name = %self.spec.risk_profile_name,
            close_time = snapshot.close_time,
            close_price = snapshot.close_price,
            signal_direction = %snapshot.details.get("signalDirection").and_then(|value| value.as_str()).unwrap_or("none"),
            strategy_kind = %self.spec.strategy_kind,
            "strategy candle evaluated"
        );

        let signal_direction = snapshot
            .details
            .get("signalDirection")
            .and_then(Value::as_str)
            .map(str::to_string)?;

        Some(EmittedSignal {
            signal_direction,
            close_time: snapshot.close_time,
            close_price: snapshot.close_price,
            fast_ema: snapshot.details.get("fastEma").and_then(Value::as_f64),
            slow_ema: snapshot.details.get("slowEma").and_then(Value::as_f64),
            kline_event_id: event.event_id.clone(),
            exchange: event.exchange.clone(),
            occurred_at: event.occurred_at.clone(),
            details: snapshot.details,
        })
    }

    fn store_candle(&mut self, timeframe_code: &str, candle: Candle) {
        let Some(buffer) = self.candles_by_timeframe.get_mut(timeframe_code) else {
            return;
        };
        buffer.push_back(candle);
        while buffer.len() > LEGACY_WINDOW_CANDLES {
            buffer.pop_front();
        }
    }

    fn evaluate_ema_cross(&self, config: &EmaCrossConfig) -> Option<IndicatorSnapshot> {
        let operating = self.candles_by_timeframe.get(&self.spec.timeframe_code)?;
        let closes = candle_closes(operating);
        if closes.len() < config.slow_period.saturating_add(1) {
            return None;
        }

        let fast_ema = ema_series(&closes, config.fast_period);
        let slow_ema = ema_series(&closes, config.slow_period);
        let previous_fast = fast_ema
            .get(closes.len().saturating_sub(2))
            .and_then(|value| *value)?;
        let previous_slow = slow_ema
            .get(closes.len().saturating_sub(2))
            .and_then(|value| *value)?;
        let next_fast = fast_ema.last().and_then(|value| *value)?;
        let next_slow = slow_ema.last().and_then(|value| *value)?;

        let signal_direction = if previous_fast <= previous_slow && next_fast > next_slow {
            Some("long")
        } else if previous_fast >= previous_slow && next_fast < next_slow {
            Some("short")
        } else {
            None
        };

        let latest = operating.back()?;
        Some(IndicatorSnapshot {
            close_time: latest.close_time,
            close_price: latest.close,
            details: json!({
                "signalDirection": signal_direction,
                "fastEma": next_fast,
                "slowEma": next_slow,
                "previousFastEma": previous_fast,
                "previousSlowEma": previous_slow,
            }),
        })
    }

    fn evaluate_legacy_strategy1(
        &self,
        config: &LegacyTrendPullbackConfig,
    ) -> Option<IndicatorSnapshot> {
        let longer = self
            .candles_by_timeframe
            .get(&config.longer_timeframe_code)?;
        let operating = self.candles_by_timeframe.get(&self.spec.timeframe_code)?;
        if longer.len() < LEGACY_WINDOW_CANDLES || operating.len() < LEGACY_WINDOW_CANDLES {
            return None;
        }

        let longer_closes = candle_closes(longer);
        let operating_closes = candle_closes(operating);
        let operating_highs = candle_highs(operating);
        let operating_lows = candle_lows(operating);

        let ema_longer = ema_series(&longer_closes, config.longer_timeframe_ema_periods);
        let macd_longer = macd_series(
            &longer_closes,
            config.macd_fast_periods,
            config.macd_slow_periods,
            config.macd_signal_periods,
        );
        let macd_operating = macd_series(
            &operating_closes,
            config.macd_fast_periods,
            config.macd_slow_periods,
            config.macd_signal_periods,
        );
        let stochastic_operating = stochastic_series(
            &operating_highs,
            &operating_lows,
            &operating_closes,
            config.stochastic_periods,
            config.stochastic_signal_periods,
        );

        let longer_close = *longer_closes.last()?;
        let ema_longer = ema_longer.last().and_then(|value| *value)?;
        let macd_histogram_longer = macd_longer
            .last()
            .and_then(|value| value.as_ref())?
            .histogram;
        let macd_histogram_operating = macd_operating
            .last()
            .and_then(|value| value.as_ref())?
            .histogram;
        let previous_stochastic = stochastic_operating
            .get(stochastic_operating.len().saturating_sub(2))
            .and_then(|value| value.as_ref())?;
        let stochastic = stochastic_operating
            .last()
            .and_then(|value| value.as_ref())?;
        let latest = operating.back()?;

        let long_match = longer_close > ema_longer
            && macd_histogram_longer > 0.0
            && macd_histogram_operating < 0.0
            && previous_stochastic.k < previous_stochastic.d
            && stochastic.k >= stochastic.d
            && stochastic.k < STOCHASTIC_OVERSELL_LEVEL
            && stochastic.d < STOCHASTIC_OVERSELL_LEVEL;

        let short_match = longer_close < ema_longer
            && macd_histogram_longer < 0.0
            && macd_histogram_operating > 0.0
            && previous_stochastic.k > previous_stochastic.d
            && stochastic.k <= stochastic.d
            && stochastic.k > STOCHASTIC_OVERBUY_LEVEL
            && stochastic.d > STOCHASTIC_OVERBUY_LEVEL;

        Some(IndicatorSnapshot {
            close_time: latest.close_time,
            close_price: latest.close,
            details: json!({
                "signalDirection": signal_from_matches(long_match, short_match),
                "longerTimeframeEma": ema_longer,
                "longerTimeframeClosePrice": longer_close,
                "macdHistogramLongerTimeframe": macd_histogram_longer,
                "macdHistogramOperatingTimeframe": macd_histogram_operating,
                "previousStochasticKOperatingTimeframe": previous_stochastic.k,
                "previousStochasticDOperatingTimeframe": previous_stochastic.d,
                "stochasticKOperatingTimeframe": stochastic.k,
                "stochasticDOperatingTimeframe": stochastic.d,
            }),
        })
    }

    fn evaluate_legacy_strategy2(
        &mut self,
        config: &LegacyMomentumConfirmationConfig,
    ) -> Option<IndicatorSnapshot> {
        let longer = self
            .candles_by_timeframe
            .get(&config.longer_timeframe_code)?;
        let operating = self.candles_by_timeframe.get(&self.spec.timeframe_code)?;
        if longer.len() < LEGACY_WINDOW_CANDLES || operating.len() < LEGACY_WINDOW_CANDLES {
            return None;
        }

        let longer_closes = candle_closes(longer);
        let operating_closes = candle_closes(operating);
        let operating_highs = candle_highs(operating);
        let operating_lows = candle_lows(operating);

        let ema_longer = ema_series(&longer_closes, config.longer_timeframe_ema_periods);
        let macd_operating = macd_series(
            &operating_closes,
            config.macd_fast_periods,
            config.macd_slow_periods,
            config.macd_signal_periods,
        );
        let stochastic_operating = stochastic_series(
            &operating_highs,
            &operating_lows,
            &operating_closes,
            config.stochastic_periods,
            config.stochastic_signal_periods,
        );
        let rsi_operating = rsi_series(&operating_closes, config.rsi_periods);

        let longer_close = *longer_closes.last()?;
        let ema_longer = ema_longer.last().and_then(|value| *value)?;
        let previous_macd = macd_operating
            .get(macd_operating.len().saturating_sub(2))
            .and_then(|value| value.as_ref())?;
        let macd = macd_operating.last().and_then(|value| value.as_ref())?;
        let stochastic = stochastic_operating
            .last()
            .and_then(|value| value.as_ref())?;
        let rsi = rsi_operating.last().and_then(|value| *value)?;
        let latest = operating.back()?;

        let long_setup = longer_close > ema_longer
            && (self.strategy2_state.stochastic_oversell_level_reached
                || (stochastic.k < STOCHASTIC_OVERSELL_LEVEL
                    && stochastic.d < STOCHASTIC_OVERSELL_LEVEL));
        let short_setup = longer_close < ema_longer
            && (self.strategy2_state.stochastic_overbuy_level_reached
                || (stochastic.k > STOCHASTIC_OVERBUY_LEVEL
                    && stochastic.d > STOCHASTIC_OVERBUY_LEVEL));

        let long_match = long_setup
            && rsi > 50.0
            && previous_macd.macd < previous_macd.signal
            && macd.macd >= macd.signal;
        let short_match = short_setup
            && rsi < 50.0
            && previous_macd.macd > previous_macd.signal
            && macd.macd <= macd.signal;

        if long_setup {
            self.strategy2_state.stochastic_oversell_level_reached = true;
            self.strategy2_state.stochastic_overbuy_level_reached = false;
        }
        if short_setup {
            self.strategy2_state.stochastic_overbuy_level_reached = true;
            self.strategy2_state.stochastic_oversell_level_reached = false;
        }

        Some(IndicatorSnapshot {
            close_time: latest.close_time,
            close_price: latest.close,
            details: json!({
                "signalDirection": signal_from_matches(long_match, short_match),
                "longerTimeframeEma": ema_longer,
                "longerTimeframeClosePrice": longer_close,
                "previousMacdOperatingTimeframe": previous_macd.macd,
                "previousMacdSignalOperatingTimeframe": previous_macd.signal,
                "macdOperatingTimeframe": macd.macd,
                "macdSignalOperatingTimeframe": macd.signal,
                "stochasticKOperatingTimeframe": stochastic.k,
                "stochasticDOperatingTimeframe": stochastic.d,
                "rsi": rsi,
                "stochasticOversellLevelReached": self.strategy2_state.stochastic_oversell_level_reached,
                "stochasticOverbuyLevelReached": self.strategy2_state.stochastic_overbuy_level_reached,
            }),
        })
    }
}

fn signal_from_matches(long_match: bool, short_match: bool) -> Option<&'static str> {
    match (long_match, short_match) {
        (true, false) => Some("long"),
        (false, true) => Some("short"),
        _ => None,
    }
}

fn timeframe_priority(signal_timeframe_code: &str, timeframe_code: &str) -> u8 {
    if timeframe_code == signal_timeframe_code {
        1
    } else {
        0
    }
}

fn candle_closes(candles: &VecDeque<Candle>) -> Vec<f64> {
    candles.iter().map(|candle| candle.close).collect()
}

fn candle_highs(candles: &VecDeque<Candle>) -> Vec<f64> {
    candles.iter().map(|candle| candle.high).collect()
}

fn candle_lows(candles: &VecDeque<Candle>) -> Vec<f64> {
    candles.iter().map(|candle| candle.low).collect()
}

fn ema_series(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut result = vec![None; values.len()];
    if period == 0 || values.len() < period {
        return result;
    }

    let mut ema = values.iter().take(period).sum::<f64>() / period as f64;
    result[period - 1] = Some(ema);
    let alpha = 2.0 / (period as f64 + 1.0);
    for (index, value) in values.iter().enumerate().skip(period) {
        ema = *value * alpha + ema * (1.0 - alpha);
        result[index] = Some(ema);
    }
    result
}

fn macd_series(
    values: &[f64],
    fast_period: usize,
    slow_period: usize,
    signal_period: usize,
) -> Vec<Option<MacdPoint>> {
    let fast_ema = ema_series(values, fast_period);
    let slow_ema = ema_series(values, slow_period);
    let mut macd_values = vec![None; values.len()];
    let mut condensed_macd = Vec::new();
    let mut condensed_indexes = Vec::new();

    for index in 0..values.len() {
        if let (Some(fast), Some(slow)) = (fast_ema[index], slow_ema[index]) {
            let macd = fast - slow;
            macd_values[index] = Some(macd);
            condensed_macd.push(macd);
            condensed_indexes.push(index);
        }
    }

    let signal_values = ema_series(&condensed_macd, signal_period);
    let mut result = vec![None; values.len()];
    for (position, index) in condensed_indexes.into_iter().enumerate() {
        let Some(signal) = signal_values[position] else {
            continue;
        };
        let Some(macd) = macd_values[index] else {
            continue;
        };
        result[index] = Some(MacdPoint {
            macd,
            signal,
            histogram: macd - signal,
        });
    }

    result
}

fn rsi_series(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut result = vec![None; values.len()];
    if period == 0 || values.len() <= period {
        return result;
    }

    let mut gains = 0.0;
    let mut losses = 0.0;
    for index in 1..=period {
        let change = values[index] - values[index - 1];
        if change >= 0.0 {
            gains += change;
        } else {
            losses += -change;
        }
    }

    let mut average_gain = gains / period as f64;
    let mut average_loss = losses / period as f64;
    result[period] = Some(rsi_from_average(average_gain, average_loss));

    for index in (period + 1)..values.len() {
        let change = values[index] - values[index - 1];
        let gain = change.max(0.0);
        let loss = (-change).max(0.0);
        average_gain = ((average_gain * (period as f64 - 1.0)) + gain) / period as f64;
        average_loss = ((average_loss * (period as f64 - 1.0)) + loss) / period as f64;
        result[index] = Some(rsi_from_average(average_gain, average_loss));
    }

    result
}

fn rsi_from_average(average_gain: f64, average_loss: f64) -> f64 {
    if average_loss == 0.0 {
        return 100.0;
    }
    let rs = average_gain / average_loss;
    100.0 - (100.0 / (1.0 + rs))
}

fn stochastic_series(
    highs: &[f64],
    lows: &[f64],
    closes: &[f64],
    period: usize,
    signal_period: usize,
) -> Vec<Option<StochasticPoint>> {
    let mut k_values = vec![None; closes.len()];
    if period == 0 || signal_period == 0 || highs.len() != lows.len() || lows.len() != closes.len()
    {
        return vec![None; closes.len()];
    }

    for index in 0..closes.len() {
        if index + 1 < period {
            continue;
        }
        let start = index + 1 - period;
        let highest = highs[start..=index]
            .iter()
            .fold(f64::MIN, |current, value| current.max(*value));
        let lowest = lows[start..=index]
            .iter()
            .fold(f64::MAX, |current, value| current.min(*value));
        let denominator = highest - lowest;
        let k = if denominator == 0.0 {
            0.0
        } else {
            ((closes[index] - lowest) / denominator) * 100.0
        };
        k_values[index] = Some(k);
    }

    let mut result = vec![None; closes.len()];
    for index in 0..closes.len() {
        if index + 1 < signal_period {
            continue;
        }
        let start = index + 1 - signal_period;
        let mut window = Vec::new();
        for value in k_values[start..=index].iter().flatten() {
            window.push(*value);
        }
        if window.len() != signal_period {
            continue;
        }
        let Some(k) = k_values[index] else {
            continue;
        };
        let d = window.iter().sum::<f64>() / signal_period as f64;
        result[index] = Some(StochasticPoint { k, d });
    }

    result
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{AnalysisEvaluator, LEGACY_WINDOW_CANDLES, build_analysis_spec};
    use crate::models::{
        MarketDataKlineEvent, PairRecord, PersistedKlineRecord, ResolvedAnalysisSettingsRecord,
        RiskProfileRecord, StrategyRecord, TimeframeRecord,
    };

    fn record_with_kind(kind: &str, settings: serde_json::Value) -> ResolvedAnalysisSettingsRecord {
        ResolvedAnalysisSettingsRecord {
            id: "analysis-1".to_string(),
            symbol: "BTCUSDT".to_string(),
            timeframe_code: "1m".to_string(),
            strategy_name: kind.to_string(),
            risk_profile_name: "default-risk".to_string(),
            technical_analysis_settings: settings,
            enabled: true,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            symbol_entity: PairRecord {
                id: "pair-1".to_string(),
                code: "BTCUSDT".to_string(),
                active: true,
                base_asset: "BTC".to_string(),
                destination_asset: "USDT".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            timeframe: TimeframeRecord {
                id: "timeframe-1".to_string(),
                code: "1m".to_string(),
                longer_timeframe_code: "5m".to_string(),
                longer_timeframe_multiplier: 5,
                period_ms: 60_000,
                active: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            strategy: StrategyRecord {
                id: "strategy-1".to_string(),
                name: kind.to_string(),
                description: kind.to_string(),
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
        }
    }

    fn persisted_row(timeframe_code: &str, open_time: i64, close: f64) -> PersistedKlineRecord {
        PersistedKlineRecord {
            pair_code: "BTCUSDT".to_string(),
            symbol: "BTCUSDT".to_string(),
            timeframe_code: timeframe_code.to_string(),
            period_ms: if timeframe_code == "5m" {
                300_000
            } else {
                60_000
            },
            open_time,
            close_time: open_time
                + if timeframe_code == "5m" {
                    300_000
                } else {
                    60_000
                },
            event_time: open_time,
            occurred_at: "2026-01-01T00:00:00Z".to_string(),
            ingestion_mode: "historical".to_string(),
            closed: true,
            open: close.to_string(),
            high: close.to_string(),
            low: close.to_string(),
            close: close.to_string(),
            volume: "1".to_string(),
            quote_volume: "1".to_string(),
            trade_count: 1,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn live_closed_event(timeframe_code: &str, open_time: i64, close: f64) -> MarketDataKlineEvent {
        MarketDataKlineEvent {
            event_id: format!("event-{timeframe_code}-{open_time}"),
            event_type: "trading-bot.market-data.kline.v1".to_string(),
            source: "test".to_string(),
            occurred_at: "2026-01-01T00:00:00Z".to_string(),
            exchange: "binance".to_string(),
            ingestion_mode: "live".to_string(),
            stream_name: format!("btcusdt@kline_{timeframe_code}"),
            pair_code: "BTCUSDT".to_string(),
            symbol: "BTCUSDT".to_string(),
            timeframe_code: timeframe_code.to_string(),
            period_ms: if timeframe_code == "5m" {
                300_000
            } else {
                60_000
            },
            open_time,
            close_time: open_time
                + if timeframe_code == "5m" {
                    300_000
                } else {
                    60_000
                },
            event_time: open_time,
            closed: true,
            open: close.to_string(),
            high: close.to_string(),
            low: close.to_string(),
            close: close.to_string(),
            volume: "1".to_string(),
            quote_volume: "1".to_string(),
            trade_count: 1,
            analysis_setting_ids: vec!["analysis-1".to_string()],
            strategy_names: vec![timeframe_code.to_string()],
        }
    }

    #[test]
    fn build_analysis_spec_ignores_unsupported_kind() {
        let record = record_with_kind("unsupported", json!({}));
        let spec = build_analysis_spec(&record).expect("spec build should succeed");
        assert!(spec.is_none());
    }

    #[test]
    fn build_analysis_spec_supports_legacy_strategy_requirements() {
        let record = record_with_kind(
            "strategy1",
            json!({
                "longerTimeframeEmaPeriods": 200,
                "macdFastPeriods": 12,
                "macdSlowPeriods": 26,
                "macdSignalPeriods": 9,
                "stochasticPeriods": 14,
                "stochasticSignalPeriods": 3
            }),
        );
        let spec = build_analysis_spec(&record)
            .expect("spec build should succeed")
            .expect("strategy1 should be supported");
        let requirements = spec.required_kline_requirements();
        assert_eq!(requirements.len(), 2);
        assert_eq!(requirements[0].timeframe_code, "5m");
        assert_eq!(requirements[1].timeframe_code, "1m");
    }

    #[test]
    fn ema_cross_emits_long_signal_after_cross() {
        let record = record_with_kind("emaCross", json!({"fastPeriod": 2, "slowPeriod": 3}));
        let spec = build_analysis_spec(&record)
            .expect("spec build should succeed")
            .expect("emaCross should be supported");
        let mut evaluator = AnalysisEvaluator::new(spec);
        evaluator.warm_from_klines(&[
            persisted_row("1m", 0, 5.0),
            persisted_row("1m", 60_000, 4.0),
            persisted_row("1m", 120_000, 3.0),
            persisted_row("1m", 180_000, 2.0),
        ]);

        let signal = evaluator.process_live_kline(&live_closed_event("1m", 240_000, 10.0));
        assert_eq!(
            signal.expect("signal should exist").signal_direction,
            "long"
        );
    }

    #[test]
    fn strategy1_requires_longer_and_operating_windows() {
        let record = record_with_kind(
            "strategy1",
            json!({
                "longerTimeframeEmaPeriods": 200,
                "macdFastPeriods": 12,
                "macdSlowPeriods": 26,
                "macdSignalPeriods": 9,
                "stochasticPeriods": 14,
                "stochasticSignalPeriods": 3
            }),
        );
        let spec = build_analysis_spec(&record)
            .expect("spec build should succeed")
            .expect("strategy1 should be supported");
        let mut evaluator = AnalysisEvaluator::new(spec);
        for index in 0..LEGACY_WINDOW_CANDLES {
            let open_time_5m = (index as i64) * 300_000;
            let open_time_1m = (index as i64) * 60_000;
            evaluator.warm_from_klines(&[
                persisted_row("5m", open_time_5m, 100.0 + index as f64),
                persisted_row("1m", open_time_1m, 100.0 + index as f64),
            ]);
        }

        let signal = evaluator.process_live_kline(&live_closed_event(
            "1m",
            (LEGACY_WINDOW_CANDLES as i64) * 60_000,
            1100.0,
        ));
        assert!(signal.is_some() || signal.is_none());
    }
}
