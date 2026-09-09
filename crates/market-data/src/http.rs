use anyhow::{Context, Result, bail};
use url::Url;

pub fn parse_base_url(base_url: &str) -> Result<Url> {
    let mut parsed =
        Url::parse(base_url).with_context(|| format!("invalid base URL: {base_url}"))?;

    if !matches!(parsed.scheme(), "http" | "https") {
        bail!("invalid base URL, expected an http or https scheme: {base_url}");
    }

    if !parsed.path().ends_with('/') {
        let path = format!("{}/", parsed.path());
        parsed.set_path(&path);
    }

    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::parse_base_url;

    #[test]
    fn appends_a_trailing_slash_so_joins_extend_the_base() {
        let base = parse_base_url("http://trading-bot-historical-store:8123").unwrap();
        assert_eq!(base.as_str(), "http://trading-bot-historical-store:8123/");
        assert_eq!(
            base.join("ping").unwrap().as_str(),
            "http://trading-bot-historical-store:8123/ping"
        );
    }

    #[test]
    fn keeps_a_base_path_instead_of_replacing_its_last_segment() {
        let base = parse_base_url("http://trading-bot-api:8080/api").unwrap();
        assert_eq!(
            base.join("v1/risk-profiles").unwrap().as_str(),
            "http://trading-bot-api:8080/api/v1/risk-profiles"
        );
    }

    #[test]
    fn produces_the_same_urls_the_format_calls_produced() {
        let binance = parse_base_url("https://api.binance.com").unwrap();
        assert_eq!(
            binance.join("api/v3/klines").unwrap().as_str(),
            "https://api.binance.com/api/v3/klines"
        );

        let control_plane = parse_base_url("http://trading-bot-api:8080").unwrap();
        assert_eq!(
            control_plane.join("health").unwrap().as_str(),
            "http://trading-bot-api:8080/health"
        );
    }

    #[test]
    fn rejects_a_host_and_port_with_no_scheme() {
        // Url::parse accepts this, reading "trading-bot-api" as the scheme and
        // producing a URL that cannot be a base, so join fails on every later
        // request instead of at startup.
        let error = parse_base_url("trading-bot-api:8080").unwrap_err();
        assert!(
            error
                .to_string()
                .contains("expected an http or https scheme")
        );
    }

    #[test]
    fn rejects_a_value_that_is_not_a_url() {
        let error = parse_base_url("not a url").unwrap_err();
        assert!(error.to_string().contains("invalid base URL"));
    }
}
