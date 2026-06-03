//! Mod upgrade commands — download, extract, install, backup/rollback.
//!
//! Equivalent to Node.js `upgradeMod` + `downloadArchive` + `extractArchive`.
//!
//! Concurrency & reliability features:
//! - Global semaphore limits concurrent upgrades (MAX_CONCURRENT_UPGRADES)
//! - Per-mod lock prevents duplicate upgrades on the same install_dir
//! - Download retry with exponential backoff
//! - Per-request timeout for HTTP operations
//! - Per-mod event isolation via installDir tagging

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use tokio::sync::Semaphore;

use super::hub::parser;
use super::scan::{self, ModRecord, ScanModsResponse};

// ============================================================
// 常量
// ============================================================

/// Maximum number of concurrent upgrade operations.
const MAX_CONCURRENT_UPGRADES: usize = 3;

/// Download timeout per HTTP request.
const DOWNLOAD_TIMEOUT_SECS: u64 = 120;

/// Retry delays (ms) for download_file — exponential backoff.
const DOWNLOAD_RETRY_DELAYS_MS: &[u64] = &[1000, 2000, 4000];

/// Maximum retries for download_file.
const DOWNLOAD_MAX_RETRIES: usize = DOWNLOAD_RETRY_DELAYS_MS.len();

// ============================================================
// 全局并发控制
// ============================================================

fn upgrade_semaphore() -> &'static Semaphore {
    use std::sync::OnceLock;
    static SEM: OnceLock<Semaphore> = OnceLock::new();
    SEM.get_or_init(|| Semaphore::new(MAX_CONCURRENT_UPGRADES))
}

fn active_upgrades() -> &'static StdMutex<HashSet<String>> {
    use std::sync::OnceLock;
    static SET: OnceLock<StdMutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| StdMutex::new(HashSet::new()))
}

/// Try to acquire the per-mod lock. Returns `Err` if this mod is already upgrading.
fn try_lock_mod(install_dir: &str) -> Result<ModUpgradeGuard, String> {
    let mut set = active_upgrades().lock().unwrap();
    if !set.insert(install_dir.to_string()) {
        return Err(format!(
            "Mod at '{}' is already being upgraded",
            install_dir
        ));
    }
    Ok(ModUpgradeGuard {
        install_dir: install_dir.to_string(),
    })
}

/// RAII guard that removes the install_dir from the active set on drop.
struct ModUpgradeGuard {
    install_dir: String,
}

impl Drop for ModUpgradeGuard {
    fn drop(&mut self) {
        let mut set = active_upgrades().lock().unwrap();
        set.remove(&self.install_dir);
    }
}

// ============================================================
// 类型
// ============================================================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[allow(dead_code)]
pub struct UpgradeProgress {
    pub phase: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
}

// ============================================================
// 下载（含超时 + 指数退避重试）
// ============================================================

/// Download a file from the given URL to disk, with timeout and retry.
async fn download_file(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    referer: &str,
) -> Result<(), String> {
    let timeout = Duration::from_secs(DOWNLOAD_TIMEOUT_SECS);
    let mut last_error = String::new();

    for attempt in 0..=DOWNLOAD_MAX_RETRIES {
        if attempt > 0 {
            let delay_ms = DOWNLOAD_RETRY_DELAYS_MS[attempt - 1];
            eprintln!(
                "[coi-mod-manager] download retry {}/{} after {}ms: {}",
                attempt, DOWNLOAD_MAX_RETRIES, delay_ms, url
            );
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        }

        let result = async {
            let response = client
                .get(url)
                .header("Referer", referer)
                .timeout(timeout)
                .send()
                .await
                .map_err(|e| format!("Download failed: {}", e))?;

            if !response.status().is_success() {
                return Err(format!("Download HTTP {}", response.status()));
            }

            let bytes = response
                .bytes()
                .await
                .map_err(|e| format!("Download error: {}", e))?;

            std::fs::write(dest, &bytes)
                .map_err(|e| format!("Cannot write file: {}", e))?;

            Ok(())
        }
        .await;

        match result {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_error = e;
                // Only retry on network/timeout errors, not on HTTP 4xx
                if last_error.starts_with("Download HTTP 4") {
                    return Err(last_error);
                }
            }
        }
    }

    Err(format!(
        "Download failed after {} retries: {}",
        DOWNLOAD_MAX_RETRIES, last_error
    ))
}

// ============================================================
// 解压
// ============================================================

fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Cannot create extract dir: {}", e))?;

    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("Cannot open zip: {}", e))?;

    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Invalid zip: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry {} error: {}", i, e))?;

        let name = entry.mangled_name();
        let output_path = dest_dir.join(&name);

        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create dir: {}", e))?;
        }

        if entry.is_dir() {
            std::fs::create_dir_all(&output_path)
                .map_err(|e| format!("Cannot create dir: {}", e))?;
        } else {
            let mut outfile = std::fs::File::create(&output_path)
                .map_err(|e| format!("Cannot create file: {}", e))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Cannot extract file: {}", e))?;
        }
    }

    Ok(())
}

/// Find the manifest.json-containing directory in the extracted tree (BFS).
fn locate_mod_root(extract_dir: &Path) -> Option<PathBuf> {
    let mut queue: Vec<PathBuf> = vec![extract_dir.to_path_buf()];
    let mut best: Option<PathBuf> = None;
    let mut best_depth: usize = usize::MAX;

    while let Some(current) = queue.pop() {
        if let Ok(entries) = std::fs::read_dir(&current) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    queue.push(path);
                } else if path
                    .file_name()
                    .map(|n| n == "manifest.json")
                    .unwrap_or(false)
                {
                    let depth = path.components().count() - extract_dir.components().count();
                    if depth < best_depth {
                        best_depth = depth;
                        best = Some(current.clone());
                    }
                }
            }
        }
    }

    best
}

// ============================================================
// 文件操作
// ============================================================

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Cannot create dst dir: {}", e))?;

    for entry in walkdir::WalkDir::new(src).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let relative = path
            .strip_prefix(src)
            .map_err(|e| format!("Path error: {}", e))?;
        let target = dst.join(relative);

        if path.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|e| format!("Cannot create dir: {}", e))?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            std::fs::copy(path, &target)
                .map_err(|e| format!("Cannot copy file: {}", e))?;
        }
    }

    Ok(())
}

fn remove_dir(path: &Path) {
    if path.exists() {
        std::fs::remove_dir_all(path).ok();
    }
}

fn backup_user_data(install_dir: &Path, backup_dir: &Path) -> (bool, bool) {
    let saved_settings = install_dir.join("Saved Settings");
    let zh_json = install_dir.join("translations").join("zh.json");

    let has_settings = saved_settings.exists();
    let has_zh = zh_json.exists();

    if has_settings {
        copy_dir(&saved_settings, &backup_dir.join("Saved Settings")).ok();
    }
    if has_zh {
        let target = backup_dir.join("zh.json");
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::copy(&zh_json, &target).ok();
    }

    (has_settings, has_zh)
}

fn restore_user_data(install_dir: &Path, backup_dir: &Path, has_settings: bool, has_zh: bool) {
    if has_settings {
        copy_dir(
            &backup_dir.join("Saved Settings"),
            &install_dir.join("Saved Settings"),
        )
        .ok();
    }
    let new_zh_exists = install_dir.join("translations").join("zh.json").exists();
    if has_zh && !new_zh_exists {
        let src = backup_dir.join("zh.json");
        let dst = install_dir.join("translations").join("zh.json");
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::copy(&src, &dst).ok();
    }
}

fn timestamp_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

// ============================================================
// 升级核心
// ============================================================

/// Generate a unique temp directory path for an upgrade operation.
/// Uses a sanitized mod directory name + timestamp to avoid collisions.
fn unique_temp_dir(install_dir: &str) -> PathBuf {
    let dir_name = Path::new(install_dir)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let safe_name: String = dir_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    std::env::temp_dir().join(format!("coi-mod-upgrade-{}-{}", safe_name, ts))
}

