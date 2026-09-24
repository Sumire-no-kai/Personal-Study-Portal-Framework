import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderMarkdown } from "./markdown";
import "./styles.css";

type Profile = "general" | "study";
type Language = "zh" | "en";
type TreeNode = { label: string; kind: string; path: string; id?: string; children: TreeNode[] };
type Diagnostic = { path: string; reason: string; suggestion: string };
type Status = {
  noticeVersion: string;
  noticeAccepted: boolean;
  guideCompleted: boolean;
  acceptedAt: string | null;
  libraryPath: string | null;
  libraryName: string | null;
  profile: Profile | null;
  serviceState: "running" | "degraded" | "starting" | "stopped";
  port: number | null;
  documentCount: number;
  diagnostics: Diagnostic[];
  tree: TreeNode[];
  lastRefresh: string | null;
  error: string | null;
  settingsRecoveryPath: string | null;
  settingsBackupAvailable: boolean;
  launchAtLogin: boolean;
  themeColor: "green" | "crimson" | "blue" | "violet";
  logoSelected: boolean;
};
type Preview = { documentCount: number; diagnostics: Diagnostic[]; tree: TreeNode[] };
type NotePreview = { relativePath: string; exists: boolean };
type SettingsReset = { status: Status; backupPath: string; warning: string | null };

const app = document.querySelector<HTMLElement>("#app")!;
const dialog = document.querySelector<HTMLDialogElement>("#dialog")!;
let status: Status;
let profile: Profile = "general";
let setupMode: "existing" | "new" = "existing";
let selectedPath = "";
let libraryName = "My Notes";
let preview: Preview | null = null;
let busy = false;
let setupVisible = false;
let noticeRead = false;
let guideStep = 0;

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem("note-portal-language");
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    // Private browser storage can be unavailable; the OS language still provides a default.
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let language: Language = initialLanguage();
document.documentElement.lang = language === "zh" ? "zh-CN" : "en";

function tr(chinese: string, english: string): string {
  return language === "zh" ? chinese : english;
}

