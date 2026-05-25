//! COI Hub integration module.
//!
//! Cookie flow (matches Node.js server/mod-api.ts):
//!   1. Load from COI_HUB_COOKIE env / config/hub.json
//!   2. Attach Cookie header to each Hub request
//!   3. Parse Set-Cookie from responses, merge into jar
//!   4. Save back to config/hub.json for persistence

pub mod cookies;
pub mod parser;

use cookies::CookieJar;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const PAGE_CACHE_TTL: Duration = Duration::from_secs(300);
const PAGE_CACHE_MAX_ENTRIES: usize = 100;

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

    let mut req = client
        .http
        .get(&url_owned)
        .header("Referer", referer);

    // Attach stored cookies
    if let Some(cookie_str) = client.cookies.get_cookie_header() {
        req = req.header("Cookie", cookie_str);
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("Hub HTTP error: {}", e))?;

    // Extract and store Set-Cookie headers
    client.cookies.apply_set_cookies(response.headers());

    if !response.status().is_success() {
        return Err(format!("Hub request failed: {}", response.status()));
    }

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

    Ok(html)
}
