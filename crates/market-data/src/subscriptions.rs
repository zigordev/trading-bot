use std::collections::BTreeMap;

use anyhow::{Result, bail};

use crate::models::{
    ActiveSubscriptions, KlineSubscription, PairRecord, PairStreamSubscription,
    ResolvedAnalysisSettingsRecord, TimeframeRecord,
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

pub fn derive_active_subscriptions(
    pairs: &[PairRecord],
    timeframes: &[TimeframeRecord],
    records: &[ResolvedAnalysisSettingsRecord],
) -> Result<ActiveSubscriptions> {
    let mut kline_groups = BTreeMap::<String, KlineSubscription>::new();
    let mut pair_groups = BTreeMap::<String, PairStreamSubscription>::new();
    let enabled_records = records.iter().filter(|record| record.enabled).collect::<Vec<_>>();

    for pair in pairs.iter().filter(|pair| pair.active) {
        let symbol = to_binance_symbol(&pair.code)?;
        pair_groups.insert(
            pair.code.clone(),
            PairStreamSubscription {
                pair_code: pair.code.clone(),
                symbol: symbol.clone(),
                trade_stream_name: build_trade_stream_name(&symbol),
                analysis_setting_ids: Vec::new(),
                strategy_names: Vec::new(),
            },
        );

        for timeframe in timeframes.iter().filter(|timeframe| timeframe.active) {
            let interval = timeframe.code.trim().to_string();
            if interval.is_empty() {
                bail!("Timeframe code cannot be empty");
            }

            let kline_subscription_id = format!("{}:{}", pair.code, timeframe.code);
            let kline_stream_name = build_kline_stream_name(&symbol, &interval);
            kline_groups.insert(
                kline_subscription_id.clone(),
                KlineSubscription {
                    subscription_id: kline_subscription_id,
                    pair_code: pair.code.clone(),
                    symbol: symbol.clone(),
                    timeframe_code: timeframe.code.clone(),
                    binance_interval: interval,
                    period_ms: timeframe.period_ms,
                    stream_name: kline_stream_name,
                    analysis_setting_ids: Vec::new(),
                    strategy_names: Vec::new(),
                },
            );
        }
    }

    for record in enabled_records {
        let kline_subscription_id = format!("{}:{}", record.symbol, record.timeframe_code);
        let Some(kline_entry) = kline_groups.get_mut(&kline_subscription_id) else {
            continue;
        };
        kline_entry.analysis_setting_ids.push(record.id.clone());
        kline_entry
            .strategy_names
            .push(record.strategy_name.clone());

        if let Some(pair_entry) = pair_groups.get_mut(&record.symbol) {
            pair_entry.analysis_setting_ids.push(record.id.clone());
            pair_entry.strategy_names.push(record.strategy_name.clone());
        }
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

    let mut stream_names = Vec::with_capacity(kline_subscriptions.len() + pair_subscriptions.len());
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
            symbol_entity: PairRecord {
                id: "pair-1".to_string(),
                code: "BTC/USDT".to_string(),
                active: true,
                base_asset: "BTC".to_string(),
                destination_asset: "USDT".to_string(),
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
                active: true,
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

    fn pair(code: &str) -> PairRecord {
        PairRecord {
            id: format!("pair-{code}"),
            code: code.to_string(),
            active: true,
            base_asset: "BTC".to_string(),
            destination_asset: "USDT".to_string(),
            origin_asset_needed_funds: None,
            destination_asset_needed_funds: None,
            created_at: "2026-03-12T18:00:00Z".to_string(),
            updated_at: "2026-03-12T18:00:00Z".to_string(),
        }
    }

    fn timeframe(code: &str, period_ms: i64) -> TimeframeRecord {
        TimeframeRecord {
            id: format!("timeframe-{code}"),
            code: code.to_string(),
            longer_timeframe_code: "5m".to_string(),
            longer_timeframe_multiplier: 5,
            period_ms,
            active: true,
            created_at: "2026-03-12T18:00:00Z".to_string(),
            updated_at: "2026-03-12T18:00:00Z".to_string(),
        }
    }

    #[test]
    fn derives_kline_and_pair_subscriptions() {
        let active = derive_active_subscriptions(
            &[pair("BTC/USDT")],
            &[timeframe("1m", 60_000)],
            &[resolved("analysis-1", "ema"), resolved("analysis-2", "breakout")],
        )
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
    }

    #[test]
    fn builds_combined_stream_url() {
        let active = derive_active_subscriptions(
            &[pair("BTC/USDT")],
            &[timeframe("1m", 60_000)],
            &[resolved("analysis-1", "ema")],
        )
        .unwrap();
        let url = build_combined_stream_url("wss://stream.binance.com:9443/stream", &active)
            .expect("url should build");
        assert!(url.contains("streams="));
        assert!(url.contains("btcusdt%40kline_1m"));
    }

    #[test]
    fn derives_operable_subscriptions_without_analysis_settings() {
        let active = derive_active_subscriptions(
            &[pair("BTCUSDT"), pair("ETHUSDT")],
            &[timeframe("1m", 60_000), timeframe("5m", 300_000)],
            &[],
        )
        .expect("subscriptions should derive");

        assert_eq!(active.pair_subscriptions.len(), 2);
        assert_eq!(active.kline_subscriptions.len(), 4);
        assert!(
            active
                .pair_subscriptions
                .iter()
                .any(|subscription| subscription.pair_code == "ETHUSDT")
        );
        assert!(
            active
                .kline_subscriptions
                .iter()
                .any(|subscription| subscription.pair_code == "ETHUSDT"
                    && subscription.timeframe_code == "5m")
        );
    }
}