const backendTranslations: Record<string, string> = {
  "请先阅读并同意当前使用提示。": "Read and accept the current responsible-use notice first.",
  "请先完成首次使用指引。": "Complete the first-use guide first.",
  "本机设置无法读取；资料库尚未启动。": "Local settings could not be read; the library did not start.",
  "本机设置格式错误；资料库尚未启动。": "Local settings are invalid; the library did not start.",
  "本机设置需要人工检查，不能继续使用旧的资料库。": "Local settings need manual review before the library can be used.",
  "本机设置暂时不可用。": "Local settings are temporarily unavailable.",
  "本地服务暂时不可用。": "The local service is temporarily unavailable.",
  "本地服务尚未启动。": "The local service is not running.",
  "请先启动本地服务。": "Start the local service first.",
  "请先选择一个资料库。": "Choose a library first.",
  "请先选择资料库。": "Choose a library first.",
  "资料库文件夹无法打开。": "The library folder could not be opened.",
  "资料库文件夹不存在或无法访问；请选择可读取的文件夹。": "The library folder is missing or inaccessible. Choose a readable folder.",
  "无法读取资料库文件夹；请检查访问权限。": "The library folder could not be read. Check its permissions.",
  "保存位置无法打开。": "The save location could not be opened.",
  "请选择一个文件夹作为保存位置。": "Choose a folder as the save location.",
  "同名文件夹已经存在，或无法在这里创建资料库。": "A folder with that name exists, or the library cannot be created here.",
  "名称包含系统不支持的字符，请换一个简短名称。": "The name contains unsupported characters. Choose a shorter, simpler name.",
  "目标文件夹名称无效。": "The destination folder name is invalid.",
  "目标文件夹不存在。": "The destination folder does not exist.",
  "目标文件夹不在当前资料库内。": "The destination folder is outside the current library.",
  "目标文件不在当前资料库内。": "The destination file is outside the current library.",
  "同名笔记已经存在，或无法在这里创建文件。": "A note with that name exists, or the file cannot be created here.",
  "笔记创建未完成，请检查目标文件。": "Note creation did not finish. Check the destination file.",
  "Week 必须是 1–99；合并周次的结束数字必须更大。": "Week must be 1–99, and a merged range must end later than it begins.",
  "这周的主笔记已经存在，或无法创建文件。": "This Week's primary note already exists, or the file cannot be created.",
  "无法打开默认浏览器。": "Could not open the default browser.",
  "无法打开默认浏览器；请检查系统默认浏览器设置。": "Could not open the default browser. Check your system browser settings.",
  "服务已经启动，但无法自动打开浏览器。请点击“打开阅读器”重试。": "The service started but the browser did not open. Try Open reader again.",
  "无法在文件管理器中打开资料库。": "Could not open the library in the file manager.",
  "Logo 超过 2 MiB，请选择较小的图片。": "Logo exceeds 2 MiB. Choose a smaller image.",
  "请选择 PNG、JPEG 或 WebP 图片；不接受 SVG 或其他格式。": "Choose a PNG, JPEG or WebP image. SVG and other formats are not accepted.",
  "名称不兼容 Windows 或含有无效字符。": "The name is incompatible with Windows or contains invalid characters.",
  "请在文件管理器中手动改名；Note Portal 不会自动修改文件。": "Rename it yourself in the file manager. Note Portal will not change files automatically.",
  "符号链接未被读取，以免访问资料库外的文件。": "A symbolic link was not read because it might lead outside the library.",
  "请使用资料库内的普通文件，或自行确认链接目标。": "Use an ordinary file in the library, or inspect the link target yourself.",
  "此处不使用 _index.md。": "_index.md is not used at this location.",
  "请参考资料库结构指南。": "See the library-structure guide.",
  "Week 文件名与文件夹不一致。": "The Week filename does not match its folder.",
  "Week 文件夹名称不符合 week-NN 或 weeks-NN-NN。": "The Week folder must be named week-NN or weeks-NN-NN.",
  "请参照资料库结构指南手动调整。": "Adjust the folder yourself using the library-structure guide.",
  "Study 笔记不在规定的 Semester / Unit / Week 位置。": "This Study note is not in the required Semester / Unit / Week location.",
  "放入 content/<semester>/<unit>/<week-key>/<week-key>-notes.md，或放入 inbox/。": "Put it under content/<semester>/<unit>/<week-key>/<week-key>-notes.md or inbox/.",
  "请在编辑器中修正后点击立即刷新。": "Fix it in your editor, then choose Refresh now.",
  "Frontmatter 缺少结束的 --- 行。": "Frontmatter is missing its closing --- line.",
  "Frontmatter 格式错误；请检查字段类型和缩进。": "Frontmatter is invalid. Check field types and indentation.",
  "显式 id 只能包含英文字母、数字、- 和 _，且最多 64 个字符。": "An explicit id may contain only letters, numbers, - and _, up to 64 characters.",
  "请修改 frontmatter 的 id，或删除该字段。": "Change the frontmatter id or remove that field.",
  "设置路径无效。": "The local settings path is invalid.",
  "无法创建本机设置文件夹。": "Could not create the local settings folder.",
  "本机设置文件是符号链接；为保护数据，已拒绝写入。": "The settings file is a symbolic link; writing was refused to protect your data.",
  "无法检查本机设置文件；为保护数据，已拒绝写入。": "Could not inspect the settings file; writing was refused to protect your data.",
  "无法保存本机设置。": "Could not save local settings.",
  "无法创建临时设置文件名。": "Could not create a temporary settings filename.",
  "无法创建临时设置文件。": "Could not create a temporary settings file.",
  "无法完整写入临时设置文件。": "Could not finish writing the temporary settings file.",
  "无法安全替换本机设置文件。": "Could not safely replace the local settings file.",
  "写入设置失败，且临时设置文件无法清理。": "Saving settings failed, and the temporary file could not be removed.",
  "无法读取当前设置，已保留原文件。": "Could not read the current settings; the original file was kept.",
  "本机设置已损坏。请先备份并人工检查设置文件。": "Local settings are damaged. Back up and inspect the settings file first.",
  "本机设置无需恢复。": "Local settings do not need restoring.",
  "本机设置无需重置。": "Local settings do not need resetting.",
  "无法备份损坏的设置；尚未恢复或重置。": "Could not back up the damaged settings; no restore or reset was made.",
  "设置文件过大；请先人工检查，尚未恢复或重置。": "The settings file is too large; inspect it manually. No restore or reset was made.",
  "无法创建设置备份名称。": "Could not create a settings backup name.",
  "无法创建损坏设置的备份；尚未恢复或重置。": "Could not create a backup of the damaged settings; no restore or reset was made.",
  "无法完整备份损坏的设置；尚未恢复或重置。": "Could not finish backing up the damaged settings; no restore or reset was made.",
  "损坏设置的备份未完成，且临时备份无法清理。": "The damaged-settings backup failed, and the incomplete backup could not be removed.",
  "设置备份无效或过大。": "The settings backup is invalid or too large.",
  "无法读取设置备份。": "Could not read the settings backup.",
  "设置备份也已损坏；请改用备份后重置。": "The settings backup is also damaged; use Back up and reset instead.",
  "本机 Logo 文件名无效。": "The local logo filename is invalid.",
  "已选择的本机 Logo 无法读取；请在设置中重新选择或清除。": "The selected local logo cannot be read. Replace or remove it in Settings.",
  "已选择的本机 Logo 文件无效；请在设置中重新选择或清除。": "The selected local logo file is invalid. Replace or remove it in Settings.",
  "已选择的本机 Logo 格式与文件名不符。": "The selected logo format does not match its filename.",
  "无法创建本机 Logo 文件名。": "Could not create a local logo filename.",
  "无法保存本机 Logo。": "Could not save the local logo.",
  "无法完整保存本机 Logo。": "Could not finish saving the local logo.",
  "无法完整保存本机 Logo，且未能清理未完成的文件。": "Could not finish saving the local logo or remove the incomplete file.",
  "新 Logo 已保存，但旧 Logo 文件无法清理。": "The new logo was saved, but the old logo file could not be removed.",
  "Logo 已清除，但旧 Logo 文件无法清理。": "The logo was cleared, but the old logo file could not be removed.",
  "文件夹选择已中断。": "Folder selection was interrupted.",
  "预览任务意外中断。": "The preview task stopped unexpectedly.",
  "无法创建 content 文件夹。": "Could not create the content folder.",
  "无法创建 inbox 文件夹。": "Could not create the inbox folder.",
  "无法打开支持页面；请检查默认浏览器设置。": "Could not open the support page. Check your default browser.",
  "无法更改系统的登录启动设置。": "Could not change the system login-startup setting.",
  "这个操作不适用于当前资料库类型。": "This action is not available for the current library type.",
  "无法创建目标文件夹。": "Could not create the destination folder.",
  "目标文件夹无法打开。": "Could not open the destination folder.",
  "Week 模板创建未完成，请检查目标文件。": "Week template creation did not finish. Check the destination file.",
  "无法创建本地阅读会话。": "Could not create a local reading session.",
  "扫描任务意外中断；当前阅读内容保持不变。": "The scan stopped unexpectedly; current reading content was kept.",
  "无法打开资料库文件夹。": "Could not open the library folder.",
  "资料库扫描任务意外中断。": "The library scan stopped unexpectedly.",
  "资料库文件夹扫描意外中断。": "The library folder scan stopped unexpectedly.",
  "无法启动本地服务；请检查系统网络权限。": "Could not start the local service. Check system network permissions.",
  "无法确定本地服务端口。": "Could not determine the local service port.",
  "无法监控资料库变动；请检查文件夹权限。": "Could not watch library changes. Check folder permissions.",
  "无法读取文件；请检查文件权限。": "Could not read the file. Check its permissions.",
  "无法读取文件信息；请检查文件权限。": "Could not read file information. Check permissions.",
  "文件暂时无法读取。": "The file is temporarily unreadable.",
  "文件读取期间发生变化；请稍后刷新。": "The file changed while being read. Refresh again shortly.",
  "文件读取期间发生变化；请保存完成后再刷新。": "The file changed while being read. Finish saving, then refresh.",
  "文件不是有效 UTF-8。": "The file is not valid UTF-8.",
  "扫描资料库时无法读取一个文件夹；请检查权限。": "A folder could not be read during the library scan. Check permissions.",
  "无法读取文件或文件夹。": "Could not read a file or folder.",
  "请检查访问权限，保存或同步完成后再刷新。": "Check access permissions, then refresh after saving or syncing finishes.",
  "资料库路径异常。": "The library path is invalid.",
  "路径包含无法识别的字符。": "The path contains unrecognised characters.",
  "请在文件管理器中手动改名。": "Rename it yourself in the file manager.",
  "请检查图片文件，保存或同步完成后再刷新。": "Check the image, then refresh after saving or syncing finishes.",
  "请检查文件编码和大小，保存完成后再刷新。": "Check the file encoding and size, then refresh after saving finishes.",
  "资料库的 Markdown 总量超过 64 MiB；请分开选择较小的资料库。": "The library contains more than 64 MiB of Markdown. Choose a smaller library.",
  "系统登录启动项未能同步；请在“设置与条款”中把登录启动选项重新切换一次。": "The system login-startup item could not be updated. Toggle the login-startup option once in Settings & terms.",
};

function backendText(value: string): string {
  if (language === "zh") return value;
  if (backendTranslations[value]) return backendTranslations[value];
  if (value.startsWith("建议名称：")) return `Suggested name: ${value.slice(5)}`;
  const pathSeparator = value.indexOf("：");
  if (pathSeparator > 0) {
    const detail = value.slice(pathSeparator + 1);
    const translated = backendText(detail);
    if (translated !== detail) return `${value.slice(0, pathSeparator)}: ${translated}`;
  }
  const oversized = value.match(/^文件超过 (\d+) MiB 的大小限制。$/);
  if (oversized) return `File exceeds the ${oversized[1]} MiB size limit.`;
  const collision = value.match(/^资料库存在仅大小写不同的冲突路径：(.*)。请先手动处理。$/);
  if (collision) return `The library has paths that differ only by letter case: ${collision[1]}. Resolve this manually.`;
  const duplicateId = value.match(/^资料库存在重复的文档 id：(.*)。请修改其中一篇的 frontmatter。$/);
  if (duplicateId) return `The library has a duplicate document id: ${duplicateId[1]}. Change one note's frontmatter.`;
  const logoCleanup = " 未使用的 Logo 文件也未能清理。";
  if (value.endsWith(logoCleanup)) return `${backendText(value.slice(0, -logoCleanup.length))} The unused logo file could not be removed.`;
  const loginWarning = " 系统登录启动设置可能已改变，请手动检查。";
  if (value.endsWith(loginWarning)) return `${backendText(value.slice(0, -loginWarning.length))} The login-startup setting may have changed; check it manually.`;
  const logoFallback = " 已改用文字标识；请在设置中重新选择或清除 Logo。";
  if (value.endsWith(logoFallback)) return `${backendText(value.slice(0, -logoFallback.length))} The text mark is in use; replace or remove the logo in Settings.`;
  return value;
}

