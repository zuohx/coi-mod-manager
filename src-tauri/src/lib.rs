use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::io::Write;
use std::sync::OnceLock;

use tauri_plugin_opener::OpenerExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Once find_project_root() succeeds, logs go here. Before that, fallback to exe parent dir.
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn hide_command_window(command: &mut Command) -> &mut Command {
  #[cfg(windows)]
  {
    command.creation_flags(CREATE_NO_WINDOW);
  }

  command
}

fn log_to_file(message: &str) {
  // Use the project-level log path if available, otherwise fallback next to exe
  let path = match LOG_PATH.get() {
    Some(p) => p.clone(),
    None => {
      let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
      exe_dir.join("coi-mod-api.log")
    }
  };
  let _ = std::fs::OpenOptions::new()
    .create(true)
    .append(true)
    .write(true)
    .open(&path)
    .and_then(|mut file| writeln!(file, "{}", message));
}

fn find_project_root() -> Option<PathBuf> {
  let exe = std::env::current_exe().ok()?;
  log_to_file(&format!("[coi-mod-api] exe path: {:?}", exe));

  let exe_dir = exe.parent()?;

  // 1) Check bundled resource locations first (Tauri installer)
  //    Tauri v2 preserves path structure: "../dist-server/*" becomes "_up_/dist-server/"
  //    Also check flat placement and "resources/" subdirectory.
  for &subdir in &["", "resources", "_up_", "_up_\\resources"] {
    let candidate = exe_dir.join(subdir).join("dist-server").join("server.mjs");
    log_to_file(&format!("[coi-mod-api] checking bundled: {:?}", candidate));
    if candidate.exists() {
      let root = exe_dir.to_path_buf();
      log_to_file(&format!("[coi-mod-api] found project root (bundled): {:?}", root));
      let project_log = root.join("coi-mod-api.log");
      let _ = LOG_PATH.set(project_log);
      return Some(root);
    }
  }

  // 2) Fall back to walking up from exe directory (development mode)
  let mut dir = exe_dir;
  loop {
    let candidate = dir.join("dist-server").join("server.mjs");
    log_to_file(&format!("[coi-mod-api] checking parent: {:?}", candidate));
    if candidate.exists() {
      log_to_file(&format!("[coi-mod-api] found project root: {:?}", dir));
      let project_log = dir.join("coi-mod-api.log");
      let _ = LOG_PATH.set(project_log);
      return Some(dir.to_path_buf());
    }
    if let Some(parent) = dir.parent() {
      dir = parent;
    } else {
      log_to_file("[coi-mod-api] reached filesystem root, project root not found!");
      return None;
    }
  }
}

fn find_node_exe() -> Option<PathBuf> {
  // 1) Check bundled location first (next to exe or in resources/ subdirectory)
  //    Tauri v2 may place resources with "_up_/" prefix for "../" relative paths
  if let Ok(exe) = std::env::current_exe() {
    if let Some(exe_dir) = exe.parent() {
      for &subdir in &["", "resources", "_up_", "_up_\\resources"] {
        let bundled_node = exe_dir.join(subdir).join("node.exe");
        if bundled_node.exists() {
          log_to_file(&format!("[coi-mod-api] found bundled node.exe at: {:?}", bundled_node));
          return Some(bundled_node);
        }
      }
    }
  }

  log_to_file("[coi-mod-api] bundled node.exe not found, searching system...");

  // 2) Check well-known install locations
  let program_files = std::env::var("ProgramFiles").unwrap_or_default();
  let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
  let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
  let appdata = std::env::var("APPDATA").unwrap_or_default();

  let volta_image_dir = PathBuf::from(&local_appdata)
    .join("Volta")
    .join("tools")
    .join("image")
    .join("node");

  if let Ok(entries) = std::fs::read_dir(&volta_image_dir) {
    let mut candidates: Vec<PathBuf> = entries
      .filter_map(Result::ok)
      .map(|entry| entry.path().join("node.exe"))
      .filter(|path| path.exists())
      .collect();
    candidates.sort();
    candidates.reverse();

    if let Some(path) = candidates.into_iter().next() {
      log_to_file(&format!("[coi-mod-api] found real Volta node.exe at: {:?}", path));
      return Some(path);
    }
  }

  let common_paths = [
    r"C:\Program Files\nodejs\node.exe",
    r"C:\Program Files (x86)\nodejs\node.exe",
    &format!(r"{}\nodejs\node.exe", program_files),
    &format!(r"{}\nodejs\node.exe", program_files_x86),
    &format!(r"{}\fnm\node-versions\current\installation\node.exe", local_appdata),
    &format!(r"{}\nvm\node.exe", appdata),
  ];

  for path_str in &common_paths {
    let path = PathBuf::from(path_str);
    if path.exists() {
      log_to_file(&format!("[coi-mod-api] found node.exe at: {:?}", path));
      return Some(path);
    }
  }

  log_to_file("[coi-mod-api] Searching for node.exe via `where node`");
  let mut where_command = Command::new("where");
  hide_command_window(&mut where_command);
  where_command.arg("node");

  if let Ok(output) = where_command.output() {
    if output.status.success() {
      let stdout = String::from_utf8_lossy(&output.stdout);
      let first_line = stdout.lines().next()?.trim().to_string();
      if !first_line.is_empty() {
        let node_path = PathBuf::from(&first_line);
        log_to_file(&format!("[coi-mod-api] found node.exe at: {:?}", node_path));
        if node_path.exists() {
          return Some(node_path);
        }
      }
    } else {
      let stderr = String::from_utf8_lossy(&output.stderr);
      log_to_file(&format!("[coi-mod-api] `where node` failed: {}", stderr.trim()));
    }
  }

  // Try `node --version` directly (in case PATH works but `where` doesn't)
  log_to_file("[coi-mod-api] trying `node --version` directly");
  let mut node_version_command = Command::new("node");
  hide_command_window(&mut node_version_command);
  node_version_command.arg("--version");

  if let Ok(ver_output) = node_version_command.output() {
    if ver_output.status.success() {
      let ver = String::from_utf8_lossy(&ver_output.stdout).trim().to_string();
      log_to_file(&format!("[coi-mod-api] `node` works in PATH, version: {}", ver));
      return Some(PathBuf::from("node"));
    }
  }

  log_to_file("[coi-mod-api] node.exe not found anywhere!");
  None
}

