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

use trading_bot_research_backtesting::{
    config::load_config, models::BacktestRequest, service::ResearchBacktestingService,
};

#[derive(Clone)]
struct AppState {
    service: ResearchBacktestingService,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BacktestListQuery {
    limit: Option<usize>,
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

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
    let service = ResearchBacktestingService::new(config.clone()).await?;
    let state = AppState { service };

    let router = Router::new()
        .route("/health/liveness", get(liveness))
        .route("/health/readiness", get(readiness))
        .route("/metrics", get(metrics))
        .route("/v1/backtests", get(list_backtests).post(run_backtest))
        .route("/v1/backtests/{backtest_id}", get(get_backtest))
        .with_state(state.clone());

    let address = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(
        port = config.port,
        service = config.service_name,
        environment = config.app_env,
        "trading bot research-backtesting started"
    );

    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
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

async fn list_backtests(
    State(state): State<AppState>,
    Query(query): Query<BacktestListQuery>,
) -> Response {
    match state
        .service
        .list_backtests(query.limit.unwrap_or(20))
        .await
    {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "message": error.to_string() })),
        )
            .into_response(),
    }
}

async fn get_backtest(State(state): State<AppState>, Path(backtest_id): Path<String>) -> Response {
    match state.service.get_backtest(&backtest_id).await {
        Ok(Some(payload)) => Json(payload).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "message": format!("backtest {backtest_id} was not found") })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "message": error.to_string() })),
        )
            .into_response(),
    }
}

async fn run_backtest(
    State(state): State<AppState>,
    Json(request): Json<BacktestRequest>,
) -> Response {
    match state.service.run_backtest(request).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "message": error.to_string() })),
        )
            .into_response(),
    }
}