function saveLanguage(next: Language): void {
  language = next;
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  try { localStorage.setItem("note-portal-language", next); } catch { /* Keep this-session preference. */ }
  void invoke("set_ui_language", { language: next }).catch((error) => showError(String(error)));
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function friendlyPath(value: string): string {
  return value.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
}

function dateLabel(value: string | null): string {
  if (!value) return tr("尚未刷新", "Not refreshed yet");
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(language === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" });
}

function treeHtml(nodes: TreeNode[], depth = 0): string {
  if (!nodes.length) return depth === 0 ? `<p class="empty">${tr("还没有识别到笔记。可以先创建一篇，或把已有 .md 文件放进资料库。", "No documents recognised yet. Create a note or add .md files to this library.")}</p>` : "";
  return `<ul class="tree-list">${nodes.map((node) => {
    const icon = node.id ? "▤" : "▰";
    if (node.id) return `<li class="tree-document"><span class="tree-icon" aria-hidden="true">${icon}</span><span>${escapeHtml(node.label)}</span></li>`;
    const kind = { folder: tr("文件夹", "Folder"), semester: tr("学期", "Semester"), unit: "Unit", week: "Week" }[node.kind] || node.kind;
    return `<li><details ${depth < 2 ? "open" : ""}><summary><span class="tree-icon" aria-hidden="true">${icon}</span><span>${escapeHtml(node.label)}</span><small>${escapeHtml(kind)}</small></summary>${treeHtml(node.children, depth + 1)}</details></li>`;
  }).join("")}</ul>`;
}

function diagnosticsHtml(items: Diagnostic[]): string {
  if (!items.length) return `<p class="quiet">${tr("没有发现未识别文件。", "No unrecognised files found.")}</p>`;
  return `<ul class="warning-list">${items.map((item) => `<li><strong>${escapeHtml(item.path)}</strong><span>${escapeHtml(backendText(item.reason))}</span><small>${escapeHtml(backendText(item.suggestion))}</small></li>`).join("")}</ul>`;
}

function header(label: string): string {
  return `<header class="app-header"><div class="brand"><span class="brand-mark" aria-hidden="true">▤</span><span>Note Portal</span></div><div class="header-actions"><span class="header-label">${escapeHtml(label)}</span><label class="language-picker"><span>${tr("语言", "Language")}</span><select id="language" aria-label="${tr("界面语言", "Interface language")}"><option value="zh" ${language === "zh" ? "selected" : ""}>中文</option><option value="en" ${language === "en" ? "selected" : ""}>English</option></select></label></div></header>`;
}

function wireLanguagePicker(): void {
  app.querySelector<HTMLSelectElement>("#language")?.addEventListener("change", (event) => {
    saveLanguage((event.target as HTMLSelectElement).value as Language);
    if (status.settingsRecoveryPath) renderSettingsRecovery();
    else if (!status.noticeAccepted) void showNotice();
    else if (!status.guideCompleted) showFirstRunGuide();
    else if (setupVisible || !status.libraryPath) renderSetup();
    else renderStatus();
  });
}

function renderAfterStatus(): void {
  if (status.settingsRecoveryPath) renderSettingsRecovery();
  else if (!status.noticeAccepted) void showNotice();
  else if (!status.guideCompleted) showFirstRunGuide();
  else if (!status.libraryPath) renderSetup();
  else renderStatus();
}

function recoveryWarning(warning: string | null): string {
  return warning ? `<p class="message" role="alert">${escapeHtml(backendText(warning))}</p>` : "";
}

function renderSettingsRecovery(): void {
  app.innerHTML = `${header(tr("本机设置需要恢复", "Local settings need recovery"))}<main class="page notice-page"><h1>${tr("设置文件无法读取", "Settings file could not be loaded")}</h1><p>${tr("你的笔记文件不会被删除或修改。可以先尝试恢复上一份设置；如果没有可用备份，可以把损坏的设置另存一份，再从头设置应用。", "Your notes will not be deleted or changed. First try the previous settings backup. If none is usable, preserve the damaged settings and set up the app again.")}</p><p class="message" role="alert">${escapeHtml(backendText(status.error || ""))}</p><p class="path-preview">${escapeHtml(status.settingsRecoveryPath || "")}</p><div class="button-row"><button class="button" id="restore-settings" type="button" ${status.settingsBackupAvailable ? "" : "disabled"}>${tr("恢复上一份设置", "Restore previous settings")}</button><button class="button primary" id="reset-settings" type="button">${tr("备份后重置设置", "Back up and reset settings")}</button></div><p id="message" class="message" role="alert" hidden></p></main>`;
  wireLanguagePicker();
  app.querySelector("#restore-settings")?.addEventListener("click", () => void action(async () => {
    const result = await invoke<SettingsReset>("restore_settings_backup");
    status = result.status;
    openDialog(tr("设置已恢复", "Settings restored"), `<p>${tr("原损坏设置已另外保存在：", "The damaged settings were preserved at:")}</p><p class="path-preview">${escapeHtml(result.backupPath)}</p>${recoveryWarning(result.warning)}<button class="button primary" id="continue-after-restore" type="button">${tr("继续", "Continue")}</button>`);
    dialog.querySelector("#continue-after-restore")?.addEventListener("click", () => { dialog.close(); renderAfterStatus(); });
  }));
  app.querySelector("#reset-settings")?.addEventListener("click", () => {
    openDialog(tr("确认重置本机设置", "Confirm local settings reset"), `<p>${tr("将保留一份损坏设置的备份，然后清除应用中的资料库选择、主题和启动选项。原始笔记文件不会被修改。", "The damaged settings will be backed up, then the app's library selection, theme and startup options will be cleared. Your note files will not be changed.")}</p><div class="button-row"><button class="button" id="cancel-reset" type="button">${tr("取消", "Cancel")}</button><button class="button primary" id="confirm-reset" type="button">${tr("备份并重置", "Back up and reset")}</button></div><p id="dialog-message" class="message" role="alert" hidden></p>`);
    dialog.querySelector("#cancel-reset")?.addEventListener("click", () => dialog.close());
    dialog.querySelector("#confirm-reset")?.addEventListener("click", () => void action(async () => {
      const result = await invoke<SettingsReset>("reset_corrupt_settings");
      status = result.status;
      openDialog(tr("设置已重置", "Settings reset"), `<p>${tr("损坏设置已备份到：", "Damaged settings were backed up to:")}</p><p class="path-preview">${escapeHtml(result.backupPath)}</p>${recoveryWarning(result.warning)}<button class="button primary" id="continue-after-reset" type="button">${tr("继续首次设置", "Continue setup")}</button>`);
      dialog.querySelector("#continue-after-reset")?.addEventListener("click", () => { dialog.close(); renderAfterStatus(); });
    }));
  });
}

function showError(message: string): void {
  message = backendText(message);
  const target = dialog.open
    ? dialog.querySelector<HTMLElement>("#dialog-message")
    : app.querySelector<HTMLElement>("#message");
  if (target) {
    target.textContent = message;
    target.hidden = false;
  } else if (dialog.open && !dialogDismissible) {
    const inline = document.createElement("p");
    inline.id = "dialog-message";
    inline.className = "message";
    inline.setAttribute("role", "alert");
    inline.textContent = message;
    dialog.querySelector(".dialog-content")!.append(inline);
  } else {
    if (dialog.open) dialog.close();
    openDialog(tr("操作没有完成", "Could not complete the action"), `<p>${escapeHtml(message)}</p><button class="button primary" id="dialog-close" type="button">${tr("知道了", "OK")}</button>`);
  }
}

async function action<T>(work: () => Promise<T>): Promise<T | undefined> {
  if (busy) return undefined;
  busy = true;
  document.body.classList.add("is-busy");
  try {
    return await work();
  } catch (error) {
    showError(String(error));
    return undefined;
  } finally {
    busy = false;
    document.body.classList.remove("is-busy");
  }
}

let dialogDismissible = true;

function openDialog(title: string, body: string, dismissible = true): void {
  dialogDismissible = dismissible;
  dialog.innerHTML = `<div class="dialog-content"><div class="dialog-heading"><h2 id="dialog-title">${escapeHtml(title)}</h2>${dismissible ? `<button class="icon-close" id="dialog-close" type="button" aria-label="${tr("关闭", "Close")}">×</button>` : ""}</div>${body}</div>`;
  if (dismissible) dialog.querySelector("#dialog-close")?.addEventListener("click", () => dialog.close());
  if (!dialog.open) dialog.showModal();
}

async function showNotice(): Promise<void> {
  const full = await invoke<string>("get_notice", { language });
  app.innerHTML = `${header(tr("首次使用 · 必须确认", "First use · confirmation required"))}
    <main class="page notice-page">
      <p class="eyebrow">${tr("使用前请阅读", "Read before use")}</p>
      <h1>${tr("学术诚信与负责任使用", "Academic integrity and responsible use")}</h1>
      <p>${tr("Note Portal 用于整理、阅读和检索你有权使用的本地 Markdown 文档，包括学习笔记、资料与日志。它不提供 AI 生成服务，也不会授予复制、发布或分享第三方材料的权利。", "Note Portal organises, reads and searches local Markdown documents you are authorised to use, including notes, documents and logs. It does not generate AI content or grant rights to copy, publish or share third-party material.")}</p>
      <div class="notice-box">
        <p>${tr("请检查并遵守你所在学校、院系、课程和考试的学术诚信规定，以及版权、隐私和保密要求。不同场景的规定可能不同。", "Check and follow the academic-integrity rules of your institution, faculty, course and assessment, as well as applicable copyright, privacy and confidentiality requirements.")}</p>
        <p>${tr("建议只在自己的电脑上使用。通常不建议把服务直接部署到公网，以免暴露课程资料、私人笔记或个人信息。", "Use on your own computer is recommended. Direct public-internet deployment is generally discouraged because it may expose course materials, private notes or personal information.")}</p>
        <p>${tr("不得用本工具侵犯版权、泄露受限资料、规避学术诚信要求或从事其他违法行为。用户对导入、处理和分享的内容及使用方式负责。", "Do not use this tool to infringe copyright, disclose restricted material, evade academic-integrity rules or break the law. You are responsible for your content and how you use it.")}</p>
      </div>
      <button class="text-link" id="notice-full" type="button">${tr("查看完整使用提示、隐私说明与开源许可证", "View full notice, privacy information and open-source licences")}</button>
      <label class="check-line"><input id="notice-check" type="checkbox" ${noticeRead ? "" : "disabled"} /><span>${tr("我已阅读并理解完整提示，同意仅处理我有权使用的内容，并遵守适用规定。", "I have read and understood the full notice. I agree to process only content I am authorised to use and follow applicable rules.")}</span></label>
      <p class="quiet" id="notice-requirement">${noticeRead ? tr("已读到完整提示末尾，现在可以勾选。", "You reached the end. You may now check the box.") : tr("请先打开完整提示并滚动到底，之后才能勾选。", "Open the full notice and scroll to the end before checking the box.")}</p>
      <p id="message" class="message" role="alert" hidden></p>
      <div class="button-row"><button class="button" id="decline" type="button">${tr("不同意并退出", "Decline and quit")}</button><button class="button primary" id="agree" type="button" disabled>${tr("同意并继续", "Agree and continue")}</button></div>
    </main>`;
  wireLanguagePicker();
  app.querySelector("#notice-full")?.addEventListener("click", () => void (async () => {
    openDialog(`${tr("完整使用提示", "Full responsible-use notice")} · ${escapeHtml(status.noticeVersion)}`,
      `<div class="markdown-content long-text" id="full-notice" role="region" tabindex="0" aria-label="${tr("完整使用提示正文", "Full notice text")}"><p>${tr("正在载入…", "Loading…")}</p></div><p class="quiet" id="notice-scroll-hint">${tr("请滚动到正文最底部。", "Scroll to the end of the notice.")}</p>`);
    const content = dialog.querySelector<HTMLElement>("#full-notice")!;
    try {
      content.innerHTML = await renderMarkdown(full);
      const updateRead = () => {
        if (content.scrollTop + content.clientHeight < content.scrollHeight - 8) return;
        noticeRead = true;
        const checkbox = app.querySelector<HTMLInputElement>("#notice-check")!;
        checkbox.disabled = false;
        app.querySelector<HTMLElement>("#notice-requirement")!.textContent = tr("已读到完整提示末尾，现在可以勾选。", "You reached the end. You may now check the box.");
        dialog.querySelector<HTMLElement>("#notice-scroll-hint")!.textContent = tr("已读到末尾。关闭窗口后勾选同意。", "End reached. Close this window, then check the box.");
      };
      content.addEventListener("scroll", updateRead);
    } catch (error) {
      content.textContent = String(error);
    }
  })());
  app.querySelector<HTMLInputElement>("#notice-check")?.addEventListener("change", (event) => {
    (app.querySelector<HTMLButtonElement>("#agree")!).disabled = !noticeRead || !(event.target as HTMLInputElement).checked;
  });
  app.querySelector("#decline")?.addEventListener("click", () => void invoke("quit"));
  app.querySelector("#agree")?.addEventListener("click", () => void action(async () => {
    if (!noticeRead || !app.querySelector<HTMLInputElement>("#notice-check")?.checked) return;
    await invoke("accept_notice");
    status = await invoke<Status>("get_status");
    renderAfterStatus();
  }));
}

function showFirstRunGuide(step = 0): void {
  guideStep = step;
  setupVisible = true;
  app.innerHTML = `${header(tr("首次使用 · 必须完成指引", "First use · guide required"))}<main class="page"><p class="eyebrow">Note Portal</p><h1>${tr("一分钟了解", "One-minute introduction")}</h1><p>${tr("请完成首次使用指引，再选择资料库。", "Complete this first-use guide before choosing a library.")}</p></main>`;
  wireLanguagePicker();
  const steps = [
    `<p>${tr("Note Portal 是本机 Markdown 阅读器，可统一查看学习笔记、文档和日志。它不生成 AI 内容；你可以继续用自己的编辑器或外部 AI 工具写 .md 文件。", "Note Portal is a local Markdown reader for study notes, documents and logs. It does not generate AI content; keep writing .md files with your editor or an external AI tool.")}</p><p class="quiet">${tr("控制窗口负责状态和设置，正文在普通浏览器打开。", "The control window shows status and settings; documents open in a normal browser.")}</p>`,
    `<p>${tr("选择“普通文档”会按原有文件夹组织 .md；选择“学习笔记”会按学期 → Unit → Week 识别主笔记。", "Choose General to retain existing folders and .md files, or Study for Semester → Unit → Week primary notes.")}</p><p class="path-preview">${tr("普通文档：", "General:")} projects / roadmap.md<br>${tr("学习笔记：", "Study:")} content / 2026-semester-2 / DEMO101 / week-01 / week-01-notes.md</p><p class="quiet">${tr("不确定时先选普通文档；选择文件夹后会给你识别预览，不会移动原文件。", "If unsure, start with General. A recognition preview appears before confirming a folder; existing files are not moved.")}</p>`,
    `<p>${tr("选择已有资料库，或创建一个新的。识别成功后用“打开阅读器”在浏览器查看内容。外部工具修改 .md 时，阅读器会动态刷新。", "Choose an existing library or create a new one. Then use Open reader to view it in the browser. When external tools change .md files, the reader refreshes.")}</p><p>${tr("若文件没有出现，先查看窗口中的“未识别文件与原因”，再核对目录和命名。", "If a file is missing, check Unrecognised files and reasons in this window, then check its location and name.")}</p><p class="quiet">${tr("仅在自己的电脑使用更安全；请遵守适用的学术诚信、版权及隐私要求。", "Local use is safer. Follow applicable academic-integrity, copyright and privacy rules.")}</p>`,
  ];
  openDialog(`${tr("一分钟了解", "One-minute introduction")} · ${step + 1}/3`, `<label class="language-picker intro-language">${tr("语言", "Language")}<select id="intro-language" aria-label="${tr("界面语言", "Interface language")}"><option value="zh" ${language === "zh" ? "selected" : ""}>中文</option><option value="en" ${language === "en" ? "selected" : ""}>English</option></select></label><div class="intro-step">${steps[step]}</div><p class="quiet">${tr("第", "Step")} ${step + 1} / 3</p><div class="button-row"><button class="button" id="intro-back" type="button" ${step === 0 ? "disabled" : ""}>${tr("上一步", "Back")}</button><button class="text-link" id="intro-guide" type="button">${tr("查看详细指南", "Read detailed guide")}</button><button class="button primary" id="intro-next" type="button">${step === 2 ? tr("完成指引，选择资料库", "Finish guide and choose library") : tr("下一步", "Next")}</button></div><p id="dialog-message" class="message" role="alert" hidden></p>`, false);
  dialog.querySelector<HTMLSelectElement>("#intro-language")?.addEventListener("change", (event) => {
    saveLanguage((event.target as HTMLSelectElement).value as Language);
    showFirstRunGuide(step);
  });
  dialog.querySelector("#intro-back")?.addEventListener("click", () => showFirstRunGuide(step - 1));
  dialog.querySelector("#intro-guide")?.addEventListener("click", () => void showGuide(step));
  dialog.querySelector("#intro-next")?.addEventListener("click", () => {
    if (step < 2) { showFirstRunGuide(step + 1); return; }
    void action(async () => {
      await invoke("complete_guide");
      status = await invoke<Status>("get_status");
      dialog.close();
      if (status.libraryPath) renderStatus();
      else renderSetup();
    });
  });
}

function profileCard(value: Profile, title: string, description: string, example: string): string {
  return `<button class="profile-card ${profile === value ? "selected" : ""}" type="button" data-profile="${value}" aria-pressed="${profile === value}"><span class="profile-card-head"><span class="radio-dot"></span><strong>${title}</strong></span><span class="quiet">${description}</span><code>${example}</code></button>`;
}

function renderSetup(): void {
  setupVisible = true;
  app.innerHTML = `${header(tr("设置资料库", "Set up library"))}
    <main class="page setup-page">
      <p class="eyebrow">${tr("简单开始 · 约 1 分钟", "Get started · about 1 minute")}</p>
      <h1>${tr("把 Markdown 整理成随时可读的页面", "Turn Markdown into an easy-to-read library")}</h1>
      <p class="lead">${tr("你或外部 AI 工具继续照常写 .md 文件；Note Portal 只负责本机识别、搜索与自动刷新，正文会在普通浏览器里打开。", "Keep writing .md files yourself or with an external AI tool. Note Portal recognises, searches and refreshes them locally; documents open in a normal browser.")}</p>
      <div class="step-title"><span>1</span><strong>${tr("选择整理方式", "Choose an organisation mode")}</strong></div>
      <div class="profile-grid">
        ${profileCard("general", tr("普通文档 · General", "General documents"), tr("保留你原来的文件夹层级，递归识别 .md。", "Keep existing folders; recognise .md files recursively."), "My Notes / projects / roadmap.md")}
        ${profileCard("study", tr("学习笔记 · Study", "Study notes"), tr("按学期 → Unit → Week 识别唯一主笔记。", "Recognise one primary note per Semester → Unit → Week."), "content / 2026-semester-2 / DEMO101 / week-01 / week-01-notes.md")}
      </div>
      <div class="step-title"><span>2</span><strong>${tr("选择资料库", "Choose a library")}</strong></div>
      <div class="segmented" role="group" aria-label="${tr("资料库来源", "Library source")}"><button type="button" data-mode="existing" aria-pressed="${setupMode === "existing"}">${tr("使用已有文件夹", "Use existing folder")}</button><button type="button" data-mode="new" aria-pressed="${setupMode === "new"}">${tr("创建新资料库", "Create new library")}</button></div>
      ${setupMode === "new" ? `<label class="field">${tr("资料库名称", "Library name")}<input id="library-name" value="${escapeHtml(libraryName)}" maxlength="80" autocomplete="off" /></label><p class="quiet">${tr("选择保存位置后，会在里面创建一个新文件夹：", "A new folder will be created in your chosen location: ")}<span id="library-name-preview">${escapeHtml(libraryName)}</span></p>` : `<p class="quiet">${tr("选择存放笔记的最外层文件夹。Study 请选同时包含 content/ 与 inbox/ 的那一层。", "Choose the outermost folder containing your notes. For Study, choose the folder containing both content/ and inbox/.")}</p>`}
      <div class="pick-row"><button class="button" id="pick" type="button">${setupMode === "new" ? tr("选择保存位置…", "Choose save location…") : tr("选择资料库文件夹…", "Choose library folder…")}</button><span class="picked-path">${selectedPath ? escapeHtml(friendlyPath(selectedPath)) : tr("尚未选择", "Not selected")}</span></div>
      ${preview ? `<section class="preview"><div class="section-heading"><h2>${tr("识别预览", "Recognition preview")}</h2><span>${preview.documentCount} ${tr("篇文档", "documents")} · ${preview.diagnostics.length} ${tr("个提醒", "notices")}</span></div><div class="tree-scroll">${treeHtml(preview.tree)}</div>${preview.diagnostics.length ? `<details class="warning-details"><summary>${tr("查看未识别文件与原因", "Unrecognised files and reasons")}</summary>${diagnosticsHtml(preview.diagnostics)}</details>` : ""}</section>` : ""}
      <p id="message" class="message" role="alert" hidden></p>
      <div class="button-row setup-actions"><button class="text-link" id="guide" type="button">${tr("使用指南", "User guide")}</button><button class="button primary" id="continue" type="button" ${selectedPath ? "" : "disabled"}>${setupMode === "new" ? tr("创建并打开", "Create and open") : tr("确认并打开", "Confirm and open")}</button></div>
    </main>`;
  wireLanguagePicker();
  app.querySelectorAll<HTMLButtonElement>("[data-profile]").forEach((button) => button.addEventListener("click", () => {
    profile = button.dataset.profile as Profile;
    preview = null;
    selectedPath = "";
    renderSetup();
  }));
  app.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    setupMode = button.dataset.mode as "existing" | "new";
    preview = null;
    selectedPath = "";
    renderSetup();
  }));
  app.querySelector<HTMLInputElement>("#library-name")?.addEventListener("input", (event) => {
    libraryName = (event.target as HTMLInputElement).value;
    const hint = app.querySelector<HTMLElement>("#library-name-preview");
    if (hint) hint.textContent = libraryName;
  });
  app.querySelector("#pick")?.addEventListener("click", () => void action(async () => {
    const picked = await invoke<string | null>("pick_folder");
    if (!picked) return;
    const nextPreview = setupMode === "existing" ? await invoke<Preview>("preview_folder", { path: picked, profile }) : null;
    selectedPath = picked;
    preview = nextPreview;
    renderSetup();
  }));
  app.querySelector("#continue")?.addEventListener("click", () => void action(async () => {
    if (!selectedPath) return;
    status = setupMode === "existing"
      ? await invoke<Status>("select_library", { path: selectedPath, profile })
      : await invoke<Status>("create_library", { parent: selectedPath, name: libraryName.trim(), profile });
    setupVisible = false;
    renderStatus();
  }));
  app.querySelector("#guide")?.addEventListener("click", () => void showGuide());
}

