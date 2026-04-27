use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use trading_bot_market_data::models::{PersistedKlineRecord, PersistedTradeRecord};
use trading_bot_strategy_engine::models::ResolvedAnalysisSettingsRecord;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPromotionRecord {
    pub promotion_id: String,
    pub execution_settings_name: String,
    pub analysis_setting_id: String,
    pub source_backtest_id: Option<String>,
    pub symbol_code: String,
    pub timeframe_code: String,
    pub strategy_name: String,
    pub risk_profile_name: String,
    pub mode: String,
    pub selection_metric: String,
    pub selection_value: f64,
    pub status: String,
    pub promoted_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionTradeRecord {
    pub trade_id: String,
    pub external_order_id: Option<String>,
    pub position_id: Option<String>,
    pub source_backtest_id: Option<String>,
    pub analysis_setting_id: String,
    pub execution_settings_name: Option<String>,
    pub symbol_code: String,
    pub timeframe_code: String,
    pub strategy_name: String,
    pub risk_profile_name: String,
    pub mode: String,
    pub side: String,
    pub status: String,
    pub close_reason: Option<String>,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub entry_price: f64,
    pub exit_price: Option<f64>,
    pub quantity: f64,
    pub notional_usd: f64,
    pub stop_loss_price: Option<f64>,
    pub take_profit_price: Option<f64>,
    pub realized_pnl_percent: Option<f64>,
    pub realized_pnl_usd: Option<f64>,
    pub fees_usd: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionSummaryResponse {
    pub generated_at: String,
    pub active_promotion: Option<ExecutionPromotionRecord>,
    #[serde(default)]
    pub active_promotions: Vec<ExecutionPromotionRecord>,
    pub totals: ExecutionSummaryTotals,
    pub recent_trades: Vec<ExecutionTradeRecord>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionSummaryTotals {
    pub open_trade_count: usize,
    pub recent_trade_count: usize,
    pub closed_trade_count: usize,
    pub realized_pnl_usd: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionTradesResponse {
    pub items: Vec<ExecutionTradeRecord>,
    pub total_count: usize,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Clone, Debug)]
pub struct ActiveExecutionContext {
    pub promotion: ExecutionPromotionRecord,
    pub analysis: ResolvedAnalysisSettingsRecord,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPaperPosition {
    pub promotion_id: String,
    pub trade_id: String,
    pub analysis_setting_id: String,
    pub symbol_code: String,
    pub timeframe_code: String,
    pub strategy_name: String,
    pub risk_profile_name: String,
    pub side: String,
    pub opened_at: String,
    pub opened_at_ms: i64,
    pub entry_price: f64,
    pub quantity: f64,
    pub notional_usd: f64,
    pub stop_loss_price: f64,
    pub take_profit_price: f64,
    pub source_backtest_id: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct MarketSnapshot {
    pub klines_by_timeframe: BTreeMap<String, Vec<PersistedKlineRecord>>,
    pub trades: Vec<PersistedTradeRecord>,
}
