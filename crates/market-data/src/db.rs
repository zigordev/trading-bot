use anyhow::{Context, Result, bail};
use chrono::{TimeZone, Utc};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::{
    config::AppConfig,
    models::{
        NormalizedBookTickerEvent, NormalizedKlineEvent, NormalizedTradeEvent,
        PersistedBookTickerRecord, PersistedKlineRecord, PersistedTradeRecord,
    },
};

#[derive(Clone)]
pub struct Database {
    client: reqwest::Client,
    base_url: String,
    database: String,
    user: Option<String>,
    password: Option<String>,
    historical_kline_retention_days: u64,
    historical_trade_retention_days: u64,
    historical_book_ticker_retention_days: u64,
}

#[derive(Debug, Deserialize)]
struct HistoricalKlineRow {
    pair_code: String,
    symbol: String,
    timeframe_code: String,
    period_ms: i64,
    open_time: i64,
    close_time: i64,
    event_time: i64,
    occurred_at_ms: i64,
    ingestion_mode: String,
    closed: bool,
    open: String,
    high: String,
    low: String,
    close: String,
    volume: String,
    quote_volume: String,
    trade_count: i64,
    #[serde(rename = "latest_updated_at_ms")]
    updated_at_ms: i64,
}

#[derive(Debug, Deserialize)]
struct HistoricalTradeRow {
    pair_code: String,
    symbol: String,
    aggregate_trade_id: i64,
    ingestion_mode: String,
    price: String,
    quantity: String,
    #[serde(rename = "latest_trade_time")]
    trade_time: i64,
    market_maker: bool,
    occurred_at_ms: i64,
    #[serde(rename = "latest_updated_at_ms")]
    updated_at_ms: i64,
}

#[derive(Debug, Deserialize)]
struct HistoricalBookTickerRow {
    pair_code: String,
    symbol: String,
    order_book_update_id: i64,
    bid_price: String,
    bid_quantity: String,
    ask_price: String,
    ask_quantity: String,
    occurred_at_ms: i64,
    #[serde(rename = "latest_updated_at_ms")]
    updated_at_ms: i64,
}

#[derive(Debug, Deserialize)]
struct StoredBacktestRunRow {
    backtest_id: String,
    finished_at_ms: i64,
    #[serde(default)]
    duration_ms: i64,
    analysis_setting_id: String,
    pair_code: String,
    timeframe_code: String,
    strategy_name: String,
    research_settings_name: String,
    window_kind: String,
    requested_start_time: i64,
    requested_end_time: i64,
    replay_kline_count: i64,
    replay_trade_count: i64,
    signal_count: i64,
    trade_count: i64,
    total_pnl_percent: f64,
    response_json: String,
}

#[derive(Debug, Deserialize)]
struct LatestOpenTimeRow {
    open_time: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct LatestTradeCheckpointRow {
    latest_trade_time: Option<i64>,
    aggregate_trade_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct LatestBookTickerCheckpointRow {
    latest_occurred_at_ms: Option<i64>,
    order_book_update_id: Option<i64>,
}

#[derive(Clone, Copy, Debug)]
pub struct BookTickerCheckpoint {
    pub latest_occurred_at_ms: i64,
    pub order_book_update_id: i64,
}

#[derive(Debug, Deserialize)]
struct KlineCountRow {
    row_count: u64,
}

#[derive(Debug, Deserialize)]
struct WindowCoverageRow {
    row_count: u64,
    min_time: Option<i64>,
    max_time: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct WindowCoverage {
    pub row_count: u64,
    pub min_time: Option<i64>,
    pub max_time: Option<i64>,
}

#[derive(Serialize)]
struct HistoricalKlineWriteRow<'a> {
    pair_code: &'a str,
    timeframe_code: &'a str,
    open_time: i64,
    symbol: &'a str,
    period_ms: i64,
    close_time: i64,
    event_time: i64,
    occurred_at_ms: i64,
    ingestion_mode: &'a str,
    closed: bool,
    open_price: &'a str,
    high_price: &'a str,
    low_price: &'a str,
    close_price: &'a str,
    volume: &'a str,
    quote_volume: &'a str,
    trade_count: i64,
    updated_at_ms: i64,
}

#[derive(Serialize)]
struct HistoricalTradeWriteRow<'a> {
    pair_code: &'a str,
    symbol: &'a str,
    aggregate_trade_id: i64,
    ingestion_mode: &'a str,
    price: &'a str,
    quantity: &'a str,
    trade_time: i64,
    market_maker: bool,
    occurred_at_ms: i64,
    updated_at_ms: i64,
}

#[derive(Clone, Copy, Debug)]
pub struct TradeCheckpoint {
    pub trade_time: i64,
    pub aggregate_trade_id: i64,
}

#[derive(Clone, Debug)]
pub struct StoredBacktestRunWrite {
    pub backtest_id: String,
    pub finished_at_ms: i64,
    pub duration_ms: i64,
    pub analysis_setting_id: String,
    pub pair_code: String,
    pub timeframe_code: String,
    pub strategy_name: String,
    pub research_settings_name: String,
    pub research_settings_id: String,
    pub window_kind: String,
    pub requested_start_time: i64,
    pub requested_end_time: i64,
    pub effective_warmup_start_time: i64,
    pub effective_warmup_candles: i64,
    pub configured_duration_ms: i64,
    pub replay_kline_count: i64,
    pub replay_trade_count: i64,
    pub signal_count: i64,
    pub trade_count: i64,
    pub total_pnl_percent: f64,
    pub closed_open_position_at_end: bool,
    pub response_json: String,
}

#[derive(Clone, Debug)]
pub struct StoredBacktestRunSummary {
    pub backtest_id: String,
    pub finished_at_ms: i64,
    pub duration_ms: i64,
    pub analysis_setting_id: String,
    pub pair_code: String,
    pub timeframe_code: String,
    pub strategy_name: String,
    pub research_settings_name: String,
    pub window_kind: String,
    pub requested_start_time: i64,
    pub requested_end_time: i64,
    pub replay_kline_count: i64,
    pub replay_trade_count: i64,
    pub signal_count: i64,
    pub trade_count: i64,
    pub total_pnl_percent: f64,
}

#[derive(Clone, Debug)]
pub struct StoredBacktestRun {
    pub summary: StoredBacktestRunSummary,
    pub response_json: String,
}

#[derive(Serialize)]
struct HistoricalBookTickerWriteRow<'a> {
    pair_code: &'a str,
    symbol: &'a str,
    order_book_update_id: i64,
    bid_price: &'a str,
    bid_quantity: &'a str,
    ask_price: &'a str,
    ask_quantity: &'a str,
    occurred_at_ms: i64,
    updated_at_ms: i64,
}

