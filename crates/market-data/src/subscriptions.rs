use std::collections::BTreeMap;

use anyhow::{Result, bail};

use crate::models::{
    ActiveSubscriptions, KlineSubscription, PairStreamSubscription, ResolvedAnalysisSettingsRecord,
};

pub fn should_refresh_for_config_resource(resource_type: &str) -> bool {
    matches!(
        resource_type,
        "pairs"
            | "timeframes"
            | "strategies"
            | "risk_profiles"
            | "trading_defaults"
            | "analysis_settings"
    )
}

pub fn to_binance_symbol(pair_code: &str) -> Result<String> {
    let symbol = pair_code
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase();

    if symbol.is_empty() {
        bail!("Pair code {pair_code} cannot be mapped to a Binance symbol");
    }

    Ok(symbol)
}

pub fn build_kline_stream_name(symbol: &str, interval: &str) -> String {
    format!("{}@kline_{interval}", symbol.to_lowercase())
}

pub fn build_trade_stream_name(symbol: &str) -> String {
    format!("{}@aggTrade", symbol.to_lowercase())
}

pub fn build_book_ticker_stream_name(symbol: &str) -> String {
    format!("{}@bookTicker", symbol.to_lowercase())
}

pub fn derive_active_subscriptions(
    records: &[ResolvedAnalysisSettingsRecord],
) -> Result<ActiveSubscriptions> {
    let mut kline_groups = BTreeMap::<String, KlineSubscription>::new();
    let mut pair_groups = BTreeMap::<String, PairStreamSubscription>::new();

    for record in records {
        let symbol = to_binance_symbol(&record.symbol)?;
        let interval = record.timeframe_code.trim().to_string();
        if interval.is_empty() {
            bail!("Timeframe code cannot be empty");
        }

        let kline_subscription_id = format!("{}:{}", record.symbol, record.timeframe_code);
        let kline_stream_name = build_kline_stream_name(&symbol, &interval);
        let kline_entry = kline_groups
            .entry(kline_subscription_id.clone())
            .or_insert_with(|| KlineSubscription {
                subscription_id: kline_subscription_id.clone(),
                pair_code: record.symbol.clone(),
                symbol: symbol.clone(),
                timeframe_code: record.timeframe_code.clone(),
                binance_interval: interval.clone(),
                period_ms: record.timeframe.period_ms,
                stream_name: kline_stream_name.clone(),
                analysis_setting_ids: Vec::new(),
                strategy_names: Vec::new(),
            });
        kline_entry.analysis_setting_ids.push(record.id.clone());
        kline_entry
            .strategy_names
            .push(record.strategy_name.clone());

        let pair_entry =
            pair_groups
                .entry(record.symbol.clone())
                .or_insert_with(|| PairStreamSubscription {
                    pair_code: record.symbol.clone(),
                    symbol: symbol.clone(),
                    trade_stream_name: build_trade_stream_name(&symbol),
                    book_ticker_stream_name: build_book_ticker_stream_name(&symbol),
                    analysis_setting_ids: Vec::new(),
                    strategy_names: Vec::new(),
                });
        pair_entry.analysis_setting_ids.push(record.id.clone());
        pair_entry.strategy_names.push(record.strategy_name.clone());
    }

    let mut kline_subscriptions = kline_groups.into_values().collect::<Vec<_>>();
    let mut pair_subscriptions = pair_groups.into_values().collect::<Vec<_>>();

    for subscription in &mut kline_subscriptions {
        subscription.analysis_setting_ids.sort();
        subscription.analysis_setting_ids.dedup();
        subscription.strategy_names.sort();
        subscription.strategy_names.dedup();
    }

    for subscription in &mut pair_subscriptions {
        subscription.analysis_setting_ids.sort();
        subscription.analysis_setting_ids.dedup();
        subscription.strategy_names.sort();
        subscription.strategy_names.dedup();
    }

    let mut stream_names =
        Vec::with_capacity(kline_subscriptions.len() + pair_subscriptions.len() * 2);
    stream_names.extend(
        kline_subscriptions
            .iter()
            .map(|subscription| subscription.stream_name.clone()),
    );
    stream_names.extend(
        pair_subscriptions
            .iter()
            .map(|subscription| subscription.trade_stream_name.clone()),
    );
    stream_names.extend(
        pair_subscriptions
            .iter()
            .map(|subscription| subscription.book_ticker_stream_name.clone()),
    );

    Ok(ActiveSubscriptions {
        kline_subscriptions,
        pair_subscriptions,
        stream_names,
    })
}

