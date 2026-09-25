#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod library;
mod platform;
mod server;

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use library::{Diagnostic, Profile, TreeNode};

const NOTICE_VERSION: &str = "1.3";
const GUIDE_VERSION: &str = "1";
const NOTICE_ZH: &str = include_str!("../../docs/NOTICE.zh-CN.md");
const NOTICE_EN: &str = include_str!("../../docs/NOTICE.en.md");
const GUIDE: &str = include_str!("../../docs/GETTING_STARTED.zh-CN.md");
const GUIDE_EN: &str = include_str!("../../docs/GETTING_STARTED.en.md");
const LICENSE: &str = include_str!("../../../../LICENSE");
const MAX_BRAND_LOGO_BYTES: usize = 2 * 1024 * 1024;

fn friendly_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{rest}")
    } else if let Some(rest) = value.strip_prefix("\\\\?\\") {
        rest.to_owned()
    } else {
        value.into_owned()
    }
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ThemeColor {
    #[default]
    Green,
    Crimson,
    Blue,
    Violet,
}

impl ThemeColor {
    fn css(self) -> &'static str {
        match self {
            Self::Green => "#14684e",
            Self::Crimson => "#a32432",
            Self::Blue => "#165e91",
            Self::Violet => "#6341a2",
        }
    }
}

fn saved_theme_color<'de, D>(deserializer: D) -> Result<ThemeColor, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    Ok(match value.as_str() {
        "crimson" => ThemeColor::Crimson,
        "blue" => ThemeColor::Blue,
        "violet" => ThemeColor::Violet,
        _ => ThemeColor::Green,
    })
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Selection {
    path: PathBuf,
    profile: Profile,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct Settings {
    notice_version: Option<String>,
    accepted_at: Option<String>,
    guide_version: Option<String>,
    library: Option<Selection>,
    launch_at_login: bool,
    #[serde(deserialize_with = "saved_theme_color")]
    theme_color: ThemeColor,
    logo_file: Option<String>,
    preferred_port: Option<u16>,
}

impl Settings {
    fn accepted(&self) -> bool {
        self.notice_version.as_deref() == Some(NOTICE_VERSION) && self.accepted_at.is_some()
    }

    fn guide_completed(&self) -> bool {
        self.guide_version.as_deref() == Some(GUIDE_VERSION)
    }

    fn ready(&self) -> bool {
        self.accepted() && self.guide_completed()
    }
}

struct Running {
    service: server::Service,
    handle: server::WebHandle,
    root: PathBuf,
    profile: Profile,
}

fn reject_settings_symlink(path: &Path) -> Result<(), String> {
    match path.symlink_metadata() {
        Ok(meta) if meta.file_type().is_symlink() => {
            Err("本机设置文件是符号链接；为保护数据，已拒绝写入。".into())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("无法检查本机设置文件；为保护数据，已拒绝写入。".into()),
    }
}

fn write_atomic_settings(path: &Path, content: &[u8]) -> Result<(), String> {
    replace_settings_file(path, content, |from, to| fs::rename(from, to))
}

// The rename step is a parameter so tests can refuse it the way some Windows setups do.
fn replace_settings_file(
    path: &Path,
    content: &[u8],
    rename: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
    reject_settings_symlink(path)?;
    let parent = path.parent().ok_or("设置路径无效。")?;
    let mut random = [0u8; 12];
    getrandom::fill(&mut random).map_err(|_| "无法创建临时设置文件名。")?;
    let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let temporary = parent.join(format!(".settings-{suffix}.tmp"));
    let result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "无法创建临时设置文件。".to_owned())?;
        file.write_all(content)
            .and_then(|_| file.sync_all())
            .map_err(|_| "无法完整写入临时设置文件。".to_owned())?;
        drop(file);
        reject_settings_symlink(path)?;
        if rename(&temporary, path).is_ok() {
            return Ok(());
        }
        // Some Windows setups refuse to rename over the settings file (a tester's encrypted
        // settings folder returned ERROR_NOT_SAME_DEVICE). Overwrite it in place, as alpha.3 did:
        // save() has already kept the previous settings in settings.json.bak, and a torn file is
        // caught at load, where the recovery page can restore that backup.
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)
            .map_err(|_| "无法安全替换本机设置文件。".to_owned())?;
        file.write_all(content)
            .and_then(|_| file.sync_all())
            .map_err(|_| "无法安全替换本机设置文件。".to_owned())
    })();
    if temporary.exists() {
        let cleanup = fs::remove_file(&temporary);
        // After an in-place overwrite the settings are saved, so a hidden leftover temporary
        // file must not turn that into a reported failure.
        if result.is_err() && cleanup.is_err() {
            return Err("写入设置失败，且临时设置文件无法清理。".to_owned());
        }
    }
    result
}

struct AppState {
    settings_path: PathBuf,
    settings: Mutex<Settings>,
    settings_error: Mutex<Option<String>>,
    startup_error: Mutex<Option<String>>,
    branding_warning: Mutex<Option<String>>,
    running: Mutex<Option<Running>>,
    startup_in_progress: AtomicBool,
    operation: tokio::sync::Mutex<()>,
}

impl AppState {
    fn load(settings_path: PathBuf) -> Arc<Self> {
        let loaded = if settings_path.exists() {
            fs::read_to_string(&settings_path)
                .map_err(|_| "本机设置无法读取；资料库尚未启动。".to_owned())
                .and_then(|text| {
                    serde_json::from_str(&text)
                        .map_err(|_| "本机设置格式错误；资料库尚未启动。".to_owned())
                })
        } else {
            Ok(Settings::default())
        };
        let (settings, settings_error) = match loaded {
            Ok(settings) => (settings, None),
            Err(error) => (Settings::default(), Some(error)),
        };
        Arc::new(Self {
            settings_path,
            settings: Mutex::new(settings),
            settings_error: Mutex::new(settings_error),
            startup_error: Mutex::new(None),
            branding_warning: Mutex::new(None),
            running: Mutex::new(None),
            startup_in_progress: AtomicBool::new(false),
            operation: tokio::sync::Mutex::new(()),
        })
    }