#[derive(Serialize)]
struct StoredBacktestRunWriteRow<'a> {
    backtest_id: &'a str,
    finished_at_ms: i64,
    duration_ms: i64,
    analysis_setting_id: &'a str,
    pair_code: &'a str,
    timeframe_code: &'a str,
    strategy_name: &'a str,
    research_settings_name: &'a str,
    research_settings_id: &'a str,
    window_kind: &'a str,
    requested_start_time: i64,
    requested_end_time: i64,
    effective_warmup_start_time: i64,
    effective_warmup_candles: i64,
    configured_duration_ms: i64,
    replay_kline_count: i64,
    replay_trade_count: i64,
    signal_count: i64,
    trade_count: i64,
    total_pnl_percent: f64,
    closed_open_position_at_end: bool,
    response_json: &'a str,
}

#[derive(Serialize)]
struct LatestBacktestRunWriteRow<'a> {
    analysis_setting_id: &'a str,
    research_settings_name: &'a str,
    window_kind: &'a str,
    backtest_id: &'a str,
    finished_at_ms: i64,
    duration_ms: i64,
    pair_code: &'a str,
    timeframe_code: &'a str,
    strategy_name: &'a str,
    requested_start_time: i64,
    requested_end_time: i64,
    replay_kline_count: i64,
    replay_trade_count: i64,
    signal_count: i64,
    trade_count: i64,
    total_pnl_percent: f64,
    closed_open_position_at_end: bool,
    response_json: &'a str,
    updated_at_ms: i64,
}

impl Database {
    pub fn from_connection(
        base_url: String,
        database: String,
        user: Option<String>,
        password: Option<String>,
    ) -> Result<Self> {
        Ok(Self {
            client: reqwest::Client::builder().build()?,
            base_url,
            database,
            user,
            password,
            historical_kline_retention_days: 1,
            historical_trade_retention_days: 1,
            historical_book_ticker_retention_days: 1,
        })
    }

    pub async fn connect(config: &AppConfig) -> Result<Self> {
        Self::from_connection(
            format!(
                "http://{}:{}",
                config.historical_store_host, config.historical_store_port
            ),
            config.historical_store_database.clone(),
            config.historical_store_user.clone(),
            config.historical_store_password.clone(),
        )
        .map(|database| Self {
            historical_kline_retention_days: config.historical_kline_retention_days,
            historical_trade_retention_days: config.historical_trade_retention_days,
            historical_book_ticker_retention_days: config.historical_book_ticker_retention_days,
            ..database
        })
    }

    pub async fn ensure_schema(&self) -> Result<()> {
        self.execute_sql(&format!(
            "CREATE DATABASE IF NOT EXISTS {}",
            sql_ident(&self.database)
        ))
        .await?;

        self.execute_sql(&format!(
            r#"
            CREATE TABLE IF NOT EXISTS {}.market_data_klines
            (
              pair_code LowCardinality(String),
              timeframe_code LowCardinality(String),
              open_time Int64,
              symbol LowCardinality(String),
              period_ms Int64,
              close_time Int64,
              event_time Int64,
              occurred_at_ms Int64,
              ingestion_mode LowCardinality(String),
              closed Bool,
              open_price String,
              high_price String,
              low_price String,
              close_price String,
              volume String,
              quote_volume String,
              trade_count Int64,
              updated_at_ms Int64
            )
            ENGINE = ReplacingMergeTree(updated_at_ms)
            PARTITION BY toYYYYMM(toDateTime(intDiv(open_time, 1000)))
            ORDER BY (pair_code, timeframe_code, open_time)
            TTL toDateTime(intDiv(open_time, 1000)) + INTERVAL {} DAY DELETE
            SETTINGS index_granularity = 8192
            "#,
            sql_ident(&self.database),
            self.historical_kline_retention_days
        ))
        .await?;

        self.execute_sql(&format!(
            r#"
            CREATE TABLE IF NOT EXISTS {}.market_data_trades
            (
              pair_code LowCardinality(String),
              symbol LowCardinality(String),
              aggregate_trade_id Int64,
              ingestion_mode LowCardinality(String),
              price String,
              quantity String,
              trade_time Int64,
              market_maker Bool,
              occurred_at_ms Int64,
              updated_at_ms Int64
            )
            ENGINE = ReplacingMergeTree(updated_at_ms)
            PARTITION BY toYYYYMMDD(toDateTime(intDiv(trade_time, 1000)))
            ORDER BY (pair_code, trade_time, aggregate_trade_id)
            TTL toDateTime(intDiv(trade_time, 1000)) + INTERVAL {} DAY DELETE
            SETTINGS index_granularity = 8192
            "#,
            sql_ident(&self.database),
            self.historical_trade_retention_days
        ))
        .await?;

        self.execute_sql(&format!(
            r#"
            CREATE TABLE IF NOT EXISTS {}.market_data_book_tickers
            (
              pair_code LowCardinality(String),
              symbol LowCardinality(String),
              order_book_update_id Int64,
              bid_price String,
              bid_quantity String,
              ask_price String,
              ask_quantity String,
              occurred_at_ms Int64,
              updated_at_ms Int64
            )
            ENGINE = ReplacingMergeTree(updated_at_ms)
            PARTITION BY toYYYYMMDD(toDateTime(intDiv(occurred_at_ms, 1000)))
            ORDER BY (pair_code, occurred_at_ms, order_book_update_id)
            TTL toDateTime(intDiv(occurred_at_ms, 1000)) + INTERVAL {} DAY DELETE
            SETTINGS index_granularity = 8192
            "#,
            sql_ident(&self.database),
            self.historical_book_ticker_retention_days
        ))
        .await?;

        self.ensure_ttl(
            "market_data_klines",
            "toDateTime(intDiv(open_time, 1000))",
            self.historical_kline_retention_days,
        )
        .await?;
        self.ensure_ttl(
            "market_data_trades",
            "toDateTime(intDiv(trade_time, 1000))",
            self.historical_trade_retention_days,
        )
        .await?;
        // Ensure legacy event_time column is dropped if it exists to reduce storage.
        self.execute_sql(&format!(
            "ALTER TABLE {}.market_data_trades DROP COLUMN IF EXISTS event_time",
            sql_ident(&self.database)
        ))
        .await?;
        self.ensure_ttl(
            "market_data_book_tickers",
            "toDateTime(intDiv(occurred_at_ms, 1000))",
            self.historical_book_ticker_retention_days,
        )
        .await?;
        self.execute_sql(&format!(
            "ALTER TABLE {}.market_data_trades ADD COLUMN IF NOT EXISTS ingestion_mode LowCardinality(String) DEFAULT 'live'",
            sql_ident(&self.database)
        ))
        .await?;

        Ok(())
    }

