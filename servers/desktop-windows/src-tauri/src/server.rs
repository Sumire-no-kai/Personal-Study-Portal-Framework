use std::{
    convert::Infallible,
    net::SocketAddr,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderValue, Method, Request, StatusCode, Uri},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Json, Router,
};
use include_dir::{include_dir, Dir};
use notify::{
    event::ModifyKind, Event as NotifyEvent, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Deserialize;
use serde_json::json;
use tokio::{
    net::TcpListener,
    sync::{broadcast, oneshot, watch, RwLock},
    task::JoinHandle,
};
use tokio_stream::{
    wrappers::{BroadcastStream, WatchStream},
    StreamExt,
};

use crate::library::{self, Profile, Snapshot};

static READER_VENDOR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../../vendor");
const READER_INDEX: &str = include_str!("../../reader/index.html");
const READER_APP: &[u8] = include_bytes!("../../reader/app.js");
const READER_STYLES: &[u8] = include_bytes!("../../reader/styles.css");
const READER_THEME: &[u8] = include_bytes!("../../reader/theme-init.js");
static DESKTOP_ICON: &[u8] = include_bytes!("../icons/icon.png");

#[derive(Clone)]
pub struct BrandLogo {
    pub mime: &'static str,
    pub bytes: Arc<Vec<u8>>,
}

#[derive(Clone)]
pub struct Branding {
    pub color: &'static str,
    pub logo: Option<BrandLogo>,
}

#[derive(Clone)]
struct WebState {
    root: PathBuf,
    profile: Profile,
    port: u16,
    access_token: String,
    snapshot: Arc<RwLock<Arc<Snapshot>>>,
    events: broadcast::Sender<String>,
    sequence: Arc<AtomicU64>,
    refresh_lock: Arc<tokio::sync::Mutex<()>>,
    last_error: Arc<RwLock<Option<String>>>,
    branding: Arc<RwLock<Branding>>,
    stopping: watch::Receiver<bool>,
}

pub struct Service {
    pub port: u16,
    access_token: String,
    pub snapshot: Arc<RwLock<Arc<Snapshot>>>,
    pub last_error: Arc<RwLock<Option<String>>>,
    pub branding: Arc<RwLock<Branding>>,
    shutdown: Option<oneshot::Sender<()>>,
    stopping: watch::Sender<bool>,
    watcher: JoinHandle<()>,
}

impl Service {
    pub fn browser_url(&self) -> String {
        format!(
            "http://127.0.0.1:{}/?access={}",
            self.port, self.access_token
        )
    }

    pub fn stop(mut self) {
        self.watcher.abort();
        let _ = self.stopping.send(true);
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

fn guarded_response(status: StatusCode) -> Response {
    let mut response = (status, "Request not allowed").into_response();
    secure_headers(&mut response);
    response
}

fn expired_session_response() -> Response {
    const BODY: &str = "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>Note Portal · 阅读会话已结束</title><h1>阅读会话已结束</h1><p>请在 Note Portal 控制窗口点击“打开阅读器”，重新打开本机阅读页。</p><h1>Reading session expired</h1><p>Open the Note Portal control window and choose Open reader to start a new local reading session.</p></html>";
    let mut response = (
        StatusCode::FORBIDDEN,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        BODY,
    )
        .into_response();
    secure_headers(&mut response);
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; base-uri 'none'; form-action 'none'"),
    );
    response
}

fn allowed_request(host: Option<&str>, origin: Option<&str>, port: u16) -> bool {
    let expected_host = format!("127.0.0.1:{port}");
    let expected_origin = format!("http://{expected_host}");
    host == Some(expected_host.as_str()) && origin.is_none_or(|value| value == expected_origin)
}

fn has_session_cookie(cookie: Option<&str>, token: &str) -> bool {
    cookie.is_some_and(|value| {
        value.split(';').any(|part| {
            part.trim()
                .strip_prefix("note_portal_session=")
                .is_some_and(|candidate| candidate == token)
        })
    })
}

fn secure_headers(response: &mut Response) {
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        "cross-origin-resource-policy",
        HeaderValue::from_static("same-origin"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
}

async fn request_guard(
    State(state): State<WebState>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok());
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if !allowed_request(host, origin, state.port) {
        return guarded_response(StatusCode::FORBIDDEN);
    }
    if request.method() == Method::GET
        && request.uri().path() == "/"
        && request.uri().query() == Some(format!("access={}", state.access_token).as_str())
    {
        let mut response = StatusCode::SEE_OTHER.into_response();
        response
            .headers_mut()
            .insert(header::LOCATION, HeaderValue::from_static("/"));
        let cookie = format!(
            "note_portal_session={}; HttpOnly; SameSite=Strict; Path=/",
            state.access_token
        );
        response.headers_mut().insert(
            header::SET_COOKIE,
            HeaderValue::from_str(&cookie).expect("hex session cookie is valid"),
        );
        secure_headers(&mut response);
        return response;
    }
    let cookie = request
        .headers()
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok());
    if !has_session_cookie(cookie, &state.access_token) {
        return if request.method() == Method::GET && request.uri().path() == "/" {
            expired_session_response()
        } else {
            guarded_response(StatusCode::FORBIDDEN)
        };
    }
    let mut response = next.run(request).await;
    secure_headers(&mut response);
    response
}

fn new_session_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "无法创建本地阅读会话。")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn reader_asset(path: &str) -> Response {
    if path
        .split('/')
        .any(|component| component.starts_with('.') || component == "..")
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    let contents: &[u8] = match path {
        "app.js" => READER_APP,
        "styles.css" => READER_STYLES,
        "theme-init.js" => READER_THEME,
        _ if path.starts_with("vendor/") => {
            let Some(file) = READER_VENDOR.get_file(&path["vendor/".len()..]) else {
                return StatusCode::NOT_FOUND.into_response();
            };
            file.contents()
        }
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = ([(header::CONTENT_TYPE, mime.as_ref())], contents.to_vec()).into_response();
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'"),
    );
    response
}