    fn save(&self, settings: &Settings) -> Result<(), String> {
        let parent = self.settings_path.parent().ok_or("设置路径无效。")?;
        fs::create_dir_all(parent).map_err(|_| "无法创建本机设置文件夹。")?;
        if self
            .settings_path
            .symlink_metadata()
            .is_ok_and(|meta| meta.file_type().is_symlink())
        {
            return Err("本机设置文件是符号链接；为保护数据，已拒绝写入。".into());
        }
        let content = serde_json::to_vec_pretty(settings).map_err(|_| "无法保存本机设置。")?;
        reject_settings_symlink(&self.settings_path)?;
        let backup = self.settings_path.with_extension("json.bak");
        if self.settings_path.exists() {
            let previous = fs::read(&self.settings_path)
                .map_err(|_| "无法读取当前设置，已保留原文件。".to_owned())?;
            if serde_json::from_slice::<Settings>(&previous).is_ok() {
                write_atomic_settings(&backup, &previous)?;
            }
        }
        write_atomic_settings(&self.settings_path, &content)
    }

    fn has_settings_error(&self) -> bool {
        self.settings_error
            .lock()
            .map(|error| error.is_some())
            .unwrap_or(true)
    }

    fn preserve_damaged_settings(&self) -> Result<PathBuf, String> {
        reject_settings_symlink(&self.settings_path)?;
        let bytes = fs::read(&self.settings_path)
            .map_err(|_| "无法备份损坏的设置；尚未恢复或重置。".to_owned())?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("设置文件过大；请先人工检查，尚未恢复或重置。".into());
        }
        let mut random = [0u8; 12];
        getrandom::fill(&mut random).map_err(|_| "无法创建设置备份名称。")?;
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let backup = self
            .settings_path
            .with_extension(format!("corrupt-{suffix}.json"));
        let result = (|| -> Result<(), String> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&backup)
                .map_err(|_| "无法创建损坏设置的备份；尚未恢复或重置。".to_owned())?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "无法完整备份损坏的设置；尚未恢复或重置。".to_owned())
        })();
        if let Err(error) = result {
            if backup.exists() {
                fs::remove_file(&backup)
                    .map_err(|_| "损坏设置的备份未完成，且临时备份无法清理。".to_owned())?;
            }
            return Err(error);
        }
        Ok(backup)
    }

    fn restore_settings_backup(&self) -> Result<PathBuf, String> {
        if !self.has_settings_error() {
            return Err("本机设置无需恢复。".into());
        }
        let backup = self.settings_path.with_extension("json.bak");
        reject_settings_symlink(&backup)?;
        if !backup
            .metadata()
            .is_ok_and(|meta| meta.is_file() && meta.len() <= 8 * 1024 * 1024)
        {
            return Err("设置备份无效或过大。".into());
        }
        let bytes = fs::read(&backup).map_err(|_| "无法读取设置备份。".to_owned())?;
        let restored: Settings = serde_json::from_slice(&bytes)
            .map_err(|_| "设置备份也已损坏；请改用备份后重置。".to_owned())?;
        let damaged = self.preserve_damaged_settings()?;
        write_atomic_settings(&self.settings_path, &bytes)?;
        *self.settings.lock().map_err(|_| "本机设置暂时不可用。")? = restored;
        *self
            .settings_error
            .lock()
            .map_err(|_| "本机设置暂时不可用。")? = None;
        Ok(damaged)
    }

    fn reset_corrupt_settings(&self) -> Result<PathBuf, String> {
        if !self.has_settings_error() {
            return Err("本机设置无需重置。".into());
        }
        let backup = self.preserve_damaged_settings()?;
        self.save(&Settings::default())?;
        *self.settings.lock().map_err(|_| "本机设置暂时不可用。")? = Settings::default();
        *self
            .settings_error
            .lock()
            .map_err(|_| "本机设置暂时不可用。")? = None;
        Ok(backup)
    }

    fn ensure_ready(&self) -> Result<(), String> {
        if self.has_settings_error() {
            return Err("本机设置需要人工检查，不能继续使用旧的资料库。".into());
        }
        let settings = self.settings.lock().map_err(|_| "本机设置暂时不可用。")?;
        if !settings.accepted() {
            return Err("请先阅读并同意当前使用提示。".into());
        }
        if !settings.guide_completed() {
            return Err("请先完成首次使用指引。".into());
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    notice_version: &'static str,
    notice_accepted: bool,
    guide_completed: bool,
    accepted_at: Option<String>,
    library_path: Option<String>,
    library_name: Option<String>,
    profile: Option<Profile>,
    service_state: &'static str,
    port: Option<u16>,
    document_count: usize,
    diagnostics: Vec<Diagnostic>,
    tree: Vec<TreeNode>,
    last_refresh: Option<String>,
    error: Option<String>,
    settings_recovery_path: Option<String>,
    settings_backup_available: bool,
    launch_at_login: bool,
    theme_color: ThemeColor,
    logo_selected: bool,
}

async fn current_status(state: &Arc<AppState>) -> Status {
    let settings_error = state
        .settings_error
        .lock()
        .ok()
        .and_then(|error| error.clone());
    let settings_recovery_path = settings_error
        .as_ref()
        .map(|_| state.settings_path.to_string_lossy().into_owned());
    let backup = state.settings_path.with_extension("json.bak");
    let settings_backup_available = settings_error.is_some()
        && reject_settings_symlink(&backup).is_ok()
        && backup
            .metadata()
            .is_ok_and(|meta| meta.is_file() && meta.len() <= 8 * 1024 * 1024)
        && fs::read(&backup)
            .ok()
            .is_some_and(|bytes| serde_json::from_slice::<Settings>(&bytes).is_ok());
    let settings = state
        .settings
        .lock()
        .expect("settings mutex poisoned")
        .clone();
    let service = {
        let running = state.running.lock().expect("running mutex poisoned");
        running.as_ref().map(|active| {
            (
                active.service.port,
                active.service.snapshot.clone(),
                active.service.last_error.clone(),
            )
        })
    };
    let (port, document_count, diagnostics, tree, last_refresh, runtime_error) =
        if let Some((port, snapshot, last_error)) = service {
            let snapshot = snapshot.read().await;
            (
                Some(port),
                snapshot.documents.len(),
                snapshot.diagnostics.clone(),
                snapshot.tree.clone(),
                Some(snapshot.generated_at.clone()),
                last_error.read().await.clone(),
            )
        } else {
            (None, 0, vec![], vec![], None, None)
        };
    Status {
        notice_version: NOTICE_VERSION,
        notice_accepted: settings.accepted(),
        guide_completed: settings.guide_completed(),
        accepted_at: settings.accepted_at,
        library_path: settings
            .library
            .as_ref()
            .map(|item| friendly_path(&item.path)),
        library_name: settings
            .library
            .as_ref()
            .and_then(|item| item.path.file_name())
            .map(|name| name.to_string_lossy().into_owned()),
        profile: settings.library.as_ref().map(|item| item.profile),
        service_state: if port.is_some() {
            if runtime_error.is_some() {
                "degraded"
            } else {
                "running"
            }
        } else if state.startup_in_progress.load(Ordering::SeqCst) {
            "starting"
        } else {
            "stopped"
        },
        port,
        document_count,
        diagnostics,
        tree,
        last_refresh,
        error: settings_error
            .or(runtime_error)
            .or_else(|| {
                state
                    .branding_warning
                    .lock()
                    .ok()
                    .and_then(|warning| warning.clone())
            })
            .or_else(|| {
                state
                    .startup_error
                    .lock()
                    .ok()
                    .and_then(|error| error.clone())
            }),
        settings_recovery_path,
        settings_backup_available,
        launch_at_login: settings.launch_at_login,
        theme_color: settings.theme_color,
        logo_selected: settings.logo_file.is_some(),
    }
}

#[tauri::command]
async fn get_status(state: State<'_, Arc<AppState>>) -> Result<Status, String> {
    Ok(current_status(state.inner()).await)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsReset {
    status: Status,
    backup_path: String,
    warning: Option<String>,
}

// Recovered settings replace `launch_at_login`, so the OS login item must follow them.
fn sync_login_item(app: &AppHandle, enabled: bool) -> Option<String> {
    let autolaunch = app.autolaunch();
    // Disabling an absent Windows entry is an error, so change the item only when it differs.
    let synced = autolaunch.is_enabled().and_then(|current| {
        if current == enabled {
            Ok(())
        } else if enabled {
            autolaunch.enable()
        } else {
            autolaunch.disable()
        }
    });
    synced.err().map(|_| {
        "系统登录启动项未能同步；请在“设置与条款”中把登录启动选项重新切换一次。".to_owned()
    })
}

#[tauri::command]
async fn restore_settings_backup(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<SettingsReset, String> {
    let _operation = state.operation.lock().await;
    let backup = state.restore_settings_backup()?;
    let launch_at_login = state
        .settings
        .lock()
        .map_err(|_| "本机设置暂时不可用。")?
        .launch_at_login;
    let warning = sync_login_item(&app, launch_at_login);
    Ok(SettingsReset {
        status: current_status(state.inner()).await,
        backup_path: backup.to_string_lossy().into_owned(),
        warning,
    })
}

#[tauri::command]
async fn reset_corrupt_settings(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<SettingsReset, String> {
    let _operation = state.operation.lock().await;
    let backup = state.reset_corrupt_settings()?;
    let warning = sync_login_item(&app, false);
    Ok(SettingsReset {
        status: current_status(state.inner()).await,
        backup_path: backup.to_string_lossy().into_owned(),
        warning,
    })
}

#[tauri::command]
fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn get_notice(language: String) -> String {
    if language == "en" {
        format!("{NOTICE_EN}\n\n## Project licence text\n\n{LICENSE}")
    } else {
        format!("{NOTICE_ZH}\n\n## 项目许可证原文\n\n{LICENSE}")
    }
}

#[tauri::command]
fn get_guide(language: String) -> &'static str {
    if language == "en" {
        GUIDE_EN
    } else {
        GUIDE
    }
}

#[tauri::command]
fn accept_notice(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    if state.has_settings_error() {
        return Err("本机设置已损坏。请先备份并人工检查设置文件。".into());
    }
    let mut settings = state.settings.lock().map_err(|_| "本机设置暂时不可用。")?;
    let mut next = settings.clone();
    next.notice_version = Some(NOTICE_VERSION.into());
    next.accepted_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
    state.save(&next)?;
    *settings = next;
    Ok(())
}

#[tauri::command]
fn complete_guide(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    if state.has_settings_error() {
        return Err("本机设置已损坏。请先备份并人工检查设置文件。".into());
    }
    let mut settings = state.settings.lock().map_err(|_| "本机设置暂时不可用。")?;
    if !settings.accepted() {
        return Err("请先阅读并同意当前使用提示。".into());
    }
    let mut next = settings.clone();
    next.guide_version = Some(GUIDE_VERSION.into());
    state.save(&next)?;
    *settings = next;
    Ok(())
}

fn logo_kind(bytes: &[u8]) -> Result<(&'static str, &'static str), String> {
    if bytes.len() > MAX_BRAND_LOGO_BYTES {
        return Err("Logo 超过 2 MiB，请选择较小的图片。".into());
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok(("png", "image/png"))
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Ok(("jpg", "image/jpeg"))
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Ok(("webp", "image/webp"))
    } else {
        Err("请选择 PNG、JPEG 或 WebP 图片；不接受 SVG 或其他格式。".into())
    }
}

fn logo_path(settings_path: &Path, filename: &str) -> Result<PathBuf, String> {
    let (id, extension) = filename
        .strip_prefix("brand-logo-")
        .and_then(|name| name.rsplit_once('.'))
        .ok_or("本机 Logo 文件名无效。")?;
    if id.len() != 24
        || !id.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !["png", "jpg", "webp"].contains(&extension)
    {
        return Err("本机 Logo 文件名无效。".into());
    }
    Ok(settings_path
        .parent()
        .ok_or("设置路径无效。")?
        .join(filename))
}

fn branding_from_settings(
    settings_path: &Path,
    settings: &Settings,
) -> Result<server::Branding, String> {
    let logo = if let Some(filename) = &settings.logo_file {
        let path = logo_path(settings_path, filename)?;
        let meta = fs::symlink_metadata(&path)
            .map_err(|_| "已选择的本机 Logo 无法读取；请在设置中重新选择或清除。")?;
        if !meta.is_file() || meta.len() > MAX_BRAND_LOGO_BYTES as u64 {
            return Err("已选择的本机 Logo 文件无效；请在设置中重新选择或清除。".into());
        }
        let bytes =
            fs::read(path).map_err(|_| "已选择的本机 Logo 无法读取；请在设置中重新选择或清除。")?;
        let (extension, mime) = logo_kind(&bytes)?;
        if !filename.ends_with(&format!(".{extension}")) {
            return Err("已选择的本机 Logo 格式与文件名不符。".into());
        }
        Some(server::BrandLogo {
            mime,
            bytes: Arc::new(bytes),
        })
    } else {
        None
    };
    Ok(server::Branding {
        color: settings.theme_color.css(),
        logo,
    })
}

fn branding_with_optional_logo(
    settings_path: &Path,
    settings: &Settings,
) -> (server::Branding, Option<String>) {
    match branding_from_settings(settings_path, settings) {
        Ok(branding) => (branding, None),
        Err(reason) => (
            server::Branding {
                color: settings.theme_color.css(),
                logo: None,
            },
            Some(format!(
                "{reason} 已改用文字标识；请在设置中重新选择或清除 Logo。"
            )),
        ),
    }
}

async fn update_live_branding(
    state: &Arc<AppState>,
    branding: server::Branding,
) -> Result<(), String> {
    let live = state
        .running
        .lock()
        .map_err(|_| "本地服务暂时不可用。")?
        .as_ref()
        .map(|running| running.service.branding.clone());
    if let Some(live) = live {
        *live.write().await = branding;
    }
    Ok(())
}

#[tauri::command]
async fn set_theme_color(
    state: State<'_, Arc<AppState>>,
    theme_color: ThemeColor,
) -> Result<Status, String> {
    state.ensure_ready()?;
    let _operation = state.operation.lock().await;
    let (branding, warning) = {
        let mut settings = state.settings.lock().map_err(|_| "本机设置暂时不可用。")?;
        let mut next = settings.clone();
        next.theme_color = theme_color;
        let (branding, warning) = branding_with_optional_logo(&state.settings_path, &next);
        state.save(&next)?;
        *settings = next;
        (branding, warning)
    };
    update_live_branding(state.inner(), branding).await?;
    *state
        .branding_warning
        .lock()
        .map_err(|_| "本机设置暂时不可用。")? = warning;
    Ok(current_status(state.inner()).await)
}

// The control window sends raw bytes; if the IPC custom protocol is unavailable, Tauri falls back
// to postMessage and delivers the same bytes as a JSON number array.
fn logo_upload_bytes(body: &tauri::ipc::InvokeBody) -> Result<Vec<u8>, String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone())
            .map_err(|_| "请选择 PNG、JPEG 或 WebP 图片；不接受 SVG 或其他格式。".to_owned()),
    }
}

