use std::{collections::VecDeque, sync::Mutex, time::Instant};

use chrono::Utc;
use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

const TARGET: &str = "note_portal_diagnostics";
const MAX_LOG_BYTES: u128 = 1024 * 1024;
const MAX_RECENT_ERRORS: usize = 20;
static RECENT_ERRORS: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

fn builder(target: TargetKind) -> tauri_plugin_log::Builder {
    tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Info)
        // Do not collect dependencies' messages, URLs or arbitrary frontend console output.
        .filter(|metadata| metadata.target() == TARGET)
        .targets([Target::new(target)])
        .max_file_size(MAX_LOG_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(3))
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    builder(TargetKind::LogDir {
        file_name: Some("note-portal".into()),
    })
    .build()
}

// Only fixed event codes and numeric measurements enter logs. In particular, never pass an
// underlying error's Display text: filesystem errors may contain paths or document contents.
pub fn event(code: &'static str) {
    log::info!(target: TARGET, "{code}");
}

pub fn failure(code: &'static str) {
    log::error!(target: TARGET, "{code}");
    let mut errors = RECENT_ERRORS.lock().expect("diagnostics mutex poisoned");
    if errors.len() == MAX_RECENT_ERRORS {
        errors.pop_front();
    }
    errors.push_back(format!("{} {code}", Utc::now().to_rfc3339()));
}

pub fn elapsed(code: &'static str, start: Instant) {
    log::info!(target: TARGET, "{code} elapsed_ms={}", start.elapsed().as_millis());
}

pub fn scan_complete(start: Instant, documents: usize, assets: usize, warnings: usize) {
    log::info!(target: TARGET,
        "scan.complete elapsed_ms={} documents={documents} assets={assets} warnings={warnings}",
        start.elapsed().as_millis());
}

fn system_version() -> String {
    static VERSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    VERSION
        .get_or_init(|| {
            #[cfg(target_os = "windows")]
            let output = {
                use std::os::windows::process::CommandExt;
                std::process::Command::new("cmd.exe")
                    .args(["/D", "/C", "ver"])
                    .creation_flags(0x08000000)
                    .output()
            };
            #[cfg(target_os = "macos")]
            let output = std::process::Command::new("/usr/bin/sw_vers")
                .arg("-productVersion")
                .output();
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            let output = std::process::Command::new("uname").arg("-r").output();
            match output {
                Ok(output) if output.status.success() => {
                    // Only numeric version information, never host/user names or command error text.
                    let version: String = String::from_utf8_lossy(&output.stdout)
                        .chars()
                        .filter(|ch| ch.is_ascii_digit() || *ch == '.')
                        .take(64)
                        .collect();
                    if !version.is_empty() {
                        return version;
                    }
                    failure("system.version_unavailable");
                    "unavailable".into()
                }
                _ => {
                    failure("system.version_unavailable");
                    "unavailable".into()
                }
            }
        })
        .clone()
}

pub fn startup() {
    log::info!(target: TARGET, "app.start version={} os={} os_version={} arch={}",
        env!("CARGO_PKG_VERSION"), std::env::consts::OS, system_version(), std::env::consts::ARCH);
}

#[tauri::command]
pub fn diagnostic_summary() -> String {
    let version = system_version();
    let errors = RECENT_ERRORS.lock().expect("diagnostics mutex poisoned");
    format!(
        "Note Portal {}\nOS: {} {}\nArchitecture: {}\nRecent errors (this session):\n{}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        version,
        std::env::consts::ARCH,
        if errors.is_empty() {
            "None recorded".into()
        } else {
            errors.iter().cloned().collect::<Vec<_>>().join("\n")
        }
    )
}

#[tauri::command]
pub fn open_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|_| "Unable to locate the local log folder")?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|_| "Unable to open the local log folder".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_rotation_is_bounded_and_external_targets_are_excluded() {
        let temp = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        let (_, _, logger) = builder(TargetKind::Folder {
            path: temp.path().into(),
            file_name: Some("note-portal".into()),
        })
        .split(app.handle())
        .unwrap();
        logger.log(
            &log::Record::builder()
                .target("untrusted_dependency")
                .level(log::Level::Error)
                .args(format_args!("PRIVATE_TOKEN_AND_PATH"))
                .build(),
        );
        let message = "scan.complete ".repeat(1000);
        for _ in 0..500 {
            logger.log(
                &log::Record::builder()
                    .target(TARGET)
                    .level(log::Level::Info)
                    .args(format_args!("{message}"))
                    .build(),
            );
        }
        logger.flush();
        let files: Vec<_> = std::fs::read_dir(temp.path())
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!((2..=4).contains(&files.len()));
        for file in files {
            let bytes = std::fs::read(file.path()).unwrap();
            assert!(bytes.len() <= MAX_LOG_BYTES as usize);
            assert!(!String::from_utf8_lossy(&bytes).contains("PRIVATE_TOKEN_AND_PATH"));
        }
    }
}
