use std::{
    collections::VecDeque,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Instant,
};

use chrono::Utc;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

const TARGET: &str = "note_portal_diagnostics";
const MAX_LOG_BYTES: usize = 1024 * 1024;
const ARCHIVE_COUNT: usize = 3;
const MAX_RECENT_ERRORS: usize = 20;
static RECENT_ERRORS: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

// Fixed archive slots avoid the official file target's second-resolution name collisions.
// Fern serialises writes and flushes after every record, so one rotation keeps a record intact.
struct LogFile {
    dir: PathBuf,
    file: Option<File>,
    buffer: Vec<u8>,
}

fn regular_file(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => Ok(true),
        Ok(_) => Err(io::Error::other("Diagnostic log must be a regular file")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn archive_path(dir: &Path, slot: usize) -> PathBuf {
    dir.join(format!("note-portal.{slot}.log"))
}

fn migrate_archives(dir: &Path) -> io::Result<()> {
    let mut legacy = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(date) = name.strip_prefix("note-portal_").and_then(|name| {
            name.strip_suffix(".log.bak")
                .or_else(|| name.strip_suffix(".log"))
        }) else {
            continue;
        };
        if date.len() == 19
            && chrono::NaiveDateTime::parse_from_str(date, "%Y-%m-%d_%H-%M-%S").is_ok()
        {
            regular_file(&entry.path())?;
            legacy.push((date.to_owned(), name.ends_with(".bak"), entry.path()));
        }
    }
    // Within one timestamp, the .log is newer than the collision backup.
    legacy.sort_by(|left, right| right.0.cmp(&left.0).then(left.1.cmp(&right.1)));
    let mut slots = VecDeque::new();
    for slot in 1..=ARCHIVE_COUNT {
        if !regular_file(&archive_path(dir, slot))? {
            slots.push_back(slot);
        }
    }
    for (_, _, path) in legacy {
        if let Some(slot) = slots.pop_front() {
            fs::rename(path, archive_path(dir, slot))?;
        } else {
            // Only exact app-generated timestamp archives participate in retention.
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

impl LogFile {
    fn open(dir: &Path) -> io::Result<Self> {
        fs::create_dir_all(dir)?;
        migrate_archives(dir)?;
        let mut writer = Self {
            dir: dir.into(),
            file: None,
            buffer: Vec::new(),
        };
        writer.open_active()?;
        Ok(writer)
    }

    fn open_active(&mut self) -> io::Result<()> {
        let path = self.dir.join("note-portal.log");
        regular_file(&path)?;
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        self.file = Some(file);
        Ok(())
    }

    fn rotate(&mut self) -> io::Result<()> {
        // Windows cannot rename an open file. Close it before shifting the bounded slots.
        self.file.take();
        let oldest = archive_path(&self.dir, ARCHIVE_COUNT);
        if regular_file(&oldest)? {
            fs::remove_file(oldest)?;
        }
        for slot in (1..ARCHIVE_COUNT).rev() {
            let path = archive_path(&self.dir, slot);
            if regular_file(&path)? {
                fs::rename(path, archive_path(&self.dir, slot + 1))?;
            }
        }
        let active = self.dir.join("note-portal.log");
        if regular_file(&active)? {
            fs::rename(active, archive_path(&self.dir, 1))?;
        }
        self.open_active()
    }
}

impl Write for LogFile {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > MAX_LOG_BYTES.saturating_sub(self.buffer.len()) {
            self.buffer.clear();
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Diagnostic record exceeds the log limit",
            ));
        }
        self.buffer.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        if self.buffer.is_empty() {
            return Ok(());
        }
        if self.file.is_none() {
            self.open_active()?;
        }
        let length = self
            .file
            .as_ref()
            .expect("active log opened")
            .metadata()?
            .len();
        if length + self.buffer.len() as u64 > MAX_LOG_BYTES as u64 {
            self.rotate()?;
        }
        let record = std::mem::take(&mut self.buffer);
        self.file
            .as_mut()
            .expect("active log opened")
            .write_all(&record)?;
        self.file.as_mut().expect("active log opened").flush()
    }
}

fn builder(dir: &Path) -> io::Result<tauri_plugin_log::Builder> {
    let writer: Box<dyn Write + Send> = Box::new(LogFile::open(dir)?);
    Ok(tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Info)
        // Do not collect dependencies' messages, URLs or arbitrary frontend console output.
        .filter(|metadata| metadata.target() == TARGET)
        .targets([Target::new(TargetKind::Dispatch(
            fern::Dispatch::new().chain(writer),
        ))]))
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_log::Builder::new().skip_logger().build()
}

pub fn init(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let (_, level, logger) = builder(&app.path().app_log_dir()?)?.split(app)?;
    tauri_plugin_log::attach_logger(level, logger)?;
    Ok(())
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
        let (_, _, logger) = builder(temp.path()).unwrap().split(app.handle()).unwrap();
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
        assert!(
            (2..=4).contains(&files.len()),
            "unexpected archive count: {}",
            files.len()
        );
        for file in files {
            let bytes = std::fs::read(file.path()).unwrap();
            assert!(bytes.len() <= MAX_LOG_BYTES as usize);
            assert!(!String::from_utf8_lossy(&bytes).contains("PRIVATE_TOKEN_AND_PATH"));
        }
    }

    #[test]
    fn legacy_collision_backups_are_migrated_with_bounded_retention() {
        let temp = tempfile::tempdir().unwrap();
        for second in 1..=6 {
            for extension in ["log", "log.bak"] {
                fs::write(
                    temp.path().join(format!(
                        "note-portal_2026-10-01_01-02-{second:02}.{extension}"
                    )),
                    format!("record-{second}-{extension}"),
                )
                .unwrap();
            }
        }
        let unrelated = temp.path().join("note-portal_user-notes.log");
        fs::write(&unrelated, "Leave this file alone").unwrap();
        let mut writer = LogFile::open(temp.path()).unwrap();
        assert_eq!(
            fs::read_to_string(archive_path(temp.path(), 1)).unwrap(),
            "record-6-log"
        );
        assert_eq!(
            fs::read_to_string(archive_path(temp.path(), 2)).unwrap(),
            "record-6-log.bak"
        );
        for _ in 0..10 {
            writer.write_all(&vec![b'a'; MAX_LOG_BYTES]).unwrap();
            writer.flush().unwrap();
        }
        drop(writer);
        drop(LogFile::open(temp.path()).unwrap());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 5);
        assert_eq!(
            fs::read_to_string(unrelated).unwrap(),
            "Leave this file alone"
        );
        for slot in 1..=ARCHIVE_COUNT {
            assert_eq!(
                fs::metadata(archive_path(temp.path(), slot)).unwrap().len(),
                MAX_LOG_BYTES as u64
            );
        }
    }

    #[test]
    fn oversized_record_is_rejected_without_writing_partial_data() {
        let temp = tempfile::tempdir().unwrap();
        let mut writer = LogFile::open(temp.path()).unwrap();
        assert!(writer.write_all(&vec![b'a'; MAX_LOG_BYTES + 1]).is_err());
        writer.write_all(b"next record").unwrap();
        writer.flush().unwrap();
        assert_eq!(
            fs::read(temp.path().join("note-portal.log")).unwrap(),
            b"next record"
        );
    }

    #[cfg(unix)]
    #[test]
    fn log_symlink_is_rejected_without_touching_its_target() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("private.md");
        fs::write(&target, "Untouched").unwrap();
        std::os::unix::fs::symlink(&target, temp.path().join("note-portal.log")).unwrap();
        assert!(LogFile::open(temp.path()).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "Untouched");
    }
}