#[tauri::command]
async fn set_brand_logo(
    request: tauri::ipc::Request<'_>,
    state: State<'_, Arc<AppState>>,
) -> Result<Status, String> {
    state.ensure_ready()?;
    let bytes = logo_upload_bytes(request.body())?;
    let (extension, mime) = logo_kind(&bytes)?;
    let _operation = state.operation.lock().await;
    let mut random = [0u8; 12];
    getrandom::fill(&mut random).map_err(|_| "无法创建本机 Logo 文件名。")?;
    let id: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let filename = format!("brand-logo-{id}.{extension}");
    let path = logo_path(&state.settings_path, &filename)?;
    fs::create_dir_all(path.parent().ok_or("设置路径无效。")?)
        .map_err(|_| "无法创建本机设置文件夹。")?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| "无法保存本机 Logo。")?;
    use std::io::Write;
    if file.write_all(&bytes).is_err() {
        drop(file);
        return match fs::remove_file(&path) {
            Ok(()) => Err("无法完整保存本机 Logo。".into()),
            Err(_) => Err("无法完整保存本机 Logo，且未能清理未完成的文件。".into()),
        };
    }
    drop(file);
    let updated = (|| -> Result<_, String> {
        let mut settings = state.settings.lock().map_err(|_| "本机设置暂时不可用。")?;
        let mut next = settings.clone();
        let old = next.logo_file.replace(filename);
        state.save(&next)?;
        let branding = server::Branding {
            color: next.theme_color.css(),
            logo: Some(server::BrandLogo {
                mime,
                bytes: Arc::new(bytes),
            }),
        };
        *settings = next;
        Ok((old, branding))
    })();
    let (old, branding) = match updated {
        Ok(updated) => updated,
        Err(error) => {
            return match fs::remove_file(&path) {
                Ok(()) => Err(error),
                Err(_) => Err(format!("{error} 未使用的 Logo 文件也未能清理。")),
            };
        }
    };
    update_live_branding(state.inner(), branding).await?;
    *state
        .branding_warning
        .lock()
        .map_err(|_| "本机设置暂时不可用。")? = None;
    if let Some(old) = old {
        let old_path = logo_path(&state.settings_path, &old)?;
        match fs::remove_file(old_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("新 Logo 已保存，但旧 Logo 文件无法清理。".into()),
        }
    }
    Ok(current_status(state.inner()).await)
}

