use anyhow::{Context, Result, bail};
use std::collections::BTreeMap;
use tracing::warn;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub app_env: String,
    pub service_name: String,
    pub port: u16,
    pub historical_store_host: String,
    pub historical_store_port: u16,
    pub historical_store_native_port: u16,
    pub historical_store_database: String,
    pub historical_store_user: Option<String>,
    pub historical_store_password: Option<String>,
    pub control_plane_base_url: String,
    pub control_plane_request_timeout_ms: u64,
    pub kafka_bootstrap_servers: String,
    pub config_change_events_topic: String,
    pub market_data_klines_topic: String,
    pub market_data_trades_topic: String,
    pub market_data_book_tickers_topic: String,
    pub runtime_config_refresh_interval_ms: u64,
    pub config_refresh_debounce_ms: u64,
    pub readiness_max_config_age_ms: u64,
    pub binance_stream_base_url: String,
    pub binance_rest_base_url: String,
    pub binance_reconnect_backoff_ms: u64,
    pub binance_rest_max_retries: usize,
    pub binance_rest_retry_backoff_ms: u64,
    pub historical_backfill_limit: usize,
    pub historical_trade_backfill_limit: usize,
    pub historical_trade_backfill_max_batches: usize,
    pub historical_backfill_max_concurrency: usize,
    /// Maximum number of trades to buffer per ClickHouse INSERT during
    /// historical trade backfill. This allows combining multiple 1000-row
    /// Binance batches into a larger insert for better ClickHouse efficiency.
    pub historical_trade_backfill_insert_batch_rows: usize,
    /// Optional ceiling for `HISTORICAL_BACKFILL_MAX_CONCURRENCY` ×
    /// `HISTORICAL_TRADE_BACKFILL_INSERT_BATCH_ROWS`. When unset, concurrency is
    /// not auto-reduced (large insert batches are honored as configured).
    pub historical_backfill_max_in_flight_trade_rows: Option<usize>,
    /// Target chunk size for historical trade backfill, in milliseconds.
    /// Backfill windows are split into contiguous [start,end) chunks of this
    /// size per pair to allow some per-pair parallelism while keeping each
    /// chunk self-contained. Defaults to 1 day.
    pub historical_trade_backfill_chunk_ms: u64,
    /// Maximum number of historical trade chunks to backfill concurrently for
    /// the same pair. This keeps one hot symbol from overwhelming Binance with
    /// too many simultaneous pagers.
    pub historical_trade_backfill_pair_max_concurrency: usize,
    /// Maximum number of klines to buffer per ClickHouse INSERT during
    /// historical kline backfill.
    pub historical_kline_backfill_insert_batch_rows: usize,
    pub historical_book_ticker_backfill_interval_ms: u64,
    pub historical_kline_retention_days: u64,
    pub historical_trade_retention_days: u64,
    pub historical_book_ticker_retention_days: u64,
    pub historical_store_compaction_enabled: bool,
    pub historical_store_compaction_interval_ms: u64,
    pub historical_store_compact_after_refresh: bool,
    /// Periodically audits ClickHouse trade coverage and backfills any detected
    /// gaps so backtests/replays keep working even if backfill missed some ranges.
    pub trade_gap_repair_enabled: bool,
    /// How often to run the periodic trade gap audit.
    pub trade_gap_repair_interval_ms: u64,
    /// How far behind "now" the audit window ends, to avoid trying to fill
    /// trailing gaps for the still-incoming latest trades.
    pub trade_gap_repair_end_grace_ms: u64,
    /// Maximum time span (ms) for the startup deep audit window.
    pub trade_gap_repair_startup_max_window_ms: u64,
    /// Maximum time span (ms) for the periodic audit window.
    pub trade_gap_repair_periodic_lookback_ms: u64,
    /// Multiplier for `historical_trade_backfill_max_batches` used by the gap repair
    /// backfill loops (the repair code further multiplies internally).
    pub trade_gap_repair_max_batches_multiplier: usize,
    /// If true, historical trade backfill flushes into ClickHouse using
    /// `INSERT ... FORMAT RowBinary` (faster than JSONEachRow for large batches).
    pub historical_trade_backfill_use_rowbinary_insert: bool,
    pub live_trade_insert_batch_rows: usize,
    pub live_trade_insert_flush_interval_ms: u64,
    pub default_warmup_multiplier: usize,
    /// Extra completed klines kept beyond the nominal backtest window plus
    /// warmup so market-data retention matches research-backtesting's replay
    /// cushion when validating/reading kline windows.
    pub backtest_kline_headroom_candles: usize,
    /// Extra history headroom kept in market-data so scheduled backtests that
    /// end at a prior UTC midnight still find the full required window plus
    /// warmup, even when market-data computes retention relative to "now".
    pub scheduled_backtest_history_headroom_ms: u64,
    pub backtesting_timerange_ms_by_timeframe: BTreeMap<String, i64>,
    pub market_event_dedup_capacity: usize,
    pub otel_exporter_otlp_endpoint: Option<String>,
}

