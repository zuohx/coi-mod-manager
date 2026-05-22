//! Mod scanning commands — local file system operations.
//!
//! Implements the equivalent of server/mod-api.ts `collectLocalMods`,
//! `handleLocalScan`, and `handleCheckMod` in native Rust.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use super::hub::HubClient;
use super::hub::parser;

// ============================================================
// 数据模型（J — 与 TypeScript 共享类型保持同步）
// ============================================================

/// Mirror of `ModRecord` in `src/shared/types/api.ts`.
/// Field names use camelCase + serde rename for JSON compatibility.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModRecord {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub version: String,
    #[serde(rename = "sizeText")]
    pub size_text: String,
    #[serde(rename = "sizeLoading", skip_serializing_if = "Option::is_none")]
    pub size_loading: Option<bool>,
    #[serde(rename = "remoteVersion", skip_serializing_if = "Option::is_none")]
    pub remote_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(rename = "downloadUrl", skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
    pub status: String,
    #[serde(rename = "manifestPath")]
    pub manifest_path: String,
    #[serde(rename = "installDir")]
    pub install_dir: String,
    #[serde(rename = "checkingStatus", skip_serializing_if = "Option::is_none")]
    pub checking_status: Option<String>,
}

/// Mirror of `ScanModsResponse` in `src/shared/types/api.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanModsResponse {
    #[serde(rename = "dirPath")]
    pub dir_path: String,
    pub mods: Vec<ModRecord>,
}

/// Internal representation of a parsed manifest (subset of fields we care about).
#[derive(Debug, Deserialize)]
struct ManifestJson {
    id: Option<String>,
    version: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "display_name")]
    display_name_alt: Option<String>,
    #[serde(rename = "hubUrl")]
    hub_url: Option<String>,
    #[serde(rename = "_hubUrl")]
    hub_url_alt: Option<String>,
    #[serde(rename = "hubVersion")]
    hub_version: Option<String>,
    #[serde(rename = "_hubVersion")]
    hub_version_alt: Option<String>,
}

// ============================================================
// 辅助函数
// ============================================================

/// Get the default COI Mods directory (same as Node.js getDefaultModsDir).
pub fn default_mods_dir() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| {
        let home = dirs_fallback();
        format!("{}\\AppData\\Roaming", home)
    });
    PathBuf::from(appdata).join("Captain of Industry").join("Mods")
}

/// Fallback for home directory when APPDATA isn't available.
fn dirs_fallback() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| String::from("."))
}

/// Find manifest.json in the given directory (case-insensitive on Windows).
fn find_manifest_path(dir: &Path) -> Option<PathBuf> {
    // Try exact match first
    let exact = dir.join("manifest.json");
    if exact.is_file() {
        return Some(exact);
    }

    // Case-insensitive fallback (same as Node.js readdir loop)
    let entries = match std::fs::read_dir(dir) {
        Ok(iter) => iter,
        Err(_) => return None,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name();
        let name_str = name.to_string_lossy().to_lowercase();
        if name_str == "manifest.json" && entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            return Some(entry.path());
        }
    }

    None
}

/// Read and parse a manifest.json file.
fn read_manifest(path: &Path) -> Option<ManifestJson> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<ManifestJson>(&text).ok()
}

/// Extract display name from manifest (prioritize displayName, then display_name).
fn manifest_display_name(m: &ManifestJson) -> String {
    let from_dn = m.display_name.as_ref().map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let from_alt = m.display_name_alt.as_ref().map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    from_dn
        .or(from_alt)
        .or_else(|| m.id.as_ref().map(|s| s.clone()))
        .unwrap_or_else(|| String::from("unknown"))
}

/// Compute directory size by summing all file sizes recursively.
fn compute_dir_size(dir: &Path) -> u64 {
    WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.metadata().map(|m| m.len()).unwrap_or(0))
        .sum()
}

/// Format bytes to human-readable string (matching Node.js formatBytes).
fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;

    if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{} KB", bytes / KB)
    } else {
        format!("{} B", bytes)
    }
}

/// Normalize a remote version string (strip leading 'v').
fn normalize_remote_version(value: Option<&str>) -> Option<String> {
    let v = value?.trim();
    if v.is_empty() {
        return None;
    }
    Some(v.trim_start_matches('v').trim_start_matches('V').to_string())
}

// ============================================================
// 核心扫描逻辑
// ============================================================

