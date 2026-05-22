//! COI Hub cookie management.
//!
//! Equivalent to Node.js `ensureHubCookies`, `loadHubCookiesFromConfig`,
//! `applySetCookies`, `getHubCookieHeader`, etc.

use reqwest::header::{HeaderMap, SET_COOKIE};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// Thread-safe cookie jar shared across the Hub client.
pub struct CookieJar {
    inner: Mutex<HashMap<String, String>>,
    config_path: PathBuf,
}

impl CookieJar {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            config_path: default_config_path(),
        }
    }

    /// Load cookies from config/hub.json (format: { "cookie": "name1=val1; name2=val2" })
    /// or from the COI_HUB_COOKIE environment variable.
    pub fn load_from_config(&self) -> bool {
        // Try env var first
        if let Ok(env) = std::env::var("COI_HUB_COOKIE") {
            let trimmed = env.trim().to_string();
            if !trimmed.is_empty() {
                self.apply_from_string(&trimmed);
                return true;
            }
        }

        // Try config file
        match std::fs::read_to_string(&self.config_path) {
            Ok(text) => {
                #[derive(Deserialize)]
                struct HubConfig {
                    cookie: Option<String>,
                }
                if let Ok(config) = serde_json::from_str::<HubConfig>(&text) {
                    if let Some(cookie) = config.cookie {
                        let trimmed = cookie.trim().to_string();
                        if !trimmed.is_empty() {
                            self.apply_from_string(&trimmed);
                            return true;
                        }
                    }
                }
                false
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => false,
        }
    }

    /// Parse Set-Cookie headers from a response and store them.
    #[allow(dead_code)]
    pub fn apply_set_cookies(&self, headers: &HeaderMap) {
        let cookies: Vec<String> = headers
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .collect();

        let mut jar = self.inner.lock().unwrap();
        for entry in &cookies {
            let pair = entry.split(';').next().unwrap_or("").trim();
            if let Some(idx) = pair.find('=') {
                if idx > 0 {
                    let name = &pair[..idx];
                    let value = &pair[idx + 1..];
                    jar.insert(name.to_string(), value.to_string());
                }
            }
        }
    }

    /// Parse a raw cookie header string into the jar.
    pub fn apply_from_string(&self, cookie_header: &str) {
        let mut jar = self.inner.lock().unwrap();
        for part in cookie_header.split(';') {
            let trimmed = part.trim();
            if let Some(idx) = trimmed.find('=') {
                if idx > 0 {
                    jar.insert(
                        trimmed[..idx].to_string(),
                        trimmed[idx + 1..].to_string(),
                    );
                }
            }
        }
    }

    /// Build a Cookie header value from stored cookies.
    pub fn get_cookie_header(&self) -> Option<String> {
        let jar = self.inner.lock().unwrap();
        if jar.is_empty() {
            return None;
        }
        let header: Vec<String> = jar.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
        Some(header.join("; "))
    }

    /// Remove all cookies.
    #[allow(dead_code)]
    pub fn clear(&self) {
        self.inner.lock().unwrap().clear();
    }

    /// Check if the jar has any cookies.
    #[allow(dead_code)]
    pub fn has_cookies(&self) -> bool {
        !self.inner.lock().unwrap().is_empty()
    }

    /// Persist cookies to config/hub.json.
    #[allow(dead_code)]
    pub fn save_to_config(&self) {
        if let Some(cookie_str) = self.get_cookie_header() {
            let dir = self.config_path.parent().unwrap();
            let _ = std::fs::create_dir_all(dir);
            let json = serde_json::json!({ "cookie": cookie_str });
            let _ = std::fs::write(&self.config_path, json.to_string());
        }
    }
}

fn default_config_path() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("config")
        .join("hub.json")
}

// ============================================================
// 测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_from_string() {
        let jar = CookieJar::new();
        jar.apply_from_string("session=abc123; token=xyz");
        let header = jar.get_cookie_header().unwrap();
        assert!(header.contains("session=abc123"));
        assert!(header.contains("token=xyz"));
    }

    #[test]
    fn test_empty_jar() {
        let jar = CookieJar::new();
        assert!(!jar.has_cookies());
        assert!(jar.get_cookie_header().is_none());
    }

    #[test]
    fn test_clear() {
        let jar = CookieJar::new();
        jar.apply_from_string("a=1; b=2");
        assert!(jar.has_cookies());
        jar.clear();
        assert!(!jar.has_cookies());
    }
}