#[tauri::command]
async fn clear_brand_logo(state: State<'_, Arc<AppState>>) -> Result<Status, String> {
    state.ensure_ready()?;
    let _operation = state.operation.lock().await;
    let (old, branding) = {
        let mut settings = state.settings.lock().map_err(|_| "本机设置暂时不可用。")?;
        let mut next = settings.clone();
        let old = next.logo_file.take();
        state.save(&next)?;
        let branding = server::Branding {
            color: next.theme_color.css(),
            logo: None,
        };
        *settings = next;
        (old, branding)
    };
    update_live_branding(state.inner(), branding).await?;
    *state
        .branding_warning
        .lock()
        .map_err(|_| "本机设置暂时不可用。")? = None;
    if let Some(old) = old {
        let old_path = logo_path(&state.settings_path, &old)?;
        match fs::remove_file(old_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Logo 已清除，但旧 Logo 文件无法清理。".into()),
        }
    }
    Ok(current_status(state.inner()).await)
}

#[tauri::command]
async fn pick_folder(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>, String> {
    state.ensure_ready()?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = sender.send(path.map(|path| path.to_string()));
    });
    receiver.await.map_err(|_| "文件夹选择已中断。".to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Preview {
    document_count: usize,
    tree: Vec<TreeNode>,
    diagnostics: Vec<Diagnostic>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotePreview {
    relative_path: String,
    exists: bool,
}

#[tauri::command]
async fn preview_folder(
    state: State<'_, Arc<AppState>>,
    path: String,
    profile: Profile,
) -> Result<Preview, String> {
    state.ensure_ready()?;
    let root = PathBuf::from(path);
    let snapshot = tokio::task::spawn_blocking(move || library::scan(&root, profile, 1))
        .await
        .map_err(|_| "预览任务意外中断。")??;
    Ok(Preview {
        document_count: snapshot.documents.len(),
        tree: snapshot.tree,
        diagnostics: snapshot.diagnostics,
    })
}

#[tauri::command]
async fn list_general_folders(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    state.ensure_ready()?;
    let selection = state
        .settings
        .lock()
        .map_err(|_| "本机设置暂时不可用。")?
        .library
        .clone()
        .ok_or("请先选择一个资料库。")?;
    if selection.profile != Profile::General {
        return Err("这个操作不适用于当前资料库类型。".into());
    }
    tokio::task::spawn_blocking(move || library::general_folders(&selection.path))
        .await
        .map_err(|_| "资料库文件夹扫描意外中断。".to_owned())?
}

async fn activate(
    app: &AppHandle,
    state: &Arc<AppState>,
    selection: Selection,
    open_browser: bool,
) -> Result<Status, String> {
    state.ensure_ready()?;
    let _operation = state.operation.lock().await;
    let root = selection
        .path
        .canonicalize()
        .map_err(|_| "资料库文件夹无法打开。")?;
    let existing_url = state
        .running
        .lock()
        .map_err(|_| "本地服务暂时不可用。")?
        .as_ref()
        .filter(|running| running.root == root && running.profile == selection.profile)
        .map(|running| running.service.browser_url());
    if let Some(url) = existing_url {
        if open_browser {
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|_| "无法打开默认浏览器。".to_owned())?;
        }
        return Ok(current_status(state).await);
    }
    let existing_settings = state
        .settings
        .lock()
        .map_err(|_| "本机设置暂时不可用。")?
        .clone();
    let (branding, warning) = branding_with_optional_logo(&state.settings_path, &existing_settings);
    let replacing_service = state
        .running
        .lock()
        .map_err(|_| "本地服务暂时不可用。")?
        .is_some();
    let (new_service, new_handle) = server::start(
        root.clone(),
        selection.profile,
        branding,
        existing_settings.preferred_port,
    )
    .await?;
    let mut next = state
        .settings
        .lock()
        .map_err(|_| "本机设置暂时不可用。")?
        .clone();
    next.library = Some(Selection {
        path: root.clone(),
        profile: selection.profile,
    });
    if !replacing_service {
        next.preferred_port = Some(new_service.port);
    }
    if let Err(error) = state.save(&next) {
        new_service.stop();
        return Err(error);
    }
    *state.settings.lock().map_err(|_| "本机设置暂时不可用。")? = next;
    let browser_url = new_service.browser_url();
    let last_error = new_service.last_error.clone();
    let old = state
        .running
        .lock()
        .map_err(|_| "本地服务暂时不可用。")?
        .replace(Running {
            service: new_service,
            handle: new_handle,
            root,
            profile: selection.profile,
        });
    if let Some(previous) = old {
        previous.service.stop();
    }
    if let Ok(mut startup_error) = state.startup_error.lock() {
        *startup_error = None;
    }
    if let Ok(mut branding_warning) = state.branding_warning.lock() {
        *branding_warning = warning;
    }
    if open_browser && app.opener().open_url(browser_url, None::<&str>).is_err() {
        *last_error.write().await =
            Some("服务已经启动，但无法自动打开浏览器。请点击“打开阅读器”重试。".into());
    }
    Ok(current_status(state).await)
}

#[tauri::command]
async fn select_library(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    profile: Profile,
) -> Result<Status, String> {
    activate(
        &app,
        state.inner(),
        Selection {
            path: PathBuf::from(path),
            profile,
        },
        true,
    )
    .await
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('.') || !library::valid_component(name) {
        return Err("名称包含系统不支持的字符，请换一个简短名称。".into());
    }
    Ok(())
}

#[tauri::command]
async fn create_library(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    parent: String,
    name: String,
    profile: Profile,
) -> Result<Status, String> {
    state.ensure_ready()?;
    validate_name(&name)?;
    let parent = PathBuf::from(parent)
        .canonicalize()
        .map_err(|_| "保存位置无法打开。")?;
    if !parent.is_dir() {
        return Err("请选择一个文件夹作为保存位置。".into());
    }
    let root = parent.join(name);
    fs::create_dir(&root).map_err(|_| "同名文件夹已经存在，或无法在这里创建资料库。".to_owned())?;
    if profile == Profile::Study {
        fs::create_dir(root.join("content")).map_err(|_| "无法创建 content 文件夹。")?;
        fs::create_dir(root.join("inbox")).map_err(|_| "无法创建 inbox 文件夹。")?;
    }
    activate(
        &app,
        state.inner(),
        Selection {
            path: root,
            profile,
        },
        true,
    )
    .await
}

#[tauri::command]
async fn start_service(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    open_browser: bool,
) -> Result<Status, String> {
    state.ensure_ready()?;
    let existing_url = {
        state
            .running
            .lock()
            .map_err(|_| "本地服务暂时不可用。")?
            .as_ref()
            .map(|running| running.service.browser_url())
    };
    if let Some(url) = existing_url {
        if open_browser {
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|_| "无法打开默认浏览器。".to_owned())?;
        }
        clear_reported_error(state.inner());
        return Ok(current_status(state.inner()).await);
    }
    let selection = state
        .settings
        .lock()
        .map_err(|_| "本机设置暂时不可用。")?
        .library
        .clone()
        .ok_or("请先选择一个资料库。")?;
    activate(&app, state.inner(), selection, open_browser).await
}