function renderStatus(): void {
  setupVisible = false;
  const running = status.serviceState === "running" || status.serviceState === "degraded";
  const starting = status.serviceState === "starting";
  const label = { running: tr("运行中", "Running"), degraded: tr("运行中 · 需注意", "Running · attention needed"), starting: tr("启动中", "Starting"), stopped: tr("已停止", "Stopped") }[status.serviceState];
  app.innerHTML = `${header(label)}
    <main class="page status-page">
      <div class="library-heading"><div><p class="eyebrow">${tr("当前资料库", "Current library")}</p><h1>${escapeHtml(status.libraryName || tr("尚未选择资料库", "No library selected"))}</h1><p class="quiet">${status.profile === "study" ? tr("学习笔记 · Study", "Study notes") : tr("普通文档 · General", "General documents")} · ${escapeHtml(status.libraryPath || "")}</p></div><span class="state-pill ${status.serviceState}">${label}</span></div>
      <div class="stat-grid"><div><strong>${status.documentCount}</strong><span>${tr("篇笔记", "documents")}</span></div><div><strong>${status.diagnostics.length}</strong><span>${tr("个提醒", "notices")}</span></div><div><strong>${running ? tr("仅本机", "Local only") : starting ? tr("启动中", "Starting") : tr("未运行", "Not running")}</strong><span>${tr("访问范围", "Access")}</span></div></div>
      <section class="panel tree-panel"><div class="section-heading"><h2>${tr("资料库目录", "Library tree")}</h2><span>${status.profile === "study" ? "Semester / Unit / Week" : tr("文件夹 / 文档", "Folders / documents")}</span></div><div class="tree-scroll">${treeHtml(status.tree)}</div></section>
      ${status.diagnostics.length ? `<details class="warning-details"><summary>${status.diagnostics.length} ${tr("个文件未识别 · 查看原因", "unrecognised files · view reasons")}</summary>${diagnosticsHtml(status.diagnostics)}</details>` : ""}
      ${status.error ? `<p class="message" role="alert">${escapeHtml(backendText(status.error))}</p>` : ""}
      <p class="last-refresh">${tr("上次成功刷新：", "Last successful refresh: ")}${escapeHtml(dateLabel(status.lastRefresh))}</p>
      <div class="main-actions"><button class="button primary" id="open" type="button" ${running ? "" : "disabled"}>${tr("打开阅读器", "Open reader")} ↗</button><button class="button" id="refresh" type="button" ${running ? "" : "disabled"}>${tr("立即刷新", "Refresh now")}</button><button class="button" id="folder" type="button">${tr("打开文件夹", "Open folder")}</button></div>
      <div class="secondary-actions"><button class="text-link" id="create" type="button">${status.profile === "study" ? tr("＋ 创建 Week 模板", "+ Create Week template") : tr("＋ 创建笔记", "+ Create note")}</button><button class="text-link" id="switch" type="button">${tr("更换资料库", "Change library")}</button><button class="text-link" id="service" type="button" ${starting ? "disabled" : ""}>${starting ? tr("启动中…", "Starting…") : running ? tr("停止服务", "Stop service") : tr("启动服务", "Start service")}</button></div>
      <p id="message" class="message" role="alert" hidden></p>
    </main>
    <footer class="app-footer"><button id="help" type="button">${tr("使用指南", "User guide")}</button><button id="settings" type="button">${tr("设置与条款", "Settings & terms")}</button><button id="about" type="button">${tr("关于", "About")}</button><button id="quit" type="button">${tr("退出", "Quit")}</button></footer>`;
  wireLanguagePicker();
  app.querySelector("#open")?.addEventListener("click", () => void action(() => invoke("open_portal")));
  app.querySelector("#refresh")?.addEventListener("click", () => void action(async () => { status = await invoke<Status>("refresh_now"); renderStatus(); }));
  app.querySelector("#folder")?.addEventListener("click", () => void action(() => invoke("open_library_folder")));
  app.querySelector("#service")?.addEventListener("click", () => void action(async () => {
    status = await invoke<Status>(running ? "stop_service" : "start_service", running ? {} : { openBrowser: false });
    renderStatus();
  }));
  app.querySelector("#switch")?.addEventListener("click", () => { selectedPath = ""; preview = null; renderSetup(); });
  app.querySelector("#create")?.addEventListener("click", () => void action(() => showCreate()));
  app.querySelector("#help")?.addEventListener("click", () => void showGuide());
  app.querySelector("#settings")?.addEventListener("click", () => void showSettings());
  app.querySelector("#about")?.addEventListener("click", () => void showAbout());
  app.querySelector("#quit")?.addEventListener("click", () => void invoke("quit"));
}

