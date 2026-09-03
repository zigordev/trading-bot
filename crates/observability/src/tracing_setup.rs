//! Logs and traces for the Rust services.
//!
//! Before this existed the three Rust services read `OTEL_EXPORTER_OTLP_ENDPOINT`
//! for the sole purpose of reporting `otel_exporter_configured: true` in their
//! status payload — a flag asserting telemetry was wired when no OpenTelemetry
//! crate was present and nothing was ever exported. Jaeger knew about two
//! services in the whole estate.
//!
//! Configuration matches the TypeScript kit exactly, because a variable that
//! means different things in different languages is worse than no variable:
//!
//! | variable                      | meaning                              |
//! | ----------------------------- | ------------------------------------ |
//! | `OTEL_SERVICE_NAME`           | names the service everywhere         |
//! | `OTEL_EXPORTER_OTLP_ENDPOINT` | **base** URL; `/v1/traces` appended  |
//! | `OTEL_TRACES_ENABLED`         | `false` disables tracing entirely    |

use std::fmt;

use opentelemetry::{KeyValue, trace::TracerProvider as _};
use opentelemetry_otlp::{Protocol, WithExportConfig};
use opentelemetry_sdk::{Resource, trace::SdkTracerProvider};
use opentelemetry_semantic_conventions::resource::SERVICE_NAME;
use tracing::{Event, Subscriber};
use tracing_subscriber::{
    EnvFilter,
    fmt::{FmtContext, FormatEvent, FormatFields, format::Writer},
    layer::SubscriberExt,
    registry::LookupSpan,
    util::SubscriberInitExt,
};

/// Returned so the caller can flush spans on shutdown. Dropping it without
/// calling `shutdown` loses whatever is still buffered — usually the spans from
/// the moments you most want to look at.
pub struct TelemetryGuard {
    provider: Option<SdkTracerProvider>,
}

impl TelemetryGuard {
    pub fn shutdown(&mut self) {
        if let Some(provider) = self.provider.take()
            && let Err(error) = provider.shutdown()
        {
            eprintln!("failed to flush traces on shutdown: {error}");
        }
    }
}

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Installs the log formatter and, unless disabled, the OTLP trace exporter.
///
/// `default_filter` is the `EnvFilter` directive to use when `RUST_LOG` is
/// unset — market-data quiets `rdkafka`, the others do not.
pub fn init(default_filter: &str) -> TelemetryGuard {
    let service_name = std::env::var("OTEL_SERVICE_NAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "unknown-service".to_owned());

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_filter));

    let format_layer = tracing_subscriber::fmt::layer()
        .event_format(EstateJson {
            service: service_name.clone(),
        })
        .with_writer(std::io::stdout);

    let provider = build_tracer_provider(&service_name);

    match provider {
        Some(provider) => {
            let tracer = provider.tracer("trading-bot");
            tracing_subscriber::registry()
                .with(filter)
                .with(format_layer)
                .with(tracing_opentelemetry::layer().with_tracer(tracer))
                .init();
            TelemetryGuard {
                provider: Some(provider),
            }
        }
        None => {
            tracing_subscriber::registry()
                .with(filter)
                .with(format_layer)
                .init();
            TelemetryGuard { provider: None }
        }
    }
}

fn build_tracer_provider(service_name: &str) -> Option<SdkTracerProvider> {
    let enabled = std::env::var("OTEL_TRACES_ENABLED")
        .map(|value| !value.trim().eq_ignore_ascii_case("false"))
        .unwrap_or(true);
    if !enabled {
        return None;
    }

    // The OTel spec defines this as the BASE endpoint, with each signal
    // appending its own path. The TypeScript kit does the same; notifications
    // used to treat it as a full traces URL, which is why the same variable
    // name once needed different values in different compose files.
    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "http://otel-collector:4318".to_owned());

    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(format!("{endpoint}/v1/traces"))
        .build();

    match exporter {
        Ok(exporter) => Some(
            SdkTracerProvider::builder()
                .with_batch_exporter(exporter)
                .with_resource(
                    Resource::builder()
                        .with_attributes([KeyValue::new(SERVICE_NAME, service_name.to_owned())])
                        .build(),
                )
                .build(),
        ),
        Err(error) => {
            // A collector that is not there must not stop the service booting.
            eprintln!("tracing disabled: could not build the OTLP exporter: {error}");
            None
        }
    }
}

