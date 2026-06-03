//! COI Hub integration module.
//!
//! Cookie flow (matches Node.js server/mod-api.ts):
//!   1. Load from COI_HUB_COOKIE env / config/hub.json
//!   2. Attach Cookie header to each Hub request
//!   3. Parse Set-Cookie from responses, merge into jar
//!   4. Save back to config/hub.json for persistence
//!
//! Retry policy:
//!   - fetch_html retries on 5xx errors and network timeouts
//!   - Max 2 retries with 500ms / 1s backoff

pub mod cookies;
pub mod parser;

use cookies::CookieJar;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const PAGE_CACHE_TTL: Duration = Duration::from_secs(300);
const PAGE_CACHE_MAX_ENTRIES: usize = 100;

/// Timeout for Hub HTTP requests.
const HUB_REQUEST_TIMEOUT_SECS: u64 = 30;

/// Retry delays (ms) for fetch_html on 5xx / timeout.
const HUB_RETRY_DELAYS_MS: &[u64] = &[500, 1000];
const HUB_MAX_RETRIES: usize = HUB_RETRY_DELAYS_MS.len();

fn page_cache() -> &'static Mutex<HashMap<String, (String, Instant)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (String, Instant)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The Hub client — wraps reqwest + cookie jar.
pub struct HubClient {
    pub http: reqwest::Client,
    pub cookies: Arc<CookieJar>,
}

impl HubClient {
    /// Create a new Hub client. Loads cookies from env/config on init.
    pub fn new() -> Self {
        let cookies = Arc::new(CookieJar::new());
        cookies.load_from_config();

        let http = reqwest::Client::builder()
            .user_agent(parser::HUB_USER_AGENT)
            .default_headers({
                let mut headers = reqwest::header::HeaderMap::new();
                headers.insert(
                    reqwest::header::ACCEPT,
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                        .parse()
                        .unwrap(),
                );
                headers.insert(
                    reqwest::header::ACCEPT_LANGUAGE,
                    "zh-CN,zh;q=0.9,en;q=0.8".parse().unwrap(),
                );
                headers
            })
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("Failed to build Hub HTTP client");

        Self { http, cookies }
    }
}

/// Remove a URL from the page cache so the next fetch gets fresh HTML.
pub fn clear_page_cache(url: &str) {
    let mut cache = page_cache().lock().unwrap();
    cache.remove(url);
}

/// Fetch HTML from a Hub URL, managing cookies on the request and response.
/// Retries on 5xx errors and network timeouts.
pub async fn fetch_html(
    client: &HubClient,
    url: &str,
    referer: &str,
) -> Result<String, String> {
    let url_owned = url.to_string();

    // Check page cache
    {
        let cache = page_cache().lock().unwrap();
        if let Some((html, timestamp)) = cache.get(&url_owned) {
            if timestamp.elapsed() < PAGE_CACHE_TTL {
                return Ok(html.clone());
            }
        }
    }

    let timeout = Duration::from_secs(HUB_REQUEST_TIMEOUT_SECS);
    let mut last_error = String::new();

    for attempt in 0..=HUB_MAX_RETRIES {
        if attempt > 0 {
            let delay_ms = HUB_RETRY_DELAYS_MS[attempt - 1];
            eprintln!(
                "[coi-mod-manager] hub fetch retry {}/{} after {}ms: {}",
                attempt, HUB_MAX_RETRIES, delay_ms, url_owned
            );
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        }

        let mut req = client
            .http
            .get(&url_owned)
            .header("Referer", referer)
            .timeout(timeout);

        // Attach stored cookies
        if let Some(cookie_str) = client.cookies.get_cookie_header() {
            req = req.header("Cookie", cookie_str);
        }

        let result = req.send().await;

        match result {
            Ok(response) => {
                // Extract and store Set-Cookie headers
                client.cookies.apply_set_cookies(response.headers());

                if response.status().is_success() {
                    let html = response
                        .text()
                        .await
                        .map_err(|e| format!("Failed to read response: {}", e))?;

                    // Store in page cache (with LRU eviction)
                    {
                        let mut cache = page_cache().lock().unwrap();
                        if cache.len() >= PAGE_CACHE_MAX_ENTRIES {
                            let oldest_key = cache.iter().min_by_key(|(_, (_, t))| *t).map(|(k, _)| k.clone());
                            if let Some(key) = oldest_key {
                                cache.remove(&key);
                            }
                        }
                        cache.insert(url_owned, (html.clone(), Instant::now()));
                    }

                    return Ok(html);
                }

                let status = response.status();
                last_error = format!("Hub request failed: {}", status);

                // Only retry on 5xx server errors
                if !status.is_server_error() {
                    return Err(last_error);
                }
            }
            Err(e) => {
                last_error = format!("Hub HTTP error: {}", e);
                // Retry on network/timeout errors
            }
        }
    }

    Err(format!(
        "Hub fetch failed after {} retries: {}",
        HUB_MAX_RETRIES, last_error
    ))
}