async function showCreate(): Promise<void> {
  if (status.profile === "general") {
    const folders = await invoke<string[]>("list_general_folders");
    const options = folders.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    openDialog(tr("创建一篇笔记", "Create a note"), `<p class="quiet">${tr("只创建一个新的 .md 文件；已有文件不会覆盖。", "This creates one new .md file; existing files are never overwritten.")}</p><label class="field">${tr("笔记标题", "Note title")}<input id="note-title" maxlength="80" placeholder="${tr("例如：读书摘录", "e.g. Reading notes")}" /></label><label class="field">${tr("放在哪个文件夹", "Destination folder")}<select id="note-folder"><option value="">${tr("资料库最外层", "Library root")}</option>${options}</select></label><p class="path-preview" id="note-preview" aria-live="polite">${tr("输入标题以预览实际创建位置。", "Enter a title to preview the exact destination.")}</p><p id="dialog-message" class="message" role="alert" hidden></p><div class="button-row"><button class="button primary" id="submit-note" type="button" disabled>${tr("创建笔记", "Create note")}</button></div>`);
    const titleInput = dialog.querySelector<HTMLInputElement>("#note-title")!;
    const folderInput = dialog.querySelector<HTMLSelectElement>("#note-folder")!;
    const target = dialog.querySelector<HTMLElement>("#note-preview")!;
    const submit = dialog.querySelector<HTMLButtonElement>("#submit-note")!;
    let requestId = 0;
    let pending: number | undefined;
    const updatePreview = () => {
      window.clearTimeout(pending);
      const current = ++requestId;
      submit.disabled = true;
      const title = titleInput.value.trim();
      if (!title) {
        target.textContent = tr("输入标题以预览实际创建位置。", "Enter a title to preview the exact destination.");
        return;
      }
      target.textContent = tr("正在检查目标位置…", "Checking destination…");
      pending = window.setTimeout(async () => {
        try {
          const result = await invoke<NotePreview>("preview_note", { title, folder: folderInput.value });
          if (current !== requestId || !dialog.open) return;
          const relativePath = result.relativePath.replaceAll("/", " / ");
          target.textContent = `${tr("将创建：", "Will create: ")}${status.libraryName || tr("资料库", "Library")} / ${relativePath}${result.exists ? `\n${tr("同名文件已存在，不会覆盖。", "A file already exists here; it will not be overwritten.")}` : ""}`;
          submit.disabled = result.exists;
        } catch (error) {
          if (current !== requestId || !dialog.open) return;
          target.textContent = `${tr("无法使用这个名称或位置：", "Invalid name or destination: ")}${backendText(String(error))}`;
        }
      }, 150);
    };
    titleInput.addEventListener("input", updatePreview);
    folderInput.addEventListener("change", updatePreview);
    dialog.querySelector("#submit-note")?.addEventListener("click", () => void action(async () => {
      submit.disabled = true;
      const title = titleInput.value;
      const folder = folderInput.value;
      status = await invoke<Status>("create_note", { title, folder });
      dialog.close(); renderStatus();
    }).finally(() => { if (dialog.open) updatePreview(); }));
  } else {
    openDialog(tr("创建 Week 模板", "Create Week template"), `<p class="quiet">${tr("预览并创建唯一的主笔记。不会移动或覆盖已有文件。", "Preview and create one primary note. Existing files are never moved or overwritten.")}</p><label class="field">${tr("学期", "Semester")}<input id="semester" value="2026-semester-2" /></label><label class="field">${tr("Unit 代码或短名称", "Unit code or short name")}<input id="unit" placeholder="${tr("例如：DEMO101", "e.g. DEMO101")}" /></label><div class="field-row"><label class="field">${tr("Week 数字", "Week number")}<input id="week" type="number" min="1" max="99" value="1" /></label><label class="field">${tr("合并到 Week（可选）", "Merge through Week (optional)")}<input id="end-week" type="number" min="2" max="99" /></label></div><p class="path-preview" id="week-preview"></p><p id="dialog-message" class="message" role="alert" hidden></p><div class="button-row"><button class="button primary" id="submit-week" type="button">${tr("创建主笔记", "Create primary note")}</button></div>`);
    const submit = dialog.querySelector<HTMLButtonElement>("#submit-week")!;
    const weekInput = dialog.querySelector<HTMLInputElement>("#week")!;
    const endInput = dialog.querySelector<HTMLInputElement>("#end-week")!;
    const validWeek = (value: string): number | null => {
      const number = Number(value);
      return value.trim() && Number.isInteger(number) && number >= 1 && number <= 99 ? number : null;
    };
    const updatePreview = () => {
      const semester = dialog.querySelector<HTMLInputElement>("#semester")!.value;
      const unit = dialog.querySelector<HTMLInputElement>("#unit")!.value;
      const week = validWeek(weekInput.value);
      const end = endInput.value.trim() ? validWeek(endInput.value) : null;
      const valid = week !== null && (!endInput.value.trim() || (end !== null && end > week));
      submit.disabled = !valid;
      if (!valid) {
        dialog.querySelector<HTMLElement>("#week-preview")!.textContent = tr("Week 必须是 1–99 的整数；合并周次必须更大。", "Use whole Week numbers from 1 to 99; the merged end must be later.");
        return;
      }
      const key = end !== null ? `weeks-${String(week).padStart(2, "0")}-${String(end).padStart(2, "0")}` : `week-${String(week).padStart(2, "0")}`;
      dialog.querySelector<HTMLElement>("#week-preview")!.textContent = `content / ${semester} / ${unit || "Unit"} / ${key} / ${key}-notes.md`;
    };
    dialog.querySelectorAll("input").forEach((input) => input.addEventListener("input", updatePreview));
    updatePreview();
    dialog.querySelector("#submit-week")?.addEventListener("click", () => void action(async () => {
      const semester = dialog.querySelector<HTMLInputElement>("#semester")!.value;
      const unit = dialog.querySelector<HTMLInputElement>("#unit")!.value;
      const week = validWeek(weekInput.value);
      const end = endInput.value.trim() ? validWeek(endInput.value) : null;
      if (week === null || (endInput.value.trim() && (end === null || end <= week))) {
        throw new Error(tr("请输入有效的 Week 数字。", "Enter valid Week numbers."));
      }
      status = await invoke<Status>("create_week", { semester, unit, week, endWeek: end });
      dialog.close(); renderStatus();
    }));
  }
}

