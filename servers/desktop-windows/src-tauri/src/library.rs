use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use walkdir::WalkDir;

const MAX_MARKDOWN_BYTES: u64 = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_LIBRARY_MARKDOWN_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    General,
    Study,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub path: String,
    pub reason: String,
    pub suggestion: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub label: String,
    pub kind: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip)]
    pub order: Option<i64>,
    pub children: Vec<TreeNode>,
}

#[derive(Clone)]
pub struct Document {
    pub id: String,
    pub relative_path: String,
    pub title: String,
    pub tags: Vec<String>,
    pub body: Arc<str>,
    pub hash: String,
    pub updated: String,
    pub location: String,
    pub week: u32,
    pub week_label: String,
    pub unit_code: String,
    pub unit_name: String,
    pub order: Option<i64>,
    pub explicit_id: bool,
}

#[derive(Clone)]
pub struct Snapshot {
    pub release_id: String,
    pub generated_at: String,
    pub signature: String,
    pub manifest: Value,
    pub tree: Vec<TreeNode>,
    pub diagnostics: Vec<Diagnostic>,
    pub documents: HashMap<String, Document>,
    pub asset_hashes: HashMap<String, String>,
}

#[derive(Default, Deserialize)]
struct Frontmatter {
    id: Option<String>,
    title: Option<String>,
    order: Option<i64>,
    tags: Option<Vec<String>>,
    draft: Option<bool>,
}

fn is_ignored(name: &str) -> bool {
    name.starts_with('.')
        || matches!(name, "node_modules" | "target" | "__pycache__")
        || [".tmp", ".part", ".swp", ".bak", "~"]
            .iter()
            .any(|suffix| name.ends_with(suffix))
}

fn remember_unique_path(seen: &mut HashSet<String>, path: &str) -> Result<(), String> {
    if seen.insert(path.to_lowercase()) {
        Ok(())
    } else {
        Err(format!(
            "资料库存在仅大小写不同的冲突路径：{path}。请先手动处理。"
        ))
    }
}

pub fn valid_component(name: &str) -> bool {
    if name.is_empty()
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return false;
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        && !(stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0')
}

pub fn valid_relative_path(path: &str) -> bool {
    Path::new(path).components().all(|part| match part {
        Component::Normal(value) => value.to_str().is_some_and(valid_component),
        _ => false,
    })
}

fn read_stable_limited(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(|_| "无法读取文件；请检查文件权限。")?;
    let before = file
        .metadata()
        .map_err(|_| "无法读取文件信息；请检查文件权限。")?;
    if before.len() > max_bytes {
        return Err(format!(
            "文件超过 {} MiB 的大小限制。",
            max_bytes / 1024 / 1024
        ));
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "文件暂时无法读取。")?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "文件超过 {} MiB 的大小限制。",
            max_bytes / 1024 / 1024
        ));
    }
    let after = file
        .metadata()
        .map_err(|_| "文件读取期间发生变化；请稍后刷新。")?;
    if before.len() != bytes.len() as u64
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Err("文件读取期间发生变化；请保存完成后再刷新。".into());
    }
    Ok(bytes)
}

fn read_stable(path: &Path) -> Result<String, String> {
    String::from_utf8(read_stable_limited(path, MAX_MARKDOWN_BYTES)?)
        .map_err(|_| "文件不是有效 UTF-8。".into())
}

fn read_stable_bytes(path: &Path) -> Result<Vec<u8>, String> {
    read_stable_limited(path, MAX_IMAGE_BYTES)
}

fn parse_frontmatter(content: &str) -> Result<(Frontmatter, &str), String> {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    if !content.starts_with("---\n") && !content.starts_with("---\r\n") {
        return Ok((Frontmatter::default(), content));
    }
    let mut lines = content.lines();
    lines.next();
    let mut yaml = String::new();
    let mut consumed = content.find('\n').unwrap_or(content.len()) + 1;
    let mut closed = false;
    for line in lines {
        consumed += line.len() + 1;
        if line.trim_end_matches('\r') == "---" {
            closed = true;
            break;
        }
        yaml.push_str(line);
        yaml.push('\n');
    }
    if !closed {
        return Err("Frontmatter 缺少结束的 --- 行。".into());
    }
    let metadata: Frontmatter =
        serde_yaml::from_str(&yaml).map_err(|_| "Frontmatter 格式错误；请检查字段类型和缩进。")?;
    Ok((metadata, content.get(consumed..).unwrap_or("")))
}