pub fn build_combined_stream_url(
    base_url: &str,
    subscriptions: &ActiveSubscriptions,
) -> Result<String> {
    let mut url = url::Url::parse(base_url)?;
    url.query_pairs_mut()
        .append_pair("streams", &subscriptions.stream_names.join("/"));
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{build_combined_stream_url, derive_active_subscriptions};
    use crate::models::{
        PairRecord, ResolvedAnalysisSettingsRecord, RiskProfileRecord, StrategyRecord,
        TimeframeRecord, TradingDefaultsRecord,
    };

    fn resolved(id: &str, strategy_name: &str) -> ResolvedAnalysisSettingsRecord {
        ResolvedAnalysisSettingsRecord {
            id: id.to_string(),
            symbol: "BTC/USDT".to_string(),
            timeframe_code: "1m".to_string(),
            strategy_name: strategy_name.to_string(),
            risk_profile_name: "default-risk".to_string(),
            trading_defaults_name: "default-trading".to_string(),
            technical_analysis_settings: json!({ "fast": 9, "slow": 21 }),
            enabled: true,
            created_at: "2026-03-12T18:00:00Z".to_string(),
            updated_at: "2026-03-12T18:00:00Z".to_string(),
            pair: PairRecord {
                id: "pair-1".to_string(),
                code: "BTC/USDT".to_string(),
                operable: true,
                origin_asset_needed_funds: None,
                destination_asset_needed_funds: None,
                created_at: "2026-03-12T18:00:00Z".to_string(),
                updated_at: "2026-03-12T18:00:00Z".to_string(),
            },
            timeframe: TimeframeRecord {
                id: "timeframe-1".to_string(),
                code: "1m".to_string(),
                longer_timeframe_code: "5m".to_string(),
                longer_timeframe_multiplier: 5,
                period_ms: 60_000,
                operable: true,
                created_at: "2026-03-12T18:00:00Z".to_string(),
                updated_at: "2026-03-12T18:00:00Z".to_string(),
            },
            strategy: StrategyRecord {
                id: format!("strategy-{strategy_name}"),
                name: strategy_name.to_string(),
                description: "strategy".to_string(),
                activated: true,
                parameters: json!({}),
                created_at: "2026-03-12T18:00:00Z".to_string(),
                updated_at: "2026-03-12T18:00:00Z".to_string(),
            },
            risk_profile: RiskProfileRecord {
                id: "risk-1".to_string(),
                name: "default-risk".to_string(),
                description: "risk".to_string(),
                maximum_stop_loss: 2.0,
                minimum_stop_loss: 1.0,
                swing_gap: 0.5,
                rrr: 2.0,
                enabled: true,
                created_at: "2026-03-12T18:00:00Z".to_string(),
                updated_at: "2026-03-12T18:00:00Z".to_string(),
            },
            trading_defaults: TradingDefaultsRecord {
                id: "defaults-1".to_string(),
                name: "default-trading".to_string(),
                description: "defaults".to_string(),
                default_position_notional_usd: 100.0,
                enabled: true,
                created_at: "2026-03-12T18:00:00Z".to_string(),
                updated_at: "2026-03-12T18:00:00Z".to_string(),
            },
        }
    }

    #[test]
    fn derives_kline_and_pair_subscriptions() {
        let active = derive_active_subscriptions(&[
            resolved("analysis-1", "ema"),
            resolved("analysis-2", "breakout"),
        ])
        .expect("subscriptions should derive");

        assert_eq!(active.kline_subscriptions.len(), 1);
        assert_eq!(active.pair_subscriptions.len(), 1);
        assert_eq!(active.kline_subscriptions[0].symbol, "BTCUSDT");
        assert_eq!(
            active.kline_subscriptions[0].analysis_setting_ids,
            vec!["analysis-1", "analysis-2"]
        );
        assert_eq!(
            active.pair_subscriptions[0].trade_stream_name,
            "btcusdt@aggTrade"
        );
        assert!(
            active
                .stream_names
                .contains(&"btcusdt@kline_1m".to_string())
        );
        assert!(
            active
                .stream_names
                .contains(&"btcusdt@aggTrade".to_string())
        );
        assert!(
            active
                .stream_names
                .contains(&"btcusdt@bookTicker".to_string())
        );
    }

    #[test]
    fn builds_combined_stream_url() {
        let active = derive_active_subscriptions(&[resolved("analysis-1", "ema")]).unwrap();
        let url = build_combined_stream_url("wss://stream.binance.com:9443/stream", &active)
            .expect("url should build");
        assert!(url.contains("streams="));
        assert!(url.contains("btcusdt%40kline_1m"));
    }
}