async function showGuide(introStep?: number): Promise<void> {
  try {
    const guide = await invoke<string>("get_guide", { language });
    const html = await renderMarkdown(guide);
    openDialog(tr("使用指南", "User guide"), `<p class="quiet">${tr("从选择文件夹到自动刷新，一步一步说明。窗口只负责控制，正文在浏览器阅读。", "Step-by-step instructions from choosing a folder to automatic refresh. The control window manages settings; the browser displays documents.")}</p><div class="markdown-content long-text" id="guide-text">${html}</div>${introStep === undefined ? "" : `<div class="button-row"><button class="button primary" id="guide-back" type="button">${tr("返回首次指引", "Back to introduction")}</button></div>`}`, introStep === undefined);
    dialog.querySelector("#guide-back")?.addEventListener("click", () => showFirstRunGuide(introStep));
  } catch (error) {
    showError(String(error));
  }
}

async function showSettings(): Promise<void> {
  try {
    const notice = await invoke<string>("get_notice", { language });
    const html = await renderMarkdown(notice);
    const colors = [
      ["green", tr("绿色", "Green")], ["crimson", tr("绯红", "Crimson")],
      ["blue", tr("蓝色", "Blue")], ["violet", tr("紫色", "Violet")],
    ];
    openDialog(tr("设置与使用条款", "Settings and terms"), `<label class="field">${tr("界面语言", "Interface language")}<select id="settings-language"><option value="zh" ${language === "zh" ? "selected" : ""}>中文</option><option value="en" ${language === "en" ? "selected" : ""}>English</option></select></label><fieldset class="branding-field"><legend>${tr("Windows 阅读页主题色", "Windows reader accent colour")}</legend><div class="color-options">${colors.map(([value, label]) => `<button class="color-option ${value}" data-color="${value}" aria-pressed="${status.themeColor === value}" type="button"><span class="color-swatch"></span>${label}</button>`).join("")}</div></fieldset><label class="field">${tr("本地 Logo（可选）", "Local logo (optional)")}<input id="brand-logo" type="file" accept="image/png,image/jpeg,image/webp" /></label><p class="quiet">${status.logoSelected ? tr("已选择 Logo。新图片会替换旧图片。", "A logo is selected. A new image will replace it.") : tr("未选择 Logo，阅读器将只显示 Note Portal 文字。", "No logo selected; the reader shows the Note Portal name only.")} ${tr("仅支持 PNG、JPEG、WebP，最大 2 MiB；图片仅保存在本机，不附带学校官方标识。", "PNG, JPEG and WebP up to 2 MiB. The image stays on this computer; no official school logo is bundled.")}</p>${status.logoSelected ? `<button class="button" id="clear-logo" type="button">${tr("清除 Logo", "Remove logo")}</button>` : ""}<p class="quiet">${tr("更改颜色或 Logo 后，请刷新已打开的浏览器阅读页。", "Refresh an already open browser reader after changing colour or logo.")}</p><label class="check-line"><input id="autostart" type="checkbox" ${status.launchAtLogin ? "checked" : ""} /><span>${tr("登录电脑后在任务栏静默启动服务（不自动打开浏览器）", "Start the local service at login in the taskbar (do not open the browser automatically)")}</span></label><p class="quiet">${tr("本机已同意版本", "Notice version accepted: ")} ${escapeHtml(status.noticeVersion)}${tr("，时间：", ", at ")}${escapeHtml(dateLabel(status.acceptedAt))}${tr("。默认只允许本机访问。", ". Only this computer can connect by default.")}</p><details class="terms-details"><summary>${tr("使用条款、学术诚信与隐私说明", "Terms, academic integrity and privacy")}</summary><div class="markdown-content long-text" id="settings-notice">${html}</div></details><p id="dialog-message" class="message" role="alert" hidden></p>`);
  } catch (error) {
    showError(String(error));
    return;
  }
  dialog.querySelector<HTMLSelectElement>("#settings-language")?.addEventListener("change", (event) => {
    saveLanguage((event.target as HTMLSelectElement).value as Language);
    dialog.close();
    renderStatus();
    void showSettings();
  });
  dialog.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((button) => button.addEventListener("click", () => void action(async () => {
    status = await invoke<Status>("set_theme_color", { themeColor: button.dataset.color });
    renderStatus();
    await showSettings();
  })));
  dialog.querySelector<HTMLInputElement>("#brand-logo")?.addEventListener("change", (event) => void action(async () => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error(tr("Logo 超过 2 MiB。", "Logo exceeds 2 MiB."));
    status = await invoke<Status>("set_brand_logo", new Uint8Array(await file.arrayBuffer()));
    renderStatus();
    await showSettings();
  }));
  dialog.querySelector("#clear-logo")?.addEventListener("click", () => void action(async () => {
    status = await invoke<Status>("clear_brand_logo");
    renderStatus();
    await showSettings();
  }));
  dialog.querySelector<HTMLInputElement>("#autostart")?.addEventListener("change", (event) => void action(async () => {
    const input = event.target as HTMLInputElement;
    try {
      await invoke("set_launch_at_login", { enabled: input.checked });
      status = await invoke<Status>("get_status");
    } catch (error) {
      input.checked = !input.checked;
      const message = dialog.querySelector<HTMLElement>("#dialog-message")!;
      message.hidden = false;
      message.textContent = backendText(String(error));
    }
  }));
}

