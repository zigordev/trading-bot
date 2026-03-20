use std::net::SocketAddr;

use anyhow::Result;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use serde_json::json;
use tracing_subscriber::{EnvFilter, fmt};
use trading_bot_market_data::{config::load_config, service::MarketDataService};

#[derive(Clone)]
struct AppState {
    service: MarketDataService,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentKlineQuery {
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentPairQuery {
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplayQuery {
    start_time: Option<i64>,
    end_time: Option<i64>,
    limit: Option<i64>,
}

fn init_tracing() {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,rdkafka=warn"));

    fmt()
        .with_env_filter(filter)
        .json()
        .with_current_span(true)
        .with_span_list(false)
        .init();
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let config = load_config()?;
    let service = MarketDataService::new(config.clone()).await?;
    let state = AppState { service };

    let router = Router::new()
        .route("/health/liveness", get(liveness))
        .route("/health/readiness", get(readiness))
        .route("/metrics", get(metrics))
        .route("/v1/info", get(info))
        .route("/v1/status", get(status))
        .route("/v1/subscriptions", get(subscriptions))
        .route(
            "/v1/klines/{pair_code}/{timeframe_code}",
            get(recent_klines),
        )
        .route("/v1/trades/{pair_code}", get(recent_trades))
        .route("/v1/book-tickers/{pair_code}", get(recent_book_tickers))
        .route(
            "/v1/replay/klines/{pair_code}/{timeframe_code}",
            get(replay_klines),
        )
        .route("/v1/replay/trades/{pair_code}", get(replay_trades))
        .route(
            "/v1/replay/book-tickers/{pair_code}",
            get(replay_book_tickers),
        )
        .with_state(state.clone());

    let address = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(
        port = config.port,
        service = config.service_name,
        environment = config.app_env,
        "trading bot market-data started"
    );

    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal(state.service.clone()))
        .await?;

    Ok(())
}

async fn shutdown_signal(service: MarketDataService) {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        let mut signal =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).ok();
        if let Some(ref mut signal) = signal {
            signal.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    service.stop().await;
}

async fn liveness(State(state): State<AppState>) -> Json<serde_json::Value> {
    let config = state.service.config_snapshot();
    Json(json!({
        "status": "ok",
        "service": config.service_name
    }))
}

async fn readiness(State(state): State<AppState>) -> Response {
    let payload = state.service.readiness().await;
    let status_code = if payload.status == "ok" {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status_code, Json(payload)).into_response()
}

async fn metrics(State(state): State<AppState>) -> Response {
    match state.service.status().await.started {
        true => {
            let body = state.service.metrics_text().unwrap_or_default();
            let mut response = body.into_response();
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/plain; version=0.0.4"),
            );
            response
        }
        false => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

async fn info(State(state): State<AppState>) -> Json<serde_json::Value> {
    let status = state.service.status().await;
    let config = state.service.config_snapshot();

    Json(json!({
        "service": config.service_name,
        "environment": config.app_env,
        "runtime": {
            "implemented": [
                "health/liveness endpoint",
                "health/readiness endpoint",
                "Prometheus-style metrics endpoint",
                "runtime-config bootstrap from control-plane",
                "config-change driven subscription refresh",
                "periodic runtime-config reconciliation",
                "Kafka topic provisioning for consumed and published contracts",
                "Binance combined websocket streams for klines, aggregate trades, and book tickers",
                "normalized market-data publication into Redpanda",
                "persisted kline, aggregate-trade, and book-ticker storage in ClickHouse historical store",
                "startup backfill and tail-gap repair for klines, aggregate trades, and book-tickers",
                "periodic trade gap audit/repair loop",
                "historian inspection endpoints",
                "replay-oriented historian query endpoints",
                "ClickHouse historian reads for research-backtesting consumers"
            ],
            "pending": [
                "execution consumer",
                "fill-accurate replay datasets"
            ]
        },
        "topics": {
            "consumes": [config.config_change_events_topic],
            "publishes": [
                config.market_data_klines_topic,
                config.market_data_trades_topic,
                config.market_data_book_tickers_topic
            ]
        },
        "status": status
    }))
}

async fn status(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::to_value(state.service.status().await).unwrap_or_else(|_| json!({})))
}

async fn subscriptions(State(state): State<AppState>) -> Json<serde_json::Value> {
    let status = state.service.status().await;
    Json(serde_json::to_value(status.subscriptions).unwrap_or_else(|_| json!({})))
}

async fn recent_klines(
    State(state): State<AppState>,
    Path((pair_code, timeframe_code)): Path<(String, String)>,
    Query(query): Query<RecentKlineQuery>,
) -> Response {
    match state
        .service
        .recent_klines(
            &pair_code,
            &timeframe_code,
            query.limit.unwrap_or(100).clamp(1, 1000),
        )
        .await
    {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "message": error.to_string() })),
        )
            .into_response(),
    }
}

async fn recent_trades(
    State(state): State<AppState>,
    Path(pair_code): Path<String>,
    Query(query): Query<RecentPairQuery>,
) -> Response {
    match state
        .service
        .recent_trades(&pair_code, query.limit.unwrap_or(100).clamp(1, 1_000))
        .await
    {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "message": error.to_string() })),
        )
            .into_response(),
    }
}

async fn recent_book_tickers(
    State(state): State<AppState>,
    Path(pair_code): Path<String>,
    Query(query): Query<RecentPairQuery>,
) -> Response {
    match state
        .service
        .recent_book_tickers(&pair_code, query.limit.unwrap_or(100).clamp(1, 1_000))
        .await
    {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "message": error.to_string() })),
        )
            .into_response(),
    }
}

async fn replay_klines(
    State(state): State<AppState>,
    Path((pair_code, timeframe_code)): Path<(String, String)>,
    Query(query): Query<ReplayQuery>,
) -> Response {
    match state
        .service
        .replay_klines(
            &pair_code,
            &timeframe_code,
            query.start_time,
            query.end_time,
            query.limit.unwrap_or(1_000).clamp(1, 5_000),
        )
        .await
    {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "message": error.to_string() })),
        )
            .into_response(),
    }
}

async fn replay_trades(
    State(state): State<AppState>,
    Path(pair_code): Path<String>,
    Query(query): Query<ReplayQuery>,
) -> Response {
    match state
        .service
        .replay_trades(
            &pair_code,
            query.start_time,
            query.end_time,
            query.limit.unwrap_or(1_000).clamp(1, 5_000),
        )
        .await
    {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "message": error.to_string() })),
        )
            .into_response(),
    }
}

async fn replay_book_tickers(
    State(state): State<AppState>,
    Path(pair_code): Path<String>,
    Query(query): Query<ReplayQuery>,
) -> Response {
    match state
        .service
        .replay_book_tickers(
            &pair_code,
            query.start_time,
            query.end_time,
            query.limit.unwrap_or(1_000).clamp(1, 5_000),
        )
        .await
    {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "message": error.to_string() })),
        )
            .into_response(),
    }
}
