use anyhow::{Context, Result, bail};
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub app_env: String,
    pub service_name: String,
    pub port: u16,
    pub kafka_bootstrap_servers: String,
    pub backtest_completed_events_topic: String,
    pub backtest_progress_events_topic: String,
    pub data_readiness_events_topic: String,
    pub data_readiness_events_consumer_group_id: String,
    pub scheduled_backtests_enabled: bool,
    pub scheduled_backtests_interval_seconds: u64,
    pub binance_reference_base_url: String,
    pub control_plane_base_url: String,
    pub control_plane_request_timeout_ms: u64,
    pub historical_store_host: String,
    pub historical_store_port: u16,
    pub historical_store_native_port: u16,
    pub historical_store_database: String,
    pub historical_store_user: Option<String>,
    pub historical_store_password: Option<String>,
    pub readiness_max_dependency_age_ms: u64,
    pub backtest_warmup_candles: usize,
    pub max_backtest_klines: usize,
    pub max_backtest_trades: usize,
    /// Size of each ClickHouse replay page when loading trades for a backtest.
    /// Large backtests may span tens of millions of trades; paging avoids single
    /// gigantic HTTP responses that can be dropped by the client/server/network.
    pub backtest_trade_replay_page_ms: u64,
    pub backtest_trade_replay_page_rows: usize,
    pub backtest_result_retention_days: u64,
    pub default_fee_bps: f64,
    pub default_slippage_bps: f64,
    /// Allowed trade timestamp slack at the edges of the requested backtest
    /// window, in milliseconds. This tolerance accounts for the fact that
    /// there may be no trades exactly at the requested start/end times, while
    /// still requiring that all trades which actually occurred inside the
    /// window are present.
    pub trade_coverage_tolerance_ms: u64,
    /// Backtest lookback duration window per timeframe (duration in milliseconds).
    ///
    /// Format: `1m=86400000,5m=604800000` (comma-separated `timeframeCode=durationMs` pairs).
    pub backtesting_timerange_ms_by_timeframe: BTreeMap<String, i64>,
    pub otel_exporter_otlp_endpoint: Option<String>,
}

fn env_or_default(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
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

fn parse_bool(key: &str, default: bool) -> Result<bool> {
    let raw = env_or_default(key, if default { "true" } else { "false" });
    match raw.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => bail!("{key} must be a valid boolean"),
    }
}

fn parse_f64(key: &str, default: f64) -> Result<f64> {
    let raw = env_or_default(key, &default.to_string());
    let parsed = raw
        .parse::<f64>()
        .with_context(|| format!("{key} must be a valid number"))?;

    if parsed < 0.0 {
        bail!("{key} must be greater than or equal to zero");
    }

    Ok(parsed)
}