fn env_or_default(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn optional_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .and_then(|value| (!value.trim().is_empty()).then_some(value))
}

fn optional_positive_usize(key: &str) -> Option<usize> {
    optional_env(key).and_then(|raw| raw.parse::<usize>().ok()).filter(|&n| n > 0)
}

fn parse_u16(key: &str, default: u16) -> Result<u16> {
    let raw = env_or_default(key, &default.to_string());
    raw.parse::<u16>()
        .with_context(|| format!("{key} must be a valid u16"))
}

fn parse_u64(key: &str, default: u64) -> Result<u64> {
    let raw = env_or_default(key, &default.to_string());
    let parsed = raw
        .parse::<u64>()
        .with_context(|| format!("{key} must be a valid positive integer"))?;

    if parsed == 0 {
        bail!("{key} must be greater than zero");
    }

    Ok(parsed)
}

fn parse_bool(key: &str, default: bool) -> Result<bool> {
    let raw = env_or_default(key, if default { "true" } else { "false" });
    match raw.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => bail!("{key} must be a valid boolean"),
    }
}

fn parse_usize(key: &str, default: usize) -> Result<usize> {
    let raw = env_or_default(key, &default.to_string());
    let parsed = raw
        .parse::<usize>()
        .with_context(|| format!("{key} must be a valid positive integer"))?;

    if parsed == 0 {
        bail!("{key} must be greater than zero");
    }

    Ok(parsed)
}