fn spawn_api_server() -> Option<Child> {
  log_to_file("[coi-mod-api] spawn_api_server() called ----------");

  let project_root = find_project_root()?;

  // Find server.mjs — check various locations that Tauri v2 may use
  let server_path = if project_root.join("dist-server").join("server.mjs").exists() {
    project_root.join("dist-server").join("server.mjs")
  } else if project_root.join("resources").join("dist-server").join("server.mjs").exists() {
    project_root.join("resources").join("dist-server").join("server.mjs")
  } else if project_root.join("_up_").join("dist-server").join("server.mjs").exists() {
    project_root.join("_up_").join("dist-server").join("server.mjs")
  } else if project_root.join("_up_").join("resources").join("dist-server").join("server.mjs").exists() {
    project_root.join("_up_").join("resources").join("dist-server").join("server.mjs")
  } else {
    // Fallback: use direct path (will fail below with clear log)
    project_root.join("dist-server").join("server.mjs")
  };

  let server_str = server_path.to_string_lossy().to_string();

  log_to_file(&format!("[coi-mod-api] server path: {:?}", server_path));
  log_to_file(&format!("[coi-mod-api] server exists: {}", server_path.exists()));

  if !server_path.exists() {
    log_to_file("[coi-mod-api] ERROR: dist-server/server.mjs not found in any location!");
    return None;
  }

  let node_exe = find_node_exe()?;
  log_to_file(&format!("[coi-mod-api] using node: {:?}", node_exe));

  let mut node_command = Command::new(&node_exe);
  hide_command_window(&mut node_command);
  node_command
    .arg(&server_str)
    .current_dir(&project_root)
    .env("PORT", "5174")
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());

  match node_command.spawn() {
    Ok(child) => {
      log_to_file(&format!("[coi-mod-api] SUCCESS: server spawned, pid={}", child.id()));
      Some(child)
    }
    Err(e) => {
      log_to_file(&format!("[coi-mod-api] ERROR spawning node: {}", e));
      // Try with cmd /c as fallback
      log_to_file("[coi-mod-api] trying fallback: cmd /c ...");
      let fallback_script = format!("start /B node \"{}\"", server_str.replace('/', "\\"));
      let mut fallback_command = Command::new("cmd");
      hide_command_window(&mut fallback_command);
      fallback_command
        .args(["/C", &fallback_script])
        .current_dir(&project_root)
        .env("PORT", "5174")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

      match fallback_command.spawn() {
        Ok(fallback_child) => {
          log_to_file(&format!("[coi-mod-api] SUCCESS via cmd fallback, pid={}", fallback_child.id()));
          Some(fallback_child)
        }
        Err(fallback_err) => {
          log_to_file(&format!("[coi-mod-api] cmd fallback also failed: {}", fallback_err));
          None
        }
      }
    }
  }
}

#[tauri::command]
fn open_mod_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
  app
    .opener()
    .open_path(path, None::<&str>)
    .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut server: Option<Child> = None;

  if !cfg!(debug_assertions) {
    server = spawn_api_server();
  } else {
    log_to_file("[coi-mod-api] debug build, skipping server spawn");
  }

  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![open_mod_directory])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");

  if let Some(ref mut child) = server {
    log_to_file(&format!("[coi-mod-api] cleaning up server, pid={}", child.id()));
    let _ = child.kill();
    let _ = child.wait();
  }

  log_to_file("[coi-mod-api] app exited");
}
