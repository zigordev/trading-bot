use anyhow::{Context, Result, bail};
use hmac::{Hmac, Mac};
use reqwest::{Client, Method, header::HeaderMap};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::Duration;

use crate::config::AppConfig;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
pub struct BinancePrivateClient {
    client: Client,
    api_key: String,
    api_secret: String,
    rest_base_url: String,
    ws_base_url: String,
    recv_window: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinanceOrderResponse {
    pub symbol: Option<String>,
    pub order_id: Option<i64>,
    pub client_order_id: Option<String>,
    pub transact_time: Option<i64>,
    pub status: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinanceOpenOrder {
    pub symbol: Option<String>,
    pub order_id: Option<i64>,
    pub client_order_id: Option<String>,
    pub status: Option<String>,
    pub side: Option<String>,
    pub price: Option<String>,
    pub orig_qty: Option<String>,
    pub executed_qty: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinanceBalance {
    pub asset: String,
    pub free: String,
    pub locked: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinanceAccountInformation {
    pub balances: Vec<BinanceBalance>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinanceListenKeyResponse {
    pub listen_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinanceExecutionReportEvent {
    #[serde(rename = "e")]
    pub event_type: String,
    #[serde(rename = "E")]
    pub event_time: i64,
    #[serde(rename = "s")]
    pub symbol: String,
    #[serde(rename = "c")]
    pub client_order_id: String,
    #[serde(rename = "S")]
    pub side: String,
    #[serde(rename = "o")]
    pub order_type: String,
    #[serde(rename = "x")]
    pub execution_type: String,
    #[serde(rename = "X")]
    pub order_status: String,
    #[serde(rename = "i")]
    pub order_id: i64,
    #[serde(rename = "l")]
    pub last_executed_quantity: String,
    #[serde(rename = "L")]
    pub last_executed_price: String,
    #[serde(rename = "z")]
    pub cumulative_filled_quantity: String,
}

impl BinancePrivateClient {
    pub fn from_config(config: &AppConfig) -> Option<Result<Self>> {
        let api_key = config.binance_api_key.clone()?;
        let api_secret = config.binance_api_secret.clone()?;
        Some(Self::new(
            api_key,
            api_secret,
            config.binance_rest_base_url.clone(),
            config.binance_ws_base_url.clone(),
            config.binance_recv_window,
            config.control_plane_request_timeout_ms,
        ))
    }

    pub fn new(
        api_key: String,
        api_secret: String,
        rest_base_url: String,
        ws_base_url: String,
        recv_window: u64,
        timeout_ms: u64,
    ) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .build()
            .context("failed to build Binance private HTTP client")?;
        Ok(Self {
            client,
            api_key,
            api_secret,
            rest_base_url,
            ws_base_url,
            recv_window,
        })
    }

    pub fn ws_listen_key_url(&self, listen_key: &str) -> String {
        format!(
            "{}/ws/{}",
            self.ws_base_url.trim_end_matches('/'),
            listen_key
        )
    }

    pub async fn create_listen_key(&self) -> Result<String> {
        let response: BinanceListenKeyResponse = self
            .client
            .post(format!(
                "{}/api/v3/userDataStream",
                self.rest_base_url.trim_end_matches('/')
            ))
            .header("X-MBX-APIKEY", &self.api_key)
            .send()
            .await
            .context("failed to request Binance listen key")?
            .error_for_status()
            .context("Binance listen-key request failed")?
            .json()
            .await
            .context("failed to decode Binance listen-key response")?;
        Ok(response.listen_key)
    }

    pub async fn keepalive_listen_key(&self, listen_key: &str) -> Result<()> {
        self.client
            .put(format!(
                "{}/api/v3/userDataStream",
                self.rest_base_url.trim_end_matches('/')
            ))
            .header("X-MBX-APIKEY", &self.api_key)
            .query(&[("listenKey", listen_key)])
            .send()
            .await
            .context("failed to keep alive Binance listen key")?
            .error_for_status()
            .context("Binance listen-key keepalive failed")?;
        Ok(())
    }

    pub async fn get_account_information(&self) -> Result<BinanceAccountInformation> {
        self.signed_request(Method::GET, "/api/v3/account", &[])
            .await
    }

    pub async fn get_open_orders(&self) -> Result<Vec<BinanceOpenOrder>> {
        self.signed_request(Method::GET, "/api/v3/openOrders", &[])
            .await
    }

    pub async fn get_order(&self, symbol: &str, order_id: i64) -> Result<BinanceOrderResponse> {
        self.signed_request(
            Method::GET,
            "/api/v3/order",
            &[
                ("symbol", symbol.to_string()),
                ("orderId", order_id.to_string()),
            ],
        )
        .await
    }

    pub async fn place_market_order(
        &self,
        symbol: &str,
        side: &str,
        quantity: f64,
    ) -> Result<BinanceOrderResponse> {
        self.signed_request(
            Method::POST,
            "/api/v3/order",
            &[
                ("symbol", symbol.to_string()),
                ("side", side.to_string()),
                ("type", "MARKET".to_string()),
                ("quantity", quantity.to_string()),
            ],
        )
        .await
    }

    pub async fn cancel_order(&self, symbol: &str, order_id: i64) -> Result<BinanceOrderResponse> {
        self.signed_request(
            Method::DELETE,
            "/api/v3/order",
            &[
                ("symbol", symbol.to_string()),
                ("orderId", order_id.to_string()),
            ],
        )
        .await
    }

    async fn signed_request<T>(
        &self,
        method: Method,
        path: &str,
        params: &[(&str, String)],
    ) -> Result<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        let mut all_params = params.to_vec();
        all_params.push(("recvWindow", self.recv_window.to_string()));
        all_params.push((
            "timestamp",
            chrono::Utc::now().timestamp_millis().to_string(),
        ));
        let query = all_params
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join("&");

        let mut mac = HmacSha256::new_from_slice(self.api_secret.as_bytes())
            .context("failed to initialize Binance request signer")?;
        mac.update(query.as_bytes());
        let signature = hex::encode(mac.finalize().into_bytes());
        let signed_query = format!("{query}&signature={signature}");

        let response = self
            .client
            .request(
                method,
                format!(
                    "{}{}?{}",
                    self.rest_base_url.trim_end_matches('/'),
                    path,
                    signed_query
                ),
            )
            .header("X-MBX-APIKEY", &self.api_key)
            .send()
            .await
            .with_context(|| format!("failed Binance private request to {path}"))?;

        response
            .error_for_status()
            .with_context(|| format!("Binance private request returned error for {path}"))?
            .json::<T>()
            .await
            .with_context(|| format!("failed to decode Binance response for {path}"))
    }
}

pub fn ensure_no_open_orders(open_orders: &[BinanceOpenOrder]) -> Result<()> {
    if open_orders.is_empty() {
        return Ok(());
    }

    bail!("live startup reconciliation failed because Binance still has open orders")
}

pub fn has_any_free_balance(account: &BinanceAccountInformation) -> bool {
    account.balances.iter().any(|balance| {
        balance
            .free
            .parse::<f64>()
            .ok()
            .map(|value| value > 0.0)
            .unwrap_or(false)
    })
}

pub fn api_key_header(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("X-MBX-APIKEY")
        .and_then(|value| value.to_str().ok())
}