    pub async fn ensure_research_backtest_schema(&self, retention_days: u64) -> Result<()> {
        self.execute_sql(&format!(
            r#"
            CREATE TABLE IF NOT EXISTS {}.research_backtest_runs
            (
              backtest_id String,
              finished_at_ms Int64,
              duration_ms Int64,
              analysis_setting_id String,
              pair_code LowCardinality(String),
              timeframe_code LowCardinality(String),
              strategy_name LowCardinality(String),
              research_settings_name LowCardinality(String),
              research_settings_id String,
              window_kind LowCardinality(String),
              requested_start_time Int64,
              requested_end_time Int64,
              effective_warmup_start_time Int64,
              effective_warmup_candles Int64,
              configured_duration_ms Int64,
              replay_kline_count Int64,
              replay_trade_count Int64,
              signal_count Int64,
              trade_count Int64,
              total_pnl_percent Float64,
              closed_open_position_at_end Bool,
              response_json String
            )
            ENGINE = MergeTree
            PARTITION BY toYYYYMM(toDateTime(intDiv(finished_at_ms, 1000)))
            ORDER BY (finished_at_ms, backtest_id)
            TTL toDateTime(intDiv(finished_at_ms, 1000)) + INTERVAL {} DAY DELETE
            SETTINGS index_granularity = 8192
            "#,
            sql_ident(&self.database),
            retention_days
        ))
        .await?;

        self.ensure_ttl(
            "research_backtest_runs",
            "toDateTime(intDiv(finished_at_ms, 1000))",
            retention_days,
        )
        .await?;
        self.execute_sql(&format!(
            "ALTER TABLE {}.research_backtest_runs ADD COLUMN IF NOT EXISTS duration_ms Int64 DEFAULT 0",
            sql_ident(&self.database)
        ))
        .await
    }

    pub async fn ping(&self) -> Result<()> {
        let response = self
            .request(self.client.get(format!("{}/ping", self.base_url)))
            .send()
            .await?;

        if response.status() != StatusCode::OK {
            bail!(
                "historical store ping failed with status {}",
                response.status()
            );
        }

        let body = response.text().await?;
        if body.trim() != "Ok." {
            bail!("unexpected historical store ping response: {body}");
        }

        Ok(())
    }

    pub async fn latest_kline_open_time(
        &self,
        pair_code: &str,
        timeframe_code: &str,
    ) -> Result<Option<i64>> {
        let sql = format!(
            r#"
            SELECT max(open_time) AS open_time
              FROM {}.market_data_klines
             WHERE pair_code = '{}'
               AND timeframe_code = '{}'
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code),
            sql_string(timeframe_code)
        );