/// One JSON object per line, in the estate's shape.
///
/// `tracing_subscriber`'s own `.json()` writes `{"fields":{"message":...},
/// "target":...}` with no `service` and no trace id, which is a third log
/// format in an estate that already agreed on one. Alloy promotes the `service`
/// field to Loki's `app` label and Grafana's derived field turns `traceId` into
/// a link to the trace, so both have to be present and spelled exactly this way.
struct EstateJson {
    service: String,
}

impl<S, N> FormatEvent<S, N> for EstateJson
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        _ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        let metadata = event.metadata();

        let mut visitor = FieldCollector::default();
        event.record(&mut visitor);

        let mut record = serde_json::Map::new();
        record.insert("timestamp".into(), serde_json::Value::String(iso8601_now()));
        record.insert(
            "level".into(),
            serde_json::Value::String(metadata.level().as_str().to_ascii_lowercase()),
        );
        record.insert(
            "service".into(),
            serde_json::Value::String(self.service.clone()),
        );
        record.insert("message".into(), serde_json::Value::String(visitor.message));
        record.insert(
            "context".into(),
            serde_json::Value::String(metadata.target().to_owned()),
        );

        // The ids that link this line to its trace. Taken from the OTel context
        // that `tracing-opentelemetry` attaches, so they are the same ids the
        // collector exports rather than tracing's own internal span ids.
        //
        // `is_valid()` is the guard that matters: outside any span — bootstrap
        // logs, background tasks — the context carries the all-zero invalid id,
        // and writing that would give every such line the same fake trace.
        {
            use opentelemetry::trace::TraceContextExt;
            use tracing_opentelemetry::OpenTelemetrySpanExt;

            let otel_context = tracing::Span::current().context();
            let span = otel_context.span();
            let span_context = span.span_context();
            if span_context.is_valid() {
                record.insert(
                    "traceId".into(),
                    serde_json::Value::String(span_context.trace_id().to_string()),
                );
                record.insert(
                    "spanId".into(),
                    serde_json::Value::String(span_context.span_id().to_string()),
                );
            }
        }

        for (key, value) in visitor.fields {
            record.entry(key).or_insert(value);
        }

        writeln!(writer, "{}", serde_json::Value::Object(record))
    }
}

/// Pulls `message` out of an event's fields, keeping the rest as structured
/// data rather than flattening everything into a string.
#[derive(Default)]
struct FieldCollector {
    message: String,
    fields: Vec<(String, serde_json::Value)>,
}

impl FieldCollector {
    fn push(&mut self, field: &tracing::field::Field, value: serde_json::Value) {
        if field.name() == "message" {
            self.message = match value {
                serde_json::Value::String(text) => text,
                other => other.to_string(),
            };
        } else {
            self.fields.push((field.name().to_owned(), value));
        }
    }
}

impl tracing::field::Visit for FieldCollector {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.push(field, serde_json::Value::String(value.to_owned()));
    }

    fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
        self.push(field, serde_json::Value::Bool(value));
    }

    fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
        self.push(field, serde_json::Value::Number(value.into()));
    }

    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        self.push(field, serde_json::Value::Number(value.into()));
    }

    fn record_f64(&mut self, field: &tracing::field::Field, value: f64) {
        match serde_json::Number::from_f64(value) {
            Some(number) => self.push(field, serde_json::Value::Number(number)),
            None => self.push(field, serde_json::Value::String(value.to_string())),
        }
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn fmt::Debug) {
        self.push(field, serde_json::Value::String(format!("{value:?}")));
    }
}

/// RFC 3339 in UTC, to the millisecond — the same format the Node services
/// emit, so one Loki query can parse every line in the estate.
fn iso8601_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as i64;
    let millis = now.subsec_millis();

    let days = secs.div_euclid(86_400);
    let time_of_day = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);

    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        time_of_day / 3600,
        (time_of_day % 3600) / 60,
        time_of_day % 60,
    )
}

/// Howard Hinnant's `civil_from_days`, so the crate does not pull in `chrono`
/// purely to format a timestamp.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_a_known_instant() {
        // 2026-09-03 is day 20699 of the Unix epoch.
        assert_eq!(civil_from_days(20_699), (2026, 9, 3));
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // A leap day, which is where naive date maths goes wrong.
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
    }

    #[test]
    fn timestamp_has_the_shape_the_estate_expects() {
        let stamp = iso8601_now();
        assert_eq!(stamp.len(), 24, "{stamp}");
        assert!(stamp.ends_with('Z'), "{stamp}");
        assert_eq!(&stamp[4..5], "-");
        assert_eq!(&stamp[10..11], "T");
    }
}
