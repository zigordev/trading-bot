use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRecord {
    pub id: String,
    pub code: String,
    pub operable: bool,
    pub origin_asset_needed_funds: Option<f64>,
    pub destination_asset_needed_funds: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeframeRecord {
    pub id: String,
    pub code: String,
    pub longer_timeframe_code: String,
    pub longer_timeframe_multiplier: i64,
    pub period_ms: i64,
    pub operable: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub activated: bool,
    pub parameters: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskProfileRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub maximum_stop_loss: f64,
    pub minimum_stop_loss: f64,
    pub swing_gap: f64,
    pub rrr: f64,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradingDefaultsRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub default_position_notional_usd: f64,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAnalysisSettingsRecord {
    pub id: String,
    #[serde(rename = "pairCode")]
    pub symbol: String,
    pub timeframe_code: String,
    pub strategy_name: String,
    pub risk_profile_name: String,
    pub trading_defaults_name: String,
    pub technical_analysis_settings: Value,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    pub pair: PairRecord,
    pub timeframe: TimeframeRecord,
    pub strategy: StrategyRecord,
    pub risk_profile: RiskProfileRecord,
    pub trading_defaults: TradingDefaultsRecord,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSubscriptions {
    pub kline_subscriptions: Vec<KlineSubscription>,
    pub pair_subscriptions: Vec<PairStreamSubscription>,
    pub stream_names: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KlineSubscription {
    pub subscription_id: String,
    pub pair_code: String,
    pub symbol: String,
    pub timeframe_code: String,
    pub binance_interval: String,
    pub period_ms: i64,
    pub stream_name: String,
    pub analysis_setting_ids: Vec<String>,
    pub strategy_names: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairStreamSubscription {
    pub pair_code: String,
    pub symbol: String,
    pub trade_stream_name: String,
    pub analysis_setting_ids: Vec<String>,
    pub strategy_names: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedKlineRecord {
    pub symbol: String,
    pub timeframe_code: String,
    pub period_ms: i64,
    pub open_time: i64,
    pub close_time: i64,
    pub event_time: i64,
    pub occurred_at: String,
    pub ingestion_mode: String,
    pub closed: bool,
    pub open: String,
    pub high: String,
    pub low: String,
    pub close: String,
    pub volume: String,
    pub quote_volume: String,
    pub trade_count: i64,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTradeRecord {
    pub symbol: String,
    pub aggregate_trade_id: i64,
    pub price: String,
    pub trade_time: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedBookTickerRecord {
    pub symbol: String,
    pub order_book_update_id: i64,
    pub bid_price: String,
    pub bid_quantity: String,
    pub ask_price: String,
    pub ask_quantity: String,
    pub occurred_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedKlineEvent {
    pub event_id: String,
    pub event_type: String,
    pub source: String,
    pub occurred_at: String,
    pub exchange: String,
    pub ingestion_mode: String,
    pub stream_name: String,
    pub pair_code: String,
    pub symbol: String,
    pub timeframe_code: String,
    pub period_ms: i64,
    pub open_time: i64,
    pub close_time: i64,
    pub event_time: i64,
    pub closed: bool,
    pub open: String,
    pub high: String,
    pub low: String,
    pub close: String,
    pub volume: String,
    pub quote_volume: String,
    pub trade_count: i64,
    pub analysis_setting_ids: Vec<String>,
    pub strategy_names: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedTradeEvent {
    pub event_id: String,
    pub event_type: String,
    pub source: String,
    pub occurred_at: String,
    pub exchange: String,
    pub ingestion_mode: String,
    pub stream_name: String,
    pub pair_code: String,
    pub symbol: String,
    pub aggregate_trade_id: i64,
    pub price: String,
    pub quantity: String,
    pub trade_time: i64,
    pub market_maker: bool,
    pub analysis_setting_ids: Vec<String>,
    pub strategy_names: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedBookTickerEvent {
    pub event_id: String,
    pub event_type: String,
    pub source: String,
    pub occurred_at: String,
    pub exchange: String,
    pub ingestion_mode: String,
    pub stream_name: String,
    pub pair_code: String,
    pub symbol: String,
    pub order_book_update_id: i64,
    pub bid_price: String,
    pub bid_quantity: String,
    pub ask_price: String,
    pub ask_quantity: String,
    pub analysis_setting_ids: Vec<String>,
    pub strategy_names: Vec<String>,
}