#[tauri::command]
async fn stop_service(state: State<'_, Arc<AppState>>) -> Result<Status, String> {
    let _operation = state.operation.lock().await;
    let active = {
        state
            .running
            .lock()
            .map_err(|_| "本地服务暂时不可用。")?
            .take()
    };
    if let Some(running) = active {
        running.service.stop();
        clear_reported_error(state.inner());
    }
    Ok(current_status(state.inner()).await)
}

#[tauri::command]
async fn refresh_now(state: State<'_, Arc<AppState>>) -> Result<Status, String> {
    state.ensure_ready()?;
    let handle = state
        .running
        .lock()
        .map_err(|_| "本地服务暂时不可用。")?
        .as_ref()
        .map(|running| running.handle.clone())
        .ok_or("本地服务尚未启动。")?;
    server::refresh(&handle).await?;
    clear_reported_error(state.inner());
    Ok(current_status(state.inner()).await)
}

#[tauri::command]
async fn open_portal(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.ensure_ready()?;
    let url = state
        .running
        .lock()
        .map_err(|_| "本地服务暂时不可用。")?
        .as_ref()
        .map(|running| running.service.browser_url())
        .ok_or("请先启动本地服务。")?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "无法打开默认浏览器；请检查系统默认浏览器设置。".to_owned())?;
    clear_reported_error(state.inner());
    Ok(())
}

