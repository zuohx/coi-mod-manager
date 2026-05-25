//! Mod upgrade commands — download, extract, install, backup/rollback.
//!
//! Equivalent to Node.js `upgradeMod` + `downloadArchive` + `extractArchive`.

use std::path::{Path, PathBuf};

use super::hub::parser;
use super::scan::{self, ModRecord, ScanModsResponse};

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
// 下载
// ============================================================

/// Download a file from the given URL to disk.
async fn download_file(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    referer: &str,
) -> Result<(), String> {
    let response = client
        .get(url)
        .header("Referer", referer)
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

/// Full upgrade pipeline.
/// Returns the enriched mod record after successful install + rescan.
async fn run_upgrade(
    client: &reqwest::Client,
    install_dir: &str,
    download_url: &str,
    hub_page_url: Option<&str>,
) -> Result<ModRecord, String> {
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

    let temp_root =
        std::env::temp_dir().join(format!("coi-mod-upgrade-{}", std::process::id()));
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
    Ok(record.clone())
}

// ============================================================
// Tauri Command
// ============================================================

/// Stream upgrade command — full upgrade pipeline with event streaming.
/// Sends `progress` events and `complete` event via `app.emit("upgrade-event")`.
#[tauri::command]
pub async fn stream_upgrade(
    app: tauri::AppHandle,
    install_dir: String,
    download_url: String,
    hub_page_url: Option<String>,
) -> Result<ScanModsResponse, String> {
    use tauri::Emitter;

    let emit = |phase: &str, message: &str, percent: Option<f64>| {
        let event = serde_json::json!({
            "type": "progress",
            "progress": {
                "phase": phase,
                "message": message,
                "percent": percent
            }
        });
        let _ = app.emit("upgrade-event", &event);
    };

    emit("resolving", "正在解析下载地址", Some(5.0));
    emit("downloading", "正在连接下载服务器", Some(10.0));

    let client = reqwest::Client::builder()
        .user_agent(parser::HUB_USER_AGENT)
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let record = run_upgrade(
        &client,
        &install_dir,
        &download_url,
        hub_page_url.as_deref(),
    )
    .await?;

    emit("completed", "升级完成", Some(100.0));

    let complete = serde_json::json!({
        "type": "complete",
        "result": {
            "dirPath": scan::default_mods_dir().to_string_lossy().to_string(),
            "mods": [&record]
        }
    });
    let _ = app.emit("upgrade-event", &complete);

    Ok(ScanModsResponse {
        dir_path: scan::default_mods_dir().to_string_lossy().to_string(),
        mods: vec![record],
    })
}
