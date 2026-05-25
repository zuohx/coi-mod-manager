//! COI Hub HTML parsing.
//!
//! Equivalent to Node.js `extractHubListings`, `extractDownloadUrlFromDetailHtml`,
//! `extractFileSizeFromDetailHtml`, `fetchModDetailInfo`.

use super::HubClient;
use scraper::{Html, Selector};

// ============================================================
// 常量
// ============================================================

pub const HUB_BASE: &str = "https://hub.coigame.com";
pub const HUB_MODS_LIST_URL: &str = "https://hub.coigame.com/Mods";
pub const DOWNLOAD_URL_PREFIX: &str = "https://hub.coigame.com/Mod/DownloadMod/";

pub const HUB_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

// ============================================================
// Hub 列表项
// ============================================================

#[derive(Debug, Clone)]
pub struct HubListing {
    pub title: String,
    pub version: Option<String>,
    pub url: String,
}

/// Mod detail info (from mod page HTML).
#[derive(Debug, Clone, Default)]
pub struct ModDetail {
    pub download_url: Option<String>,
    pub size_text: Option<String>,
    pub changelog: Vec<ChangelogEntry>,
}

/// A single changelog entry parsed from the Hub detail page.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChangelogEntry {
    pub version: String,
    pub date: String,
    pub content: String,
}

// ============================================================
// Hub 操作（统一使用 HubClient）
// ============================================================

/// Search the COI Hub for mods matching a query.
pub async fn search_hub(
    client: &HubClient,
    query: &str,
) -> Result<Vec<HubListing>, String> {
    let url = format!("{}/Mods/Search?query={}", HUB_BASE, urlencoding(query));
    let html = super::fetch_html(client, &url, HUB_MODS_LIST_URL).await?;
    Ok(extract_hub_listings(&html))
}

/// Fetch mod detail page and extract download URL + file size + changelog.
pub async fn fetch_mod_detail(
    client: &HubClient,
    mod_url: &str,
) -> Result<ModDetail, String> {
    if !mod_url.starts_with(&format!("{}/Mod/", HUB_BASE)) {
        return Ok(ModDetail::default());
    }
    let html = super::fetch_html(client, mod_url, HUB_MODS_LIST_URL).await?;
    Ok(ModDetail {
        download_url: extract_download_url(&html),
        size_text: extract_file_size(&html),
        changelog: extract_changelog(&html),
    })
}

/// Find the best Hub listing for a local mod.
pub async fn find_hub_listing(
    client: &HubClient,
    display_name: &str,
    mod_id: &str,
    install_dir_name: &str,
) -> Option<HubListing> {
    let queries = unique_by(
        &[
            display_name.to_string(),
            mod_id.to_string(),
            install_dir_name.to_string(),
        ],
        |s| normalize_name(s),
    );

    let target_names: Vec<String> = [display_name, mod_id, install_dir_name]
        .iter()
        .map(|s| normalize_name(s))
        .filter(|s| !s.is_empty())
        .collect();

    let find_exact = |listings: &[HubListing]| -> Option<HubListing> {
        listings
            .iter()
            .find(|l| {
                let n = normalize_name(&l.title);
                target_names.contains(&n)
            })
            .cloned()
    };

    let find_partial = |listings: &[HubListing]| -> Option<HubListing> {
        listings
            .iter()
            .find(|l| {
                let n = normalize_name(&l.title);
                target_names.iter().any(|t| n.contains(t) || t.contains(&n))
            })
            .cloned()
    };

    let first_result = search_hub(client, &queries[0]).await.unwrap_or_default();
    if let Some(exact) = find_exact(&first_result) {
        return Some(exact);
    }
    let mut best_partial = find_partial(&first_result);

    if queries.len() > 1 && best_partial.is_none() {
        for query in &queries[1..] {
            if let Ok(listings) = search_hub(client, query).await {
                if let Some(exact) = find_exact(&listings) {
                    return Some(exact);
                }
                if best_partial.is_none() {
                    best_partial = find_partial(&listings);
                }
            }
        }
    }

    if best_partial.is_none() {
        eprintln!(
            "[coi-mod-api] Hub 未找到匹配: \"{}\" (id={})",
            display_name, mod_id
        );
    }

    best_partial
}

// ============================================================
// HTML 解析
// ============================================================