pub fn load_config() -> Result<AppConfig> {
    let default_backtesting_timerange_ms_by_timeframe = BTreeMap::from([
        ("1m".to_string(), 600_000_000),
        ("3m".to_string(), 1_800_000_000),
        ("5m".to_string(), 3_000_000_000),
    ]);

    let parse_timerange_map = |raw: String| -> Result<BTreeMap<String, i64>> {
        let mut map = BTreeMap::<String, i64>::new();
        let raw = raw.trim();
        if raw.is_empty() {
            return Ok(default_backtesting_timerange_ms_by_timeframe.clone());
        }

        for entry in raw.split(',') {
            let entry = entry.trim();
            if entry.is_empty() {
                continue;
            }
            let Some((k, v)) = entry.split_once('=') else {
                bail!(
                    "invalid BACKTEST_TIMERANGE_MS_BY_TIMEFRAME entry '{entry}', expected 'timeframeCode=durationMs'"
                );
            };
            let key = k.trim().to_string();
            let duration_ms: i64 = v.trim().parse().with_context(|| {
                format!(
                    "invalid durationMs for BACKTEST_TIMERANGE_MS_BY_TIMEFRAME entry '{entry}'"
                )
            })?;
            if duration_ms <= 0 {
                bail!(
                    "invalid non-positive durationMs={duration_ms} for BACKTEST_TIMERANGE_MS_BY_TIMEFRAME entry '{entry}'"
                );
            }
            map.insert(key, duration_ms);
        }

        if map.is_empty() {
            Ok(default_backtesting_timerange_ms_by_timeframe)
        } else {
            Ok(map)
        }
    };

    let backtesting_timerange_ms_by_timeframe = {
        let raw = std::env::var("BACKTEST_TIMERANGE_MS_BY_TIMEFRAME").unwrap_or_default();
        parse_timerange_map(raw)?
    };

    let market_data_klines_topic = std::env::var("MARKET_DATA_KLINES_TOPIC")
        .or_else(|_| std::env::var("MARKET_DATA_EVENTS_TOPIC"))
        .unwrap_or_else(|_| "trading-bot.market-data.klines.v1".to_string());

    let mut config = AppConfig {
        app_env: env_or_default("APP_ENV", "local"),
        service_name: env_or_default("SERVICE_NAME", "trading-bot-market-data"),
        port: parse_u16("PORT", 8090)?,
        historical_store_host: env_or_default(
            "HISTORICAL_STORE_HOST",
            "trading-bot-historical-store",
        ),
        historical_store_port: parse_u16("HISTORICAL_STORE_PORT", 8123)?,
        historical_store_native_port: parse_u16("HISTORICAL_STORE_NATIVE_PORT", 9000)?,
        historical_store_database: env_or_default(
            "HISTORICAL_STORE_DATABASE",
            "trading_bot_market_data",
        ),
        historical_store_user: optional_env("HISTORICAL_STORE_USER"),
        historical_store_password: optional_env("HISTORICAL_STORE_PASSWORD"),
        control_plane_base_url: env_or_default(
            "CONTROL_PLANE_BASE_URL",
            "http://trading-bot-api:8080",
        ),
        control_plane_request_timeout_ms: parse_u64("CONTROL_PLANE_REQUEST_TIMEOUT_MS", 5000)?,
        kafka_bootstrap_servers: env_or_default(
            "KAFKA_BOOTSTRAP_SERVERS",
            "platform-redpanda:9092",
        ),
        config_change_events_topic: env_or_default(
            "CONFIG_CHANGE_EVENTS_TOPIC",
            "trading-bot.control-plane.config-changes.v1",
        ),
        market_data_klines_topic,
        market_data_trades_topic: env_or_default(
            "MARKET_DATA_TRADES_TOPIC",
            "trading-bot.market-data.trades.v1",
        ),
        market_data_book_tickers_topic: env_or_default(
            "MARKET_DATA_BOOK_TICKERS_TOPIC",
            "trading-bot.market-data.book-tickers.v1",
        ),
        runtime_config_refresh_interval_ms: parse_u64("RUNTIME_CONFIG_REFRESH_INTERVAL_MS", 30000)?,
        config_refresh_debounce_ms: parse_u64("CONFIG_REFRESH_DEBOUNCE_MS", 500)?,
        readiness_max_config_age_ms: parse_u64("READINESS_MAX_CONFIG_AGE_MS", 120000)?,
        binance_stream_base_url: env_or_default(
            "BINANCE_STREAM_BASE_URL",
            "wss://stream.binance.com:9443/stream",
        ),
        binance_rest_base_url: env_or_default("BINANCE_REST_BASE_URL", "https://api.binance.com"),
        binance_reconnect_backoff_ms: parse_u64("BINANCE_RECONNECT_BACKOFF_MS", 2000)?,
        binance_rest_max_retries: parse_usize("BINANCE_REST_MAX_RETRIES", 5)?,
        binance_rest_retry_backoff_ms: parse_u64("BINANCE_REST_RETRY_BACKOFF_MS", 500)?,
        historical_backfill_limit: parse_usize("HISTORICAL_BACKFILL_LIMIT", 500)?,
        historical_trade_backfill_limit: parse_usize("HISTORICAL_TRADE_BACKFILL_LIMIT", 1000)?,
        historical_trade_backfill_max_batches: parse_usize(
            "HISTORICAL_TRADE_BACKFILL_MAX_BATCHES",
            100,
        )?,
        historical_backfill_max_concurrency: parse_usize("HISTORICAL_BACKFILL_MAX_CONCURRENCY", 4)?,
        historical_trade_backfill_insert_batch_rows: parse_usize(
            "HISTORICAL_TRADE_BACKFILL_INSERT_BATCH_ROWS",
            50_000,
        )?,
        historical_backfill_max_in_flight_trade_rows: optional_positive_usize(
            "HISTORICAL_BACKFILL_MAX_IN_FLIGHT_TRADE_ROWS",
        ),
        historical_trade_backfill_chunk_ms: parse_u64(
            "HISTORICAL_TRADE_BACKFILL_CHUNK_MS",
            24 * 60 * 60 * 1000,
        )?,
        historical_trade_backfill_pair_max_concurrency: parse_usize(
            "HISTORICAL_TRADE_BACKFILL_PAIR_MAX_CONCURRENCY",
            8,
        )?,
        historical_kline_backfill_insert_batch_rows: parse_usize(
            "HISTORICAL_KLINE_BACKFILL_INSERT_BATCH_ROWS",
            50_000,
        )?,
        historical_book_ticker_backfill_interval_ms: parse_u64(
            "HISTORICAL_BOOK_TICKER_BACKFILL_INTERVAL_MS",
            60_000,
        )?,
        historical_kline_retention_days: parse_u64("HISTORICAL_KLINE_RETENTION_DAYS", 365)?,
        historical_trade_retention_days: parse_u64("HISTORICAL_TRADE_RETENTION_DAYS", 90)?,
        historical_book_ticker_retention_days: parse_u64(
            "HISTORICAL_BOOK_TICKER_RETENTION_DAYS",
            30,
        )?,
        historical_store_compaction_enabled: parse_bool("HISTORICAL_STORE_COMPACTION_ENABLED", false)?,
        historical_store_compaction_interval_ms: parse_u64(
            "HISTORICAL_STORE_COMPACTION_INTERVAL_MS",
            180000,
        )?,
        historical_store_compact_after_refresh: parse_bool(
            "HISTORICAL_STORE_COMPACTION_AFTER_REFRESH",
            false,
        )?,
        trade_gap_repair_enabled: parse_bool("TRADE_GAP_REPAIR_ENABLED", true)?,
        trade_gap_repair_interval_ms: parse_u64(
            "TRADE_GAP_REPAIR_INTERVAL_MS",
            60 * 60 * 1000,
        )?,
        trade_gap_repair_end_grace_ms: parse_u64("TRADE_GAP_REPAIR_END_GRACE_MS", 5 * 60 * 1000)?,
        trade_gap_repair_startup_max_window_ms: parse_u64(
            "TRADE_GAP_REPAIR_STARTUP_MAX_WINDOW_MS",
            180 * 24 * 60 * 60 * 1000,
        )?,
        trade_gap_repair_periodic_lookback_ms: parse_u64(
            "TRADE_GAP_REPAIR_PERIODIC_LOOKBACK_MS",
            7 * 24 * 60 * 60 * 1000,
        )?,
        trade_gap_repair_max_batches_multiplier: parse_usize(
            "TRADE_GAP_REPAIR_MAX_BATCHES_MULTIPLIER",
            1,
        )?,
        historical_trade_backfill_use_rowbinary_insert: parse_bool(
            "HISTORICAL_TRADE_BACKFILL_USE_ROW_BINARY_INSERT",
            true,
        )?,
        live_trade_insert_batch_rows: parse_usize("LIVE_TRADE_INSERT_BATCH_ROWS", 2_000)?,
        live_trade_insert_flush_interval_ms: parse_u64(
            "LIVE_TRADE_INSERT_FLUSH_INTERVAL_MS",
            250,
        )?,
        default_warmup_multiplier: parse_usize("BACKTEST_WARMUP_MULTIPLIER", 5)?,
        backtest_kline_headroom_candles: parse_usize("BACKTEST_KLINE_HEADROOM_CANDLES", 4)?,
        scheduled_backtest_history_headroom_ms: parse_u64(
            "SCHEDULED_BACKTEST_HISTORY_HEADROOM_MS",
            48 * 60 * 60 * 1000,
        )?,
        backtesting_timerange_ms_by_timeframe,
        market_event_dedup_capacity: parse_usize("MARKET_EVENT_DEDUP_CAPACITY", 10000)?,
        otel_exporter_otlp_endpoint: std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok(),
    };

    // Optional guardrail: only when HISTORICAL_BACKFILL_MAX_IN_FLIGHT_TRADE_ROWS is set, reduce
    // concurrency so (concurrency × insert_batch_rows) stays bounded. Omit the env var to honor
    // full concurrency with large `HISTORICAL_TRADE_BACKFILL_INSERT_BATCH_ROWS` (higher OOM risk).
    if let Some(max_in_flight) = config.historical_backfill_max_in_flight_trade_rows {
        let in_flight_trade_rows = config
            .historical_backfill_max_concurrency
            .saturating_mul(config.historical_trade_backfill_insert_batch_rows);
        if in_flight_trade_rows > max_in_flight {
            let effective = (max_in_flight / config.historical_trade_backfill_insert_batch_rows)
                .max(1);
            warn!(
                configured_historical_backfill_max_concurrency = config.historical_backfill_max_concurrency,
                historical_trade_backfill_insert_batch_rows = config.historical_trade_backfill_insert_batch_rows,
                in_flight_trade_rows = in_flight_trade_rows,
                max_in_flight_trade_rows = max_in_flight,
                effective_historical_backfill_max_concurrency = effective,
                "backfill in-flight rows exceed HISTORICAL_BACKFILL_MAX_IN_FLIGHT_TRADE_ROWS; lowering HISTORICAL_BACKFILL_MAX_CONCURRENCY"
            );
            config.historical_backfill_max_concurrency = effective;
        }
    }

    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::load_config;

    #[test]
    fn load_config_uses_defaults() {
        unsafe {
            std::env::remove_var("HISTORICAL_STORE_HOST");
            std::env::remove_var("HISTORICAL_STORE_PORT");
            std::env::remove_var("HISTORICAL_STORE_NATIVE_PORT");
            std::env::remove_var("HISTORICAL_STORE_DATABASE");
            std::env::remove_var("HISTORICAL_STORE_USER");
            std::env::remove_var("HISTORICAL_STORE_PASSWORD");
            std::env::remove_var("HISTORICAL_KLINE_RETENTION_DAYS");
            std::env::remove_var("HISTORICAL_TRADE_RETENTION_DAYS");
            std::env::remove_var("HISTORICAL_BOOK_TICKER_RETENTION_DAYS");
            std::env::remove_var("HISTORICAL_STORE_COMPACTION_ENABLED");
            std::env::remove_var("HISTORICAL_STORE_COMPACTION_INTERVAL_MS");
            std::env::remove_var("HISTORICAL_STORE_COMPACTION_AFTER_REFRESH");
            std::env::remove_var("TRADE_GAP_REPAIR_ENABLED");
            std::env::remove_var("TRADE_GAP_REPAIR_INTERVAL_MS");
            std::env::remove_var("TRADE_GAP_REPAIR_END_GRACE_MS");
            std::env::remove_var("TRADE_GAP_REPAIR_STARTUP_MAX_WINDOW_MS");
            std::env::remove_var("TRADE_GAP_REPAIR_PERIODIC_LOOKBACK_MS");
            std::env::remove_var("TRADE_GAP_REPAIR_MAX_BATCHES_MULTIPLIER");
            std::env::remove_var("HISTORICAL_TRADE_BACKFILL_USE_ROW_BINARY_INSERT");
            std::env::remove_var("MARKET_DATA_KLINES_TOPIC");
            std::env::remove_var("MARKET_DATA_EVENTS_TOPIC");
            std::env::remove_var("BINANCE_REST_MAX_RETRIES");
            std::env::remove_var("BINANCE_REST_RETRY_BACKOFF_MS");
            std::env::remove_var("HISTORICAL_TRADE_BACKFILL_LIMIT");
            std::env::remove_var("HISTORICAL_TRADE_BACKFILL_MAX_BATCHES");
            std::env::remove_var("HISTORICAL_BOOK_TICKER_BACKFILL_INTERVAL_MS");
            std::env::remove_var("HISTORICAL_BACKFILL_MAX_IN_FLIGHT_TRADE_ROWS");
            std::env::remove_var("BACKTEST_KLINE_HEADROOM_CANDLES");
            std::env::remove_var("SCHEDULED_BACKTEST_HISTORY_HEADROOM_MS");
        }

        let config = load_config().expect("config should load");
        assert_eq!(config.service_name, "trading-bot-market-data");
        assert_eq!(config.historical_store_host, "trading-bot-historical-store");
        assert_eq!(config.historical_store_port, 8123);
        assert_eq!(config.historical_store_native_port, 9000);
        assert_eq!(config.historical_store_database, "trading_bot_market_data");
        assert_eq!(config.historical_store_user, None);
        assert_eq!(config.historical_store_password, None);
        assert_eq!(config.historical_kline_retention_days, 365);
        assert_eq!(config.historical_trade_retention_days, 90);
        assert_eq!(config.historical_book_ticker_retention_days, 30);
        assert_eq!(config.historical_store_compaction_enabled, false);
        assert_eq!(config.historical_store_compaction_interval_ms, 180000);
        assert_eq!(config.historical_store_compact_after_refresh, false);
        assert_eq!(
            config.market_data_klines_topic,
            "trading-bot.market-data.klines.v1"
        );
        assert_eq!(config.binance_rest_max_retries, 5);
        assert_eq!(config.binance_rest_retry_backoff_ms, 500);
        assert_eq!(config.historical_book_ticker_backfill_interval_ms, 60_000);
        assert_eq!(config.historical_trade_backfill_limit, 1000);
        assert_eq!(config.historical_trade_backfill_max_batches, 100);
        assert_eq!(config.backtest_kline_headroom_candles, 4);
        assert_eq!(config.scheduled_backtest_history_headroom_ms, 172_800_000);
    }
}
