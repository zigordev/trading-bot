use std::collections::HashMap;

use anyhow::{Context, Result};
use chrono::{TimeZone, Utc};
use serde::Deserialize;
use serde_json::Value;

use crate::models::{
    KlineSubscription, NormalizedBookTickerEvent, NormalizedKlineEvent, NormalizedTradeEvent,
    PairStreamSubscription,
};

#[derive(Clone, Debug)]
pub enum NormalizedWsEvent {
    Kline(NormalizedKlineEvent),
    Trade(NormalizedTradeEvent),
    BookTicker(NormalizedBookTickerEvent),
}

#[derive(Debug, Deserialize)]
struct CombinedStreamEnvelope {
    stream: String,
    data: Value,
}

#[derive(Debug, Deserialize)]
struct BinanceKlineWrapper {
    #[serde(rename = "E")]
    event_time: i64,
    k: BinanceKlinePayload,
}

#[derive(Debug, Deserialize)]
struct BinanceKlinePayload {
    #[serde(rename = "t")]
    open_time: i64,
    #[serde(rename = "T")]
    close_time: i64,
    #[serde(rename = "o")]
    open: String,
    #[serde(rename = "h")]
    high: String,
    #[serde(rename = "l")]
    low: String,
    #[serde(rename = "c")]
    close: String,
    #[serde(rename = "v")]
    volume: String,
    #[serde(rename = "q")]
    quote_volume: String,
    #[serde(rename = "n")]
    trade_count: i64,
    #[serde(rename = "x")]
    closed: bool,
}

#[derive(Debug, Deserialize)]
struct BinanceAggTradePayload {
    #[serde(rename = "a")]
    aggregate_trade_id: i64,
    #[serde(rename = "p")]
    price: String,
    #[serde(rename = "q")]
    quantity: String,
    #[serde(rename = "T")]
    trade_time: i64,
    #[serde(rename = "m")]
    market_maker: bool,
}

#[derive(Debug, Deserialize)]
struct BinanceAggTradeRestRow {
    #[serde(rename = "a")]
    aggregate_trade_id: i64,
    #[serde(rename = "p")]
    price: String,
    #[serde(rename = "q")]
    quantity: String,
    #[serde(rename = "T")]
    trade_time: i64,
    #[serde(rename = "m")]
    market_maker: bool,
}

