use serde::{Deserialize, Serialize};
use trading_bot_strategy_engine::models::{PersistedKlineRecord, ResolvedAnalysisSettingsRecord};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestRequest {
    #[serde(default)]
    pub control_plane_job_id: Option<String>,
    #[serde(default)]
    pub batch_id: Option<String>,
    #[serde(default)]
    pub batch_total_count: Option<usize>,
    #[serde(default)]
    pub batch_completed_count: Option<usize>,
    pub analysis_setting_id: String,
    #[serde(default)]
    pub risk_profile_name: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub warmup_candles: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestTimeWindow {
    pub window_source: String,
    pub configured_duration_ms: i64,
    pub requested_start_time: i64,
    pub requested_end_time: i64,
    pub effective_warmup_start_time: i64,
    pub effective_warmup_candles: usize,
    pub period_ms: i64,
    pub end_time_is_exclusive: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestDatasetSummary {
    pub fetched_kline_count: usize,
    pub warmup_kline_count: usize,
    pub replay_kline_count: usize,
    pub fetched_trade_count: usize,
    pub replay_trade_count: usize,
    pub first_replay_open_time: Option<i64>,
    pub last_replay_close_time: Option<i64>,
    pub first_replay_trade_time: Option<i64>,
    pub last_replay_trade_time: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestSignalRecord {
    pub sequence: usize,
    pub signal_direction: String,
    pub close_time: i64,
    pub close_price: f64,
    pub fast_ema: f64,
    pub slow_ema: f64,
    pub kline_event_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PositionDirection {
    Long,
    Short,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatedTradeRecord {
    pub trade_number: usize,
    pub direction: PositionDirection,
    pub entry_signal_sequence: usize,
    pub exit_signal_sequence: Option<usize>,
    pub entry_time: i64,
    pub exit_time: i64,
    pub entry_price: f64,
    pub exit_price: f64,
    pub quantity: f64,
    pub notional_usd: f64,
    pub stop_loss_price: f64,
    pub take_profit_price: f64,
    pub fees_usd: f64,
    pub pnl_usd: f64,
    pub pnl_percent: f64,
    pub entry_fill_source: String,
    pub exit_fill_source: String,
    pub exit_reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestSummary {
    pub signal_count: usize,
    pub long_signal_count: usize,
    pub short_signal_count: usize,
    pub trade_count: usize,
    pub winning_trade_count: usize,
    pub losing_trade_count: usize,
    pub flat_trade_count: usize,
    pub stop_loss_trade_count: usize,
    pub take_profit_trade_count: usize,
    pub reversal_trade_count: usize,
    pub window_end_trade_count: usize,
    pub win_rate: f64,
    pub total_fees_usd: f64,
    pub total_pnl_percent: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestResponse {
    pub backtest_id: String,
    pub finished_at: String,
    #[serde(default)]
    pub backtest_duration_ms: i64,
    #[serde(default)]
    pub data_retrieval_duration_ms: i64,
    pub service: String,
    pub analysis_setting_id: String,
    pub time_window: BacktestTimeWindow,
    pub analysis: ResolvedAnalysisSettingsRecord,
    pub dataset: BacktestDatasetSummary,
    pub execution_assumptions: BacktestExecutionAssumptions,
    pub summary: BacktestSummary,
    pub signals: Vec<BacktestSignalRecord>,
    pub trades: Vec<SimulatedTradeRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestExecutionAssumptions {
    pub fill_source: String,
    pub fee_bps: f64,
    pub slippage_bps: f64,
    pub stop_loss_source: String,
    pub take_profit_source: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastBacktestStatus {
    pub backtest_id: String,
    pub finished_at: String,
    pub backtest_duration_ms: i64,
    pub data_retrieval_duration_ms: i64,
    pub analysis_setting_id: String,
    pub risk_profile_name: String,
    pub symbol: String,
    pub timeframe_code: String,
    pub replay_kline_count: usize,
    pub signal_count: usize,
    pub trade_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedBacktestRunSummary {
    pub backtest_id: String,
    pub finished_at: String,
    pub backtest_duration_ms: i64,
    pub data_retrieval_duration_ms: i64,
    pub analysis_setting_id: String,
    pub risk_profile_name: String,
    pub symbol: String,
    pub timeframe_code: String,
    pub strategy_name: String,
    pub requested_start_time: i64,
    pub requested_end_time: i64,
    pub replay_kline_count: usize,
    pub replay_trade_count: usize,
    pub signal_count: usize,
    pub trade_count: usize,
    pub total_pnl_percent: f64,
}

#[derive(Clone, Debug)]
pub struct ResolvedBacktestInput {
    pub analysis: ResolvedAnalysisSettingsRecord,
    pub time_window: BacktestTimeWindow,
    pub warmup_rows: Vec<PersistedKlineRecord>,
    pub replay_rows: Vec<PersistedKlineRecord>,
    pub replay_trade_start_time: i64,
    pub replay_trade_end_time: i64,
    pub replay_trade_max_rows: usize,
}