#[tauri::command]
fn open_library_folder(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.ensure_ready()?;
    let path = state
        .settings
        .lock()
        .map_err(|_| "本机设置暂时不可用。")?
        .library
        .as_ref()
        .map(|item| item.path.to_string_lossy().into_owned())
        .ok_or("请先选择资料库。")?;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|_| "无法在文件管理器中打开资料库。".to_owned())
}

#[tauri::command]
fn open_support(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.ensure_ready()?;
    app.opener()
        .open_url("https://buymeacoffee.com/edward_lee", None::<&str>)
        .map_err(|_| "无法打开支持页面；请检查默认浏览器设置。".to_owned())
}

#[tauri::command]
fn set_launch_at_login(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<(), String> {
    state.ensure_ready()?;
    let mut settings = state.settings.lock().map_err(|_| "本机设置暂时不可用。")?;
    let previous = settings.launch_at_login;
    let apply = |value| {
        if value {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        }
    };
    apply(enabled).map_err(|_| "无法更改系统的登录启动设置。".to_owned())?;
    let mut next = settings.clone();
    next.launch_at_login = enabled;
    if let Err(error) = state.save(&next) {
        if apply(previous).is_err() {
            return Err(format!("{error} 系统登录启动设置可能已改变，请手动检查。"));
        }
        return Err(error);
    }
    *settings = next;
    Ok(())
}

fn active_library(state: &Arc<AppState>, expected: Profile) -> Result<PathBuf, String> {
    state.ensure_ready()?;
    let running = state.running.lock().map_err(|_| "本地服务暂时不可用。")?;
    let active = running.as_ref().ok_or("请先启动本地服务。")?;
    if active.profile != expected {
        return Err("这个操作不适用于当前资料库类型。".into());
    }
    Ok(active.root.clone())
}

fn safe_existing_folder(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() {
        return Ok(root.to_path_buf());
    }
    if !library::valid_relative_path(relative) {
        return Err("目标文件夹名称无效。".into());
    }
    let target = root
        .join(relative)
        .canonicalize()
        .map_err(|_| "目标文件夹不存在。")?;
    if !target.starts_with(root) || !target.is_dir() {
        return Err("目标文件夹不在当前资料库内。".into());
    }
    Ok(target)
}

fn general_note_target(
    root: &Path,
    title: &str,
    folder: &str,
) -> Result<(PathBuf, String), String> {
    let title = title.trim();
    validate_name(title)?;
    let folder = safe_existing_folder(root, folder)?;
    let filename = format!("{title}.md");
    validate_name(&filename)?;
    let target = folder.join(filename);
    let relative_path = target
        .strip_prefix(root)
        .map_err(|_| "目标文件不在当前资料库内。")?
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    Ok((target, relative_path))
}

#[tauri::command]
fn preview_note(
    state: State<'_, Arc<AppState>>,
    title: String,
    folder: String,
) -> Result<NotePreview, String> {
    let root = active_library(state.inner(), Profile::General)?;
    let (target, relative_path) = general_note_target(&root, &title, &folder)?;
    Ok(NotePreview {
        relative_path,
        exists: fs::symlink_metadata(target).is_ok(),
    })
}

#[tauri::command]
async fn create_note(
    state: State<'_, Arc<AppState>>,
    title: String,
    folder: String,
) -> Result<Status, String> {
    let root = active_library(state.inner(), Profile::General)?;
    let (target, _) = general_note_target(&root, &title, &folder)?;
    let content = format!("# {}\n", title.trim());
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|_| "同名笔记已经存在，或无法在这里创建文件。".to_owned())?;
    use std::io::Write;
    file.write_all(content.as_bytes())
        .map_err(|_| "笔记创建未完成，请检查目标文件。".to_owned())?;
    drop(file);
    refresh_now(state).await
}

fn create_dir_if_missing(parent: &Path, name: &str, root: &Path) -> Result<PathBuf, String> {
    validate_name(name)?;
    let target = parent.join(name);
    if !target.exists() {
        fs::create_dir(&target).map_err(|_| "无法创建目标文件夹。".to_owned())?;
    }
    let canonical = target.canonicalize().map_err(|_| "目标文件夹无法打开。")?;
    if !canonical.starts_with(root) || !canonical.is_dir() {
        return Err("目标文件夹不在当前资料库内。".into());
    }
    Ok(canonical)
}

#[tauri::command]
async fn create_week(
    state: State<'_, Arc<AppState>>,
    semester: String,
    unit: String,
    week: u8,
    end_week: Option<u8>,
) -> Result<Status, String> {
    let root = active_library(state.inner(), Profile::Study)?;
    validate_name(&semester)?;
    validate_name(&unit)?;
    if week == 0 || week > 99 || end_week.is_some_and(|end| end <= week || end > 99) {
        return Err("Week 必须是 1–99；合并周次的结束数字必须更大。".into());
    }
    let content = create_dir_if_missing(&root, "content", &root)?;
    let semester_dir = create_dir_if_missing(&content, &semester, &root)?;
    let unit_dir = create_dir_if_missing(&semester_dir, &unit, &root)?;
    let week_key = end_week.map_or_else(
        || format!("week-{week:02}"),
        |end| format!("weeks-{week:02}-{end:02}"),
    );
    let week_dir = create_dir_if_missing(&unit_dir, &week_key, &root)?;
    let target = week_dir.join(format!("{week_key}-notes.md"));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|_| "这周的主笔记已经存在，或无法创建文件。".to_owned())?;
    use std::io::Write;
    file.write_all(
        format!(
            "# {}\n",
            end_week.map_or_else(
                || format!("Week {week}"),
                |end| format!("Weeks {week}–{end}")
            )
        )
        .as_bytes(),
    )
    .map_err(|_| "Week 模板创建未完成，请检查目标文件。".to_owned())?;
    drop(file);
    refresh_now(state).await
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// A later successful service action supersedes any tray or startup error still on display.
fn clear_reported_error(state: &AppState) {
    if let Ok(mut error) = state.startup_error.lock() {
        *error = None;
    }
}