#[derive(Debug, Deserialize)]
struct BinanceBookTickerRestRow {
    symbol: String,
    #[serde(rename = "bidPrice")]
    bid_price: String,
    #[serde(rename = "bidQty")]
    bid_quantity: String,
    #[serde(rename = "askPrice")]
    ask_price: String,
    #[serde(rename = "askQty")]
    ask_quantity: String,
    #[serde(rename = "updateId")]
    #[serde(default)]
    update_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct BinanceBookTickerPayload {
    #[serde(rename = "u")]
    update_id: i64,
    #[serde(rename = "b")]
    bid_price: String,
    #[serde(rename = "B")]
    bid_quantity: String,
    #[serde(rename = "a")]
    ask_price: String,
    #[serde(rename = "A")]
    ask_quantity: String,
}

fn iso_timestamp(timestamp_ms: i64) -> String {
    Utc.timestamp_millis_opt(timestamp_ms)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

fn now_iso_timestamp() -> String {
    Utc::now().to_rfc3339()
}

pub fn normalize_ws_message(
    raw: &str,
    kline_by_stream: &HashMap<String, KlineSubscription>,
    pair_by_stream: &HashMap<String, PairStreamSubscription>,
    source: &str,
) -> Result<Option<NormalizedWsEvent>> {
    let envelope: CombinedStreamEnvelope = serde_json::from_str(raw)?;
    let stream_name = envelope.stream.to_lowercase();

    if let Some(subscription) = kline_by_stream.get(&stream_name) {
        let payload: BinanceKlineWrapper = serde_json::from_value(envelope.data)?;
        return Ok(Some(NormalizedWsEvent::Kline(NormalizedKlineEvent {
            event_id: format!(
                "{}:{}:{}:{}",
                subscription.subscription_id,
                payload.k.open_time,
                payload.event_time,
                if payload.k.closed { "closed" } else { "update" }
            ),
            event_type: "trading-bot.market-data.kline.v1".to_string(),
            source: source.to_string(),
            occurred_at: iso_timestamp(payload.event_time),
            exchange: "binance".to_string(),
            ingestion_mode: "live".to_string(),
            stream_name: subscription.stream_name.clone(),
            pair_code: subscription.pair_code.clone(),
            symbol: subscription.symbol.clone(),
            timeframe_code: subscription.timeframe_code.clone(),
            period_ms: subscription.period_ms,
            open_time: payload.k.open_time,
            close_time: payload.k.close_time,
            event_time: payload.event_time,
            closed: payload.k.closed,
            open: payload.k.open,
            high: payload.k.high,
            low: payload.k.low,
            close: payload.k.close,
            volume: payload.k.volume,
            quote_volume: payload.k.quote_volume,
            trade_count: payload.k.trade_count,
            analysis_setting_ids: subscription.analysis_setting_ids.clone(),
            strategy_names: subscription.strategy_names.clone(),
        })));
    }

    if let Some(subscription) = pair_by_stream.get(&stream_name) {
        if stream_name.ends_with("@aggtrade") {
            let payload: BinanceAggTradePayload = serde_json::from_value(envelope.data)?;
            return Ok(Some(NormalizedWsEvent::Trade(NormalizedTradeEvent {
                event_id: format!(
                    "{}:trade:{}",
                    subscription.pair_code, payload.aggregate_trade_id
                ),
                event_type: "trading-bot.market-data.agg-trade.v1".to_string(),
                source: source.to_string(),
                occurred_at: iso_timestamp(payload.trade_time),
                exchange: "binance".to_string(),
                ingestion_mode: "live".to_string(),
                stream_name: subscription.trade_stream_name.clone(),
                pair_code: subscription.pair_code.clone(),
                symbol: subscription.symbol.clone(),
                aggregate_trade_id: payload.aggregate_trade_id,
                price: payload.price,
                quantity: payload.quantity,
                trade_time: payload.trade_time,
                market_maker: payload.market_maker,
                analysis_setting_ids: subscription.analysis_setting_ids.clone(),
                strategy_names: subscription.strategy_names.clone(),
            })));
        }

        if stream_name.ends_with("@bookticker") {
            let payload: BinanceBookTickerPayload = serde_json::from_value(envelope.data)?;
            return Ok(Some(NormalizedWsEvent::BookTicker(
                NormalizedBookTickerEvent {
                    event_id: format!("{}:book:{}", subscription.pair_code, payload.update_id),
                    event_type: "trading-bot.market-data.book-ticker.v1".to_string(),
                    source: source.to_string(),
                    occurred_at: now_iso_timestamp(),
                    exchange: "binance".to_string(),
                    ingestion_mode: "live".to_string(),
                    stream_name: subscription.book_ticker_stream_name.clone(),
                    pair_code: subscription.pair_code.clone(),
                    symbol: subscription.symbol.clone(),
                    order_book_update_id: payload.update_id,
                    bid_price: payload.bid_price,
                    bid_quantity: payload.bid_quantity,
                    ask_price: payload.ask_price,
                    ask_quantity: payload.ask_quantity,
                    analysis_setting_ids: subscription.analysis_setting_ids.clone(),
                    strategy_names: subscription.strategy_names.clone(),
                },
            )));
        }
    }

    Ok(None)
}

pub fn normalize_rest_book_ticker(
    subscription: &PairStreamSubscription,
    row: serde_json::Value,
    source: &str,
) -> Result<NormalizedBookTickerEvent> {
    let row = serde_json::from_value::<BinanceBookTickerRestRow>(row)?;
    let event_time = Utc::now().timestamp_millis();
    let order_book_update_id = row.update_id.unwrap_or(event_time);
    let event_id = if row.update_id.is_some() {
        format!(
            "{}:book-backfill:{}",
            subscription.pair_code, order_book_update_id
        )
    } else {
        format!("{}:book-backfill:{}", subscription.pair_code, event_time)
    };

    Ok(NormalizedBookTickerEvent {
        event_id,
        event_type: "trading-bot.market-data.book-ticker.v1".to_string(),
        source: source.to_string(),
        occurred_at: now_iso_timestamp(),
        exchange: "binance".to_string(),
        ingestion_mode: "backfill".to_string(),
        stream_name: subscription.book_ticker_stream_name.clone(),
        pair_code: subscription.pair_code.clone(),
        symbol: row.symbol,
        order_book_update_id,
        bid_price: row.bid_price,
        bid_quantity: row.bid_quantity,
        ask_price: row.ask_price,
        ask_quantity: row.ask_quantity,
        analysis_setting_ids: subscription.analysis_setting_ids.clone(),
        strategy_names: subscription.strategy_names.clone(),
    })
}

pub fn normalize_rest_kline(
    subscription: &KlineSubscription,
    row: &[Value],
    source: &str,
) -> Result<NormalizedKlineEvent> {
    let open_time = row
        .first()
        .and_then(Value::as_i64)
        .context("Binance rest kline is missing open time")?;
    let close_time = row
        .get(6)
        .and_then(Value::as_i64)
        .context("Binance rest kline is missing close time")?;
    let trade_count = row
        .get(8)
        .and_then(Value::as_i64)
        .context("Binance rest kline is missing trade count")?;

    Ok(NormalizedKlineEvent {
        event_id: format!(
            "{}:{}:{}:backfill",
            subscription.subscription_id, open_time, close_time
        ),
        event_type: "trading-bot.market-data.kline.v1".to_string(),
        source: source.to_string(),
        occurred_at: iso_timestamp(close_time),
        exchange: "binance".to_string(),
        ingestion_mode: "backfill".to_string(),
        stream_name: subscription.stream_name.clone(),
        pair_code: subscription.pair_code.clone(),
        symbol: subscription.symbol.clone(),
        timeframe_code: subscription.timeframe_code.clone(),
        period_ms: subscription.period_ms,
        open_time,
        close_time,
        event_time: close_time,
        closed: true,
        open: row
            .get(1)
            .and_then(Value::as_str)
            .context("Binance rest kline is missing open")?
            .to_string(),
        high: row
            .get(2)
            .and_then(Value::as_str)
            .context("Binance rest kline is missing high")?
            .to_string(),
        low: row
            .get(3)
            .and_then(Value::as_str)
            .context("Binance rest kline is missing low")?
            .to_string(),
        close: row
            .get(4)
            .and_then(Value::as_str)
            .context("Binance rest kline is missing close")?
            .to_string(),
        volume: row
            .get(5)
            .and_then(Value::as_str)
            .context("Binance rest kline is missing volume")?
            .to_string(),
        quote_volume: row
            .get(7)
            .and_then(Value::as_str)
            .context("Binance rest kline is missing quote volume")?
            .to_string(),
        trade_count,
        analysis_setting_ids: subscription.analysis_setting_ids.clone(),
        strategy_names: subscription.strategy_names.clone(),
    })
}

pub fn normalize_rest_trade(
    subscription: &PairStreamSubscription,
    row: serde_json::Value,
    source: &str,
) -> Result<NormalizedTradeEvent> {
    let row = serde_json::from_value::<BinanceAggTradeRestRow>(row)?;

    Ok(NormalizedTradeEvent {
        event_id: format!(
            "{}:trade:{}",
            subscription.pair_code, row.aggregate_trade_id
        ),
        event_type: "trading-bot.market-data.agg-trade.v1".to_string(),
        source: source.to_string(),
        occurred_at: iso_timestamp(row.trade_time),
        exchange: "binance".to_string(),
        ingestion_mode: "backfill".to_string(),
        stream_name: subscription.trade_stream_name.clone(),
        pair_code: subscription.pair_code.clone(),
        symbol: subscription.symbol.clone(),
        aggregate_trade_id: row.aggregate_trade_id,
        price: row.price,
        quantity: row.quantity,
        trade_time: row.trade_time,
        market_maker: row.market_maker,
        analysis_setting_ids: subscription.analysis_setting_ids.clone(),
        strategy_names: subscription.strategy_names.clone(),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::{
        NormalizedWsEvent, normalize_rest_book_ticker, normalize_rest_trade, normalize_ws_message,
    };
    use crate::models::{KlineSubscription, PairStreamSubscription};

    #[test]
    fn normalizes_kline_trade_and_book_ticker_messages() {
        let mut kline_by_stream = HashMap::new();
        kline_by_stream.insert(
            "btcusdt@kline_1m".to_string(),
            KlineSubscription {
                subscription_id: "BTCUSDT:1m".to_string(),
                pair_code: "BTCUSDT".to_string(),
                symbol: "BTCUSDT".to_string(),
                timeframe_code: "1m".to_string(),
                binance_interval: "1m".to_string(),
                period_ms: 60_000,
                stream_name: "btcusdt@kline_1m".to_string(),
                analysis_setting_ids: vec!["analysis-1".to_string()],
                strategy_names: vec!["ema".to_string()],
            },
        );
        let mut pair_by_stream = HashMap::new();
        let pair = PairStreamSubscription {
            pair_code: "BTCUSDT".to_string(),
            symbol: "BTCUSDT".to_string(),
            trade_stream_name: "btcusdt@aggTrade".to_string(),
            book_ticker_stream_name: "btcusdt@bookTicker".to_string(),
            analysis_setting_ids: vec!["analysis-1".to_string()],
            strategy_names: vec!["ema".to_string()],
        };
        pair_by_stream.insert(pair.trade_stream_name.to_lowercase(), pair.clone());
        pair_by_stream.insert(pair.book_ticker_stream_name.to_lowercase(), pair);

        let kline = normalize_ws_message(
            r#"{"stream":"btcusdt@kline_1m","data":{"E":1710000000000,"k":{"t":1710000000000,"T":1710000059999,"o":"100.0","h":"102.0","l":"99.0","c":"101.0","v":"42.0","q":"4242.0","n":17,"x":true}}}"#,
            &kline_by_stream,
            &pair_by_stream,
            "test",
        )
        .expect("kline should parse")
        .expect("kline event should exist");

        match kline {
            NormalizedWsEvent::Kline(event) => {
                assert_eq!(event.pair_code, "BTCUSDT");
                assert_eq!(event.trade_count, 17);
            }
            _ => panic!("expected kline event"),
        }

        let trade = normalize_ws_message(
            r#"{"stream":"btcusdt@aggTrade","data":{"E":1710000000000,"a":123,"p":"100.1","q":"0.25","T":1710000000001,"m":true}}"#,
            &kline_by_stream,
            &pair_by_stream,
            "test",
        )
        .expect("trade should parse")
        .expect("trade event should exist");

        match trade {
            NormalizedWsEvent::Trade(event) => {
                assert_eq!(event.aggregate_trade_id, 123);
                assert_eq!(event.ingestion_mode, "live");
                assert_eq!(event.quantity, "0.25");
            }
            _ => panic!("expected trade event"),
        }

        let book = normalize_ws_message(
            r#"{"stream":"btcusdt@bookTicker","data":{"u":99,"b":"100.0","B":"1.0","a":"100.5","A":"2.0"}}"#,
            &kline_by_stream,
            &pair_by_stream,
            "test",
        )
        .expect("book should parse")
        .expect("book event should exist");

        match book {
            NormalizedWsEvent::BookTicker(event) => {
                assert_eq!(event.event_id, "BTCUSDT:book:99");
                assert_eq!(event.event_type, "trading-bot.market-data.book-ticker.v1");
                assert_eq!(event.source, "test");
                assert_eq!(event.exchange, "binance");
                assert!(!event.occurred_at.is_empty());
                assert_eq!(event.stream_name, "btcusdt@bookTicker");
                assert_eq!(event.pair_code, "BTCUSDT");
                assert_eq!(event.symbol, "BTCUSDT");
                assert_eq!(event.order_book_update_id, 99);
                assert_eq!(event.bid_price, "100.0");
                assert_eq!(event.bid_quantity, "1.0");
                assert_eq!(event.ask_price, "100.5");
                assert_eq!(event.ask_quantity, "2.0");
                assert_eq!(event.analysis_setting_ids, vec!["analysis-1"]);
                assert_eq!(event.strategy_names, vec!["ema"]);
            }
            _ => panic!("expected book ticker event"),
        }

        let rest_trade = normalize_rest_trade(
            pair_by_stream
                .get("btcusdt@aggtrade")
                .expect("trade subscription should exist"),
            json!({
                "a": 321,
                "p": "101.5",
                "q": "0.75",
                "T": 1710000001000i64,
                "m": false
            }),
            "test",
        )
        .expect("rest trade should normalize");
        assert_eq!(rest_trade.aggregate_trade_id, 321);
        assert_eq!(rest_trade.ingestion_mode, "backfill");
        assert_eq!(rest_trade.event_time, 1710000001000);

        let rest_book_ticker = normalize_rest_book_ticker(
            pair_by_stream
                .get("btcusdt@bookticker")
                .expect("book ticker subscription should exist"),
            json!({
                "symbol": "BTCUSDT",
                "bidPrice": "100.0",
                "bidQty": "1.0",
                "askPrice": "100.5",
                "askQty": "2.0"
            }),
            "test",
        )
        .expect("rest book ticker should normalize");
        assert_eq!(rest_book_ticker.pair_code, "BTCUSDT");
        assert_eq!(rest_book_ticker.ingestion_mode, "backfill");
        assert_eq!(rest_book_ticker.bid_price, "100.0");
        assert_eq!(rest_book_ticker.ask_price, "100.5");

        let rest_book_ticker_snapshot = normalize_rest_book_ticker(
            pair_by_stream
                .get("btcusdt@bookticker")
                .expect("book ticker subscription should exist"),
            json!({
                "symbol": "BTCUSDT",
                "updateId": 12345,
                "bidPrice": "101.0",
                "bidQty": "1.1",
                "askPrice": "101.5",
                "askQty": "2.1"
            }),
            "test",
        )
        .expect("snapshot rest book ticker should normalize");
        assert_eq!(rest_book_ticker_snapshot.order_book_update_id, 12345);
    }
}