fn title_from(body: &str, metadata: &Frontmatter, fallback: &str) -> String {
    metadata
        .title
        .as_deref()
        .filter(|title| !title.trim().is_empty())
        .map(str::to_owned)
        .or_else(|| {
            body.lines()
                .find_map(|line| line.strip_prefix("# ").map(str::trim))
                .filter(|title| !title.is_empty())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| fallback.to_owned())
}

fn week_number(key: &str) -> Option<(u32, String)> {
    if let Some(value) = key.strip_prefix("week-") {
        if value.len() == 2 && value.bytes().all(|c| c.is_ascii_digit()) {
            let number: u32 = value.parse().ok()?;
            return (number > 0).then(|| (number, format!("Week {number}")));
        }
    }
    let range = key.strip_prefix("weeks-")?;
    let (start, end) = range.split_once('-')?;
    if start.len() != 2
        || end.len() != 2
        || !start.bytes().chain(end.bytes()).all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let first: u32 = start.parse().ok()?;
    let last: u32 = end.parse().ok()?;
    (first > 0 && last > first).then(|| (first, format!("Weeks {first}–{last}")))
}

fn natural_cmp(left: &str, right: &str) -> Ordering {
    let left = left.to_lowercase();
    let right = right.to_lowercase();
    let mut left = left.chars().peekable();
    let mut right = right.chars().peekable();
    loop {
        match (left.peek().copied(), right.peek().copied()) {
            (Some(a), Some(b)) if a.is_ascii_digit() && b.is_ascii_digit() => {
                let digits = |chars: &mut std::iter::Peekable<std::str::Chars<'_>>| {
                    let mut run = String::new();
                    while chars.peek().is_some_and(char::is_ascii_digit) {
                        run.push(chars.next().unwrap());
                    }
                    run
                };
                let a = digits(&mut left);
                let b = digits(&mut right);
                let a_trimmed = a.trim_start_matches('0');
                let b_trimmed = b.trim_start_matches('0');
                let comparison = a_trimmed
                    .len()
                    .cmp(&b_trimmed.len())
                    .then_with(|| a_trimmed.cmp(b_trimmed))
                    .then_with(|| a.len().cmp(&b.len()));
                if comparison != Ordering::Equal {
                    return comparison;
                }
            }
            (Some(a), Some(b)) => {
                left.next();
                right.next();
                let comparison = a.cmp(&b);
                if comparison != Ordering::Equal {
                    return comparison;
                }
            }
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
        }
    }
}

