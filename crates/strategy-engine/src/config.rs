use anyhow::{Context, Result, bail};

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub app_env: String,
    pub service_name: String,
    pub port: u16,
    pub control_plane_base_url: String,
    pub control_plane_request_timeout_ms: u64,
    pub market_data_base_url: String,
    pub market_data_request_timeout_ms: u64,
    pub kafka_bootstrap_servers: String,
    pub config_change_events_topic: String,
    pub market_data_klines_topic: String,
    pub strategy_signals_topic: String,
    pub runtime_config_refresh_interval_ms: u64,
    pub config_refresh_debounce_ms: u64,
    pub readiness_max_config_age_ms: u64,
    pub strategy_warmup_history_limit: usize,
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

pub fn load_config() -> Result<AppConfig> {
    Ok(AppConfig {
        app_env: env_or_default("APP_ENV", "local"),
        service_name: env_or_default("SERVICE_NAME", "trading-bot-strategy-engine"),
        port: parse_u16("PORT", 8100)?,
        control_plane_base_url: env_or_default(
            "CONTROL_PLANE_BASE_URL",
            "http://trading-bot-api:8080",
        ),
        control_plane_request_timeout_ms: parse_u64("CONTROL_PLANE_REQUEST_TIMEOUT_MS", 5000)?,
        market_data_base_url: env_or_default(
            "MARKET_DATA_BASE_URL",
            "http://trading-bot-market-data:8090",
        ),
        market_data_request_timeout_ms: parse_u64("MARKET_DATA_REQUEST_TIMEOUT_MS", 5000)?,
        kafka_bootstrap_servers: env_or_default(
            "KAFKA_BOOTSTRAP_SERVERS",
            "platform-redpanda:9092",
        ),
        config_change_events_topic: env_or_default(
            "CONFIG_CHANGE_EVENTS_TOPIC",
            "trading-bot.control-plane.config-changes.v1",
        ),
        market_data_klines_topic: env_or_default(
            "MARKET_DATA_KLINES_TOPIC",
            "trading-bot.market-data.klines.v1",
        ),
        strategy_signals_topic: env_or_default(
            "STRATEGY_SIGNALS_TOPIC",
            "trading-bot.strategy-engine.signals.v1",
        ),
        runtime_config_refresh_interval_ms: parse_u64("RUNTIME_CONFIG_REFRESH_INTERVAL_MS", 30000)?,
        config_refresh_debounce_ms: parse_u64("CONFIG_REFRESH_DEBOUNCE_MS", 500)?,
        readiness_max_config_age_ms: parse_u64("READINESS_MAX_CONFIG_AGE_MS", 120000)?,
        strategy_warmup_history_limit: parse_usize("STRATEGY_WARMUP_HISTORY_LIMIT", 250)?,
        otel_exporter_otlp_endpoint: std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok(),
    })
}

#[cfg(test)]
mod tests {
    use super::load_config;

    #[test]
    fn load_config_uses_defaults() {
        unsafe {
            std::env::remove_var("STRATEGY_SIGNALS_TOPIC");
        }

        let config = load_config().expect("config should load");
        assert_eq!(config.service_name, "trading-bot-strategy-engine");
        assert_eq!(
            config.strategy_signals_topic,
            "trading-bot.strategy-engine.signals.v1"
        );
    }
}