/// Full upgrade pipeline.
/// Returns the enriched mod record after successful install + rescan.
async fn run_upgrade(
    client: &reqwest::Client,
    install_dir: &str,
    download_url: &str,
    hub_page_url: Option<&str>,
) -> Result<ModRecord, String> {
    eprintln!(
        "[coi-mod-manager] upgrade start: {} <- {}",
        install_dir, download_url
    );

    let resolved_url = if download_url.starts_with(parser::DOWNLOAD_URL_PREFIX) {
        download_url.to_string()
    } else if download_url.starts_with(&format!("{}/Mod/", parser::HUB_BASE)) {
        let hub = super::hub::HubClient::new();
        let detail = parser::fetch_mod_detail(&hub, download_url).await?;
        detail
            .download_url
            .ok_or_else(|| "Cannot find download URL on mod page".to_string())?
    } else {
        return Err(format!("Unexpected download URL: {}", download_url));
    };

    let temp_root = unique_temp_dir(install_dir);
    std::fs::create_dir_all(&temp_root)
        .map_err(|e| format!("Cannot create temp dir: {}", e))?;

    let zip_path = temp_root.join("mod.zip");
    let extract_dir = temp_root.join("extract");
    let install_path = PathBuf::from(install_dir);
    let backup_path = PathBuf::from(format!("{}.backup-{}", install_dir, timestamp_now()));

    let referer = hub_page_url.unwrap_or(parser::HUB_MODS_LIST_URL);

    // Download
    download_file(client, &resolved_url, &zip_path, referer).await?;

    // Extract
    extract_zip(&zip_path, &extract_dir)?;
    let mod_root = locate_mod_root(&extract_dir)
        .ok_or_else(|| "Downloaded archive does not contain manifest.json".to_string())?;

    // Backup + Install
    let user_backup = temp_root.join("user-backup");
    let (has_settings, has_zh) = backup_user_data(&install_path, &user_backup);

    if install_path.exists() {
        std::fs::rename(&install_path, &backup_path)
            .map_err(|e| format!("Cannot backup mod: {}", e))?;
    }

    let install_result = (|| -> Result<(), String> {
        std::fs::create_dir_all(&install_path)
            .map_err(|e| format!("Cannot create install dir: {}", e))?;
        copy_dir(&mod_root, &install_path)?;
        restore_user_data(&install_path, &user_backup, has_settings, has_zh);
        remove_dir(&backup_path);
        Ok(())
    })();

    if let Err(e) = install_result {
        remove_dir(&install_path);
        if backup_path.exists() {
            std::fs::rename(&backup_path, &install_path).ok();
        }
        return Err(e);
    }

    // Rescan + enrich
    let mut mods = scan::collect_local_mods(&install_path);
    let record = mods
        .first_mut()
        .ok_or_else(|| "Mod not found after install".to_string())?;

    let hub = super::hub::HubClient::new();
    scan::enrich_mod(&hub, record).await;

    remove_dir(&temp_root);
    eprintln!(
        "[coi-mod-manager] upgrade success: {} -> v{}",
        install_dir, record.version
    );
    Ok(record.clone())
}

// ============================================================
// Tauri Command
// ============================================================

/// Stream upgrade command — full upgrade pipeline with event streaming.
/// Sends `progress` events and `complete` event via `app.emit("upgrade-event")`.
///
/// Concurrency features:
/// - Global semaphore limits to MAX_CONCURRENT_UPGRADES parallel upgrades
/// - Per-mod lock prevents duplicate upgrades on the same install_dir
/// - Events include `installDir` for frontend filtering
#[tauri::command]
pub async fn stream_upgrade(
    app: tauri::AppHandle,
    install_dir: String,
    download_url: String,
    hub_page_url: Option<String>,
) -> Result<ScanModsResponse, String> {
    use tauri::Emitter;

    // Acquire global concurrency permit
    let _permit = upgrade_semaphore()
        .acquire()
        .await
        .map_err(|e| format!("Failed to acquire upgrade slot: {}", e))?;

    // Acquire per-mod lock (RAII guard releases on drop)
    let _mod_guard = try_lock_mod(&install_dir)?;

    let install_dir_tag = install_dir.clone();
    let app_for_emit = app.clone();

    let emit = move |phase: &str, message: &str, percent: Option<f64>| {
        let event = serde_json::json!({
            "type": "progress",
            "installDir": install_dir_tag,
            "progress": {
                "phase": phase,
                "message": message,
                "percent": percent
            }
        });
        let _ = app_for_emit.emit("upgrade-event", &event);
    };

    eprintln!(
        "[coi-mod-manager] stream_upgrade begin: {}",
        install_dir
    );

    emit("resolving", "正在解析下载地址", Some(5.0));
    emit("downloading", "正在连接下载服务器", Some(10.0));

    let client = reqwest::Client::builder()
        .user_agent(parser::HUB_USER_AGENT)
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let record = match run_upgrade(
        &client,
        &install_dir,
        &download_url,
        hub_page_url.as_deref(),
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!(
                "[coi-mod-manager] upgrade failed: {} — {}",
                install_dir, e
            );
            // Emit error event so the frontend can track per-mod failures
            let error_event = serde_json::json!({
                "type": "error",
                "installDir": install_dir,
                "message": e
            });
            let _ = app.emit("upgrade-event", &error_event);
            return Err(e);
        }
    };

    emit("completed", "升级完成", Some(100.0));

    let complete = serde_json::json!({
        "type": "complete",
        "installDir": install_dir,
        "result": {
            "dirPath": scan::default_mods_dir().to_string_lossy().to_string(),
            "mods": [&record]
        }
    });
    let _ = app.emit("upgrade-event", &complete);

    eprintln!(
        "[coi-mod-manager] stream_upgrade done: {}",
        install_dir
    );

    Ok(ScanModsResponse {
        dir_path: scan::default_mods_dir().to_string_lossy().to_string(),
        mods: vec![record],
    })
}