        let body = self.query_text(&sql).await?;
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        let row = serde_json::from_str::<LatestOpenTimeRow>(trimmed)?;
        Ok(row.open_time.filter(|value| *value > 0))
    }

    pub async fn earliest_pair_kline_open_time(&self, pair_code: &str) -> Result<Option<i64>> {
        let sql = format!(
            r#"
            SELECT min(open_time) AS open_time
              FROM {}.market_data_klines
             WHERE pair_code = '{}'
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code)
        );

        let body = self.query_text(&sql).await?;
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        let row = serde_json::from_str::<LatestOpenTimeRow>(trimmed)?;
        Ok(row.open_time.filter(|value| *value > 0))
    }

    pub async fn earliest_kline_open_time(
        &self,
        pair_code: &str,
        timeframe_code: &str,
    ) -> Result<Option<i64>> {
        let sql = format!(
            r#"
            SELECT min(open_time) AS open_time
              FROM {}.market_data_klines
             WHERE pair_code = '{}'
               AND timeframe_code = '{}'
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code),
            sql_string(timeframe_code)
        );

        let body = self.query_text(&sql).await?;
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        let row = serde_json::from_str::<LatestOpenTimeRow>(trimmed)?;
        Ok(row.open_time.filter(|value| *value > 0))
    }

    pub async fn kline_open_time_count(
        &self,
        pair_code: &str,
        timeframe_code: &str,
    ) -> Result<usize> {
        let sql = format!(
            r#"
            SELECT COUNT(DISTINCT open_time) AS row_count
              FROM {}.market_data_klines
             WHERE pair_code = '{}'
               AND timeframe_code = '{}'
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code),
            sql_string(timeframe_code)
        );

        let body = self.query_text(&sql).await?;
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Ok(0);
        }

        let row = serde_json::from_str::<KlineCountRow>(trimmed)?;
        Ok(row.row_count as usize)
    }

    pub async fn kline_open_time_count_in_range(
        &self,
        pair_code: &str,
        timeframe_code: &str,
        start_open_time_ms: i64,
        end_open_time_ms: i64,
    ) -> Result<usize> {
        let (start_open_time_ms, end_open_time_ms) = if start_open_time_ms <= end_open_time_ms {
            (start_open_time_ms, end_open_time_ms)
        } else {
            (end_open_time_ms, start_open_time_ms)
        };

        let sql = format!(
            r#"
            SELECT COUNT(DISTINCT open_time) AS row_count
              FROM {}.market_data_klines
             WHERE pair_code = '{}'
               AND timeframe_code = '{}'
               AND open_time >= {}
               AND open_time <= {}
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code),
            sql_string(timeframe_code),
            start_open_time_ms,
            end_open_time_ms
        );

        let body = self.query_text(&sql).await?;
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Ok(0);
        }

        let row = serde_json::from_str::<KlineCountRow>(trimmed)?;
        Ok(row.row_count as usize)
    }

    pub async fn kline_window_coverage_in_range(
        &self,
        pair_code: &str,
        timeframe_code: &str,
        start_time: i64,
        end_time: i64,
    ) -> Result<WindowCoverage> {
        let time_range = sql_numeric_time_range("open_time", Some(start_time), Some(end_time));
        let sql = format!(
            r#"
            SELECT
              COUNT(DISTINCT open_time) AS row_count,
              MIN(open_time) AS min_time,
              MAX(open_time) AS max_time
            FROM {}.market_data_klines
            WHERE pair_code = '{}'
              AND timeframe_code = '{}'
              {}
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code),
            sql_string(timeframe_code),
            time_range
        );

        self.query_window_coverage(&sql).await
    }

    pub async fn trade_window_coverage_in_range(
        &self,
        pair_code: &str,
        start_time: i64,
        end_time: i64,
    ) -> Result<WindowCoverage> {
        let time_range = sql_numeric_time_range("trade_time", Some(start_time), Some(end_time));
        let sql = format!(
            r#"
            SELECT
              COUNT(*) AS row_count,
              MIN(latest_trade_time) AS min_time,
              MAX(latest_trade_time) AS max_time
            FROM
            (
              SELECT
                argMax(trade_time, updated_at_ms) AS latest_trade_time
              FROM {}.market_data_trades
              WHERE pair_code = '{}'
                {}
              GROUP BY aggregate_trade_id
            )
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code),
            time_range
        );

        self.query_window_coverage(&sql).await
    }

    pub async fn latest_trade_checkpoint(
        &self,
        pair_code: &str,
    ) -> Result<Option<TradeCheckpoint>> {
        let sql = format!(
            r#"
            SELECT
              argMax(trade_time, updated_at_ms) AS latest_trade_time,
              aggregate_trade_id
            FROM {}.market_data_trades
            WHERE pair_code = '{}'
            GROUP BY aggregate_trade_id
            ORDER BY latest_trade_time DESC, aggregate_trade_id DESC
            LIMIT 1
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code)
        );

        let body = self.query_text(&sql).await?;
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        let row = serde_json::from_str::<LatestTradeCheckpointRow>(trimmed)?;
        match (row.latest_trade_time, row.aggregate_trade_id) {
            (Some(trade_time), Some(aggregate_trade_id)) if trade_time > 0 => {
                Ok(Some(TradeCheckpoint {
                    trade_time,
                    aggregate_trade_id,
                }))
            }
            _ => Ok(None),
        }
    }

    pub async fn latest_book_ticker_checkpoint(
        &self,
        pair_code: &str,
    ) -> Result<Option<BookTickerCheckpoint>> {
        let sql = format!(
            r#"
            SELECT
              max(occurred_at_ms) AS latest_occurred_at_ms,
              argMax(order_book_update_id, occurred_at_ms) AS order_book_update_id
            FROM {}.market_data_book_tickers
             WHERE pair_code = '{}'
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code)
        );

        let body = self.query_text(&sql).await?;
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        let row = serde_json::from_str::<LatestBookTickerCheckpointRow>(trimmed)?;
        match (row.latest_occurred_at_ms, row.order_book_update_id) {
            (Some(latest_occurred_at_ms), Some(order_book_update_id))
                if latest_occurred_at_ms > 0 =>
            {
                Ok(Some(BookTickerCheckpoint {
                    latest_occurred_at_ms,
                    order_book_update_id,
                }))
            }
            _ => Ok(None),
        }
    }

    pub async fn upsert_kline(&self, event: &NormalizedKlineEvent) -> Result<()> {
        let occurred_at_ms = parse_rfc3339_to_millis(&event.occurred_at)?;
        let updated_at_ms = Utc::now().timestamp_millis();
        let row = HistoricalKlineWriteRow {
            pair_code: &event.pair_code,
            timeframe_code: &event.timeframe_code,
            open_time: event.open_time,
            symbol: &event.symbol,
            period_ms: event.period_ms,
            close_time: event.close_time,
            event_time: event.event_time,
            occurred_at_ms,
            ingestion_mode: &event.ingestion_mode,
            closed: event.closed,
            open_price: &event.open,
            high_price: &event.high,
            low_price: &event.low,
            close_price: &event.close,
            volume: &event.volume,
            quote_volume: &event.quote_volume,
            trade_count: event.trade_count,
            updated_at_ms,
        };

        self.insert_json_each_row(
            "market_data_klines",
            &format!("{}\n", serde_json::to_string(&row)?),
        )
        .await
    }

    /// Insert a batch of normalized kline events into ClickHouse using a
    /// single JSONEachRow INSERT. This is used by historical backfill to
    /// combine multiple Binance REST batches into fewer, larger inserts.
    pub async fn upsert_klines_batch(&self, events: &[NormalizedKlineEvent]) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }

        let mut payload = String::new();
        let updated_at_ms = Utc::now().timestamp_millis();

        for event in events {
            let occurred_at_ms = parse_rfc3339_to_millis(&event.occurred_at)?;
            let row = HistoricalKlineWriteRow {
                pair_code: &event.pair_code,
                timeframe_code: &event.timeframe_code,
                open_time: event.open_time,
                symbol: &event.symbol,
                period_ms: event.period_ms,
                close_time: event.close_time,
                event_time: event.event_time,
                occurred_at_ms,
                ingestion_mode: &event.ingestion_mode,
                closed: event.closed,
                open_price: &event.open,
                high_price: &event.high,
                low_price: &event.low,
                close_price: &event.close,
                volume: &event.volume,
                quote_volume: &event.quote_volume,
                trade_count: event.trade_count,
                updated_at_ms,
            };
            payload.push_str(&serde_json::to_string(&row)?);
            payload.push('\n');
        }

        self.insert_json_each_row("market_data_klines", &payload).await
    }

    pub async fn upsert_trade(&self, event: &NormalizedTradeEvent) -> Result<()> {
        let occurred_at_ms = parse_rfc3339_to_millis(&event.occurred_at)?;
        let updated_at_ms = Utc::now().timestamp_millis();
        let row = HistoricalTradeWriteRow {
            pair_code: &event.pair_code,
            symbol: &event.symbol,
            aggregate_trade_id: event.aggregate_trade_id,
            ingestion_mode: &event.ingestion_mode,
            price: &event.price,
            quantity: &event.quantity,
            trade_time: event.trade_time,
            market_maker: event.market_maker,
            occurred_at_ms,
            updated_at_ms,
        };

        self.insert_json_each_row(
            "market_data_trades",
            &format!("{}\n", serde_json::to_string(&row)?),
        )
        .await
    }

    /// Insert a batch of normalized trade events into ClickHouse using a
    /// single JSONEachRow INSERT. This is used by historical backfill to
    /// combine multiple Binance REST batches into fewer, larger inserts,
    /// which is more efficient for ClickHouse and reduces part counts.
    pub async fn upsert_trades_batch(&self, events: &[NormalizedTradeEvent]) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }

        let mut payload = String::new();
        // Use a single updated_at_ms for the batch; for historical backfill
        // we do not need per-row precision here.
        let updated_at_ms = Utc::now().timestamp_millis();

        for event in events {
            let occurred_at_ms = parse_rfc3339_to_millis(&event.occurred_at)?;
            let row = HistoricalTradeWriteRow {
                pair_code: &event.pair_code,
                symbol: &event.symbol,
                aggregate_trade_id: event.aggregate_trade_id,
                ingestion_mode: &event.ingestion_mode,
                price: &event.price,
                quantity: &event.quantity,
                trade_time: event.trade_time,
                market_maker: event.market_maker,
                occurred_at_ms,
                updated_at_ms,
            };
            payload.push_str(&serde_json::to_string(&row)?);
            payload.push('\n');
        }

        self.insert_json_each_row("market_data_trades", &payload).await
    }

    pub async fn upsert_book_ticker(&self, event: &NormalizedBookTickerEvent) -> Result<()> {
        let occurred_at_ms = parse_rfc3339_to_millis(&event.occurred_at)?;
        let updated_at_ms = Utc::now().timestamp_millis();
        let row = HistoricalBookTickerWriteRow {
            pair_code: &event.pair_code,
            symbol: &event.symbol,
            order_book_update_id: event.order_book_update_id,
            bid_price: &event.bid_price,
            bid_quantity: &event.bid_quantity,
            ask_price: &event.ask_price,
            ask_quantity: &event.ask_quantity,
            occurred_at_ms,
            updated_at_ms,
        };

        self.insert_json_each_row(
            "market_data_book_tickers",
            &format!("{}\n", serde_json::to_string(&row)?),
        )
        .await
    }

    pub async fn insert_backtest_run(&self, run: &StoredBacktestRunWrite) -> Result<()> {
        let row = StoredBacktestRunWriteRow {
            backtest_id: &run.backtest_id,
            finished_at_ms: run.finished_at_ms,
            duration_ms: run.duration_ms,
            analysis_setting_id: &run.analysis_setting_id,
            pair_code: &run.pair_code,
            timeframe_code: &run.timeframe_code,
            strategy_name: &run.strategy_name,
            research_settings_name: &run.research_settings_name,
            research_settings_id: &run.research_settings_id,
            window_kind: &run.window_kind,
            requested_start_time: run.requested_start_time,
            requested_end_time: run.requested_end_time,
            effective_warmup_start_time: run.effective_warmup_start_time,
            effective_warmup_candles: run.effective_warmup_candles,
            configured_duration_ms: run.configured_duration_ms,
            replay_kline_count: run.replay_kline_count,
            replay_trade_count: run.replay_trade_count,
            signal_count: run.signal_count,
            trade_count: run.trade_count,
            total_pnl_percent: run.total_pnl_percent,
            closed_open_position_at_end: run.closed_open_position_at_end,
            response_json: &run.response_json,
        };

        self.insert_json_each_row(
            "research_backtest_runs",
            &format!("{}\n", serde_json::to_string(&row)?),
        )
        .await
    }

    // latest_research_backtest_runs has been removed; callers should query
    // research_backtest_runs directly for latest-per-key projections.

    pub async fn list_backtest_runs(&self, limit: i64) -> Result<Vec<StoredBacktestRunSummary>> {
        let safe_limit = limit.clamp(1, 1_000);
        let sql = format!(
            r#"
            SELECT
              backtest_id,
              finished_at_ms,
              duration_ms,
              analysis_setting_id,
              pair_code,
              timeframe_code,
              strategy_name,
              research_settings_name,
              window_kind,
              requested_start_time,
              requested_end_time,
              replay_kline_count,
              replay_trade_count,
              signal_count,
              trade_count,
              total_pnl_percent,
              response_json
            FROM {}.research_backtest_runs
            ORDER BY finished_at_ms DESC, backtest_id DESC
            LIMIT {}
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            safe_limit
        );

        let rows = self.query_backtest_rows(&sql).await?;
        Ok(rows.into_iter().map(|row| row.summary).collect())
    }

    // latest_backtest_run has been removed; callers should query
    // research_backtest_runs directly for the latest row they need.

    pub async fn get_backtest_run(&self, backtest_id: &str) -> Result<Option<StoredBacktestRun>> {
        let sql = format!(
            r#"
            SELECT
              backtest_id,
              finished_at_ms,
              duration_ms,
              analysis_setting_id,
              pair_code,
              timeframe_code,
              strategy_name,
              research_settings_name,
              window_kind,
              requested_start_time,
              requested_end_time,
              replay_kline_count,
              replay_trade_count,
              signal_count,
              trade_count,
              total_pnl_percent,
              response_json
            FROM {}.research_backtest_runs
            WHERE backtest_id = '{}'
            ORDER BY finished_at_ms DESC
            LIMIT 1
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(backtest_id)
        );

        Ok(self.query_backtest_rows(&sql).await?.into_iter().next())
    }

    pub async fn list_recent_klines(
        &self,
        pair_code: &str,
        timeframe_code: &str,
        limit: i64,
    ) -> Result<Vec<PersistedKlineRecord>> {
        let safe_limit = limit.clamp(1, 1_000);
        let sql = format!(
            r#"
            SELECT
              pair_code,
              argMax(symbol, updated_at_ms) AS symbol,
              timeframe_code,
              argMax(period_ms, updated_at_ms) AS period_ms,
              open_time,
              argMax(close_time, updated_at_ms) AS close_time,
              argMax(event_time, updated_at_ms) AS event_time,
              argMax(occurred_at_ms, updated_at_ms) AS occurred_at_ms,
              argMax(ingestion_mode, updated_at_ms) AS ingestion_mode,
              argMax(closed, updated_at_ms) AS closed,
              argMax(open_price, updated_at_ms) AS open,
              argMax(high_price, updated_at_ms) AS high,
              argMax(low_price, updated_at_ms) AS low,
              argMax(close_price, updated_at_ms) AS close,
              argMax(volume, updated_at_ms) AS volume,
              argMax(quote_volume, updated_at_ms) AS quote_volume,
              argMax(trade_count, updated_at_ms) AS trade_count,
              max(updated_at_ms) AS latest_updated_at_ms
            FROM {}.market_data_klines
            WHERE pair_code = '{}'
              AND timeframe_code = '{}'
            GROUP BY pair_code, timeframe_code, open_time
            ORDER BY open_time DESC
            LIMIT {}
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code),
            sql_string(timeframe_code),
            safe_limit
        );

        self.query_kline_rows(&sql).await
    }

    pub async fn replay_klines(
        &self,
        pair_code: &str,
        timeframe_code: &str,
        start_time: Option<i64>,
        end_time: Option<i64>,
        limit: i64,
    ) -> Result<Vec<PersistedKlineRecord>> {
        let safe_limit = limit.clamp(1, 5_000_000);
        let time_range = sql_numeric_time_range("open_time", start_time, end_time);
        let sql = format!(
            r#"
            SELECT
              pair_code,
              argMax(symbol, updated_at_ms) AS symbol,
              timeframe_code,
              argMax(period_ms, updated_at_ms) AS period_ms,
              open_time,
              argMax(close_time, updated_at_ms) AS close_time,
              argMax(event_time, updated_at_ms) AS event_time,
              argMax(occurred_at_ms, updated_at_ms) AS occurred_at_ms,
              argMax(ingestion_mode, updated_at_ms) AS ingestion_mode,
              argMax(closed, updated_at_ms) AS closed,
              argMax(open_price, updated_at_ms) AS open,
              argMax(high_price, updated_at_ms) AS high,
              argMax(low_price, updated_at_ms) AS low,
              argMax(close_price, updated_at_ms) AS close,
              argMax(volume, updated_at_ms) AS volume,
              argMax(quote_volume, updated_at_ms) AS quote_volume,
              argMax(trade_count, updated_at_ms) AS trade_count,
              max(updated_at_ms) AS latest_updated_at_ms
            FROM {}.market_data_klines
            WHERE pair_code = '{}'
              AND timeframe_code = '{}'
              {}
            GROUP BY pair_code, timeframe_code, open_time
            ORDER BY open_time ASC
            LIMIT {}
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code),
            sql_string(timeframe_code),
            time_range,
            safe_limit
        );

        self.query_kline_rows(&sql).await
    }

    pub async fn list_recent_trades(
        &self,
        pair_code: &str,
        limit: i64,
    ) -> Result<Vec<PersistedTradeRecord>> {
        let safe_limit = limit.clamp(1, 1_000);
        let sql = format!(
            r#"
            SELECT
              pair_code,
              argMax(symbol, updated_at_ms) AS symbol,
              aggregate_trade_id,
              argMax(ingestion_mode, updated_at_ms) AS ingestion_mode,
              argMax(price, updated_at_ms) AS price,
              argMax(quantity, updated_at_ms) AS quantity,
              argMax(trade_time, updated_at_ms) AS latest_trade_time,
              argMax(market_maker, updated_at_ms) AS market_maker,
              argMax(occurred_at_ms, updated_at_ms) AS occurred_at_ms,
              max(updated_at_ms) AS latest_updated_at_ms
            FROM {}.market_data_trades
            WHERE pair_code = '{}'
            GROUP BY pair_code, aggregate_trade_id
            ORDER BY latest_trade_time DESC, aggregate_trade_id DESC
            LIMIT {}
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code),
            safe_limit
        );

        self.query_trade_rows(&sql).await
    }

    pub async fn replay_trades(
        &self,
        pair_code: &str,
        start_time: Option<i64>,
        end_time: Option<i64>,
        limit: i64,
    ) -> Result<Vec<PersistedTradeRecord>> {
        let safe_limit = limit.clamp(1, 5_000_000);
        let time_range = sql_numeric_time_range("trade_time", start_time, end_time);
        let sql = format!(
            r#"
            SELECT
              pair_code,
              symbol,
              aggregate_trade_id,
              ingestion_mode,
              price,
              quantity,
              latest_trade_time,
              market_maker,
              occurred_at_ms,
              latest_updated_at_ms
            FROM
            (
              SELECT
                pair_code,
                argMax(symbol, updated_at_ms) AS symbol,
                aggregate_trade_id,
                argMax(ingestion_mode, updated_at_ms) AS ingestion_mode,
                argMax(price, updated_at_ms) AS price,
                argMax(quantity, updated_at_ms) AS quantity,
                argMax(trade_time, updated_at_ms) AS latest_trade_time,
                argMax(market_maker, updated_at_ms) AS market_maker,
                argMax(occurred_at_ms, updated_at_ms) AS occurred_at_ms,
                max(updated_at_ms) AS latest_updated_at_ms
              FROM {}.market_data_trades
              WHERE pair_code = '{}'
              {}
              GROUP BY pair_code, aggregate_trade_id
            )
            WHERE 1 = 1
            ORDER BY latest_trade_time ASC, aggregate_trade_id ASC
            LIMIT {}
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code),
            time_range,
            safe_limit
        );

        self.query_trade_rows(&sql).await
    }

    pub async fn list_recent_book_tickers(
        &self,
        pair_code: &str,
        limit: i64,
    ) -> Result<Vec<PersistedBookTickerRecord>> {
        let safe_limit = limit.clamp(1, 1_000);
        let sql = format!(
            r#"
            SELECT
              pair_code,
              argMax(symbol, updated_at_ms) AS symbol,
              order_book_update_id,
              argMax(bid_price, updated_at_ms) AS bid_price,
              argMax(bid_quantity, updated_at_ms) AS bid_quantity,
              argMax(ask_price, updated_at_ms) AS ask_price,
              argMax(ask_quantity, updated_at_ms) AS ask_quantity,
              argMax(occurred_at_ms, updated_at_ms) AS occurred_at_ms,
              max(updated_at_ms) AS latest_updated_at_ms
            FROM {}.market_data_book_tickers
            WHERE pair_code = '{}'
            GROUP BY pair_code, order_book_update_id
            ORDER BY occurred_at_ms DESC, order_book_update_id DESC
            LIMIT {}
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code),
            safe_limit
        );

        self.query_book_ticker_rows(&sql).await
    }

    pub async fn replay_book_tickers(
        &self,
        pair_code: &str,
        start_time: Option<i64>,
        end_time: Option<i64>,
        limit: i64,
    ) -> Result<Vec<PersistedBookTickerRecord>> {
        let safe_limit = limit.clamp(1, 5_000_000);
        let time_range = sql_numeric_time_range("latest_occurred_at_ms", start_time, end_time);
        let sql = format!(
            r#"
            SELECT
              pair_code,
              symbol,
              order_book_update_id,
              bid_price,
              bid_quantity,
              ask_price,
              ask_quantity,
              latest_occurred_at_ms AS occurred_at_ms,
              latest_updated_at_ms
            FROM
            (
              SELECT
                pair_code,
                argMax(symbol, updated_at_ms) AS symbol,
                order_book_update_id,
                argMax(bid_price, updated_at_ms) AS bid_price,
                argMax(bid_quantity, updated_at_ms) AS bid_quantity,
                argMax(ask_price, updated_at_ms) AS ask_price,
                argMax(ask_quantity, updated_at_ms) AS ask_quantity,
                argMax(occurred_at_ms, updated_at_ms) AS latest_occurred_at_ms,
                max(updated_at_ms) AS latest_updated_at_ms
              FROM {}.market_data_book_tickers
              WHERE pair_code = '{}'
              GROUP BY pair_code, order_book_update_id
            )
            WHERE 1 = 1
              {}
            ORDER BY latest_occurred_at_ms ASC, order_book_update_id ASC
            LIMIT {}
            FORMAT JSONEachRow
            "#,
            sql_ident(&self.database),
            sql_string(pair_code),
            time_range,
            safe_limit
        );

        self.query_book_ticker_rows(&sql).await
    }

    async fn query_kline_rows(&self, sql: &str) -> Result<Vec<PersistedKlineRecord>> {
        let body = self.query_text(sql).await?;
        let mut records = Vec::new();

        for line in body.lines().filter(|line| !line.trim().is_empty()) {
            let row = serde_json::from_str::<HistoricalKlineRow>(line)?;
            records.push(PersistedKlineRecord {
                pair_code: row.pair_code,
                symbol: row.symbol,
                timeframe_code: row.timeframe_code,
                period_ms: row.period_ms,
                open_time: row.open_time,
                close_time: row.close_time,
                event_time: row.event_time,
                occurred_at: millis_to_rfc3339(row.occurred_at_ms)?,
                ingestion_mode: row.ingestion_mode,
                closed: row.closed,
                open: row.open,
                high: row.high,
                low: row.low,
                close: row.close,
                volume: row.volume,
                quote_volume: row.quote_volume,
                trade_count: row.trade_count,
                updated_at: millis_to_rfc3339(row.updated_at_ms)?,
            });
        }

        Ok(records)
    }

    pub async fn compact_market_data_tables(&self) -> Result<()> {
        for table_name in [
            "market_data_klines",
            "market_data_trades",
            "market_data_book_tickers",
        ] {
            self.execute_sql(&format!(
                "OPTIMIZE TABLE {}.{} FINAL",
                sql_ident(&self.database),
                sql_ident(table_name),
            ))
            .await?;
        }

        Ok(())
    }

    async fn query_trade_rows(&self, sql: &str) -> Result<Vec<PersistedTradeRecord>> {
        let body = self.query_text(sql).await?;
        let mut records = Vec::new();

        for line in body.lines().filter(|line| !line.trim().is_empty()) {
            let row = serde_json::from_str::<HistoricalTradeRow>(line)?;
            records.push(PersistedTradeRecord {
                pair_code: row.pair_code,
                symbol: row.symbol,
                aggregate_trade_id: row.aggregate_trade_id,
                ingestion_mode: row.ingestion_mode,
                price: row.price,
                quantity: row.quantity,
                trade_time: row.trade_time,
                market_maker: row.market_maker,
                occurred_at: millis_to_rfc3339(row.occurred_at_ms)?,
                updated_at: millis_to_rfc3339(row.updated_at_ms)?,
            });
        }

        Ok(records)
    }

    async fn query_book_ticker_rows(&self, sql: &str) -> Result<Vec<PersistedBookTickerRecord>> {
        let body = self.query_text(sql).await?;
        let mut records = Vec::new();

        for line in body.lines().filter(|line| !line.trim().is_empty()) {
            let row = serde_json::from_str::<HistoricalBookTickerRow>(line)?;
            records.push(PersistedBookTickerRecord {
                pair_code: row.pair_code,
                symbol: row.symbol,
                order_book_update_id: row.order_book_update_id,
                bid_price: row.bid_price,
                bid_quantity: row.bid_quantity,
                ask_price: row.ask_price,
                ask_quantity: row.ask_quantity,
                occurred_at: millis_to_rfc3339(row.occurred_at_ms)?,
                updated_at: millis_to_rfc3339(row.updated_at_ms)?,
            });
        }

        Ok(records)
    }

    async fn query_backtest_rows(&self, sql: &str) -> Result<Vec<StoredBacktestRun>> {
        let body = self.query_text(sql).await?;
        let mut records = Vec::new();

        for line in body.lines().filter(|line| !line.trim().is_empty()) {
            let row = serde_json::from_str::<StoredBacktestRunRow>(line)?;
            records.push(StoredBacktestRun {
                summary: StoredBacktestRunSummary {
                    backtest_id: row.backtest_id,
                    finished_at_ms: row.finished_at_ms,
                    duration_ms: row.duration_ms,
                    analysis_setting_id: row.analysis_setting_id,
                    pair_code: row.pair_code,
                    timeframe_code: row.timeframe_code,
                    strategy_name: row.strategy_name,
                    research_settings_name: row.research_settings_name,
                    window_kind: row.window_kind,
                    requested_start_time: row.requested_start_time,
                    requested_end_time: row.requested_end_time,
                    replay_kline_count: row.replay_kline_count,
                    replay_trade_count: row.replay_trade_count,
                    signal_count: row.signal_count,
                    trade_count: row.trade_count,
                    total_pnl_percent: row.total_pnl_percent,
                },
                response_json: row.response_json,
            });
        }

        Ok(records)
    }

    async fn ensure_ttl(
        &self,
        table_name: &str,
        timestamp_expression: &str,
        retention_days: u64,
    ) -> Result<()> {
        self.execute_sql(&format!(
            "ALTER TABLE {}.{} MODIFY TTL {} + INTERVAL {} DAY DELETE",
            sql_ident(&self.database),
            sql_ident(table_name),
            timestamp_expression,
            retention_days
        ))
        .await
    }

    async fn insert_json_each_row(&self, table_name: &str, payload: &str) -> Result<()> {
        let sql = format!(
            "INSERT INTO {}.{} FORMAT JSONEachRow",
            sql_ident(&self.database),
            sql_ident(table_name)
        );

        let response = self
            .request(
                self.client
                    .post(format!("{}/", self.base_url))
                    .query(&[("query", sql.as_str())])
                    .body(payload.to_string()),
            )
            .send()
            .await?;

        self.ensure_success(response).await?;
        Ok(())
    }

    async fn execute_sql(&self, sql: &str) -> Result<()> {
        let response = self
            .request(
                self.client
                    .post(format!("{}/", self.base_url))
                    .body(sql.to_string()),
            )
            .send()
            .await?;
        self.ensure_success(response).await?;
        Ok(())
    }

    async fn query_text(&self, sql: &str) -> Result<String> {
        let response = self
            .request(
                self.client
                    .post(format!("{}/", self.base_url))
                    .query(&[("output_format_json_quote_64bit_integers", "0")])
                    .body(sql.to_string()),
            )
            .send()
            .await?;
        let response = self.ensure_success(response).await?;
        Ok(response.text().await?)
    }

    async fn query_window_coverage(&self, sql: &str) -> Result<WindowCoverage> {
        let body = self.query_text(sql).await?;
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Ok(WindowCoverage {
                row_count: 0,
                min_time: None,
                max_time: None,
            });
        }

        let row = serde_json::from_str::<WindowCoverageRow>(trimmed)?;
        Ok(WindowCoverage {
            row_count: row.row_count,
            min_time: row.min_time,
            max_time: row.max_time,
        })
    }

    fn request(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(user) = &self.user {
            return request.basic_auth(user, self.password.clone());
        }

        request
    }

    async fn ensure_success(&self, response: reqwest::Response) -> Result<reqwest::Response> {
        if response.status().is_success() {
            return Ok(response);
        }

        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        bail!("historical store request failed with status {status}: {body}");
    }
}

fn sql_ident(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn sql_string(value: &str) -> String {
    value.replace('\'', "''")
}

fn sql_numeric_time_range(
    column_name: &str,
    start_time: Option<i64>,
    end_time: Option<i64>,
) -> String {
    let mut filters = Vec::new();
    if let Some(start_time) = start_time {
        filters.push(format!("AND {column_name} >= {start_time}"));
    }
    if let Some(end_time) = end_time {
        filters.push(format!("AND {column_name} <= {end_time}"));
    }

    if filters.is_empty() {
        String::new()
    } else {
        filters.join("\n              ")
    }
}

fn parse_rfc3339_to_millis(value: &str) -> Result<i64> {
    let parsed = chrono::DateTime::parse_from_rfc3339(value)
        .with_context(|| format!("invalid RFC3339 timestamp: {value}"))?;
    Ok(parsed.timestamp_millis())
}

fn millis_to_rfc3339(value: i64) -> Result<String> {
    let timestamp = Utc
        .timestamp_millis_opt(value)
        .single()
        .with_context(|| format!("invalid unix timestamp in millis: {value}"))?;
    Ok(timestamp.to_rfc3339())
}
