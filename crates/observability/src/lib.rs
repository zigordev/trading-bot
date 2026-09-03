//! The Rust half of the estate's observability kit.
//!
//! The TypeScript services vendor `platform-ops/packages/observability`; this
//! crate is the equivalent for the Rust ones. It exists for one reason: every
//! recording rule and alert in `platform-ops/docker/prometheus/` aggregates
//! `http_requests_total` and `http_request_duration_seconds`. A service that
//! does not emit those two metrics, under exactly those names and labels, is
//! scraped but can never be alerted on — which is what all three Rust services
//! were until this existed.
//!
//! It is a workspace crate rather than three copies because copies drift, and
//! the drift here would be silent: the alerts simply stop covering a service.

pub mod tracing_setup;

use axum::{
    extract::{MatchedPath, Request, State},
    middleware::Next,
    response::Response,
};
use prometheus::{HistogramOpts, HistogramVec, IntCounterVec, Opts, Registry};
use std::time::Instant;

/// The two metrics the shared alerting rules are built on.
#[derive(Clone)]
pub struct HttpMetrics {
    requests_total: IntCounterVec,
    request_duration_seconds: HistogramVec,
}

impl HttpMetrics {
    /// Registers both metrics into the service's existing registry, so they are
    /// served by the `/metrics` endpoint it already has.
    ///
    /// Names and labels match the Node middleware exactly. That sameness is the
    /// whole point — `sum by (job) (rate(http_requests_total[5m]))` has to mean
    /// the same thing on every service in the estate.
    pub fn register(registry: &Registry) -> anyhow::Result<Self> {
        let requests_total = IntCounterVec::new(
            Opts::new("http_requests_total", "Total number of HTTP requests"),
            &["method", "route", "status"],
        )?;

        let request_duration_seconds = HistogramVec::new(
            HistogramOpts::new(
                "http_request_duration_seconds",
                "HTTP request duration in seconds",
            )
            .buckets(vec![
                0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0,
            ]),
            &["method", "route", "status"],
        )?;

        registry.register(Box::new(requests_total.clone()))?;
        registry.register(Box::new(request_duration_seconds.clone()))?;

        Ok(Self {
            requests_total,
            request_duration_seconds,
        })
    }
}

/// Axum middleware recording every request.
///
/// The `route` label comes from `MatchedPath`, which is axum's route *pattern*
/// (`/v1/klines/{pair_code}/{timeframe_code}`) rather than the resolved URI. A
/// label whose value contains an id gives Prometheus one time series per id,
/// which is the standard way to kill a Prometheus server. Requests that match
/// no route are labelled `unmatched` rather than by their raw path, for the
/// same reason — otherwise a scanner probing random URLs creates a series per
/// probe.
pub async fn track_http_metrics(
    State(metrics): State<HttpMetrics>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().as_str().to_owned();
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched| matched.as_str().to_owned())
        .unwrap_or_else(|| "unmatched".to_owned());

    // A span per request, which is what actually reaches Jaeger.
    //
    // `tracing-opentelemetry` exports spans, not events — so wiring the OTLP
    // exporter without creating any span exports nothing at all, silently. The
    // three Rust services had no `info_span!` or `#[instrument]` anywhere, so
    // this middleware is the whole of their tracing surface for now.
    //
    // The name follows the OTel HTTP convention (`GET /v1/pairs`) so it reads
    // the same as the Node services' spans in a trace list. Log lines written
    // inside this span pick up its `traceId`, which is what makes the "View
    // trace" link in Grafana work.
    let span = tracing::info_span!(
        "http_request",
        otel.name = %format!("{method} {route}"),
        otel.kind = "server",
        http.request.method = %method,
        http.route = %route,
        // Filled in once the response exists; declared here because a span's
        // field set is fixed at creation.
        http.response.status_code = tracing::field::Empty,
    );

    let started = Instant::now();
    let response = {
        use tracing::Instrument;
        next.run(request).instrument(span.clone()).await
    };
    let status_code = response.status().as_u16();
    span.record("http.response.status_code", status_code);

    let status = status_code.to_string();
    let labels = [method.as_str(), route.as_str(), status.as_str()];
    metrics.requests_total.with_label_values(&labels).inc();
    metrics
        .request_duration_seconds
        .with_label_values(&labels)
        .observe(started.elapsed().as_secs_f64());

    response
}
