use std::net::SocketAddr;

use anyhow::Result;
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::json;
use tracing_subscriber::{EnvFilter, fmt};

use trading_bot_execution::{config::load_config, service::ExecutionService};

#[derive(Clone)]
struct AppState {
    service: ExecutionService,
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
    let service = ExecutionService::new(config.clone()).await?;
    let state = AppState { service };

    let router = Router::new()
        .route("/health/liveness", get(liveness))
        .route("/health/readiness", get(readiness))
        .route("/metrics", get(metrics))
        .route("/v1/status", get(status))
        .route("/v1/promotion", get(active_promotion))
        .with_state(state.clone());

    let address = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(
        port = config.port,
        service = config.service_name,
        environment = config.app_env,
        "trading bot execution started"
    );

    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal(state.service.clone()))
        .await?;

    Ok(())
}

async fn shutdown_signal(service: ExecutionService) {
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

async fn status(State(state): State<AppState>) -> Response {
    Json(state.service.status().await).into_response()
}

async fn active_promotion(State(state): State<AppState>) -> Response {
    Json(state.service.active_promotion().await).into_response()
}