/// Walk the given directory tree and collect all found mods.
/// Equivalent to Node.js `collectLocalMods`.
pub fn collect_local_mods(dir_path: &Path) -> Vec<ModRecord> {
    let mut mods: Vec<ModRecord> = Vec::new();
    let mut visited: HashSet<PathBuf> = HashSet::new();

    // Use BFS-like approach: collect all directories, then process
    let dirs: Vec<PathBuf> = WalkDir::new(dir_path)
        .max_depth(5)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
        .map(|e| e.path().to_path_buf())
        .collect();

    for dir in &dirs {
        let canonical = match dir.canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !visited.insert(canonical.clone()) {
            continue;
        }

        let manifest_path = match find_manifest_path(dir) {
            Some(p) => p,
            None => continue,
        };

        let manifest = match read_manifest(&manifest_path) {
            Some(m) => m,
            None => continue,
        };

        let id = match &manifest.id {
            Some(id) if !id.is_empty() => id.clone(),
            _ => continue,
        };

        let version = match &manifest.version {
            Some(v) if !v.is_empty() => v.clone(),
            _ => continue,
        };

        let display_name = manifest_display_name(&manifest);
        let dir_size = compute_dir_size(dir);
        let size_text = format_bytes(dir_size);

        let hub_url = manifest
            .hub_url
            .as_ref()
            .or(manifest.hub_url_alt.as_ref())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string());

        let cached_hub_version = normalize_remote_version(
            manifest
                .hub_version
                .as_ref()
                .or(manifest.hub_version_alt.as_ref())
                .map(|s| s.as_str()),
        );

        // Status from cached hub version (if available in manifest)
        let status = if let Some(ref hv) = cached_hub_version {
            if compare_versions(&version, hv) >= 0 {
                "up_to_date"
            } else {
                "update_available"
            }
        } else {
            "unknown"
        };

        mods.push(ModRecord {
            id,
            display_name,
            version,
            size_text,
            size_loading: Some(true),
            remote_version: cached_hub_version,
            url: hub_url,
            download_url: None,
            status: status.to_string(),
            manifest_path: manifest_path.to_string_lossy().to_string(),
            install_dir: dir.to_string_lossy().to_string(),
            checking_status: Some("pending".to_string()),
        });
    }

    // Sort by display name (locale-aware, like Node.js)
    mods.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });

    mods
}

/// Compare two version strings. Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
/// Equivalent to Node.js `compareVersions`.
fn compare_versions(v1: &str, v2: &str) -> i32 {
    let parse = |v: &str| -> Vec<u32> {
        v.trim_start_matches(|c: char| c == 'v' || c == 'V')
            .split('.')
            .map(|seg| {
                seg.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse::<u32>()
                    .unwrap_or(0)
            })
            .collect()
    };

    let p1 = parse(v1);
    let p2 = parse(v2);
    let max_len = p1.len().max(p2.len());

    for i in 0..max_len {
        let a = p1.get(i).copied().unwrap_or(0);
        let b = p2.get(i).copied().unwrap_or(0);
        if a > b {
            return 1;
        }
        if a < b {
            return -1;
        }
    }

    0
}

// ============================================================
// Tauri Commands
// ============================================================

/// Quick local scan — walks the COI Mod directory and returns all found mods.
/// No Hub enrichment is performed.
#[tauri::command]
pub async fn local_scan() -> Result<ScanModsResponse, String> {
    let dir_path = default_mods_dir();

    // Run the blocking filesystem work on a background thread
    let dir_path_str = dir_path.to_string_lossy().to_string();
    let mods = tokio::task::spawn_blocking(move || collect_local_mods(&dir_path))
        .await
        .map_err(|e| format!("Scan task panicked: {}", e))?;

    Ok(ScanModsResponse {
        dir_path: dir_path_str,
        mods,
    })
}

/// Check a single mod by its install directory.
/// Reads manifest.json, computes size, and enriches with Hub data.
#[tauri::command]
pub async fn check_mod(install_dir: String) -> Result<ModRecord, String> {
    let install_path = PathBuf::from(&install_dir);

    let manifest_path = find_manifest_path(&install_path)
        .ok_or_else(|| format!("Manifest not found in: {}", install_dir))?;

    let manifest = read_manifest(&manifest_path)
        .ok_or_else(|| format!("Failed to parse manifest in: {}", install_dir))?;

    let id = manifest
        .id
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Missing 'id' in manifest: {}", install_dir))?
        .clone();

    let version = manifest
        .version
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Missing 'version' in manifest: {}", install_dir))?
        .clone();

    let display_name = manifest_display_name(&manifest);
    let dir_size = compute_dir_size(&install_path);
    let size_text = format_bytes(dir_size);

    let hub_url = manifest
        .hub_url
        .as_ref()
        .or(manifest.hub_url_alt.as_ref())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string());

    let cached_hub_version = normalize_remote_version(
        manifest
            .hub_version
            .as_ref()
            .or(manifest.hub_version_alt.as_ref())
            .map(|s| s.as_str()),
    );

    let mut record = ModRecord {
        id,
        display_name,
        version,
        size_text,
        size_loading: Some(false),
        remote_version: cached_hub_version,
        url: hub_url,
        download_url: None,
        status: "unknown".to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        install_dir,
        checking_status: Some("pending".to_string()),
    };

    // Hub enrichment (Phase 3)
    let hub = HubClient::new();
    enrich_mod(&hub, &mut record).await;

    Ok(record)
}