pub fn extract_hub_listings(html: &str) -> Vec<HubListing> {
    let document = Html::parse_document(html);
    let mut listings: Vec<HubListing> = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();

    for anchor in document.select(&Selector::parse("a[href]").unwrap()) {
        let href = match anchor.value().attr("href") {
            Some(h) => h,
            None => continue,
        };
        if !href.starts_with("/Mod/") {
            continue;
        }
        let url = format!("{}{}", HUB_BASE, href);
        if !seen_urls.insert(url.clone()) {
            continue;
        }

        let raw = anchor.text().collect::<Vec<_>>().join(" ");
        let content = normalize_whitespace(&strip_tags(&decode_html_entities(&raw)));

        if let Some((title, version)) = parse_listing_text(&content) {
            if !title.is_empty() {
                listings.push(HubListing { title, version, url });
            }
        }
    }
    listings
}

fn parse_listing_text(text: &str) -> Option<(String, Option<String>)> {
    let re =
        regex_lite::Regex::new(r"(?i)^(.*?)\s+v([0-9][0-9A-Za-z.\-]*)\s+(?:by\b.*)?$").ok()?;
    let caps = re.captures(text)?;
    let title = caps.get(1)?.as_str().trim().to_string();
    let version = caps.get(2)?.as_str().trim().to_string();
    Some((title, Some(version)))
}

pub fn extract_download_url(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    for anchor in document.select(&Selector::parse("a[href]").unwrap()) {
        let href = anchor.value().attr("href")?;
        if href.starts_with("/Mod/DownloadMod/") {
            return Some(format!("{}{}", HUB_BASE, href));
        }
    }
    regex_lite::Regex::new(r"/Mod/DownloadMod/\d+")
        .ok()?
        .find(html)
        .map(|m| format!("{}{}", HUB_BASE, m.as_str()))
}

pub fn extract_file_size(html: &str) -> Option<String> {
    if let Some(idx) = html.to_lowercase().find("latest") {
        if let Some(size) = find_size_in_context(&html[idx..]) {
            return Some(size);
        }
    }
    find_size_in_context(html)
}

fn find_size_in_context(text: &str) -> Option<String> {
    regex_lite::Regex::new(
        r"(?i)file\s*size[\s\S]{0,240}?(\d+(?:\.\d+)?\s*(?:KB|MB|GB|B))",
    )
    .ok()?
    .captures(text)
    .and_then(|caps| caps.get(1))
    .map(|m| normalize_whitespace(m.as_str()))
}

/// Fetch changelog entries from a mod's Hub detail page.
pub async fn fetch_changelog(
    client: &HubClient,
    hub_url: &str,
) -> Result<Vec<ChangelogEntry>, String> {
    if !hub_url.starts_with(&format!("{}/Mod/", HUB_BASE)) {
        return Ok(Vec::new());
    }
    let html = super::fetch_html(client, hub_url, HUB_MODS_LIST_URL).await?;
    Ok(extract_changelog(&html))
}

/// Extract changelog entries from the #tab-changelog section of a Hub detail page.
pub fn extract_changelog(html: &str) -> Vec<ChangelogEntry> {
    let document = Html::parse_document(html);

    // Select the #tab-changelog container
    let tab_selector = match Selector::parse("#tab-changelog") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let tab_element = match document.select(&tab_selector).next() {
        Some(el) => el,
        None => return Vec::new(),
    };

    // Select each version card (.darkerGreyBg) within the tab
    let card_selector = match Selector::parse(".darkerGreyBg") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let h4_selector = Selector::parse("h4").unwrap();
    let pre_selector = Selector::parse("pre").unwrap();

    let title_re = regex_lite::Regex::new(r"(?i)^v?([0-9][0-9A-Za-z.\-]*)\s*\|\s*(\d{4}-\d{2}-\d{2})").unwrap();
    let title_line_re = regex_lite::Regex::new(r"(?i)^v?[0-9][0-9A-Za-z.\-]*\s*\|").unwrap();

    let mut entries = Vec::new();

    for card in tab_element.select(&card_selector) {
        // Extract version + date from <h4>
        let h4_text = card
            .select(&h4_selector)
            .next()
            .map(|el| el.text().collect::<String>())
            .unwrap_or_default();
        let h4_clean = normalize_whitespace(&h4_text);

        let (version, date) = if let Some(caps) = title_re.captures(&h4_clean) {
            (
                caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
                caps.get(2).map(|m| m.as_str().to_string()).unwrap_or_default(),
            )
        } else {
            (h4_clean.clone(), String::new())
        };

        if version.is_empty() {
            continue;
        }

        // Extract content from <pre>
        let pre_text = card
            .select(&pre_selector)
            .next()
            .map(|el| el.text().collect::<String>())
            .unwrap_or_default();

        // Filter out the duplicated title line and empty lines
        let content: String = pre_text
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                !trimmed.is_empty() && !title_line_re.is_match(trimmed)
            })
            .collect::<Vec<_>>()
            .join("\n");

        entries.push(ChangelogEntry {
            version,
            date,
            content: content.trim().to_string(),
        });
    }

    entries
}

