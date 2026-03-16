use crate::models::BacktestWindowKind;
use anyhow::{Context, Result, bail};

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub app_env: String,
    pub service_name: String,
    pub port: u16,
    pub control_plane_base_url: String,
    pub control_plane_request_timeout_ms: u64,
    pub historical_store_host: String,
    pub historical_store_port: u16,
    pub historical_store_database: String,
    pub historical_store_user: Option<String>,
    pub historical_store_password: Option<String>,
    pub readiness_max_dependency_age_ms: u64,
    pub default_warmup_multiplier: usize,
    pub max_backtest_klines: usize,
    pub max_backtest_trades: usize,
    pub max_backtest_book_tickers: usize,
    pub backtest_result_retention_days: u64,
    pub default_fee_bps: f64,
    pub default_slippage_bps: f64,
    pub auto_backtest_enabled: bool,
    pub auto_backtest_interval_seconds: u64,
    pub auto_backtest_research_settings_name: String,
    pub auto_backtest_window_kind: BacktestWindowKind,
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

fn parse_bool(key: &str, default: bool) -> Result<bool> {
    let raw = env_or_default(key, if default { "true" } else { "false" });
    match raw.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => bail!("{key} must be a valid boolean"),
    }
}

fn parse_backtest_window_kind(key: &str, default: &str) -> Result<BacktestWindowKind> {
    let raw = env_or_default(key, default).to_ascii_lowercase();
    match raw.as_str() {
        "backtesting" => Ok(BacktestWindowKind::Backtesting),
        "favourabletimeslots" | "favorabletimeslots" => Ok(BacktestWindowKind::FavorableTimeslots),
        "favorableslots" | "favorable_timeslots" | "favorable-timeslots" => {
            Ok(BacktestWindowKind::FavorableTimeslots)
        }
        "optimizationvalidity" | "optimization_validity" | "optimization-validity" => {
            Ok(BacktestWindowKind::OptimizationValidity)
        }
        value => bail!("unknown value for {key}: {value}"),
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

    Ok(AppConfig {
        app_env: env_or_default("APP_ENV", "local"),
        service_name: env_or_default("SERVICE_NAME", "trading-bot-research-backtesting"),
        port: parse_u16("PORT", 8110)?,
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
        historical_store_database: env_or_default(
            "HISTORICAL_STORE_DATABASE",
            "trading_bot_market_data",
        ),
        historical_store_user,
        historical_store_password,
        readiness_max_dependency_age_ms: parse_u64("READINESS_MAX_DEPENDENCY_AGE_MS", 120000)?,
        default_warmup_multiplier: parse_usize("BACKTEST_WARMUP_MULTIPLIER", 5)?,
        max_backtest_klines: parse_usize("BACKTEST_MAX_KLINES", 100000)?,
        max_backtest_trades: parse_usize("BACKTEST_MAX_TRADES", 1000000)?,
        max_backtest_book_tickers: parse_usize("BACKTEST_MAX_BOOK_TICKERS", 1000000)?,
        backtest_result_retention_days: parse_u64("BACKTEST_RESULT_RETENTION_DAYS", 365)?,
        default_fee_bps: parse_f64("BACKTEST_FEE_BPS", 0.0)?,
        default_slippage_bps: parse_f64("BACKTEST_SLIPPAGE_BPS", 0.0)?,
        auto_backtest_enabled: parse_bool("AUTO_BACKTEST_ENABLED", false)?,
        auto_backtest_interval_seconds: parse_u64("AUTO_BACKTEST_INTERVAL_SECONDS", 3600)?,
        auto_backtest_research_settings_name: env_or_default(
            "AUTO_BACKTEST_RESEARCH_SETTINGS_NAME",
            "default",
        ),
        auto_backtest_window_kind: parse_backtest_window_kind(
            "AUTO_BACKTEST_WINDOW_KIND",
            "backtesting",
        )?,
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
            std::env::remove_var("BACKTEST_WARMUP_MULTIPLIER");
            std::env::remove_var("AUTO_BACKTEST_ENABLED");
        }

        let config = load_config().expect("config should load");
        assert_eq!(config.service_name, "trading-bot-research-backtesting");
        assert_eq!(config.auto_backtest_enabled, false);
        assert_eq!(config.auto_backtest_interval_seconds, 3600);
        assert_eq!(config.auto_backtest_research_settings_name, "default");
        assert!(matches!(
            config.auto_backtest_window_kind,
            BacktestWindowKind::Backtesting
        ));
        assert_eq!(config.default_warmup_multiplier, 5);
        assert_eq!(config.max_backtest_trades, 1_000_000);
        assert_eq!(config.max_backtest_book_tickers, 1_000_000);
        assert_eq!(config.backtest_result_retention_days, 365);
        assert_eq!(config.default_fee_bps, 0.0);
        assert_eq!(config.default_slippage_bps, 0.0);
    }
}