fn encoded_path(relative: &str) -> String {
    relative
        .split('/')
        .map(|part| {
            part.as_bytes()
                .iter()
                .map(|byte| match byte {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        (*byte as char).to_string()
                    }
                    _ => format!("%{byte:02X}"),
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn tree_insert(
    nodes: &mut Vec<TreeNode>,
    path: &[String],
    document: &Document,
    profile: Profile,
    prefix: &str,
    depth: usize,
) {
    if path.is_empty() {
        nodes.push(TreeNode {
            label: document.title.clone(),
            kind: "document".into(),
            path: document.relative_path.clone(),
            id: Some(document.id.clone()),
            order: document.order,
            children: vec![],
        });
        return;
    }
    let label = &path[0];
    let kind = if profile == Profile::Study {
        if label == "inbox" {
            "inbox"
        } else if prefix.starts_with("inbox") {
            "folder"
        } else if depth == 0 {
            "semester"
        } else if depth == 1 {
            "unit"
        } else {
            "week"
        }
    } else {
        "folder"
    };
    let folder_path = if profile == Profile::Study && depth == 0 && label != "inbox" {
        format!("content/{label}")
    } else if prefix.is_empty() {
        label.clone()
    } else {
        format!("{prefix}/{label}")
    };
    let index = nodes
        .iter()
        .position(|node| node.id.is_none() && node.label == *label);
    let index = index.unwrap_or_else(|| {
        nodes.push(TreeNode {
            label: label.clone(),
            kind: kind.into(),
            path: folder_path.clone(),
            id: None,
            order: None,
            children: vec![],
        });
        nodes.len() - 1
    });
    tree_insert(
        &mut nodes[index].children,
        &path[1..],
        document,
        profile,
        &folder_path,
        depth + 1,
    );
}

fn sort_tree(nodes: &mut Vec<TreeNode>, metadata: &HashMap<String, Frontmatter>) {
    for node in nodes.iter_mut() {
        if node.id.is_none() {
            if let Some(meta) = metadata.get(&node.path) {
                node.order = meta.order;
                if let Some(title) = meta.title.as_ref().filter(|title| !title.trim().is_empty()) {
                    node.label = title.clone();
                }
            }
        }
    }
    nodes.sort_by(|a, b| {
        a.id.is_some()
            .cmp(&b.id.is_some())
            .then_with(|| {
                a.order
                    .unwrap_or(i64::MAX)
                    .cmp(&b.order.unwrap_or(i64::MAX))
            })
            .then_with(|| {
                if a.kind == "week" && b.kind == "week" {
                    let a_key = a.path.rsplit('/').next().unwrap_or("");
                    let b_key = b.path.rsplit('/').next().unwrap_or("");
                    return week_number(a_key)
                        .map(|value| value.0)
                        .cmp(&week_number(b_key).map(|value| value.0))
                        .then_with(|| {
                            a_key
                                .starts_with("weeks-")
                                .cmp(&b_key.starts_with("weeks-"))
                        });
                }
                natural_cmp(&a.label, &b.label)
            })
    });
    for node in nodes {
        sort_tree(&mut node.children, metadata);
    }
}

fn diagnostic(path: &str, reason: &str, suggestion: &str) -> Diagnostic {
    Diagnostic {
        path: path.into(),
        reason: reason.into(),
        suggestion: suggestion.into(),
    }
}

pub fn scan(root: &Path, profile: Profile, sequence: u64) -> Result<Snapshot, String> {
    if !root.is_dir() {
        return Err("资料库文件夹不存在或无法访问；请选择可读取的文件夹。".into());
    }
    let root = root
        .canonicalize()
        .map_err(|_| "无法读取资料库文件夹；请检查访问权限。")?;
    let mut diagnostics = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut ids = HashSet::new();
    let mut documents = HashMap::new();
    let mut folder_metadata: HashMap<String, Frontmatter> = HashMap::new();
    let mut signature_parts = BTreeMap::new();
    let mut asset_hashes = HashMap::new();
    let mut scanned_markdown_bytes = 0u64;
    let mut entries = WalkDir::new(&root).follow_links(false).into_iter();

    while let Some(entry) = entries.next() {
        let entry = entry.map_err(|_| "扫描资料库时无法读取一个文件夹；请检查权限。")?;
        if entry.depth() == 0 {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if is_ignored(&name) {
            if entry.file_type().is_dir() {
                entries.skip_current_dir();
            }
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(&root)
            .map_err(|_| "资料库路径异常。")?
            .to_str()
            .ok_or("路径包含无法识别的字符。")?
            .replace('\\', "/");
        if !valid_relative_path(&relative) {
            diagnostics.push(diagnostic(
                &relative,
                "名称不兼容 Windows 或含有无效字符。",
                "请在文件管理器中手动改名；Note Portal 不会自动修改文件。",
            ));
            if entry.file_type().is_dir() {
                entries.skip_current_dir();
            }
            continue;
        }
        remember_unique_path(&mut seen_paths, &relative)?;
        if entry.file_type().is_symlink() {
            diagnostics.push(diagnostic(
                &relative,
                "符号链接未被读取，以免访问资料库外的文件。",
                "请使用资料库内的普通文件，或自行确认链接目标。",
            ));
            continue;
        }
        if entry.file_type().is_dir() {
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let extension = entry
            .path()
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if ["gif", "jpeg", "jpg", "png", "svg", "webp"]
            .iter()
            .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        {
            let bytes = read_stable_bytes(entry.path())
                .map_err(|reason| format!("{relative}：{reason}"))?;
            let hash = blake3::hash(&bytes).to_hex().to_string();
            signature_parts.insert(relative.clone(), hash.clone());
            asset_hashes.insert(relative.clone(), hash);
            continue;
        }
        if !extension.eq_ignore_ascii_case("md") {
            continue;
        }
        if relative.split('/').any(|part| part == "_assets") {
            continue;
        }
        if name.starts_with('_') && name != "_index.md" {
            continue;
        }
        let parts: Vec<&str> = relative.split('/').collect();
        if name == "_index.md" {
            let valid_index = match profile {
                Profile::General => true,
                Profile::Study => {
                    parts.first() == Some(&"content") && (parts.len() == 3 || parts.len() == 4)
                }
            };
            if !valid_index {
                diagnostics.push(diagnostic(
                    &relative,
                    "此处不使用 _index.md。",
                    "请参考资料库结构指南。",
                ));
                continue;
            }
            let content =
                read_stable(entry.path()).map_err(|reason| format!("{relative}：{reason}"))?;
            scanned_markdown_bytes = scanned_markdown_bytes.saturating_add(content.len() as u64);
            if scanned_markdown_bytes > MAX_LIBRARY_MARKDOWN_BYTES {
                return Err("资料库的 Markdown 总量超过 64 MiB；请分开选择较小的资料库。".into());
            }
            let (meta, _) =
                parse_frontmatter(&content).map_err(|reason| format!("{relative}：{reason}"))?;
            let parent = parts[..parts.len() - 1].join("/");
            folder_metadata.insert(parent, meta);
            signature_parts.insert(
                relative.clone(),
                blake3::hash(content.as_bytes()).to_hex().to_string(),
            );
            continue;
        }

        let (location, week, week_label, unit_code, unit_name, tree_path): (
            String,
            u32,
            String,
            String,
            String,
            Vec<String>,
        ) = match profile {
            Profile::General => {
                let folders = parts[..parts.len() - 1]
                    .iter()
                    .map(|s| (*s).to_owned())
                    .collect();
                let location = parts[..parts.len() - 1].join("/");
                (
                    location.clone(),
                    0,
                    location.clone(),
                    location.clone(),
                    location,
                    folders,
                )
            }
            Profile::Study if parts.first() == Some(&"inbox") && parts.len() >= 2 => {
                let folders = parts[..parts.len() - 1]
                    .iter()
                    .map(|s| (*s).to_owned())
                    .collect();
                (
                    "Inbox".into(),
                    0,
                    "Inbox".into(),
                    "Inbox".into(),
                    "Inbox".into(),
                    folders,
                )
            }
            Profile::Study if parts.first() == Some(&"content") && parts.len() == 5 => {
                let expected = format!("{}-notes.md", parts[3]);
                if let Some((week, label)) = week_number(parts[3]) {
                    if parts[4] == expected {
                        (
                            format!("{} / {} / {}", parts[1], parts[2], label),
                            week,
                            label,
                            parts[2].into(),
                            parts[2].into(),
                            parts[1..4].iter().map(|s| (*s).to_owned()).collect(),
                        )
                    } else {
                        diagnostics.push(diagnostic(
                            &relative,
                            "Week 文件名与文件夹不一致。",
                            &format!("建议名称：{expected}"),
                        ));
                        continue;
                    }
                } else {
                    diagnostics.push(diagnostic(
                        &relative,
                        "Week 文件夹名称不符合 week-NN 或 weeks-NN-NN。",
                        "请参照资料库结构指南手动调整。",
                    ));
                    continue;
                }
            }
            Profile::Study => {
                diagnostics.push(diagnostic(&relative, "Study 笔记不在规定的 Semester / Unit / Week 位置。", "放入 content/<semester>/<unit>/<week-key>/<week-key>-notes.md，或放入 inbox/。"));
                continue;
            }
        };

        let content =
            read_stable(entry.path()).map_err(|reason| format!("{relative}：{reason}"))?;
        scanned_markdown_bytes = scanned_markdown_bytes.saturating_add(content.len() as u64);
        if scanned_markdown_bytes > MAX_LIBRARY_MARKDOWN_BYTES {
            return Err("资料库的 Markdown 总量超过 64 MiB；请分开选择较小的资料库。".into());
        }
        let (meta, body) = match parse_frontmatter(&content) {
            Ok(parsed) => parsed,
            Err(reason) => {
                diagnostics.push(diagnostic(
                    &relative,
                    &reason,
                    "请在编辑器中修正后点击立即刷新。",
                ));
                continue;
            }
        };
        if meta.draft.unwrap_or(false) {
            continue;
        }
        let explicit_id = meta.id.is_some();
        let id = if let Some(explicit) = meta.id.as_deref() {
            if explicit.is_empty()
                || explicit.len() > 64
                || !explicit
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            {
                diagnostics.push(diagnostic(
                    &relative,
                    "显式 id 只能包含英文字母、数字、- 和 _，且最多 64 个字符。",
                    "请修改 frontmatter 的 id，或删除该字段。",
                ));
                continue;
            }
            explicit.to_owned()
        } else {
            let digest = blake3::hash(format!("{profile:?}:{relative}").as_bytes());
            format!("doc-{}", &digest.to_hex()[..20])
        };
        if !ids.insert(id.clone()) {
            return Err(format!(
                "资料库存在重复的文档 id：{id}。请修改其中一篇的 frontmatter。"
            ));
        }
        let updated = fs::metadata(entry.path())
            .ok()
            .and_then(|m| m.modified().ok())
            .map(chrono::DateTime::<Utc>::from)
            .map(|t| t.to_rfc3339_opts(SecondsFormat::Secs, true))
            .unwrap_or_default();
        let title = title_from(
            body,
            &meta,
            parts.last().unwrap_or(&"note").trim_end_matches(".md"),
        );
        let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
        signature_parts.insert(relative.clone(), hash.clone());
        let document = Document {
            id: id.clone(),
            relative_path: relative.clone(),
            title,
            tags: meta.tags.unwrap_or_default(),
            body: Arc::from(body.to_owned()),
            hash,
            updated,
            location,
            week,
            week_label,
            unit_code,
            unit_name,
            order: meta.order,
            explicit_id,
        };
        documents.insert(id, (document, tree_path));
    }

    let mut tree = Vec::new();
    let mut document_map = HashMap::new();
    let mut ordered: Vec<_> = documents.into_values().collect();
    ordered.sort_by(|a, b| natural_cmp(&a.0.relative_path, &b.0.relative_path));
    for (document, tree_path) in ordered {
        tree_insert(&mut tree, &tree_path, &document, profile, "", 0);
        document_map.insert(document.id.clone(), document);
    }
    sort_tree(&mut tree, &folder_metadata);
    diagnostics.sort_by(|a, b| a.path.cmp(&b.path).then_with(|| a.reason.cmp(&b.reason)));
    let signature = blake3::hash(
        serde_json::to_string(&(signature_parts, &diagnostics))
            .unwrap()
            .as_bytes(),
    )
    .to_hex()
    .to_string();
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let release_id = format!("{}-{sequence}", &signature[..16]);
    let label = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Note Portal")
        .to_owned();
    let mut manifest = json!({
        "id": format!("library-{}", &blake3::hash(root.to_string_lossy().as_bytes()).to_hex()[..16]),
        "label": label,
        "pickerLabel": label,
        "generatedAt": generated_at,
        "desktop": true,
        "profile": profile,
        "tree": tree,
        "documents": [],
        "units": []
    });

    let mut docs: Vec<&Document> = document_map.values().collect();
    docs.sort_by(|a, b| natural_cmp(&a.relative_path, &b.relative_path));
    manifest["documents"] = Value::Array(docs.iter().map(|doc| document_json(doc)).collect());
    if profile == Profile::Study {
        let mut units: BTreeMap<(String, String), Vec<Value>> = BTreeMap::new();
        for doc in docs.iter().filter(|doc| doc.week > 0) {
            let semester = doc.relative_path.split('/').nth(1).unwrap_or("");
            units
                .entry((semester.into(), doc.unit_code.clone()))
                .or_default()
                .push(document_json(doc));
        }
        let mut unit_values: Vec<Value> = units.into_iter().map(|((semester, code), mut weeks)| {
            weeks.sort_by_key(|note| note["week"].as_u64().unwrap_or(0));
            json!({"code": format!("{semester}/{code}"), "name": code, "semester": semester, "topics": "", "weeks": weeks})
        }).collect();
        let inbox: Vec<Value> = docs
            .iter()
            .filter(|doc| doc.unit_code == "Inbox")
            .map(|doc| document_json(doc))
            .collect();
        if !inbox.is_empty() {
            unit_values.push(
                json!({"code":"Inbox", "name":"Unsorted notes", "topics":"", "weeks": inbox}),
            );
        }
        manifest["units"] = Value::Array(unit_values);
    }
    Ok(Snapshot {
        release_id,
        generated_at,
        signature,
        manifest,
        tree,
        diagnostics,
        documents: document_map,
        asset_hashes,
    })
}

fn document_json(doc: &Document) -> Value {
    let parent = doc
        .relative_path
        .rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("");
    let asset_base = if parent.is_empty() {
        "/library/".to_owned()
    } else {
        format!("/library/{}/", encoded_path(parent))
    };
    json!({
        "id": doc.id,
        "title": doc.title,
        "path": format!("/api/documents/{}", doc.id),
        "assetBase": asset_base,
        "relativePath": doc.relative_path,
        "location": doc.location,
        "week": doc.week,
        "weekLabel": doc.week_label,
        "unitCode": doc.unit_code,
        "unitName": doc.unit_name,
        "updated": doc.updated,
        "hash": doc.hash,
        "tags": doc.tags
    })
}

fn replace_id_in_tree(nodes: &mut [TreeNode], from: &str, to: &str) {
    for node in nodes {
        if node.id.as_deref() == Some(from) {
            node.id = Some(to.to_owned());
        }
        replace_id_in_tree(&mut node.children, from, to);
    }
}

fn replace_id_in_manifest(value: &mut Value, from: &str, to: &str) {
    match value {
        Value::Object(object) => {
            if object.get("id").and_then(Value::as_str) == Some(from) {
                object.insert("id".into(), Value::String(to.into()));
                if object.contains_key("path") {
                    object.insert("path".into(), Value::String(format!("/api/documents/{to}")));
                }
            }
            for child in object.values_mut() {
                replace_id_in_manifest(child, from, to);
            }
        }
        Value::Array(items) => {
            for item in items {
                replace_id_in_manifest(item, from, to);
            }
        }
        _ => {}
    }
}

pub fn preserve_rename_ids(next: &mut Snapshot, previous: &Snapshot) {
    let old_paths: HashSet<&str> = previous
        .documents
        .values()
        .map(|doc| doc.relative_path.as_str())
        .collect();
    let new_paths: HashSet<&str> = next
        .documents
        .values()
        .map(|doc| doc.relative_path.as_str())
        .collect();
    let mut old_by_hash: HashMap<&str, Vec<&Document>> = HashMap::new();
    for doc in previous
        .documents
        .values()
        .filter(|doc| !new_paths.contains(doc.relative_path.as_str()))
    {
        old_by_hash.entry(&doc.hash).or_default().push(doc);
    }
    let mut new_by_hash: HashMap<&str, Vec<&Document>> = HashMap::new();
    for doc in next
        .documents
        .values()
        .filter(|doc| !doc.explicit_id && !old_paths.contains(doc.relative_path.as_str()))
    {
        new_by_hash.entry(&doc.hash).or_default().push(doc);
    }
    let changes: Vec<(String, String)> = new_by_hash
        .into_iter()
        .filter_map(|(hash, new_docs)| {
            let old_docs = old_by_hash.get(hash)?;
            (new_docs.len() == 1
                && old_docs.len() == 1
                && !next.documents.contains_key(&old_docs[0].id))
            .then(|| (new_docs[0].id.clone(), old_docs[0].id.clone()))
        })
        .collect();
    for (from, to) in changes {
        let Some(mut document) = next.documents.remove(&from) else {
            continue;
        };
        document.id.clone_from(&to);
        next.documents.insert(to.clone(), document);
        replace_id_in_tree(&mut next.tree, &from, &to);
        replace_id_in_manifest(&mut next.manifest, &from, &to);
    }
}

pub fn resolve_asset(root: &Path, relative: &str) -> Option<PathBuf> {
    if !valid_relative_path(relative) {
        return None;
    }
    let extension = Path::new(relative).extension()?.to_str()?;
    if !["gif", "jpeg", "jpg", "png", "svg", "webp"]
        .iter()
        .any(|allowed| extension.eq_ignore_ascii_case(allowed))
    {
        return None;
    }
    let canonical_root = root.canonicalize().ok()?;
    let canonical_file = root.join(relative).canonicalize().ok()?;
    (canonical_file.starts_with(canonical_root) && canonical_file.is_file())
        .then_some(canonical_file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_names_and_asset_containment() {
        assert!(!valid_component("CON.txt"));
        assert!(!valid_component("notes."));
        assert!(!valid_component("a:b.md"));
        assert!(valid_component("九月笔记.md"));
        let root = tempfile::tempdir().unwrap();
        assert!(resolve_asset(root.path(), "../private.png").is_none());
    }

    #[test]
    fn general_finds_nested_markdown_and_excludes_drafts() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("projects")).unwrap();
        fs::write(root.path().join("ideas.md"), "# Ideas\nhello").unwrap();
        fs::write(
            root.path().join("projects/roadmap.md"),
            "---\ntitle: Roadmap\n---\n# Body",
        )
        .unwrap();
        fs::write(
            root.path().join("draft.md"),
            "---\ndraft: true\n---\n# Draft",
        )
        .unwrap();
        let snapshot = scan(root.path(), Profile::General, 1).unwrap();
        assert_eq!(snapshot.documents.len(), 2);
        assert_eq!(snapshot.tree.len(), 2);
        assert!(snapshot
            .documents
            .values()
            .any(|doc| doc.title == "Roadmap"));
    }

    #[test]
    fn oversized_markdown_is_rejected_before_loading() {
        let root = tempfile::tempdir().unwrap();
        fs::File::create(root.path().join("too-large.md"))
            .unwrap()
            .set_len(MAX_MARKDOWN_BYTES + 1)
            .unwrap();
        let error = scan(root.path(), Profile::General, 1).err().unwrap();
        assert!(error.contains("8 MiB"));
    }

    #[test]
    fn study_requires_matching_primary_note() {
        let root = tempfile::tempdir().unwrap();
        let week = root.path().join("content/2026-semester-2/DEMO101/week-01");
        fs::create_dir_all(&week).unwrap();
        fs::write(week.join("week-01-notes.md"), "# First week").unwrap();
        fs::write(week.join("extra.md"), "# Not a primary note").unwrap();
        let snapshot = scan(root.path(), Profile::Study, 1).unwrap();
        assert_eq!(snapshot.documents.len(), 1);
        assert_eq!(snapshot.diagnostics.len(), 1);
    }

    #[test]
    fn duplicate_ids_abort_snapshot() {
        let root = tempfile::tempdir().unwrap();
        for name in ["a.md", "b.md"] {
            fs::write(root.path().join(name), "---\nid: same\n---\n# Note").unwrap();
        }
        assert!(scan(root.path(), Profile::General, 1).is_err());
    }

    #[test]
    fn case_collisions_are_rejected_independently_of_host_filesystem() {
        let mut seen = HashSet::new();
        remember_unique_path(&mut seen, "Projects/Roadmap.md").unwrap();
        assert!(remember_unique_path(&mut seen, "projects/roadmap.md").is_err());
    }

    #[test]
    fn repository_fixtures_match_both_profiles() {
        let examples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples");
        let general = scan(
            &examples.join("general-library-template"),
            Profile::General,
            1,
        )
        .unwrap();
        assert!(general
            .documents
            .values()
            .any(|doc| doc.relative_path == "ideas.md"));
        assert!(general
            .tree
            .iter()
            .any(|node| node.label == "Example Projects"));
        assert!(!general
            .documents
            .values()
            .any(|doc| doc.title == "Example Draft"));

        let study = scan(&examples.join("study-library-template"), Profile::Study, 1).unwrap();
        assert_eq!(study.documents.len(), 2);
        assert_eq!(study.manifest["units"].as_array().unwrap().len(), 2);
        assert!(study
            .asset_hashes
            .contains_key("content/2026-semester-2/DEMO101/week-01/_assets/example-diagram.svg"));
        assert!(study
            .diagnostics
            .iter()
            .any(|item| item.path == "README.md"));
    }

    #[test]
    fn natural_and_numeric_week_ordering() {
        assert_eq!(natural_cmp("folder2", "folder10"), Ordering::Less);
        let root = tempfile::tempdir().unwrap();
        let unit = root.path().join("content/2026-semester-2/DEMO101");
        for key in ["week-10", "week-02", "weeks-03-04"] {
            fs::create_dir_all(unit.join(key)).unwrap();
            fs::write(unit.join(key).join(format!("{key}-notes.md")), "# Note").unwrap();
        }
        let snapshot = scan(root.path(), Profile::Study, 1).unwrap();
        let weeks = &snapshot.tree[0].children[0].children;
        assert_eq!(
            weeks
                .iter()
                .map(|node| node.label.as_str())
                .collect::<Vec<_>>(),
            vec!["week-02", "weeks-03-04", "week-10"]
        );
    }

    #[test]
    fn unambiguous_rename_preserves_id_in_every_view() {
        let root = tempfile::tempdir().unwrap();
        let old_path = root.path().join("old.md");
        fs::write(&old_path, "# Same content").unwrap();
        let previous = scan(root.path(), Profile::General, 1).unwrap();
        let old_id = previous.documents.values().next().unwrap().id.clone();

        fs::rename(&old_path, root.path().join("new.md")).unwrap();
        let mut next = scan(root.path(), Profile::General, 2).unwrap();
        assert_ne!(next.documents.values().next().unwrap().id, old_id);
        preserve_rename_ids(&mut next, &previous);

        assert_eq!(next.documents[&old_id].relative_path, "new.md");
        assert_eq!(next.tree[0].id.as_deref(), Some(old_id.as_str()));
        assert_eq!(next.manifest["tree"][0]["id"], old_id);
        assert_eq!(next.manifest["documents"][0]["id"], old_id);
        assert_eq!(
            next.manifest["documents"][0]["path"],
            format!("/api/documents/{old_id}")
        );
    }

    #[test]
    fn ambiguous_identical_content_rename_gets_new_ids() {
        let root = tempfile::tempdir().unwrap();
        for name in ["old-a.md", "old-b.md"] {
            fs::write(root.path().join(name), "# Same content").unwrap();
        }
        let previous = scan(root.path(), Profile::General, 1).unwrap();
        for (old, new) in [("old-a.md", "new-a.md"), ("old-b.md", "new-b.md")] {
            fs::rename(root.path().join(old), root.path().join(new)).unwrap();
        }
        let mut next = scan(root.path(), Profile::General, 2).unwrap();
        preserve_rename_ids(&mut next, &previous);
        assert!(next
            .documents
            .keys()
            .all(|id| !previous.documents.contains_key(id)));
    }
}