// ============================================================
// 文本处理
// ============================================================

fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "+".to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

fn decode_html_entities(text: &str) -> String {
    text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn strip_tags(text: &str) -> String {
    regex_lite::Regex::new(r"<[^>]+>")
        .unwrap()
        .replace_all(text, " ")
        .to_string()
}

fn normalize_whitespace(text: &str) -> String {
    regex_lite::Regex::new(r"\s+")
        .unwrap()
        .replace_all(text, " ")
        .trim()
        .to_string()
}

pub fn normalize_name(value: &str) -> String {
    let lower = value.to_lowercase();
    let replaced = lower.replace("++", " plus plus ").replace('+', " plus ").replace('&', " and ");
    let re = regex_lite::Regex::new(r"[^a-z0-9]+").unwrap();
    normalize_whitespace(&re.replace_all(&replaced, " "))
}

fn unique_by<T: Clone>(items: &[T], key_fn: impl Fn(&T) -> String) -> Vec<T> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for item in items {
        let key = key_fn(item);
        if seen.insert(key) {
            result.push(item.clone());
        }
    }
    result
}

// ============================================================
// 测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_name() {
        let n = normalize_name("My Mod++ v2.0");
        assert!(n.contains("plus plus"));
        assert!(!n.contains("++"));
    }

    #[test]
    fn test_decode_html_entities() {
        assert_eq!(decode_html_entities("A&amp;B"), "A&B");
        assert_eq!(decode_html_entities("&nbsp;x"), " x");
    }

    #[test]
    fn test_strip_tags() {
        assert_eq!(strip_tags("<a>hello</a> world"), " hello  world");
    }

    #[test]
    fn test_normalize_whitespace() {
        assert_eq!(normalize_whitespace("  a   b  "), "a b");
    }

    #[test]
    fn test_urlencoding() {
        let encoded = urlencoding("hello world");
        assert!(encoded.contains("hello"));
        assert!(encoded.contains("world"));
    }

    #[test]
    fn test_parse_listing_text() {
        let (title, version) = parse_listing_text("My Great Mod v1.2.3 by Author").unwrap();
        assert_eq!(title, "My Great Mod");
        assert_eq!(version.unwrap(), "1.2.3");
    }

    #[test]
    fn test_extract_hub_listings_example() {
        let html = r#"
        <html><body>
        <a href="/Mod/42/Some-Mod">Some Mod v1.0.0 by Dev</a>
        <a href="/Mod/99/Other">Other Mod v2.3.1 by Someone</a>
        </body></html>
        "#;
        let listings = extract_hub_listings(html);
        assert_eq!(listings.len(), 2);
        assert_eq!(listings[0].title, "Some Mod");
        assert_eq!(listings[0].version.as_deref(), Some("1.0.0"));
    }

    #[test]
    fn test_extract_download_url() {
        let html = r#"<a href="/Mod/DownloadMod/42">Download</a>"#;
        assert_eq!(
            extract_download_url(html),
            Some("https://hub.coigame.com/Mod/DownloadMod/42".to_string())
        );
    }

    #[test]
    fn test_extract_changelog() {
        let html = r#"
        <div class="tab-pane" id="tab-changelog" role="tabpanel">
            <div class="darkerGreyBg p-3 rounded mb-3">
                <h4 class="mb-2">v0.4.3 | 2026-05-04</h4>
                <pre style="white-space:pre-wrap;">v0.4.3 | 2026-05-04
* Fixed a bug with the toolbar.
* Improved performance.</pre>
            </div>
            <div class="darkerGreyBg p-3 rounded mb-3">
                <h4 class="mb-2">v0.4.2 | 2026-04-20</h4>
                <pre style="white-space:pre-wrap;">v0.4.2 | 2026-04-20
* Added new feature X.</pre>
            </div>
        </div>
        "#;
        let entries = extract_changelog(html);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].version, "0.4.3");
        assert_eq!(entries[0].date, "2026-05-04");
        assert!(entries[0].content.contains("Fixed a bug"));
        assert!(entries[0].content.contains("Improved performance"));
        assert!(!entries[0].content.contains("0.4.3 |"));
        assert_eq!(entries[1].version, "0.4.2");
        assert_eq!(entries[1].date, "2026-04-20");
    }

    #[test]
    fn test_extract_changelog_empty() {
        let html = r#"<div id="tab-info">No changelog here</div>"#;
        let entries = extract_changelog(html);
        assert!(entries.is_empty());
    }
}