pub fn load_config() -> Result<AppConfig> {
    let historical_store_user = std::env::var("HISTORICAL_STORE_USER").ok();
    let historical_store_password = std::env::var("HISTORICAL_STORE_PASSWORD").ok();

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
                format!("invalid durationMs for BACKTEST_TIMERANGE_MS_BY_TIMEFRAME entry '{entry}'")
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

    Ok(AppConfig {
        app_env: env_or_default("APP_ENV", "local"),
        service_name: env_or_default("SERVICE_NAME", "trading-bot-research-backtesting"),
        port: parse_u16("PORT", 8110)?,
        kafka_bootstrap_servers: env_or_default(
            "KAFKA_BOOTSTRAP_SERVERS",
            "platform-redpanda:9092",
        ),
        backtest_completed_events_topic: env_or_default(
            "BACKTEST_COMPLETED_EVENTS_TOPIC",
            "trading-bot.research-backtesting.backtest-completed.v1",
        ),
        backtest_progress_events_topic: env_or_default(
            "BACKTEST_PROGRESS_EVENTS_TOPIC",
            "trading-bot.research-backtesting.backtest-progress.v1",
        ),
        data_readiness_events_topic: env_or_default(
            "DATA_READINESS_EVENTS_TOPIC",
            "trading-bot.market-data.data-readiness-snapshot.v1",
        ),
        data_readiness_events_consumer_group_id: std::env::var(
            "RESEARCH_BACKTESTING_DATA_READINESS_EVENTS_CONSUMER_GROUP_ID",
        )
        .unwrap_or_else(|_| {
            env_or_default(
                "DATA_READINESS_EVENTS_CONSUMER_GROUP_ID",
                "trading-bot-research-backtesting-data-readiness-trigger-v1",
            )
        }),
        scheduled_backtests_enabled: parse_bool("SCHEDULED_BACKTESTS_ENABLED", true)?,
        scheduled_backtests_interval_seconds: parse_u64(
            "SCHEDULED_BACKTESTS_INTERVAL_SECONDS",
            3600,
        )?,
        binance_reference_base_url: env_or_default(
            "BINANCE_REFERENCE_BASE_URL",
            "https://api.binance.com",
        ),
        control_plane_base_url: env_or_default(
            "CONTROL_PLANE_BASE_URL",
            "http://trading-bot-api:8080",
        ),
        control_plane_request_timeout_ms: parse_u64("CONTROL_PLANE_REQUEST_TIMEOUT_MS", 5000)?,
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
        historical_store_user,
        historical_store_password,
        readiness_max_dependency_age_ms: parse_u64("READINESS_MAX_DEPENDENCY_AGE_MS", 120000)?,
        backtest_warmup_candles: parse_usize("BACKTEST_WARMUP_CANDLES", 200)?,
        max_backtest_klines: parse_usize("BACKTEST_MAX_KLINES", 100000)?,
        max_backtest_trades: parse_usize("BACKTEST_MAX_TRADES", 1000000)?,
        backtest_trade_replay_page_ms: parse_u64("BACKTEST_TRADE_REPLAY_PAGE_MS", 3_600_000)?,
        backtest_trade_replay_page_rows: parse_usize("BACKTEST_TRADE_REPLAY_PAGE_ROWS", 200_000)?,
        backtest_result_retention_days: parse_u64("BACKTEST_RESULT_RETENTION_DAYS", 365)?,
        default_fee_bps: parse_f64("BACKTEST_FEE_BPS", 0.0)?,
        default_slippage_bps: parse_f64("BACKTEST_SLIPPAGE_BPS", 0.0)?,
        trade_coverage_tolerance_ms: parse_u64("BACKTEST_TRADE_COVERAGE_TOLERANCE_MS", 15_000)?,
        backtesting_timerange_ms_by_timeframe,
        otel_exporter_otlp_endpoint: std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok(),
    })
}

#[cfg(test)]
mod tests {
    use super::load_config;

    #[test]
    fn load_config_uses_defaults() {
        unsafe {
            std::env::remove_var("SERVICE_NAME");
            std::env::remove_var("BACKTEST_WARMUP_CANDLES");
            std::env::remove_var("BACKTEST_TIMERANGE_MS_BY_TIMEFRAME");
        }

        let config = load_config().expect("config should load");
        assert_eq!(config.service_name, "trading-bot-research-backtesting");
        assert_eq!(config.kafka_bootstrap_servers, "platform-redpanda:9092");
        assert_eq!(
            config.data_readiness_events_topic,
            "trading-bot.market-data.data-readiness-snapshot.v1"
        );
        assert!(config.scheduled_backtests_enabled);
        assert_eq!(config.scheduled_backtests_interval_seconds, 3600);
        assert_eq!(config.binance_reference_base_url, "https://api.binance.com");
        assert_eq!(config.backtest_warmup_candles, 200);
        assert_eq!(config.max_backtest_trades, 1_000_000);
        assert_eq!(config.backtest_result_retention_days, 365);
        assert_eq!(config.default_fee_bps, 0.0);
        assert_eq!(config.default_slippage_bps, 0.0);
    }
}