async function showAbout(): Promise<void> {
  try {
    const version = await invoke<string>("get_app_version");
    openDialog(tr("关于 Note Portal", "About Note Portal"), `<p>${tr("Note Portal 是一个本机 Markdown 阅读器。它不会生成 AI 内容，也不会上传你的笔记；文件始终由你保管。", "Note Portal is a local Markdown reader. It does not generate AI content or upload your notes; you remain in control of your files.")}</p><p class="quiet">${tr("版本", "Version")} ${escapeHtml(version)} · Windows</p><p>${tr("如果它对你有帮助，可以自愿通过 Buy Me a Coffee 支持维护；是否支持不影响任何功能。", "If it helps you, you can support maintenance through Buy Me a Coffee. Support is optional and does not affect any feature.")}</p><button class="button" id="support" type="button">${tr("打开 Buy Me a Coffee", "Open Buy Me a Coffee")} ↗</button>`);
    dialog.querySelector("#support")?.addEventListener("click", () => void action(() => invoke("open_support")));
  } catch (error) {
    showError(String(error));
  }
}

async function initialize(): Promise<void> {
  try {
    status = await invoke<Status>("get_status");
    renderAfterStatus();
    void invoke("set_ui_language", { language }).catch((error) => showError(String(error)));
  } catch (error) {
    app.innerHTML = `${header(tr("启动失败", "Startup failed"))}<main class="page"><h1>${tr("无法读取本机状态", "Could not read local status")}</h1><p class="message">${escapeHtml(error)}</p></main>`;
    wireLanguagePicker();
  }
}

dialog.addEventListener("click", (event) => {
  if (event.target === dialog && dialogDismissible) dialog.close();
});
dialog.addEventListener("cancel", (event) => { if (!dialogDismissible) event.preventDefault(); });
dialog.addEventListener("close", () => {
  if (!dialogDismissible && status?.noticeAccepted && !status.guideCompleted) {
    queueMicrotask(() => { if (!dialog.open) showFirstRunGuide(guideStep); });
  }
});
window.setInterval(async () => {
  if (document.hidden || !status?.noticeAccepted || !status.guideCompleted || setupVisible || dialog.open || busy) return;
  try {
    const next = await invoke<Status>("get_status");
    if (JSON.stringify(next) !== JSON.stringify(status)) {
      status = next;
      renderStatus();
    }
  } catch {
    // The next visible action reports a concrete error; the status poll never mutates source files.
  }
}, 2000);
void listen<string>("note-portal-tray-error", (event) => showError(event.payload))
  .catch((error) => showError(String(error)));
void initialize();
