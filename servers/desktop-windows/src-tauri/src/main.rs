#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod library;
mod server;

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use library::{Diagnostic, Profile, TreeNode};

const NOTICE_VERSION: &str = "1.1";
const NOTICE: &str = include_str!("../../docs/ACADEMIC_INTEGRITY_NOTICE.md");
const GUIDE: &str = include_str!("../../docs/GETTING_STARTED.zh-CN.md");
const LICENSE: &str = include_str!("../../../../LICENSE");

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
    library: Option<Selection>,
    launch_at_login: bool,
}

impl Settings {
    fn accepted(&self) -> bool {
        self.notice_version.as_deref() == Some(NOTICE_VERSION) && self.accepted_at.is_some()
    }
}

struct Running {
    service: server::Service,
    handle: server::WebHandle,
    root: PathBuf,
    profile: Profile,
}

struct AppState {
    settings_path: PathBuf,
    settings: Mutex<Settings>,
    settings_error: Option<String>,
    startup_error: Mutex<Option<String>>,
    running: Mutex<Option<Running>>,
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
            settings_error,
            startup_error: Mutex::new(None),
            running: Mutex::new(None),
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
        fs::write(&self.settings_path, content)
            .map_err(|_| "无法写入本机设置；请检查磁盘和权限。".to_owned())
    }

    fn ensure_accepted(&self) -> Result<(), String> {
        if self.settings_error.is_some() {
            return Err("本机设置需要人工检查，不能继续使用旧的资料库。".into());
        }
        if !self
            .settings
            .lock()
            .map_err(|_| "本机设置暂时不可用。")?
            .accepted()
        {
            return Err("请先阅读并同意当前使用提示。".into());
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    notice_version: &'static str,
    notice_accepted: bool,
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
    launch_at_login: bool,
}

async fn current_status(state: &Arc<AppState>) -> Status {
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
        accepted_at: settings.accepted_at,
        library_path: settings
            .library
            .as_ref()
            .map(|item| item.path.to_string_lossy().into_owned()),
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
        } else {
            "stopped"
        },
        port,
        document_count,
        diagnostics,
        tree,
        last_refresh,
        error: state.settings_error.clone().or(runtime_error).or_else(|| {
            state
                .startup_error
                .lock()
                .ok()
                .and_then(|error| error.clone())
        }),
        launch_at_login: settings.launch_at_login,
    }
}

#[tauri::command]
async fn get_status(state: State<'_, Arc<AppState>>) -> Result<Status, String> {
    Ok(current_status(state.inner()).await)
}

#[tauri::command]
fn get_notice() -> String {
    format!("{NOTICE}\n\n## Open-source license\n\n{LICENSE}\n\nThe bundled Marked and KaTeX packages retain their MIT licenses in the reader's vendor directory.")
}

#[tauri::command]
fn get_guide() -> &'static str {
    GUIDE
}

#[tauri::command]
fn accept_notice(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    if state.settings_error.is_some() {
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
async fn pick_folder(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>, String> {
    state.ensure_accepted()?;
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

#[tauri::command]
async fn preview_folder(
    state: State<'_, Arc<AppState>>,
    path: String,
    profile: Profile,
) -> Result<Preview, String> {
    state.ensure_accepted()?;
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

async fn activate(
    app: &AppHandle,
    state: &Arc<AppState>,
    selection: Selection,
    open_browser: bool,
) -> Result<Status, String> {
    state.ensure_accepted()?;
    let _operation = state.operation.lock().await;
    let root = selection
        .path
        .canonicalize()
        .map_err(|_| "资料库文件夹无法打开。")?;
    let (new_service, new_handle) = server::start(root.clone(), selection.profile).await?;
    let mut next = state
        .settings
        .lock()
        .map_err(|_| "本机设置暂时不可用。")?
        .clone();
    next.library = Some(Selection {
        path: root.clone(),
        profile: selection.profile,
    });
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
    state.ensure_accepted()?;
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
    state.ensure_accepted()?;
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
    }
    Ok(current_status(state.inner()).await)
}

#[tauri::command]
async fn refresh_now(state: State<'_, Arc<AppState>>) -> Result<Status, String> {
    state.ensure_accepted()?;
    let handle = state
        .running
        .lock()
        .map_err(|_| "本地服务暂时不可用。")?
        .as_ref()
        .map(|running| running.handle.clone())
        .ok_or("本地服务尚未启动。")?;
    server::refresh(&handle).await?;
    Ok(current_status(state.inner()).await)
}

#[tauri::command]
async fn open_portal(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.ensure_accepted()?;
    let url = state
        .running
        .lock()
        .map_err(|_| "本地服务暂时不可用。")?
        .as_ref()
        .map(|running| running.service.browser_url())
        .ok_or("请先启动本地服务。")?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "无法打开默认浏览器；请检查系统默认浏览器设置。".to_owned())
}

#[tauri::command]
fn open_library_folder(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.ensure_accepted()?;
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
    state.ensure_accepted()?;
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
    state.ensure_accepted()?;
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
    state.ensure_accepted()?;
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

#[tauri::command]
async fn create_note(
    state: State<'_, Arc<AppState>>,
    title: String,
    folder: String,
) -> Result<Status, String> {
    let root = active_library(state.inner(), Profile::General)?;
    let title = title.trim();
    validate_name(title)?;
    let folder = safe_existing_folder(&root, &folder)?;
    let filename = format!("{title}.md");
    validate_name(&filename)?;
    let target = folder.join(filename);
    let content = format!("# {title}\n");
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
            get_notice,
            get_guide,
            accept_notice,
            pick_folder,
            preview_folder,
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
            create_week,
            quit,
        ])
        .setup(|app| {
            let settings_path = app.path().app_data_dir()?.join("settings.json");
            let state = AppState::load(settings_path);
            app.manage(state.clone());

            let menu = MenuBuilder::new(app)
                .text("show", "显示控制窗口")
                .text("open", "打开阅读器")
                .text("start", "启动服务")
                .text("stop", "停止服务")
                .separator()
                .text("quit", "退出 Note Portal")
                .build()?;
            let icon = app.default_window_icon().ok_or("缺少应用图标")?.clone();
            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_window(app),
                    "open" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<Arc<AppState>>();
                            let _ = open_portal(app.clone(), state).await;
                        });
                    }
                    "start" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<Arc<AppState>>();
                            let _ = start_service(app.clone(), state, false).await;
                        });
                    }
                    "stop" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<Arc<AppState>>();
                            let _ = stop_service(state).await;
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
            if autostart
                && state
                    .settings
                    .lock()
                    .expect("settings mutex poisoned")
                    .accepted()
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.hide()?;
                }
            }
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let selection = state.settings.lock().ok().and_then(|settings| {
                    settings
                        .accepted()
                        .then(|| settings.library.clone())
                        .flatten()
                });
                if let Some(selection) = selection {
                    if let Err(error) = activate(&app_handle, &state, selection, !autostart).await {
                        if let Ok(mut startup_error) = state.startup_error.lock() {
                            *startup_error = Some(error);
                        }
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<Arc<AppState>>();
                if !state
                    .settings
                    .lock()
                    .map(|settings| settings.accepted())
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