async fn index() -> Response {
    let html = READER_INDEX
        .replace("<body>", "<body class=\"profile-desktop\">")
        .replace(
            "  <script src=\"app.js",
            "  <script src=\"notes-manifest.js\"></script>\n  <script src=\"app.js",
        );
    let mut response = ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response();
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'"),
    );
    response
}

async fn brand_styles(State(state): State<WebState>) -> Response {
    let brand = state.branding.read().await;
    let color = brand.color;
    let logo = if brand.logo.is_some() {
        "body.profile-desktop .brand__product::before { content: ''; display: inline-block; width: 30px; height: 30px; margin-right: 10px; vertical-align: middle; background: url('/reader-logo') center / contain no-repeat; }"
    } else {
        ""
    };
    let css = format!(
        "body.profile-desktop {{ --primary: {color}; --primary-hover: color-mix(in srgb, {color}, black 18%); --primary-pressed: color-mix(in srgb, {color}, black 28%); --primary-pale: color-mix(in srgb, {color}, white 90%); --accent: {color}; --accent-pale: color-mix(in srgb, {color}, white 90%); }} :root[data-reading-theme='dark'] body.profile-desktop {{ --primary: color-mix(in srgb, {color}, white 48%); --primary-hover: color-mix(in srgb, {color}, white 60%); --primary-pressed: color-mix(in srgb, {color}, white 72%); --primary-pale: color-mix(in srgb, {color}, black 70%); --accent: color-mix(in srgb, {color}, white 48%); --accent-pale: color-mix(in srgb, {color}, black 70%); }} {logo}"
    );
    ([(header::CONTENT_TYPE, "text/css; charset=utf-8")], css).into_response()
}

