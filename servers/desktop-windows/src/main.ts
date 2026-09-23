import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

type Profile = "general" | "study";
type TreeNode = { label: string; kind: string; path: string; id?: string; children: TreeNode[] };
type Diagnostic = { path: string; reason: string; suggestion: string };
type Status = {
  noticeVersion: string;
  noticeAccepted: boolean;
  acceptedAt: string | null;
  libraryPath: string | null;
  libraryName: string | null;
  profile: Profile | null;
  serviceState: "running" | "degraded" | "stopped";
  port: number | null;
  documentCount: number;
  diagnostics: Diagnostic[];
  tree: TreeNode[];
  lastRefresh: string | null;
  error: string | null;
  launchAtLogin: boolean;
};
type Preview = { documentCount: number; diagnostics: Diagnostic[]; tree: TreeNode[] };

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

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dateLabel(value: string | null): string {
  if (!value) return "尚未刷新";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

function treeHtml(nodes: TreeNode[], depth = 0): string {
  if (!nodes.length) return depth === 0 ? '<p class="empty">还没有识别到笔记。可以先创建一篇，或把已有 .md 文件放进资料库。</p>' : "";
  return `<ul class="tree-list">${nodes.map((node) => {
    const icon = node.id ? "▤" : "▰";
    if (node.id) return `<li class="tree-document"><span class="tree-icon" aria-hidden="true">${icon}</span><span>${escapeHtml(node.label)}</span></li>`;
    return `<li><details ${depth < 2 ? "open" : ""}><summary><span class="tree-icon" aria-hidden="true">${icon}</span><span>${escapeHtml(node.label)}</span><small>${escapeHtml(node.kind)}</small></summary>${treeHtml(node.children, depth + 1)}</details></li>`;
  }).join("")}</ul>`;
}

function diagnosticsHtml(items: Diagnostic[]): string {
  if (!items.length) return '<p class="quiet">没有发现未识别文件。</p>';
  return `<ul class="warning-list">${items.map((item) => `<li><strong>${escapeHtml(item.path)}</strong><span>${escapeHtml(item.reason)}</span><small>${escapeHtml(item.suggestion)}</small></li>`).join("")}</ul>`;
}

function header(label: string): string {
  return `<header class="app-header"><div class="brand"><span class="brand-mark" aria-hidden="true">▤</span><span>Note Portal</span></div><span class="header-label">${escapeHtml(label)}</span></header>`;
}

function showError(message: string): void {
  const target = dialog.open
    ? dialog.querySelector<HTMLElement>("#dialog-message")
    : app.querySelector<HTMLElement>("#message");
  if (target) {
    target.textContent = message;
    target.hidden = false;
  } else {
    if (dialog.open) dialog.close();
    openDialog("操作没有完成", `<p>${escapeHtml(message)}</p><button class="button primary" id="dialog-close" type="button">知道了</button>`);
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

function openDialog(title: string, body: string): void {
  dialog.innerHTML = `<div class="dialog-content"><div class="dialog-heading"><h2 id="dialog-title">${escapeHtml(title)}</h2><button class="icon-close" id="dialog-close" type="button" aria-label="关闭">×</button></div>${body}</div>`;
  dialog.querySelector("#dialog-close")?.addEventListener("click", () => dialog.close());
  dialog.showModal();
}

async function showNotice(): Promise<void> {
  const full = await invoke<string>("get_notice");
  app.innerHTML = `${header("首次使用 · 必须确认")}
    <main class="page notice-page">
      <p class="eyebrow">使用前请阅读</p>
      <h1>学术诚信与负责任使用</h1>
      <p>Note Portal 用于整理、阅读和检索你有权使用的本地 Markdown 文档，包括学习笔记、资料与日志。它不提供 AI 生成服务，也不会授予复制、发布或分享第三方材料的权利。</p>
      <div class="notice-box">
        <p>请检查并遵守你所在学校、院系、课程和考试的学术诚信规定，以及版权、隐私和保密要求。不同场景的规定可能不同。</p>
        <p>建议只在自己的电脑上使用。通常不建议把服务直接部署到公网，以免暴露课程资料、私人笔记或个人信息。</p>
        <p>不得用本工具侵犯版权、泄露受限资料、规避学术诚信要求或从事其他违法行为。用户对导入、处理和分享的内容及使用方式负责。</p>
      </div>
      <button class="text-link" id="notice-full" type="button">查看完整使用提示、隐私说明与开源许可证</button>
      <label class="check-line"><input id="notice-check" type="checkbox" /><span>我已阅读并理解以上提示，同意仅处理我有权使用的内容，并遵守适用规定。</span></label>
      <p id="message" class="message" role="alert" hidden></p>
      <div class="button-row"><button class="button" id="decline" type="button">不同意并退出</button><button class="button primary" id="agree" type="button" disabled>同意并继续</button></div>
    </main>`;
  app.querySelector("#notice-full")?.addEventListener("click", () => {
    openDialog("完整使用提示 · 版本 1.1", '<pre class="long-text" id="full-notice"></pre>');
    dialog.querySelector("#full-notice")!.textContent = full;
  });
  app.querySelector<HTMLInputElement>("#notice-check")?.addEventListener("change", (event) => {
    (app.querySelector<HTMLButtonElement>("#agree")!).disabled = !(event.target as HTMLInputElement).checked;
  });
  app.querySelector("#decline")?.addEventListener("click", () => void invoke("quit"));
  app.querySelector("#agree")?.addEventListener("click", () => void action(async () => {
    await invoke("accept_notice");
    status = await invoke<Status>("get_status");
    setupVisible = true;
    renderSetup();
    showFirstRunGuide();
  }));
}

function showFirstRunGuide(): void {
  openDialog("一分钟了解 Note Portal", `<p>把 Markdown 笔记放进资料库，Note Portal 会在本机整理目录并用普通浏览器显示。你可以继续用自己熟悉的编辑器，或让外部 AI 工具更新 .md 文件；本软件不生成 AI 内容。</p>
    <ol class="intro-steps"><li><strong>选整理方式</strong><span>普通文档保留现有文件夹；学习笔记按学期、Unit、Week 整理。</span></li><li><strong>选文件夹</strong><span>可以选择已有笔记文件夹，或让软件创建一个新资料库；确认前会显示识别预览。</span></li><li><strong>打开阅读器</strong><span>控制窗口只显示状态和目录。正文在浏览器阅读，文件更新后会自动刷新。</span></li></ol>
    <p class="quiet">不需要改动现有笔记，也不需要使用命令行。看不懂的文件名或提醒，可以随时点“使用指南”。</p>
    <div class="button-row"><button class="text-link" id="intro-guide" type="button">查看详细指南</button><button class="button primary" id="intro-start" type="button">开始选择资料库</button></div>`);
  dialog.querySelector("#intro-start")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("#intro-guide")?.addEventListener("click", () => {
    dialog.close();
    void showGuide();
  });
}

function profileCard(value: Profile, title: string, description: string, example: string): string {
  return `<button class="profile-card ${profile === value ? "selected" : ""}" type="button" data-profile="${value}" aria-pressed="${profile === value}"><span class="profile-card-head"><span class="radio-dot"></span><strong>${title}</strong></span><span class="quiet">${description}</span><code>${example}</code></button>`;
}

function renderSetup(): void {
  setupVisible = true;
  app.innerHTML = `${header("设置资料库")}
    <main class="page setup-page">
      <p class="eyebrow">简单开始 · 约 1 分钟</p>
      <h1>把 Markdown 整理成随时可读的页面</h1>
      <p class="lead">你或外部 AI 工具继续照常写 .md 文件；Note Portal 只负责本机识别、搜索与自动刷新，正文会在普通浏览器里打开。</p>
      <div class="step-title"><span>1</span><strong>选择整理方式</strong></div>
      <div class="profile-grid">
        ${profileCard("general", "普通文档 · General", "保留你原来的文件夹层级，递归识别 .md。", "My Notes / projects / roadmap.md")}
        ${profileCard("study", "学习笔记 · Study", "按学期 → Unit → Week 识别唯一主笔记。", "content / 2026-semester-2 / DEMO101 / week-01 / week-01-notes.md")}
      </div>
      <div class="step-title"><span>2</span><strong>选择资料库</strong></div>
      <div class="segmented" role="group" aria-label="资料库来源"><button type="button" data-mode="existing" aria-pressed="${setupMode === "existing"}">使用已有文件夹</button><button type="button" data-mode="new" aria-pressed="${setupMode === "new"}">创建新资料库</button></div>
      ${setupMode === "new" ? `<label class="field">资料库名称<input id="library-name" value="${escapeHtml(libraryName)}" maxlength="80" autocomplete="off" /></label><p class="quiet">选择保存位置后，会在里面创建一个新的「${escapeHtml(libraryName)}」文件夹。</p>` : '<p class="quiet">选择存放笔记的最外层文件夹。Study 请选同时包含 content/ 与 inbox/ 的那一层。</p>'}
      <div class="pick-row"><button class="button" id="pick" type="button">${setupMode === "new" ? "选择保存位置…" : "选择资料库文件夹…"}</button><span class="picked-path">${selectedPath ? escapeHtml(selectedPath) : "尚未选择"}</span></div>
      ${preview ? `<section class="preview"><div class="section-heading"><h2>识别预览</h2><span>${preview.documentCount} 篇文档 · ${preview.diagnostics.length} 个提醒</span></div><div class="tree-scroll">${treeHtml(preview.tree)}</div>${preview.diagnostics.length ? `<details class="warning-details"><summary>查看未识别文件与原因</summary>${diagnosticsHtml(preview.diagnostics)}</details>` : ""}</section>` : ""}
      <p id="message" class="message" role="alert" hidden></p>
      <div class="button-row setup-actions"><button class="text-link" id="guide" type="button">使用指南</button><button class="button primary" id="continue" type="button" ${selectedPath ? "" : "disabled"}>${setupMode === "new" ? "创建并打开" : "确认并打开"}</button></div>
    </main>`;
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

function collectFolders(nodes: TreeNode[], found: Set<string>): void {
  for (const node of nodes) {
    if (node.kind === "folder" && node.path) found.add(node.path);
    collectFolders(node.children, found);
  }
}

function renderStatus(): void {
  setupVisible = false;
  const running = status.serviceState !== "stopped";
  const label = { running: "运行中", degraded: "运行中 · 需注意", stopped: "已停止" }[status.serviceState];
  app.innerHTML = `${header(label)}
    <main class="page status-page">
      <div class="library-heading"><div><p class="eyebrow">当前资料库</p><h1>${escapeHtml(status.libraryName || "尚未选择资料库")}</h1><p class="quiet">${status.profile === "study" ? "学习笔记 · Study" : "普通文档 · General"} · ${escapeHtml(status.libraryPath || "")}</p></div><span class="state-pill ${status.serviceState}">${label}</span></div>
      <div class="stat-grid"><div><strong>${status.documentCount}</strong><span>篇笔记</span></div><div><strong>${status.diagnostics.length}</strong><span>个提醒</span></div><div><strong>${running ? "仅本机" : "未运行"}</strong><span>访问范围</span></div></div>
      <section class="panel tree-panel"><div class="section-heading"><h2>资料库目录</h2><span>${status.profile === "study" ? "Semester / Unit / Week" : "文件夹 / 文档"}</span></div><div class="tree-scroll">${treeHtml(status.tree)}</div></section>
      ${status.diagnostics.length ? `<details class="warning-details"><summary>${status.diagnostics.length} 个文件未识别 · 查看原因</summary>${diagnosticsHtml(status.diagnostics)}</details>` : ""}
      ${status.error ? `<p class="message" role="alert">${escapeHtml(status.error)}</p>` : ""}
      <p class="last-refresh">上次成功刷新：${escapeHtml(dateLabel(status.lastRefresh))}</p>
      <div class="main-actions"><button class="button primary" id="open" type="button" ${running ? "" : "disabled"}>打开阅读器 ↗</button><button class="button" id="refresh" type="button" ${running ? "" : "disabled"}>立即刷新</button><button class="button" id="folder" type="button">打开文件夹</button></div>
      <div class="secondary-actions"><button class="text-link" id="create" type="button">${status.profile === "study" ? "＋ 创建 Week 模板" : "＋ 创建笔记"}</button><button class="text-link" id="switch" type="button">更换资料库</button><button class="text-link" id="service" type="button">${running ? "停止服务" : "启动服务"}</button></div>
      <p id="message" class="message" role="alert" hidden></p>
    </main>
    <footer class="app-footer"><button id="help" type="button">使用指南</button><button id="settings" type="button">设置与条款</button><button id="about" type="button">关于</button><button id="quit" type="button">退出</button></footer>`;
  app.querySelector("#open")?.addEventListener("click", () => void action(() => invoke("open_portal")));
  app.querySelector("#refresh")?.addEventListener("click", () => void action(async () => { status = await invoke<Status>("refresh_now"); renderStatus(); }));
  app.querySelector("#folder")?.addEventListener("click", () => void action(() => invoke("open_library_folder")));
  app.querySelector("#service")?.addEventListener("click", () => void action(async () => {
    status = await invoke<Status>(running ? "stop_service" : "start_service", running ? {} : { openBrowser: false });
    renderStatus();
  }));
  app.querySelector("#switch")?.addEventListener("click", () => { selectedPath = ""; preview = null; renderSetup(); });
  app.querySelector("#create")?.addEventListener("click", () => showCreate());
  app.querySelector("#help")?.addEventListener("click", () => void showGuide());
  app.querySelector("#settings")?.addEventListener("click", () => void showSettings());
  app.querySelector("#about")?.addEventListener("click", showAbout);
  app.querySelector("#quit")?.addEventListener("click", () => void invoke("quit"));
}

function showCreate(): void {
  if (status.profile === "general") {
    const folders = new Set<string>();
    collectFolders(status.tree, folders);
    const options = [...folders].sort((a, b) => a.localeCompare(b)).map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    openDialog("创建一篇笔记", `<p class="quiet">只创建一个新的 .md 文件；已有文件不会覆盖。</p><label class="field">笔记标题<input id="note-title" maxlength="80" placeholder="例如：读书摘录" /></label><label class="field">放在哪个文件夹<select id="note-folder"><option value="">资料库最外层</option>${options}</select></label><p id="dialog-message" class="message" role="alert" hidden></p><div class="button-row"><button class="button primary" id="submit-note" type="button">创建笔记</button></div>`);
    dialog.querySelector("#submit-note")?.addEventListener("click", () => void action(async () => {
      const title = dialog.querySelector<HTMLInputElement>("#note-title")!.value;
      const folder = dialog.querySelector<HTMLSelectElement>("#note-folder")!.value;
      status = await invoke<Status>("create_note", { title, folder });
      dialog.close(); renderStatus();
    }));
  } else {
    openDialog("创建 Week 模板", `<p class="quiet">预览并创建唯一的主笔记。不会移动或覆盖已有文件。</p><label class="field">学期<input id="semester" value="2026-semester-2" /></label><label class="field">Unit 代码或短名称<input id="unit" placeholder="例如：DEMO101" /></label><div class="field-row"><label class="field">Week 数字<input id="week" type="number" min="1" max="99" value="1" /></label><label class="field">合并到 Week（可选）<input id="end-week" type="number" min="2" max="99" /></label></div><p class="path-preview" id="week-preview"></p><p id="dialog-message" class="message" role="alert" hidden></p><div class="button-row"><button class="button primary" id="submit-week" type="button">创建主笔记</button></div>`);
    const updatePreview = () => {
      const semester = dialog.querySelector<HTMLInputElement>("#semester")!.value;
      const unit = dialog.querySelector<HTMLInputElement>("#unit")!.value;
      const week = Number(dialog.querySelector<HTMLInputElement>("#week")!.value);
      const end = Number(dialog.querySelector<HTMLInputElement>("#end-week")!.value);
      const key = end > week ? `weeks-${String(week).padStart(2, "0")}-${String(end).padStart(2, "0")}` : `week-${String(week).padStart(2, "0")}`;
      dialog.querySelector<HTMLElement>("#week-preview")!.textContent = `content / ${semester} / ${unit || "Unit"} / ${key} / ${key}-notes.md`;
    };
    dialog.querySelectorAll("input").forEach((input) => input.addEventListener("input", updatePreview));
    updatePreview();
    dialog.querySelector("#submit-week")?.addEventListener("click", () => void action(async () => {
      const semester = dialog.querySelector<HTMLInputElement>("#semester")!.value;
      const unit = dialog.querySelector<HTMLInputElement>("#unit")!.value;
      const week = Number(dialog.querySelector<HTMLInputElement>("#week")!.value);
      const end = dialog.querySelector<HTMLInputElement>("#end-week")!.value;
      status = await invoke<Status>("create_week", { semester, unit, week, endWeek: end ? Number(end) : null });
      dialog.close(); renderStatus();
    }));
  }
}

async function showGuide(): Promise<void> {
  const guide = await invoke<string>("get_guide");
  openDialog("使用指南", '<p class="quiet">从选择文件夹到自动刷新，一步一步说明。窗口只负责控制，正文在浏览器阅读。</p><pre class="long-text" id="guide-text"></pre>');
  dialog.querySelector("#guide-text")!.textContent = guide;
}

async function showSettings(): Promise<void> {
  const notice = await invoke<string>("get_notice");
  openDialog("设置与使用条款", `<label class="check-line"><input id="autostart" type="checkbox" ${status.launchAtLogin ? "checked" : ""} /><span>登录电脑后在任务栏静默启动服务（不自动打开浏览器）</span></label><p class="quiet">本机已同意版本 ${escapeHtml(status.noticeVersion)}，时间：${escapeHtml(dateLabel(status.acceptedAt))}。默认只允许本机访问。</p><details class="terms-details"><summary>使用条款、学术诚信与隐私说明</summary><pre class="long-text" id="settings-notice"></pre></details><p id="dialog-message" class="message" role="alert" hidden></p>`);
  dialog.querySelector("#settings-notice")!.textContent = notice;
  dialog.querySelector<HTMLInputElement>("#autostart")?.addEventListener("change", (event) => void action(async () => {
    const input = event.target as HTMLInputElement;
    try {
      await invoke("set_launch_at_login", { enabled: input.checked });
      status = await invoke<Status>("get_status");
    } catch (error) {
      input.checked = !input.checked;
      const message = dialog.querySelector<HTMLElement>("#dialog-message")!;
      message.hidden = false;
      message.textContent = String(error);
    }
  }));
}

function showAbout(): void {
  openDialog("关于 Note Portal", '<p>Note Portal 是一个本机 Markdown 阅读器。它不会生成 AI 内容，也不会上传你的笔记；文件始终由你保管。</p><p class="quiet">版本 0.1.0 · Windows 初版</p><p>如果它对你有帮助，可以自愿通过 Buy Me a Coffee 支持维护；是否支持不影响任何功能。</p><button class="button" id="support" type="button">打开 Buy Me a Coffee ↗</button>');
  dialog.querySelector("#support")?.addEventListener("click", () => void action(() => invoke("open_support")));
}

async function initialize(): Promise<void> {
  try {
    status = await invoke<Status>("get_status");
    if (!status.noticeAccepted) await showNotice();
    else if (!status.libraryPath) renderSetup();
    else renderStatus();
  } catch (error) {
    app.innerHTML = `${header("启动失败")}<main class="page"><h1>无法读取本机状态</h1><p class="message">${escapeHtml(error)}</p></main>`;
  }
}

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
window.setInterval(async () => {
  if (document.hidden || !status?.noticeAccepted || setupVisible || dialog.open || busy) return;
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
void initialize();
