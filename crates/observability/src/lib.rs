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

pub fn current_release() -> Option<String> {
    ["OTEL_SERVICE_VERSION", "APP_RELEASE"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .map(|value| value.trim().to_owned())
        .find(|value| !value.is_empty())
}

pub fn register_build_info(registry: &Registry) -> anyhow::Result<()> {
    register_build_info_for(
        registry,
        &current_release().unwrap_or_else(|| "dev".to_owned()),
    )
}

fn register_build_info_for(registry: &Registry, version: &str) -> anyhow::Result<()> {
    let build_info = IntGaugeVec::new(
        Opts::new(
            "service_build_info",
            "The release this process runs, as a label",
        ),
        &["version"],
    )?;
    registry.register(Box::new(build_info.clone()))?;
    build_info.with_label_values(&[version]).set(1);
    Ok(())
}

use axum::{
    extract::{MatchedPath, Request, State},
    middleware::Next,
    response::Response,
};
use prometheus::{
    HistogramOpts, HistogramVec, IntCounterVec, IntGauge, IntGaugeVec, Opts, Registry,
};
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

#[derive(Clone)]
pub struct HealthMetrics {
    status: IntGauge,
    component_up: IntGaugeVec,
}

impl HealthMetrics {
    pub fn register(registry: &Registry) -> anyhow::Result<Self> {
        let status = IntGauge::new(
            "service_health_status",
            "Overall service health: 2 = ok, 1 = degraded, 0 = error",
        )?;
        let component_up = IntGaugeVec::new(
            Opts::new(
                "service_component_up",
                "Whether a dependency the service reports on is up (1) or down (0)",
            ),
            &["component"],
        )?;

        registry.register(Box::new(status.clone()))?;
        registry.register(Box::new(component_up.clone()))?;

        Ok(Self {
            status,
            component_up,
        })
    }

    pub fn record(&self, payload: &serde_json::Value) {
        let status = match payload.get("status").and_then(serde_json::Value::as_str) {
            Some("ok") => 2,
            Some("degraded") => 1,
            _ => 0,
        };
        self.status.set(status);

        let Some(components) = payload
            .get("components")
            .and_then(serde_json::Value::as_object)
        else {
            return;
        };
        for (name, component) in components {
            let up = match component.get("status").and_then(serde_json::Value::as_str) {
                Some("up") => 1,
                Some("down") => 0,
                _ => continue,
            };
            self.component_up
                .with_label_values(&[name.as_str()])
                .set(up);
        }
    }
}

fn is_probe(route: &str) -> bool {
    matches!(route, "/health" | "/metrics")
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

    // A span per request except the probes, which is what actually reaches Jaeger.
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
    let span = (!is_probe(&route)).then(|| {
        tracing::info_span!(
            "http_request",
            otel.name = %format!("{method} {route}"),
            otel.kind = "server",
            http.request.method = %method,
            http.route = %route,
            // Filled in once the response exists; declared here because a span's
            // field set is fixed at creation.
            http.response.status_code = tracing::field::Empty,
        )
    });

    let started = Instant::now();
    let response = match &span {
        Some(span) => {
            use tracing::Instrument;
            next.run(request).instrument(span.clone()).await
        }
        None => next.run(request).await,
    };
    let status_code = response.status().as_u16();
    if let Some(span) = &span {
        span.record("http.response.status_code", status_code);
        if status_code >= 500 {
            tracing::error!(
                parent: span,
                event = "request.failed",
                method = %method,
                route = %route,
                status = status_code,
            );
        }
    }

    let status = status_code.to_string();
    let labels = [method.as_str(), route.as_str(), status.as_str()];
    metrics.requests_total.with_label_values(&labels).inc();
    metrics
        .request_duration_seconds
        .with_label_values(&labels)
        .observe(started.elapsed().as_secs_f64());

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use prometheus::{Encoder, TextEncoder};

    #[test]
    fn build_info_names_the_release_as_a_label() {
        let registry = Registry::new();
        register_build_info_for(&registry, "v0.2.0").unwrap();

        let mut buffer = Vec::new();
        TextEncoder::new()
            .encode(&registry.gather(), &mut buffer)
            .unwrap();
        let text = String::from_utf8(buffer).unwrap();

        assert!(text.contains("service_build_info{version=\"v0.2.0\"} 1"));
    }

    fn encoded(registry: &Registry) -> String {
        let mut buffer = Vec::new();
        TextEncoder::new()
            .encode(&registry.gather(), &mut buffer)
            .unwrap();
        String::from_utf8(buffer).unwrap()
    }

    #[test]
    fn health_is_recorded_from_the_payload_the_health_route_answers() {
        let registry = Registry::new();
        let health = HealthMetrics::register(&registry).unwrap();

        health.record(&serde_json::json!({
            "status": "error",
            "components": {
                "controlPlane": { "status": "up" },
                "exchange": { "status": "down" },
                "marketData": { "status": "idle" }
            }
        }));

        let text = encoded(&registry);
        assert!(text.contains("service_health_status 0"));
        assert!(text.contains("service_component_up{component=\"controlPlane\"} 1"));
        assert!(text.contains("service_component_up{component=\"exchange\"} 0"));
        assert!(!text.contains("component=\"marketData\""));

        health.record(&serde_json::json!({ "status": "ok", "components": {} }));
        assert!(encoded(&registry).contains("service_health_status 2"));
    }

    #[test]
    fn probes_are_counted_but_never_traced() {
        assert!(is_probe("/health"));
        assert!(is_probe("/metrics"));
        assert!(!is_probe("/v1/klines/{pair_code}/{timeframe_code}"));
        assert!(!is_probe("unmatched"));
    }
}