async fn brand_logo(State(state): State<WebState>) -> Response {
    let brand = state.branding.read().await;
    match &brand.logo {
        Some(logo) => (
            [(header::CONTENT_TYPE, logo.mime)],
            logo.bytes.as_ref().clone(),
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn static_file(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if path == "favicon.png" {
        return ([(header::CONTENT_TYPE, "image/png")], DESKTOP_ICON.to_vec()).into_response();
    }
    if path.is_empty() || path.starts_with("api/") || path.starts_with("library/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    reader_asset(path)
}

async fn manifest(State(state): State<WebState>) -> Response {
    let snapshot = state.snapshot.read().await;
    let body = format!("window.PORTAL_DATA = {};", snapshot.manifest);
    (
        [(
            header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        body,
    )
        .into_response()
}

async fn library(State(state): State<WebState>) -> Json<serde_json::Value> {
    let snapshot = state.snapshot.read().await;
    Json(json!({
        "profile": state.profile,
        "generatedAt": snapshot.generated_at,
        "releaseId": snapshot.release_id,
        "tree": snapshot.tree,
        "documents": snapshot.manifest["documents"],
        "diagnostics": snapshot.diagnostics,
    }))
}

async fn health(State(state): State<WebState>) -> Json<serde_json::Value> {
    let snapshot = state.snapshot.read().await;
    Json(
        json!({"status":"running", "releaseId": snapshot.release_id, "documents": snapshot.documents.len()}),
    )
}

async fn document(State(state): State<WebState>, Path(id): Path<String>) -> Response {
    let snapshot = state.snapshot.read().await;
    match snapshot.documents.get(&id) {
        Some(doc) => (
            [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
            doc.body.to_string(),
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn asset(State(state): State<WebState>, Path(path): Path<String>) -> Response {
    let expected_hash = {
        let snapshot = state.snapshot.read().await;
        snapshot.asset_hashes.get(&path).cloned()
    };
    let Some(expected_hash) = expected_hash else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(asset) = library::resolve_asset(&state.root, &path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(bytes) = library::read_stable_bytes(&asset) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    if blake3::hash(&bytes).to_hex().as_str() != expected_hash {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let mime = mime_guess::from_path(&asset).first_or_octet_stream();
    let mut response = ([(header::CONTENT_TYPE, mime.as_ref())], bytes).into_response();
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox; default-src 'none'; style-src 'unsafe-inline'"),
    );
    response
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    limit: Option<usize>,
}

async fn search(State(state): State<WebState>, Query(query): Query<SearchQuery>) -> Response {
    let needle = query.q.trim().to_lowercase();
    if needle.len() > 200 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if needle.is_empty() {
        return Json(json!({"results": []})).into_response();
    }
    let limit = query.limit.unwrap_or(24).min(50);
    if limit == 0 {
        return Json(json!({"results": []})).into_response();
    }
    let snapshot = state.snapshot.read().await;
    let mut results = Vec::new();
    let mut docs: Vec<_> = snapshot.documents.values().collect();
    docs.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    for doc in docs {
        let line = doc
            .body
            .lines()
            .find(|line| line.to_lowercase().contains(&needle));
        if line.is_none()
            && !doc.title.to_lowercase().contains(&needle)
            && !doc
                .tags
                .iter()
                .any(|tag| tag.to_lowercase().contains(&needle))
        {
            continue;
        }
        results.push(json!({
            "noteId": doc.id,
            "unitCode": doc.unit_code,
            "weekLabel": doc.week_label,
            "noteTitle": doc.title,
            "heading": "",
            "anchor": "",
            "snippet": line.unwrap_or(&doc.title).chars().take(220).collect::<String>()
        }));
        if results.len() == limit {
            break;
        }
    }
    Json(json!({"results": results})).into_response()
}

async fn events(
    State(state): State<WebState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let release = state.snapshot.read().await.release_id.clone();
    let initial = tokio_stream::once(Some(Ok(Event::default()
        .event("release")
        .data(json!({"releaseId": release}).to_string()))));
    let updates = BroadcastStream::new(state.events.subscribe()).filter_map(|item| {
        item.ok().map(|release_id| {
            Some(Ok(Event::default()
                .event("release")
                .data(json!({"releaseId": release_id}).to_string())))
        })
    });
    let stopping =
        WatchStream::new(state.stopping.clone()).filter_map(|stopped| stopped.then_some(None));
    let stream = initial
        .chain(updates)
        .merge(stopping)
        .take_while(Option::is_some)
        .map(Option::unwrap);
    Sse::new(stream).keep_alive(KeepAlive::default())
}

pub async fn refresh(state: &WebHandle) -> Result<bool, String> {
    let current = state.0.clone();
    let _refresh = current.refresh_lock.lock().await;
    let root = current.root.clone();
    let profile = current.profile;
    let previous = current.snapshot.read().await.clone();
    let sequence = current.sequence.fetch_add(1, Ordering::SeqCst) + 1;
    let staged = tokio::task::spawn_blocking(move || {
        library::scan_with_previous(&root, profile, sequence, Some(&previous))
    })
    .await
    .map_err(|_| "扫描任务意外中断；当前阅读内容保持不变。".to_owned())?;
    match staged {
        Ok(mut snapshot) => {
            let mut active = current.snapshot.write().await;
            if active.signature == snapshot.signature {
                *current.last_error.write().await = None;
                return Ok(false);
            }
            library::preserve_rename_ids(&mut snapshot, &active);
            let release_id = snapshot.release_id.clone();
            *active = Arc::new(snapshot);
            *current.last_error.write().await = None;
            let _ = current.events.send(release_id);
            Ok(true)
        }
        Err(error) => {
            *current.last_error.write().await = Some(error.clone());
            Err(error)
        }
    }
}

#[derive(Clone)]
pub struct WebHandle(WebState);

fn relevant_event(
    root: &std::path::Path,
    event: &Result<NotifyEvent, notify::Error>,
    snapshot: Option<&Snapshot>,
) -> bool {
    let Ok(event) = event else {
        // A watcher overflow or lost-watch notification warrants one full rescan.
        return true;
    };
    if matches!(
        event.kind,
        EventKind::Access(_) | EventKind::Modify(ModifyKind::Metadata(_))
    ) {
        return false;
    }
    if event.paths.is_empty() {
        return true;
    }
    event.paths.iter().any(|path| {
        let Ok(relative) = path.strip_prefix(root) else {
            return true;
        };
        let ignored = relative.components().any(|part| {
            let name = part.as_os_str().to_string_lossy();
            name.starts_with('.')
                || matches!(name.as_ref(), "node_modules" | "target" | "__pycache__")
                || [".tmp", ".part", ".swp", ".bak", "~"]
                    .iter()
                    .any(|suffix| name.ends_with(suffix))
        });
        if ignored {
            return false;
        }
        if path.is_dir() {
            return true;
        }
        let relative = relative.to_string_lossy().replace('\\', "/");
        if snapshot.is_some_and(|snapshot| {
            let prefix = format!("{relative}/");
            snapshot
                .documents
                .values()
                .any(|doc| doc.relative_path.starts_with(&prefix))
                || snapshot
                    .asset_hashes
                    .keys()
                    .any(|asset| asset.starts_with(&prefix))
        }) {
            return true;
        }
        let Some(extension) = path.extension().and_then(|ext| ext.to_str()) else {
            return true;
        };
        ["md", "gif", "jpeg", "jpg", "png", "svg", "webp"]
            .iter()
            .any(|allowed| extension.eq_ignore_ascii_case(allowed))
    })
}

pub async fn start(
    root: PathBuf,
    profile: Profile,
    branding: Branding,
    preferred_port: Option<u16>,
) -> Result<(Service, WebHandle), String> {
    let root = root.canonicalize().map_err(|_| "无法打开资料库文件夹。")?;
    let snapshot = tokio::task::spawn_blocking({
        let root = root.clone();
        move || library::scan(&root, profile, 1)
    })
    .await
    .map_err(|_| "资料库扫描任务意外中断。")??;
    let listener = match preferred_port.filter(|port| *port != 0) {
        Some(port) => match TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await {
            Ok(listener) => listener,
            Err(_) => TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|_| "无法启动本地服务；请检查系统网络权限。")?,
        },
        None => TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "无法启动本地服务；请检查系统网络权限。")?,
    };
    let address: SocketAddr = listener
        .local_addr()
        .map_err(|_| "无法确定本地服务端口。")?;
    let access_token = new_session_token()?;
    let (event_tx, _) = broadcast::channel(32);
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let (stopping_tx, stopping_rx) = watch::channel(false);
    let state = WebState {
        root: root.clone(),
        profile,
        port: address.port(),
        access_token: access_token.clone(),
        snapshot: Arc::new(RwLock::new(Arc::new(snapshot))),
        events: event_tx,
        sequence: Arc::new(AtomicU64::new(1)),
        refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        last_error: Arc::new(RwLock::new(None)),
        branding: Arc::new(RwLock::new(branding)),
        stopping: stopping_rx,
    };
    let router = Router::new()
        .route("/", get(index))
        .route("/notes-manifest.js", get(manifest))
        .route("/reader-brand.css", get(brand_styles))
        .route("/reader-logo", get(brand_logo))
        .route("/api/health", get(health))
        .route("/api/library", get(library))
        .route("/api/documents/{id}", get(document))
        .route("/api/search", get(search))
        .route("/api/portal-events", get(events))
        .route("/library/{*path}", get(asset))
        .fallback(get(static_file))
        .layer(middleware::from_fn_with_state(state.clone(), request_guard))
        .with_state(state.clone());
    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    let handle = WebHandle(state.clone());
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(move |event| {
        let _ = tx.send(event);
    })
    .map_err(|_| "无法监控资料库变动；请检查文件夹权限。")?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|_| "无法监控资料库变动；请检查文件夹权限。")?;
    let watcher_handle = handle.clone();
    let watcher_task = tokio::spawn(async move {
        let _watcher = watcher;
        while let Some(first) = rx.recv().await {
            let snapshot = watcher_handle.0.snapshot.read().await.clone();
            let mut should_refresh = relevant_event(&root, &first, Some(&snapshot));
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            while let Ok(event) = rx.try_recv() {
                should_refresh |= relevant_event(&root, &event, Some(&snapshot));
            }
            if should_refresh {
                let _ = refresh(&watcher_handle).await;
            }
        }
    });
    let service = Service {
        port: address.port(),
        access_token,
        snapshot: state.snapshot.clone(),
        last_error: state.last_error.clone(),
        branding: state.branding.clone(),
        shutdown: Some(shutdown_tx),
        stopping: stopping_tx,
        watcher: watcher_task,
    };
    Ok((service, handle))
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, DataChange};
    use std::{
        fs,
        io::{Read, Write},
    };

    fn local_get(port: u16, path: &str, cookie: Option<&str>) -> String {
        let mut connection = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        connection
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let cookie = cookie.map_or_else(String::new, |value| format!("Cookie: {value}\r\n"));
        write!(
            connection,
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n{cookie}\r\n"
        )
        .unwrap();
        let mut response = String::new();
        connection.read_to_string(&mut response).unwrap();
        response
    }

    fn test_handle(root: &std::path::Path, profile: Profile) -> WebHandle {
        let snapshot = library::scan(root, profile, 1).unwrap();
        let (events, _) = broadcast::channel(8);
        WebHandle(WebState {
            root: root.canonicalize().unwrap(),
            profile,
            port: 0,
            access_token: "test-token".into(),
            snapshot: Arc::new(RwLock::new(Arc::new(snapshot))),
            events,
            sequence: Arc::new(AtomicU64::new(1)),
            refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
            last_error: Arc::new(RwLock::new(None)),
            branding: Arc::new(RwLock::new(Branding {
                color: "#14684e",
                logo: None,
            })),
            stopping: watch::channel(false).1,
        })
    }

    #[test]
    fn watcher_ignores_temp_and_access_but_keeps_atomic_rename() {
        let root = PathBuf::from("library");
        let access =
            NotifyEvent::new(EventKind::Access(AccessKind::Any)).add_path(root.join("note.md"));
        assert!(!relevant_event(&root, &Ok(access), None));
        let temporary = NotifyEvent::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
            .add_path(root.join("note.md.part"));
        assert!(!relevant_event(&root, &Ok(temporary), None));
        let renamed = NotifyEvent::new(EventKind::Modify(ModifyKind::Name(
            notify::event::RenameMode::Both,
        )))
        .add_path(root.join("note.md.part"))
        .add_path(root.join("note.md"));
        assert!(relevant_event(&root, &Ok(renamed), None));
    }

    #[test]
    fn watcher_refreshes_dotted_folder_creation_and_removal() {
        let root = tempfile::tempdir().unwrap();
        let dotted = root.path().join("Node.js notes");
        fs::create_dir(&dotted).unwrap();
        fs::write(dotted.join("intro.md"), "# Intro").unwrap();
        let snapshot = library::scan(root.path(), Profile::General, 1).unwrap();
        let created = NotifyEvent::new(EventKind::Any).add_path(dotted.clone());
        assert!(relevant_event(root.path(), &Ok(created), Some(&snapshot)));
        fs::remove_dir_all(&dotted).unwrap();
        let removed = NotifyEvent::new(EventKind::Any).add_path(dotted);
        assert!(relevant_event(root.path(), &Ok(removed), Some(&snapshot)));
        let unrelated = NotifyEvent::new(EventKind::Any).add_path(root.path().join("old.pdf"));
        assert!(!relevant_event(
            root.path(),
            &Ok(unrelated),
            Some(&snapshot)
        ));
    }

    #[test]
    fn request_guard_rejects_unexpected_host_and_origin() {
        assert!(allowed_request(Some("127.0.0.1:4172"), None, 4172));
        assert!(allowed_request(
            Some("127.0.0.1:4172"),
            Some("http://127.0.0.1:4172"),
            4172
        ));
        assert!(!allowed_request(Some("localhost:4172"), None, 4172));
        assert!(!allowed_request(
            Some("127.0.0.1:4172"),
            Some("https://evil.example"),
            4172
        ));
        assert!(!allowed_request(None, None, 4172));
    }

    #[test]
    fn session_cookie_requires_exact_per_launch_token() {
        assert!(has_session_cookie(
            Some("a=1; note_portal_session=abc"),
            "abc"
        ));
        assert!(!has_session_cookie(
            Some("note_portal_session=abcdef"),
            "abc"
        ));
        assert!(!has_session_cookie(Some("note_portal_session=abc"), "def"));
        assert!(!has_session_cookie(None, "abc"));
        let first = new_session_token().unwrap();
        let second = new_session_token().unwrap();
        assert_eq!(first.len(), 64);
        assert_ne!(first, second);
    }

    #[tokio::test]
    async fn document_routes_require_browser_bootstrap_session() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a.md"), "# Private note").unwrap();
        let (service, _) = start(
            root.path().to_path_buf(),
            Profile::General,
            Branding {
                color: "#14684e",
                logo: None,
            },
            None,
        )
        .await
        .unwrap();
        let port = service.port;
        let token = service.access_token.clone();
        let unauthenticated =
            tokio::task::spawn_blocking(move || local_get(port, "/notes-manifest.js", None))
                .await
                .unwrap();
        assert!(unauthenticated.starts_with("HTTP/1.1 403"));
        assert!(!unauthenticated.contains("Private note"));

        let expired = tokio::task::spawn_blocking(move || local_get(port, "/", None))
            .await
            .unwrap();
        assert!(expired.starts_with("HTTP/1.1 403"));
        assert!(expired.to_ascii_lowercase().contains("content-type: text/html; charset=utf-8"));
        assert!(expired.contains("default-src 'none'"));
        assert!(expired.contains("Reading session expired"));
        assert!(expired.contains("Open reader"));
        assert!(!expired.contains("Private note"));

        let bootstrap = tokio::task::spawn_blocking({
            let token = token.clone();
            move || local_get(port, &format!("/?access={token}"), None)
        })
        .await
        .unwrap();
        assert!(bootstrap.starts_with("HTTP/1.1 303"));
        assert!(bootstrap.contains(&format!("note_portal_session={token}")));
        assert!(bootstrap.contains("HttpOnly; SameSite=Strict"));

        let authenticated = tokio::task::spawn_blocking(move || {
            local_get(
                port,
                "/notes-manifest.js",
                Some(&format!("note_portal_session={token}")),
            )
        })
        .await
        .unwrap();
        assert!(authenticated.starts_with("HTTP/1.1 200"));
        assert!(authenticated.contains("a.md"));
        service.stop();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn stopping_service_closes_sse_and_releases_old_snapshot() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a.md"), "# Private note").unwrap();
        let (service, handle) = start(
            root.path().to_path_buf(),
            Profile::General,
            Branding {
                color: "#14684e",
                logo: None,
            },
            None,
        )
        .await
        .unwrap();
        let snapshot = handle.0.snapshot.read().await.clone();
        let weak = Arc::downgrade(&snapshot);
        drop(snapshot);
        let port = service.port;
        let token = service.access_token.clone();
        let (ready_tx, ready_rx) = oneshot::channel();
        let connection = tokio::task::spawn_blocking(move || {
            let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            write!(
                stream,
                "GET /api/portal-events HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nCookie: note_portal_session={token}\r\n\r\n"
            )
            .unwrap();
            let mut first = [0u8; 4096];
            let count = stream.read(&mut first).unwrap();
            assert!(String::from_utf8_lossy(&first[..count]).contains("200 OK"));
            let _ = ready_tx.send(());
            let mut remaining = Vec::new();
            stream.read_to_end(&mut remaining).unwrap();
        });
        ready_rx.await.unwrap();
        drop(handle);
        service.stop();
        connection.await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while weak.upgrade().is_some() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("old snapshot should be released after the SSE connection closes");
    }

    #[tokio::test]
    async fn preferred_port_is_used_or_falls_back_if_occupied() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a.md"), "# Note").unwrap();
        let free = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let preferred = free.local_addr().unwrap().port();
        drop(free);
        let brand = Branding {
            color: "#14684e",
            logo: None,
        };
        let (service, _) = start(
            root.path().to_path_buf(),
            Profile::General,
            brand.clone(),
            Some(preferred),
        )
        .await
        .unwrap();
        assert_eq!(service.port, preferred);
        service.stop();
        let occupied = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let occupied_port = occupied.local_addr().unwrap().port();
        let (fallback, _) = start(
            root.path().to_path_buf(),
            Profile::General,
            brand,
            Some(occupied_port),
        )
        .await
        .unwrap();
        assert_ne!(fallback.port, occupied_port);
        fallback.stop();
    }

    #[test]
    fn embedded_assets_are_explicitly_allowlisted() {
        assert_eq!(reader_asset("app.js").status(), StatusCode::OK);
        assert_eq!(
            reader_asset("vendor/marked.umd.js").status(),
            StatusCode::OK
        );
        assert_eq!(reader_asset("README.md").status(), StatusCode::NOT_FOUND);
        assert_eq!(
            reader_asset("USydLogoBlack.svg.png").status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            reader_asset("../.git/config").status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn desktop_index_uses_private_reader_copy_and_brand_css() {
        let response = index().await;
        let body = axum::body::to_bytes(response.into_body(), 100_000)
            .await
            .unwrap();
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(html.contains("reader-brand.css"));
        assert!(!html.contains("USydLogoBlack.svg.png"));
        assert!(html.contains("notes-manifest.js"));
    }

    #[tokio::test]
    async fn brand_routes_use_only_selected_color_and_logo_bytes() {
        let root = tempfile::tempdir().unwrap();
        let handle = test_handle(root.path(), Profile::General);
        *handle.0.branding.write().await = Branding {
            color: "#165e91",
            logo: Some(BrandLogo {
                mime: "image/png",
                bytes: Arc::new(b"\x89PNG\r\n\x1a\nbody".to_vec()),
            }),
        };
        let css = brand_styles(State(handle.0.clone())).await;
        let css_bytes = axum::body::to_bytes(css.into_body(), 10_000).await.unwrap();
        let css = String::from_utf8(css_bytes.to_vec()).unwrap();
        assert!(css.contains("#165e91"));
        assert!(css.contains("/reader-logo"));
        let logo = brand_logo(State(handle.0.clone())).await;
        assert_eq!(logo.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(
            axum::body::to_bytes(logo.into_body(), 100).await.unwrap(),
            b"\x89PNG\r\n\x1a\nbody".as_slice()
        );
    }

    #[tokio::test]
    async fn failed_refresh_keeps_previous_snapshot() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a.md"), "---\nid: same\n---\n# A").unwrap();
        let handle = test_handle(root.path(), Profile::General);
        let before = handle.0.snapshot.read().await.signature.clone();
        fs::write(root.path().join("b.md"), "---\nid: same\n---\n# B").unwrap();
        assert!(refresh(&handle).await.is_err());
        assert_eq!(handle.0.snapshot.read().await.signature, before);
    }

    #[tokio::test]
    async fn malformed_existing_note_retains_body_and_publishes_other_changes() {
        let root = tempfile::tempdir().unwrap();
        let note = root.path().join("a.md");
        fs::write(&note, "# Good content").unwrap();
        let handle = test_handle(root.path(), Profile::General);
        fs::write(&note, "---\ntitle: Half written").unwrap();
        fs::write(root.path().join("b.md"), "# New content").unwrap();
        assert!(refresh(&handle).await.unwrap());
        let active = handle.0.snapshot.read().await;
        assert!(active
            .documents
            .values()
            .any(|doc| doc.body.as_ref() == "# Good content"));
        assert!(active
            .documents
            .values()
            .any(|doc| doc.body.as_ref() == "# New content"));
        assert!(active.diagnostics.iter().any(|item| item.path == "a.md"));
    }

    #[tokio::test]
    async fn successful_refresh_notifies_browser_contract() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a.md"), "# First").unwrap();
        let handle = test_handle(root.path(), Profile::General);
        let mut events = handle.0.events.subscribe();
        fs::write(root.path().join("a.md"), "# Second").unwrap();
        assert!(refresh(&handle).await.unwrap());
        let release = events.recv().await.unwrap();
        let active = handle.0.snapshot.read().await;
        assert_eq!(release, active.release_id);
        assert_eq!(active.manifest["desktop"], true);
        assert_eq!(active.manifest["documents"][0]["title"], "Second");
    }

    #[tokio::test]
    async fn newly_excluded_file_updates_diagnostics_without_changing_documents() {
        let root = tempfile::tempdir().unwrap();
        let week = root.path().join("content/2026-semester-2/DEMO101/week-01");
        fs::create_dir_all(&week).unwrap();
        fs::write(week.join("week-01-notes.md"), "# Valid").unwrap();
        let handle = test_handle(root.path(), Profile::Study);
        let mut events = handle.0.events.subscribe();
        fs::write(root.path().join("misplaced.md"), "# Needs a folder").unwrap();

        assert!(refresh(&handle).await.unwrap());
        assert_eq!(
            events.recv().await.unwrap(),
            handle.0.snapshot.read().await.release_id
        );
        let active = handle.0.snapshot.read().await;
        assert_eq!(active.documents.len(), 1);
        assert_eq!(active.diagnostics.len(), 1);
        assert!(active
            .diagnostics
            .iter()
            .any(|item| item.path == "misplaced.md"));
    }
}
