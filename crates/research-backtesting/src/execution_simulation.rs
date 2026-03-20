use anyhow::{Context, Result};
use chrono::DateTime;
use trading_bot_market_data::models::{PersistedBookTickerRecord, PersistedTradeRecord};
use trading_bot_strategy_engine::models::{PersistedKlineRecord, ResolvedAnalysisSettingsRecord};

use crate::models::{BacktestSignalRecord, PositionDirection, SimulatedTradeRecord};

#[derive(Clone, Debug)]
pub struct TradeReplayStats {
    pub fetched_trade_count: usize,
    pub first_trade_time: Option<i64>,
    pub last_trade_time: Option<i64>,
}

#[derive(Clone, Copy, Debug)]
pub struct SimulationConfig {
    pub fee_bps: f64,
    pub slippage_bps: f64,
}

#[derive(Clone, Debug)]
struct Fill {
    time: i64,
    effective_price: f64,
    source: &'static str,
}

#[derive(Clone, Debug)]
struct OpenPosition {
    direction: PositionDirection,
    entry_signal_sequence: usize,
    entry_time: i64,
    entry_price: f64,
    quantity: f64,
    notional_usd: f64,
    stop_loss_price: f64,
    take_profit_price: f64,
    entry_fee_usd: f64,
    entry_fill_source: &'static str,
}

#[derive(Clone, Debug)]
struct TradeThresholds {
    stop_loss_price: f64,
    take_profit_price: f64,
}

#[derive(Clone, Debug)]
struct BookTickerPoint {
    occurred_at_ms: i64,
    bid_price: f64,
    ask_price: f64,
}

#[derive(Clone, Debug)]
enum PositionResolution {
    Closed(SimulatedTradeRecord),
    StillOpen(OpenPosition, Option<Fill>),
}

pub fn simulate_trade_replay(
    signals: &[BacktestSignalRecord],
    replay_trades: &[PersistedTradeRecord],
    replay_book_tickers: &[PersistedBookTickerRecord],
    analysis: &ResolvedAnalysisSettingsRecord,
    last_kline: Option<&PersistedKlineRecord>,
    config: SimulationConfig,
) -> Result<Vec<SimulatedTradeRecord>> {
    let replay_book_tickers = replay_book_tickers
        .iter()
        .map(parse_book_ticker)
        .collect::<Result<Vec<_>>>()?;
    let mut trades = Vec::new();
    let mut open_position: Option<OpenPosition> = None;
    let mut trade_cursor = 0usize;
    let mut book_ticker_cursor = 0usize;

    for signal in signals {
        if let Some(position) = open_position.take() {
            match resolve_until_time(
                &position,
                replay_trades,
                &replay_book_tickers,
                &mut trade_cursor,
                &mut book_ticker_cursor,
                signal.close_time,
                config,
            )? {
                PositionResolution::Closed(trade) => {
                    trades.push(trade);
                }
                PositionResolution::StillOpen(position, _) => {
                    open_position = Some(position);
                }
            }
        }

        let next_direction = signal_direction(signal);
        match &open_position {
            None => {
                open_position = open_position_from_signal(
                    signal,
                    next_direction,
                    replay_trades,
                    &replay_book_tickers,
                    &mut trade_cursor,
                    &mut book_ticker_cursor,
                    analysis,
                    config,
                )?;
            }
            Some(position) if position.direction == next_direction => {}
            Some(position) => {
                let exit_fill = fill_at_or_after(
                    replay_trades,
                    &replay_book_tickers,
                    &mut trade_cursor,
                    &mut book_ticker_cursor,
                    signal.close_time,
                    signal.close_price,
                    next_direction,
                    false,
                    config.slippage_bps,
                );
                let closed_trade = close_position(
                    trades.len() + 1,
                    position,
                    signal.close_time,
                    Some(signal.sequence),
                    exit_fill,
                    "reversal",
                    config.fee_bps,
                );
                trades.push(closed_trade);
                open_position = open_position_from_signal(
                    signal,
                    next_direction,
                    replay_trades,
                    &replay_book_tickers,
                    &mut trade_cursor,
                    &mut book_ticker_cursor,
                    analysis,
                    config,
                )?;
            }
        }
    }

    if let Some(position) = open_position.take() {
        match resolve_until_time(
            &position,
            replay_trades,
            &replay_book_tickers,
            &mut trade_cursor,
            &mut book_ticker_cursor,
            i64::MAX,
            config,
        )? {
            PositionResolution::Closed(trade) => {
                trades.push(trade);
            }
            PositionResolution::StillOpen(position, last_fill_before_end) => {
                // Open positions are intentionally left unclosed at the end of the window.
                // That means they don't contribute to `trades`/PnL aggregation.
            }
        }
    }

    Ok(trades)
}