// ============================================================
// Hub 增强 + 流式扫描 (Phase 3)
// ============================================================

/// Enrich a locally scanned mod record with Hub data.
/// Equivalent to Node.js `enrichMod`.
pub async fn enrich_mod(
    hub: &HubClient,
    record: &mut ModRecord,
) {
    // If manifest already has hubVersion cached, use it
    if record.remote_version.is_some() {
        // Try to get download URL from cached hub URL
        if let Some(ref url) = record.url {
            if let Ok(detail) = parser::fetch_mod_detail(&hub, url).await {
                if let Some(dl) = detail.download_url {
                    record.download_url = Some(dl);
                }
                if let Some(size) = detail.size_text {
                    record.size_text = size;
                }
            }
        }
        record.checking_status = Some("done".to_string());
        return;
    }

    // Search Hub and find matching listing
    let dir_name = std::path::Path::new(&record.install_dir)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let listing = parser::find_hub_listing(
        &hub,
        &record.display_name,
        &record.id,
        &dir_name,
    )
    .await;

    if let Some(listing) = listing {
        record.remote_version = listing.version.clone();
        record.url = Some(listing.url.clone());

        let status = if let Some(ref hv) = listing.version {
            if compare_versions(&record.version, hv) >= 0 {
                "up_to_date"
            } else {
                "update_available"
            }
        } else {
            "unknown"
        };
        record.status = status.to_string();

        // Fetch detail page for download URL and file size
        if let Ok(detail) = parser::fetch_mod_detail(&hub, &listing.url).await {
            if let Some(dl) = detail.download_url {
                record.download_url = Some(dl);
            }
            if let Some(size) = detail.size_text {
                record.size_text = size;
            }
        }
    }

    record.checking_status = Some("done".to_string());
}

/// Stream scan — local scan + Hub enrichment with real-time progress events.
/// Equivalent to Node.js `streamScan`.
///
/// Sends `start`, `mod`, and `complete` events via the Tauri IPC channel.
#[tauri::command]
pub async fn stream_scan(
    app: tauri::AppHandle,
) -> Result<ScanModsResponse, String> {
    use tauri::Emitter;

    let dir_path = default_mods_dir();

    // Spawn blocking file scan
    let dir_path_str = dir_path.to_string_lossy().to_string();
    let mut mods = tokio::task::spawn_blocking(move || collect_local_mods(&dir_path))
        .await
        .map_err(|e| format!("Scan task panicked: {}", e))?;

    // Build Hub client for enrichment
    let hub = HubClient::new();

    // Emit start event
    let start_event = serde_json::json!({
        "type": "start",
        "dirPath": dir_path_str,
        "mods": mods
    });
    let _ = app.emit("scan-event", &start_event);

    // Enrich mods one by one, emitting progress
    let total = mods.len();
    for (i, record) in mods.iter_mut().enumerate() {
        enrich_mod(&hub, record).await;

        // Emit mod event
        let mod_event = serde_json::json!({
            "type": "mod",
            "mod": record,
            "progress": { "current": i + 1, "total": total }
        });
        let _ = app.emit("scan-event", &mod_event);
    }

    // Emit complete event
    let complete_event = serde_json::json!({
        "type": "complete",
        "result": {
            "dirPath": dir_path_str,
            "mods": mods
        }
    });
    let _ = app.emit("scan-event", &complete_event);

    Ok(ScanModsResponse {
        dir_path: dir_path_str,
        mods,
    })
}

// ============================================================
// 测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_versions() {
        assert_eq!(compare_versions("1.0.0", "1.0.0"), 0);
        assert_eq!(compare_versions("1.2.0", "1.0.0"), 1);
        assert_eq!(compare_versions("1.0.0", "1.2.0"), -1);
        assert_eq!(compare_versions("v2.0.0", "1.9.0"), 1);
        assert_eq!(compare_versions("1.0", "1.0.0"), 0);
        assert_eq!(compare_versions("2.0", "1.9.9"), 1);
    }

    #[test]
    fn test_format_bytes() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(500), "500 B");
        assert_eq!(format_bytes(2048), "2 KB");
        assert_eq!(format_bytes(1048576), "1.0 MB");
        assert_eq!(format_bytes(1572864), "1.5 MB");
    }

    #[test]
    fn test_normalize_remote_version() {
        assert_eq!(normalize_remote_version(Some("v1.2.3")), Some("1.2.3".to_string()));
        assert_eq!(normalize_remote_version(Some("V2.0.0")), Some("2.0.0".to_string()));
        assert_eq!(normalize_remote_version(Some("1.0.0")), Some("1.0.0".to_string()));
        assert_eq!(normalize_remote_version(Some("  ")), None);
        assert_eq!(normalize_remote_version(None), None);
    }
}