fn report_tray_error(app: &AppHandle, error: String) {
    let state = app.state::<Arc<AppState>>();
    if let Ok(mut visible_error) = state.startup_error.lock() {
        *visible_error = Some(error.clone());
    }
    show_window(app);
    // The event updates an already-open dialog; status retains the error if the event is missed.
    let _ = app.emit_to("main", "note-portal-tray-error", error);
}

fn tray_menu(app: &AppHandle, language: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let zh = language == "zh";
    MenuBuilder::new(app)
        .text(
            "show",
            if zh {
                "显示控制窗口"
            } else {
                "Show control window"
            },
        )
        .text("open", if zh { "打开阅读器" } else { "Open reader" })
        .text("start", if zh { "启动服务" } else { "Start service" })
        .text("stop", if zh { "停止服务" } else { "Stop service" })
        .separator()
        .text(
            "quit",
            if zh {
                "退出 Note Portal"
            } else {
                "Quit Note Portal"
            },
        )
        .build()
}

#[tauri::command]
fn set_ui_language(app: AppHandle, language: String) -> Result<(), String> {
    if language != "zh" && language != "en" {
        return Err("Unsupported interface language".into());
    }
    let menu = tray_menu(&app, &language).map_err(|_| "Unable to update taskbar menu")?;
    app.tray_by_id("note-portal-tray")
        .ok_or("Taskbar icon is unavailable")?
        .set_menu(Some(menu))
        .map_err(|_| "Unable to update taskbar menu".to_owned())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_window(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg("--note-portal-autostart")
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_status,
            get_app_version,
            restore_settings_backup,
            reset_corrupt_settings,
            get_notice,
            get_guide,
            accept_notice,
            complete_guide,
            pick_folder,
            preview_folder,
            list_general_folders,
            select_library,
            create_library,
            start_service,
            stop_service,
            refresh_now,
            open_portal,
            open_library_folder,
            open_support,
            set_launch_at_login,
            create_note,
            preview_note,
            create_week,
            set_theme_color,
            set_brand_logo,
            clear_brand_logo,
            set_ui_language,
            quit,
        ])
        .setup(|app| {
            let settings_path = app.path().app_data_dir()?.join("settings.json");
            let state = AppState::load(settings_path);
            app.manage(state.clone());

            let menu = tray_menu(app.handle(), platform::system_language())?;
            let icon = app.default_window_icon().ok_or("缺少应用图标")?.clone();
            TrayIconBuilder::with_id("note-portal-tray")
                .icon(icon)
                .tooltip("Note Portal")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_window(app),
                    "open" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<Arc<AppState>>();
                            if let Err(error) = open_portal(app.clone(), state).await {
                                report_tray_error(&app, error);
                            }
                        });
                    }
                    "start" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<Arc<AppState>>();
                            if let Err(error) = start_service(app.clone(), state, false).await {
                                report_tray_error(&app, error);
                            }
                        });
                    }
                    "stop" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<Arc<AppState>>();
                            if let Err(error) = stop_service(state).await {
                                report_tray_error(&app, error);
                            }
                        });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let autostart = std::env::args().any(|arg| arg == "--note-portal-autostart");
            // The window is created hidden so a login launch never flashes it on screen.
            let start_hidden = autostart
                && state
                    .settings
                    .lock()
                    .expect("settings mutex poisoned")
                    .ready();
            if !start_hidden {
                if let Some(window) = app.get_webview_window("main") {
                    window.show()?;
                    let _ = window.set_focus();
                }
            }
            let selection =
                state.settings.lock().ok().and_then(|settings| {
                    settings.ready().then(|| settings.library.clone()).flatten()
                });
            if let Some(selection) = selection {
                state.startup_in_progress.store(true, Ordering::SeqCst);
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = activate(&app_handle, &state, selection, !autostart).await {
                        if let Ok(mut startup_error) = state.startup_error.lock() {
                            *startup_error = Some(error);
                        }
                    }
                    state.startup_in_progress.store(false, Ordering::SeqCst);
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<Arc<AppState>>();
                if !state
                    .settings
                    .lock()
                    .map(|settings| settings.ready())
                    .unwrap_or(false)
                {
                    window.app_handle().exit(0);
                } else {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Note Portal failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn automatic_activation_reports_starting_until_it_finishes() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().join("settings.json"));
        assert_eq!(current_status(&state).await.service_state, "stopped");
        state.startup_in_progress.store(true, Ordering::SeqCst);
        assert_eq!(current_status(&state).await.service_state, "starting");
        state.startup_in_progress.store(false, Ordering::SeqCst);
        assert_eq!(current_status(&state).await.service_state, "stopped");
    }

    #[test]
    fn windows_extended_paths_are_human_readable_only_at_display_boundary() {
        assert_eq!(friendly_path(Path::new(r"\\?\C:\Notes")), r"C:\Notes");
        assert_eq!(
            friendly_path(Path::new(r"\\?\UNC\server\share")),
            r"\\server\share"
        );
        assert_eq!(friendly_path(Path::new("/notes")), "/notes");
    }

    #[test]
    fn bundled_notices_are_localised_user_copy_without_internal_contract() {
        let chinese = get_notice("zh".into());
        let english = get_notice("en".into());
        assert!(chinese.contains("本机处理与隐私"));
        assert!(english.contains("Local processing and privacy"));
        for notice in [chinese, english] {
            assert!(notice.contains("1.3"));
            assert!(!notice.contains("Implementation contract"));
            assert!(!notice.contains("Required local acceptance fields"));
        }
    }

    #[test]
    fn settings_backup_can_restore_and_corrupt_file_can_be_preserved_before_reset() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let state = AppState::load(path.clone());
        let first = Settings {
            guide_version: Some("1".into()),
            ..Settings::default()
        };
        state.save(&first).unwrap();
        let mut second = first.clone();
        second.launch_at_login = true;
        state.save(&second).unwrap();
        let backup: Settings =
            serde_json::from_slice(&fs::read(path.with_extension("json.bak")).unwrap()).unwrap();
        assert!(!backup.launch_at_login);

        fs::write(&path, b"{broken").unwrap();
        let damaged = AppState::load(path.clone());
        assert!(damaged.has_settings_error());
        damaged.restore_settings_backup().unwrap();
        assert!(!damaged.has_settings_error());
        assert_eq!(
            damaged.settings.lock().unwrap().guide_version.as_deref(),
            Some("1")
        );

        fs::write(&path, b"{broken again").unwrap();
        let damaged = AppState::load(path.clone());
        let preserved = damaged.reset_corrupt_settings().unwrap();
        assert_eq!(fs::read(preserved).unwrap(), b"{broken again");
        assert!(!damaged.has_settings_error());
        let reset: Settings = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert!(reset.library.is_none());
    }

    #[test]
    fn unknown_saved_theme_uses_safe_default() {
        let settings: Settings =
            serde_json::from_str(r#"{"themeColor":"new-future-colour"}"#).unwrap();
        assert!(matches!(settings.theme_color, ThemeColor::Green));
    }

    #[test]
    fn settings_write_overwrites_in_place_when_rename_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let refuse = |_: &Path, _: &Path| Err(std::io::Error::other("rename refused"));
        let existing = dir.path().join("settings.json");
        fs::write(&existing, "old").unwrap();
        replace_settings_file(&existing, b"new", refuse).unwrap();
        assert_eq!(fs::read_to_string(&existing).unwrap(), "new");
        let fresh = dir.path().join("settings.json.bak");
        replace_settings_file(&fresh, b"first", refuse).unwrap();
        assert_eq!(fs::read_to_string(&fresh).unwrap(), "first");
        let mut names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        names.sort();
        assert_eq!(names, ["settings.json", "settings.json.bak"]);
    }

    #[cfg(unix)]
    #[test]
    fn settings_save_refuses_symlink_without_touching_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("outside.json");
        fs::write(&target, "untouched").unwrap();
        let path = dir.path().join("settings.json");
        std::os::unix::fs::symlink(&target, &path).unwrap();
        let state = AppState::load(path);
        assert!(state.save(&Settings::default()).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "untouched");
    }

    #[cfg(unix)]
    #[test]
    fn settings_backup_refuses_symlink_without_touching_primary_or_target() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let state = AppState::load(path.clone());
        state.save(&Settings::default()).unwrap();
        let original = fs::read(&path).unwrap();
        let target = dir.path().join("outside.json");
        fs::write(&target, "untouched").unwrap();
        std::os::unix::fs::symlink(&target, path.with_extension("json.bak")).unwrap();
        assert!(state.save(&Settings::default()).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(fs::read_to_string(target).unwrap(), "untouched");
    }

    #[test]
    fn general_note_preview_uses_the_creation_path() {
        let library = tempfile::tempdir().unwrap();
        fs::create_dir(library.path().join("reading")).unwrap();
        let root = library.path().canonicalize().unwrap();

        let (target, relative) = general_note_target(&root, "  Book notes  ", "reading").unwrap();
        assert_eq!(relative, "reading/Book notes.md");
        assert_eq!(target, root.join("reading").join("Book notes.md"));
    }

    #[test]
    fn logo_upload_accepts_raw_bytes_and_postmessage_fallback() {
        use tauri::ipc::InvokeBody;
        let png = b"\x89PNG\r\n\x1a\nbody".to_vec();
        assert_eq!(
            logo_upload_bytes(&InvokeBody::Raw(png.clone())).unwrap(),
            png
        );
        assert_eq!(
            logo_upload_bytes(&InvokeBody::Json(serde_json::json!(png))).unwrap(),
            png
        );
        assert!(logo_upload_bytes(&InvokeBody::Json(serde_json::json!({ "bytes": [1] }))).is_err());
    }

    #[test]
    fn general_note_preview_rejects_paths_outside_the_library() {
        let library = tempfile::tempdir().unwrap();
        assert!(general_note_target(library.path(), "Note", "../outside").is_err());
        assert!(general_note_target(library.path(), "../outside", "").is_err());
    }

    #[test]
    fn onboarding_requires_current_notice_and_completed_guide() {
        let mut settings = Settings::default();
        assert!(!settings.ready());
        settings.notice_version = Some(NOTICE_VERSION.into());
        settings.accepted_at = Some("2026-09-23T00:00:00Z".into());
        assert!(settings.accepted());
        assert!(!settings.ready());
        settings.guide_version = Some(GUIDE_VERSION.into());
        assert!(settings.ready());
        settings.notice_version = Some("1.1".into());
        assert!(!settings.ready());
    }

    #[test]
    fn brand_logo_accepts_only_small_raster_images_and_safe_paths() {
        assert_eq!(logo_kind(b"\x89PNG\r\n\x1a\nbody").unwrap().0, "png");
        assert_eq!(logo_kind(b"\xff\xd8\xffbody").unwrap().0, "jpg");
        assert_eq!(logo_kind(b"RIFF0000WEBPbody").unwrap().0, "webp");
        assert!(logo_kind(b"<svg><script/></svg>").is_err());
        assert!(logo_kind(&vec![0; MAX_BRAND_LOGO_BYTES + 1]).is_err());
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        assert!(logo_path(&settings, "../secret.png").is_err());
        assert!(logo_path(&settings, "brand-logo-1234.png").is_err());
        assert!(logo_path(&settings, "brand-logo-0123456789abcdef01234567.png").is_ok());
    }

    #[test]
    fn branding_is_loaded_from_app_data_not_a_user_library() {
        let dir = tempfile::tempdir().unwrap();
        let settings_path = dir.path().join("settings.json");
        let filename = "brand-logo-0123456789abcdef01234567.png";
        fs::write(dir.path().join(filename), b"\x89PNG\r\n\x1a\nbody").unwrap();
        let settings = Settings {
            theme_color: ThemeColor::Blue,
            logo_file: Some(filename.into()),
            ..Settings::default()
        };
        let brand = branding_from_settings(&settings_path, &settings).unwrap();
        assert_eq!(brand.color, "#165e91");
        assert_eq!(brand.logo.unwrap().mime, "image/png");
    }

    #[test]
    fn missing_optional_logo_falls_back_to_text_and_keeps_colour() {
        let dir = tempfile::tempdir().unwrap();
        let settings_path = dir.path().join("settings.json");
        let settings = Settings {
            theme_color: ThemeColor::Blue,
            logo_file: Some("brand-logo-0123456789abcdef01234567.png".into()),
            ..Settings::default()
        };
        let (branding, warning) = branding_with_optional_logo(&settings_path, &settings);
        assert_eq!(branding.color, "#165e91");
        assert!(branding.logo.is_none());
        assert!(warning.is_some());
    }
}
