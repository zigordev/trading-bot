use anyhow::{Context, Result, bail};

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub app_env: String,
    pub service_name: String,
    pub port: u16,
    pub control_plane_base_url: String,
    pub market_data_base_url: String,
    pub kafka_bootstrap_servers: String,
    pub market_data_kline_events_topic: String,
    pub market_data_trade_events_topic: String,
    pub market_data_events_consumer_group_id: String,
    pub control_plane_request_timeout_ms: u64,
    pub market_data_request_timeout_ms: u64,
    pub refresh_interval_ms: u64,
    pub signal_poll_interval_ms: u64,
    pub readiness_max_dependency_age_ms: u64,
    pub default_mode: String,
    pub default_position_notional_usd: f64,
    pub binance_api_key: Option<String>,
    pub binance_api_secret: Option<String>,
    pub binance_rest_base_url: String,
    pub binance_ws_base_url: String,
    pub binance_recv_window: u64,
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

fn parse_f64(key: &str, default: f64) -> Result<f64> {
    let raw = env_or_default(key, &default.to_string());
    let parsed = raw
        .parse::<f64>()
        .with_context(|| format!("{key} must be a valid number"))?;
    if parsed <= 0.0 {
        bail!("{key} must be greater than zero");
    }
    Ok(parsed)
}

pub fn load_config() -> Result<AppConfig> {
    let default_mode = env_or_default("EXECUTION_DEFAULT_MODE", "paper");
    if default_mode != "paper" && default_mode != "live" {
        bail!("EXECUTION_DEFAULT_MODE must be either 'paper' or 'live'");
    }
    let binance_api_key = std::env::var("BINANCE_API_KEY").ok();
    let binance_api_secret = std::env::var("BINANCE_API_SECRET").ok();
    if default_mode == "live" && (binance_api_key.is_none() || binance_api_secret.is_none()) {
        bail!(
            "BINANCE_API_KEY and BINANCE_API_SECRET are required when EXECUTION_DEFAULT_MODE=live"
        );
    }

    Ok(AppConfig {
        app_env: env_or_default("APP_ENV", "local"),
        service_name: env_or_default("OTEL_SERVICE_NAME", "trading-bot-execution"),
        port: parse_u16("PORT", 8120)?,
        control_plane_base_url: env_or_default(
            "CONTROL_PLANE_BASE_URL",
            "http://trading-bot-api:8080",
        ),
        market_data_base_url: env_or_default(
            "MARKET_DATA_BASE_URL",
            "http://trading-bot-market-data:8090",
        ),
        kafka_bootstrap_servers: env_or_default(
            "KAFKA_BOOTSTRAP_SERVERS",
            "platform-redpanda:9092",
        ),
        market_data_kline_events_topic: env_or_default(
            "MARKET_DATA_KLINE_EVENTS_TOPIC",
            "trading-bot.market-data.kline.v1",
        ),
        market_data_trade_events_topic: env_or_default(
            "MARKET_DATA_TRADE_EVENTS_TOPIC",
            "trading-bot.market-data.agg-trade.v1",
        ),
        market_data_events_consumer_group_id: env_or_default(
            "EXECUTION_MARKET_DATA_EVENTS_CONSUMER_GROUP_ID",
            "trading-bot-execution-market-data-v1",
        ),
        control_plane_request_timeout_ms: parse_u64("CONTROL_PLANE_REQUEST_TIMEOUT_MS", 10000)?,
        market_data_request_timeout_ms: parse_u64("MARKET_DATA_REQUEST_TIMEOUT_MS", 15000)?,
        refresh_interval_ms: parse_u64("EXECUTION_REFRESH_INTERVAL_MS", 15000)?,
        signal_poll_interval_ms: parse_u64("EXECUTION_SIGNAL_POLL_INTERVAL_MS", 5000)?,
        readiness_max_dependency_age_ms: parse_u64("READINESS_MAX_DEPENDENCY_AGE_MS", 120000)?,
        default_mode,
        default_position_notional_usd: parse_f64("EXECUTION_DEFAULT_POSITION_NOTIONAL_USD", 100.0)?,
        binance_api_key,
        binance_api_secret,
        binance_rest_base_url: env_or_default("BINANCE_REST_BASE_URL", "https://api.binance.com"),
        binance_ws_base_url: env_or_default("BINANCE_WS_BASE_URL", "wss://stream.binance.com:9443"),
        binance_recv_window: parse_u64("BINANCE_RECV_WINDOW", 5000)?,
        otel_exporter_otlp_endpoint: std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok(),
    })
}

#[cfg(test)]
mod tests {
    use super::load_config;

    #[test]
    fn load_config_uses_defaults() {
        // Test-only. Rust 2024 made `std::env::remove_var` unsafe because it
        // is not thread-safe, so a test that clears an env var has no other
        // way to do it. Nothing here dereferences a pointer.
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage
        unsafe {
            std::env::remove_var("OTEL_SERVICE_NAME");
            std::env::remove_var("EXECUTION_DEFAULT_MODE");
        }

        let config = load_config().expect("config should load");
        assert_eq!(config.service_name, "trading-bot-execution");
        assert_eq!(config.port, 8120);
        assert_eq!(config.default_mode, "paper");
        assert_eq!(
            config.market_data_kline_events_topic,
            "trading-bot.market-data.kline.v1"
        );
        assert_eq!(config.control_plane_request_timeout_ms, 10000);
        assert_eq!(config.market_data_request_timeout_ms, 15000);
        assert_eq!(config.binance_rest_base_url, "https://api.binance.com");
    }
}