struct TradePager<F>
where
    F: FnMut(
            Option<(i64, i64)>,
            i64,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Vec<PersistedTradeRecord>>> + Send>,
        > + Send,
{
    fetch: F,
    max_total: usize,
    stats: TradeReplayStats,
    cursor_key: Option<(i64, i64)>,
    done: bool,
    buf: Vec<PersistedTradeRecord>,
}

impl<F> TradePager<F>
where
    F: FnMut(
            Option<(i64, i64)>,
            i64,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Vec<PersistedTradeRecord>>> + Send>,
        > + Send,
{
    fn new(fetch: F, max_total: usize) -> Self {
        Self {
            fetch,
            max_total,
            stats: TradeReplayStats {
                fetched_trade_count: 0,
                first_trade_time: None,
                last_trade_time: None,
            },
            cursor_key: None,
            done: false,
            buf: Vec::new(),
        }
    }

    async fn ensure_until(&mut self, target_time: i64) -> Result<()> {
        if self.done {
            return Ok(());
        }

        loop {
            let last_time = self.buf.last().map(|t| t.trade_time);
            if last_time.is_some_and(|t| t >= target_time) {
                return Ok(());
            }
            if self.stats.fetched_trade_count >= self.max_total {
                self.done = true;
                return Ok(());
            }

            let remaining = (self.max_total - self.stats.fetched_trade_count) as i64;
            let page = (self.fetch)(self.cursor_key, remaining).await?;
            if page.is_empty() {
                self.done = true;
                return Ok(());
            }

            if self.stats.first_trade_time.is_none() {
                self.stats.first_trade_time = page.first().map(|t| t.trade_time);
            }
            self.stats.last_trade_time = page.last().map(|t| t.trade_time);
            self.stats.fetched_trade_count += page.len();
            self.cursor_key = page.last().map(|t| (t.trade_time, t.aggregate_trade_id));

            self.buf.extend(page);
        }
    }

    fn maybe_drain_consumed(&mut self, trade_cursor: &mut usize) {
        // Keep memory bounded by dropping the consumed prefix.
        const DRAIN_THRESHOLD: usize = 200_000;
        if *trade_cursor > DRAIN_THRESHOLD {
            self.buf.drain(0..*trade_cursor);
            *trade_cursor = 0;
        }
    }
}

pub async fn simulate_trade_replay_paged<F>(
    signals: &[BacktestSignalRecord],
    replay_book_tickers: &[PersistedBookTickerRecord],
    analysis: &ResolvedAnalysisSettingsRecord,
    config: SimulationConfig,
    requested_end_time: i64,
    max_total_trades: usize,
    fetch_page: F,
) -> Result<(Vec<SimulatedTradeRecord>, TradeReplayStats)>
where
    F: FnMut(
            Option<(i64, i64)>,
            i64,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Vec<PersistedTradeRecord>>> + Send>,
        > + Send,
{
    let replay_book_tickers = replay_book_tickers
        .iter()
        .map(parse_book_ticker)
        .collect::<Result<Vec<_>>>()?;

    let mut trades = Vec::new();
    let mut open_position: Option<OpenPosition> = None;
    let mut trade_cursor = 0usize;
    let mut book_ticker_cursor = 0usize;

    let mut pager = TradePager::new(fetch_page, max_total_trades);

    for signal in signals {
        pager.ensure_until(signal.close_time).await?;

        if let Some(position) = open_position.take() {
            match resolve_until_time(
                &position,
                &pager.buf,
                &replay_book_tickers,
                &mut trade_cursor,
                &mut book_ticker_cursor,
                signal.close_time,
                config,
            )? {
                PositionResolution::Closed(trade) => trades.push(trade),
                PositionResolution::StillOpen(position, _) => open_position = Some(position),
            }
        }

        pager.maybe_drain_consumed(&mut trade_cursor);

        let next_direction = signal_direction(signal);
        match &open_position {
            None => {
                pager.ensure_until(signal.close_time).await?;
                open_position = open_position_from_signal(
                    signal,
                    next_direction,
                    &pager.buf,
                    &replay_book_tickers,
                    &mut trade_cursor,
                    &mut book_ticker_cursor,
                    analysis,
                    config,
                )?;
            }
            Some(position) if position.direction == next_direction => {}
            Some(position) => {
                pager.ensure_until(signal.close_time).await?;
                let exit_fill = fill_at_or_after(
                    &pager.buf,
                    &replay_book_tickers,
                    &mut trade_cursor,
                    &mut book_ticker_cursor,
                    signal.close_time,
                    signal.close_price,
                    next_direction,
                    false,
                    config.slippage_bps,
                );
                trades.push(close_position(
                    trades.len() + 1,
                    position,
                    signal.close_time,
                    Some(signal.sequence),
                    exit_fill,
                    "reversal",
                    config.fee_bps,
                ));
                open_position = open_position_from_signal(
                    signal,
                    next_direction,
                    &pager.buf,
                    &replay_book_tickers,
                    &mut trade_cursor,
                    &mut book_ticker_cursor,
                    analysis,
                    config,
                )?;
            }
        }
    }

    // Resolve remaining position up to end of window; leave any still-open
    // position open (do not force-close at window end).
    let end_time = requested_end_time.saturating_sub(1);
    pager.ensure_until(end_time).await?;
    if let Some(position) = open_position.take() {
        match resolve_until_time(
            &position,
            &pager.buf,
            &replay_book_tickers,
            &mut trade_cursor,
            &mut book_ticker_cursor,
            end_time.saturating_add(1),
            config,
        )? {
            PositionResolution::Closed(trade) => trades.push(trade),
            PositionResolution::StillOpen(_, _) => {}
        }
    }

    Ok((trades, pager.stats))
}

fn resolve_until_time(
    position: &OpenPosition,
    replay_trades: &[PersistedTradeRecord],
    replay_book_tickers: &[BookTickerPoint],
    trade_cursor: &mut usize,
    book_ticker_cursor: &mut usize,
    end_time_exclusive: i64,
    config: SimulationConfig,
) -> Result<PositionResolution> {
    let mut last_fill_before_end = None;

    loop {
        let next_trade_time = replay_trades
            .get(*trade_cursor)
            .map(|record| record.trade_time);
        let next_book_ticker_time = replay_book_tickers
            .get(*book_ticker_cursor)
            .map(|record| record.occurred_at_ms);
        let next_event_time = earliest_time(next_trade_time, next_book_ticker_time);

        let Some(next_event_time) = next_event_time else {
            break;
        };
        if next_event_time >= end_time_exclusive {
            break;
        }

        let use_book_ticker = match (next_trade_time, next_book_ticker_time) {
            (Some(trade_time), Some(book_time)) => book_time <= trade_time,
            (None, Some(_)) => true,
            _ => false,
        };

        if use_book_ticker {
            let record = &replay_book_tickers[*book_ticker_cursor];
            *book_ticker_cursor += 1;
            let fill =
                fill_from_book_ticker(record, position.direction, false, config.slippage_bps);
            let hit_stop = match position.direction {
                PositionDirection::Long => record.bid_price <= position.stop_loss_price,
                PositionDirection::Short => record.ask_price >= position.stop_loss_price,
            };
            let hit_take_profit = match position.direction {
                PositionDirection::Long => record.bid_price >= position.take_profit_price,
                PositionDirection::Short => record.ask_price <= position.take_profit_price,
            };
            last_fill_before_end = Some(fill.clone());

            if hit_stop {
                return Ok(PositionResolution::Closed(close_position(
                    0,
                    position,
                    fill.time,
                    None,
                    Some(fill),
                    "stopLoss",
                    config.fee_bps,
                )));
            }

            if hit_take_profit {
                return Ok(PositionResolution::Closed(close_position(
                    0,
                    position,
                    fill.time,
                    None,
                    Some(fill),
                    "takeProfit",
                    config.fee_bps,
                )));
            }

            continue;
        }

        let record = &replay_trades[*trade_cursor];
        let raw_price = record.price.parse::<f64>()?;
        let hit_stop = match position.direction {
            PositionDirection::Long => raw_price <= position.stop_loss_price,
            PositionDirection::Short => raw_price >= position.stop_loss_price,
        };
        let hit_take_profit = match position.direction {
            PositionDirection::Long => raw_price >= position.take_profit_price,
            PositionDirection::Short => raw_price <= position.take_profit_price,
        };
        let fill = Fill {
            time: record.trade_time,
            effective_price: apply_slippage(
                raw_price,
                position.direction,
                false,
                config.slippage_bps,
            ),
            source: "aggTrade",
        };

        *trade_cursor += 1;
        last_fill_before_end = Some(fill.clone());

        if hit_stop {
            return Ok(PositionResolution::Closed(close_position(
                0,
                position,
                fill.time,
                None,
                Some(fill),
                "stopLoss",
                config.fee_bps,
            )));
        }

        if hit_take_profit {
            return Ok(PositionResolution::Closed(close_position(
                0,
                position,
                fill.time,
                None,
                Some(fill),
                "takeProfit",
                config.fee_bps,
            )));
        }
    }

    Ok(PositionResolution::StillOpen(
        position.clone(),
        last_fill_before_end,
    ))
}

fn open_position_from_signal(
    signal: &BacktestSignalRecord,
    direction: PositionDirection,
    replay_trades: &[PersistedTradeRecord],
    replay_book_tickers: &[BookTickerPoint],
    trade_cursor: &mut usize,
    book_ticker_cursor: &mut usize,
    analysis: &ResolvedAnalysisSettingsRecord,
    config: SimulationConfig,
) -> Result<Option<OpenPosition>> {
    let fill = fill_at_or_after(
        replay_trades,
        replay_book_tickers,
        trade_cursor,
        book_ticker_cursor,
        signal.close_time,
        signal.close_price,
        direction,
        true,
        config.slippage_bps,
    );
    let Some(fill) = fill else {
        return Ok(None);
    };

    let notional_usd = analysis.trading_defaults.default_position_notional_usd;
    let quantity = if fill.effective_price > 0.0 {
        notional_usd / fill.effective_price
    } else {
        0.0
    };
    let entry_fee_usd = quantity * fill.effective_price * (config.fee_bps / 10_000.0);
    let thresholds = trade_thresholds(fill.effective_price, direction, analysis);

    Ok(Some(OpenPosition {
        direction,
        entry_signal_sequence: signal.sequence,
        entry_time: fill.time,
        entry_price: fill.effective_price,
        quantity,
        notional_usd,
        stop_loss_price: thresholds.stop_loss_price,
        take_profit_price: thresholds.take_profit_price,
        entry_fee_usd,
        entry_fill_source: fill.source,
    }))
}

fn trade_thresholds(
    entry_price: f64,
    direction: PositionDirection,
    analysis: &ResolvedAnalysisSettingsRecord,
) -> TradeThresholds {
    let risk = &analysis.risk_profile;
    let stop_loss_percent = risk
        .swing_gap
        .max(risk.minimum_stop_loss)
        .min(risk.maximum_stop_loss)
        / 100.0;
    let take_profit_percent = stop_loss_percent * risk.rrr.max(0.0);

    match direction {
        PositionDirection::Long => TradeThresholds {
            stop_loss_price: entry_price * (1.0 - stop_loss_percent),
            take_profit_price: entry_price * (1.0 + take_profit_percent),
        },
        PositionDirection::Short => TradeThresholds {
            stop_loss_price: entry_price * (1.0 + stop_loss_percent),
            take_profit_price: entry_price * (1.0 - take_profit_percent),
        },
    }
}

fn close_position(
    trade_number: usize,
    position: &OpenPosition,
    fallback_exit_time: i64,
    exit_signal_sequence: Option<usize>,
    fill: Option<Fill>,
    exit_reason: &str,
    fee_bps: f64,
) -> SimulatedTradeRecord {
    let fill = fill.unwrap_or_else(|| {
        fallback_fill(
            fallback_exit_time,
            position.entry_price,
            position.direction,
            false,
            0.0,
            "positionFallback",
        )
    });
    let exit_fee_usd = position.quantity * fill.effective_price * (fee_bps / 10_000.0);
    let gross_pnl_usd = match position.direction {
        PositionDirection::Long => {
            position.quantity * (fill.effective_price - position.entry_price)
        }
        PositionDirection::Short => {
            position.quantity * (position.entry_price - fill.effective_price)
        }
    };
    let fees_usd = position.entry_fee_usd + exit_fee_usd;
    let pnl_usd = gross_pnl_usd - fees_usd;
    let pnl_percent = if position.notional_usd > 0.0 {
        (pnl_usd / position.notional_usd) * 100.0
    } else {
        0.0
    };

    SimulatedTradeRecord {
        trade_number,
        direction: position.direction,
        entry_signal_sequence: position.entry_signal_sequence,
        exit_signal_sequence,
        entry_time: position.entry_time,
        exit_time: fill.time,
        entry_price: position.entry_price,
        exit_price: fill.effective_price,
        quantity: position.quantity,
        notional_usd: position.notional_usd,
        stop_loss_price: position.stop_loss_price,
        take_profit_price: position.take_profit_price,
        fees_usd,
        pnl_usd,
        pnl_percent,
        entry_fill_source: position.entry_fill_source.to_string(),
        exit_fill_source: fill.source.to_string(),
        exit_reason: exit_reason.to_string(),
    }
}

fn fill_at_or_after(
    replay_trades: &[PersistedTradeRecord],
    replay_book_tickers: &[BookTickerPoint],
    trade_cursor: &mut usize,
    book_ticker_cursor: &mut usize,
    signal_time: i64,
    fallback_price: f64,
    direction: PositionDirection,
    is_entry: bool,
    slippage_bps: f64,
) -> Option<Fill> {
    advance_trade_cursor_to_time(replay_trades, trade_cursor, signal_time);
    advance_book_ticker_cursor_to_time(replay_book_tickers, book_ticker_cursor, signal_time);

    let next_trade_time = replay_trades
        .get(*trade_cursor)
        .map(|record| record.trade_time);
    let next_book_ticker_time = replay_book_tickers
        .get(*book_ticker_cursor)
        .map(|record| record.occurred_at_ms);

    match (next_trade_time, next_book_ticker_time) {
        (Some(trade_time), Some(book_time)) if book_time <= trade_time => {
            let record = replay_book_tickers.get(*book_ticker_cursor)?;
            let fill = fill_from_book_ticker(record, direction, is_entry, slippage_bps);
            *book_ticker_cursor += 1;
            advance_trade_cursor_to_time(replay_trades, trade_cursor, fill.time);
            Some(fill)
        }
        (Some(_), Some(book_time)) => {
            let record = replay_trades.get(*trade_cursor)?;
            let raw_price = record.price.parse::<f64>().ok()?;
            let fill = Fill {
                time: record.trade_time,
                effective_price: apply_slippage(raw_price, direction, is_entry, slippage_bps),
                source: "aggTrade",
            };
            *trade_cursor += 1;
            advance_book_ticker_cursor_to_time(
                replay_book_tickers,
                book_ticker_cursor,
                book_time.min(fill.time),
            );
            Some(fill)
        }
        (Some(_), None) => {
            let record = replay_trades.get(*trade_cursor)?;
            let raw_price = record.price.parse::<f64>().ok()?;
            let fill = Fill {
                time: record.trade_time,
                effective_price: apply_slippage(raw_price, direction, is_entry, slippage_bps),
                source: "aggTrade",
            };
            *trade_cursor += 1;
            Some(fill)
        }
        (None, Some(_)) => {
            let record = replay_book_tickers.get(*book_ticker_cursor)?;
            let fill = fill_from_book_ticker(record, direction, is_entry, slippage_bps);
            *book_ticker_cursor += 1;
            Some(fill)
        }
        (None, None) => (fallback_price > 0.0).then(|| {
            fallback_fill(
                signal_time,
                fallback_price,
                direction,
                is_entry,
                slippage_bps,
                "klineFallback",
            )
        }),
    }
}

fn advance_trade_cursor_to_time(
    replay_trades: &[PersistedTradeRecord],
    trade_cursor: &mut usize,
    signal_time: i64,
) {
    while *trade_cursor < replay_trades.len() {
        let record = &replay_trades[*trade_cursor];
        if record.trade_time >= signal_time {
            break;
        }
        *trade_cursor += 1;
    }
}

fn advance_book_ticker_cursor_to_time(
    replay_book_tickers: &[BookTickerPoint],
    book_ticker_cursor: &mut usize,
    signal_time: i64,
) {
    while *book_ticker_cursor < replay_book_tickers.len() {
        let record = &replay_book_tickers[*book_ticker_cursor];
        if record.occurred_at_ms >= signal_time {
            break;
        }
        *book_ticker_cursor += 1;
    }
}

fn earliest_time(first: Option<i64>, second: Option<i64>) -> Option<i64> {
    match (first, second) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn fill_from_book_ticker(
    record: &BookTickerPoint,
    direction: PositionDirection,
    is_entry: bool,
    slippage_bps: f64,
) -> Fill {
    let raw_price = match (direction, is_entry) {
        (PositionDirection::Long, true) => record.ask_price,
        (PositionDirection::Long, false) => record.bid_price,
        (PositionDirection::Short, true) => record.bid_price,
        (PositionDirection::Short, false) => record.ask_price,
    };

    Fill {
        time: record.occurred_at_ms,
        effective_price: apply_slippage(raw_price, direction, is_entry, slippage_bps),
        source: "bookTicker",
    }
}

fn parse_book_ticker(record: &PersistedBookTickerRecord) -> Result<BookTickerPoint> {
    Ok(BookTickerPoint {
        occurred_at_ms: DateTime::parse_from_rfc3339(&record.occurred_at)
            .with_context(|| {
                format!(
                    "invalid book ticker occurredAt timestamp: {}",
                    record.occurred_at
                )
            })?
            .timestamp_millis(),
        bid_price: record
            .bid_price
            .parse::<f64>()
            .with_context(|| format!("invalid book ticker bidPrice: {}", record.bid_price))?,
        ask_price: record
            .ask_price
            .parse::<f64>()
            .with_context(|| format!("invalid book ticker askPrice: {}", record.ask_price))?,
    })
}

fn fallback_fill(
    time: i64,
    raw_price: f64,
    direction: PositionDirection,
    is_entry: bool,
    slippage_bps: f64,
    source: &'static str,
) -> Fill {
    Fill {
        time,
        effective_price: apply_slippage(raw_price, direction, is_entry, slippage_bps),
        source,
    }
}

fn apply_slippage(
    raw_price: f64,
    direction: PositionDirection,
    is_entry: bool,
    slippage_bps: f64,
) -> f64 {
    if raw_price <= 0.0 || slippage_bps <= 0.0 {
        return raw_price;
    }

    let slippage_ratio = slippage_bps / 10_000.0;
    match (direction, is_entry) {
        (PositionDirection::Long, true) => raw_price * (1.0 + slippage_ratio),
        (PositionDirection::Long, false) => raw_price * (1.0 - slippage_ratio),
        (PositionDirection::Short, true) => raw_price * (1.0 - slippage_ratio),
        (PositionDirection::Short, false) => raw_price * (1.0 + slippage_ratio),
    }
}

fn signal_direction(signal: &BacktestSignalRecord) -> PositionDirection {
    if signal.signal_direction == "long" {
        PositionDirection::Long
    } else {
        PositionDirection::Short
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use trading_bot_strategy_engine::models::{
        PairRecord, RiskProfileRecord, StrategyRecord, TimeframeRecord, TradingDefaultsRecord,
    };

    use super::*;
    use crate::models::BacktestSignalRecord;

    fn analysis_record() -> ResolvedAnalysisSettingsRecord {
        ResolvedAnalysisSettingsRecord {
            id: "analysis-1".to_string(),
            symbol: "BTCUSDT".to_string(),
            timeframe_code: "1m".to_string(),
            strategy_name: "emaCross".to_string(),
            risk_profile_name: "default".to_string(),
            trading_defaults_name: "default".to_string(),
            technical_analysis_settings: json!({
                "fastPeriod": 2,
                "slowPeriod": 3
            }),
            enabled: true,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            pair: PairRecord {
                id: "pair-1".to_string(),
                code: "BTCUSDT".to_string(),
                operable: true,
                origin_asset_needed_funds: Some(1000.0),
                destination_asset_needed_funds: Some(1000.0),
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
                name: "emaCross".to_string(),
                description: "ema cross".to_string(),
                activated: true,
                parameters: json!({
                    "kind": "emaCross",
                    "fastPeriod": 2,
                    "slowPeriod": 3
                }),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            risk_profile: RiskProfileRecord {
                id: "risk-1".to_string(),
                name: "default".to_string(),
                description: "default".to_string(),
                maximum_stop_loss: 3.0,
                minimum_stop_loss: 1.0,
                swing_gap: 1.0,
                rrr: 2.0,
                enabled: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
            trading_defaults: TradingDefaultsRecord {
                id: "td-1".to_string(),
                name: "default".to_string(),
                description: "default".to_string(),
                default_position_notional_usd: 100.0,
                enabled: true,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            },
        }
    }

    fn signal(
        sequence: usize,
        direction: &str,
        close_time: i64,
        close_price: f64,
    ) -> BacktestSignalRecord {
        BacktestSignalRecord {
            sequence,
            signal_direction: direction.to_string(),
            close_time,
            close_price,
            fast_ema: 1.0,
            slow_ema: 0.5,
            kline_event_id: format!("signal-{sequence}"),
        }
    }

    fn trade(id: i64, trade_time: i64, price: f64) -> PersistedTradeRecord {
        PersistedTradeRecord {
            symbol: "BTCUSDT".to_string(),
            aggregate_trade_id: id,
            price: price.to_string(),
            trade_time,
        }
    }

    fn book_ticker(
        occurred_at_ms: i64,
        bid_price: f64,
        ask_price: f64,
    ) -> PersistedBookTickerRecord {
        PersistedBookTickerRecord {
            symbol: "BTCUSDT".to_string(),
            order_book_update_id: occurred_at_ms,
            bid_price: bid_price.to_string(),
            bid_quantity: "1.0".to_string(),
            ask_price: ask_price.to_string(),
            ask_quantity: "1.0".to_string(),
            occurred_at: chrono::DateTime::from_timestamp_millis(occurred_at_ms)
                .expect("valid timestamp")
                .to_rfc3339(),
            updated_at: chrono::DateTime::from_timestamp_millis(occurred_at_ms)
                .expect("valid timestamp")
                .to_rfc3339(),
        }
    }

    #[test]
    fn simulate_trade_replay_uses_trade_tape_for_take_profit_and_reversal() {
        let analysis = analysis_record();
        let signals = vec![
            signal(1, "long", 1000, 100.0),
            signal(2, "short", 5000, 102.0),
        ];
        let replay_trades = vec![
            trade(1, 1001, 100.0),
            trade(2, 2000, 100.5),
            trade(3, 2500, 102.5),
            trade(4, 5001, 101.5),
            trade(5, 6000, 100.0),
        ];

        let result = simulate_trade_replay(
            &signals,
            &replay_trades,
            &[],
            &analysis,
            None,
            SimulationConfig {
                fee_bps: 0.0,
                slippage_bps: 0.0,
            },
        )
        .expect("simulation should succeed");

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].exit_reason, "takeProfit");
        assert_eq!(result[0].exit_fill_source, "aggTrade");
    }

    #[test]
    fn simulate_trade_replay_prefers_book_ticker_quotes_when_available() {
        let analysis = analysis_record();
        let signals = vec![
            signal(1, "long", 1000, 100.0),
            signal(2, "short", 5000, 102.0),
        ];
        let replay_trades = vec![
            trade(1, 1100, 100.0),
            trade(2, 2500, 101.0),
            trade(3, 5005, 101.9),
            trade(4, 6000, 100.0),
        ];
        let replay_book_tickers = vec![
            book_ticker(1005, 99.9, 100.1),
            book_ticker(2500, 102.2, 102.3),
            book_ticker(5001, 101.8, 101.9),
            book_ticker(6000, 99.7, 99.8),
        ];

        let result = simulate_trade_replay(
            &signals,
            &replay_trades,
            &replay_book_tickers,
            &analysis,
            None,
            SimulationConfig {
                fee_bps: 0.0,
                slippage_bps: 0.0,
            },
        )
        .expect("simulation should succeed");

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].entry_fill_source, "bookTicker");
        assert_eq!(result[0].exit_fill_source, "bookTicker");
        assert_eq!(result[0].entry_price, 100.1);
        assert_eq!(result[0].exit_reason, "takeProfit");
    }
}
