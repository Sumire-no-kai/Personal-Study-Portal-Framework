// UI copy only. Never pass Markdown, document titles, headings or folder names to this table.
(() => {
  const messages = {
    "跳到笔记正文": ["跳到笔记正文", "Skip to document"],
    "收起课程导航": ["收起文档导航", "Collapse document navigation"],
    "展开课程导航": ["展开文档导航", "Expand document navigation"],
    "打开课程导航": ["打开文档导航", "Open document navigation"],
    "关闭课程导航": ["关闭文档导航", "Close document navigation"],
    "Note Portal 首页": ["Note Portal 首页", "Note Portal home"],
    "返回 Note Portal 首页": ["返回 Note Portal 首页", "Return to Note Portal home"],
    "选择学期": ["选择学期", "Select semester"],
    "当前笔记": ["当前笔记", "Current note"],
    "当前文档": ["当前文档", "Current document"],
    "文档": ["文档", "Document"],
    "资料库最外层": ["资料库最外层", "Library root"],
    "打印当前笔记或保存为 A4 PDF": ["打印当前笔记或保存为 A4 PDF", "Print this note or save as A4 PDF"],
    "打印 / PDF": ["打印 / PDF", "Print / PDF"],
    "通过 Buy Me a Coffee 支持 Note Portal": ["通过 Buy Me a Coffee 支持 Note Portal", "Support Note Portal on Buy Me a Coffee"],
    "打开设置": ["打开设置", "Open settings"],
    "设置": ["设置", "Settings"],
    "搜索笔记": ["搜索笔记", "Search notes"],
    "搜索文档": ["搜索文档", "Search documents"],
    "搜索全部笔记": ["搜索全部笔记", "Search all notes"],
    "搜索全部笔记正文…": ["搜索全部笔记正文…", "Search all note contents…"],
    "关闭搜索": ["关闭搜索", "Close search"],
    "跳转到上次阅读位置": ["跳转到上次阅读位置", "Jump to last reading position"],
    "上次读到": ["上次读到", "Last read"],
    "笔记开头": ["笔记开头", "Start of note"],
    "章节": ["章节", "Section"],
    "可一键跳转到上次的阅读位置": ["可一键跳转到上次的阅读位置", "Jump back to where you left off"],
    "继续阅读": ["继续阅读", "Continue reading"],
    "暂不跳转": ["暂不跳转", "Stay here"],
    "课程与周次导航": ["课程与周次导航", "Course and week navigation"],
    "课程列表": ["课程列表", "Course list"],
    "资料库目录": ["资料库目录", "Library contents"],
    "文件夹与文档导航": ["文件夹与文档导航", "Folder and document navigation"],
    "文件夹与文档列表": ["文件夹与文档列表", "Folders and documents"],
    "文件夹与文档": ["文件夹与文档", "Folders and documents"],
    "本页目录": ["本页目录", "On this page"],
    "打开本页目录": ["打开本页目录", "Open page contents"],
    "关闭本页目录": ["关闭本页目录", "Close page contents"],
    "展开本页目录": ["展开本页目录", "Expand page contents"],
    "本页目录已展开": ["本页目录已展开", "Page contents expanded"],
    "阅读工具": ["阅读工具", "Reading tools"],
    "关闭阅读工具": ["关闭阅读工具", "Close reading tools"],
    "收起阅读工具": ["收起阅读工具", "Collapse reading tools"],
    "开启沉浸阅读": ["开启沉浸阅读", "Start immersive reading"],
    "退出全屏沉浸阅读": ["退出全屏沉浸阅读", "Exit full-screen reading"],
    "进入全屏沉浸阅读": ["进入全屏沉浸阅读", "Enter full-screen reading"],
    "回到页首": ["回到页首", "Back to top"],
    "阅读外观": ["阅读外观", "Reading appearance"],
    "关闭阅读外观": ["关闭阅读外观", "Close reading appearance"],
    "问笔记": ["问笔记", "Ask notes"],
    "打开问笔记": ["打开问笔记", "Open Ask notes"],
    "关闭问笔记": ["关闭问笔记", "Close Ask notes"],
    "关闭设置": ["关闭设置", "Close settings"],
    "阅读配色": ["阅读配色", "Reading theme"],
    "选择适合长时间阅读的页面配色。": ["选择适合长时间阅读的页面配色。", "Choose a comfortable theme for long reading sessions."],
    "白昼": ["白昼", "Daylight"],
    "暖纸": ["暖纸", "Warm paper"],
    "夜间": ["夜间", "Night"],
    "主题色与本机 Logo 请在 Note Portal 控制窗口的“设置与条款”中选择；修改后刷新此页。": ["主题色与本机 Logo 请在 Note Portal 控制窗口的“设置与条款”中选择；修改后刷新此页。", "Choose the accent colour and local logo in Settings and terms in the Note Portal control window, then refresh this page."],
    "使用声明": ["使用声明", "Responsible use"],
    "本机资料库仅供你在有权使用的范围内阅读。请遵守适用的学术诚信、版权、隐私和保密要求；通常不建议将服务部署到公网上。": ["本机资料库仅供你在有权使用的范围内阅读。请遵守适用的学术诚信、版权、隐私和保密要求；通常不建议将服务部署到公网上。", "Only read material you are authorised to use. Follow applicable academic integrity, copyright, privacy and confidentiality requirements. Public internet deployment is generally not recommended."],
    "本地服务已断开；当前内容可能不是最新版本。请在 Note Portal 窗口重新打开阅读器。": ["本地服务已断开；当前内容可能不是最新版本。请在 Note Portal 窗口重新打开阅读器。", "The local service is disconnected; this content may be out of date. Reopen the reader from the Note Portal control window."],
    "正在载入文档…": ["正在载入文档…", "Loading document…"],
    "笔记载入失败": ["笔记载入失败", "Could not load note"],
    "表格，可横向滚动": ["表格，可横向滚动", "Table, scroll horizontally"],
    "上一篇和下一篇笔记": ["上一篇和下一篇笔记", "Previous and next notes"],
    "按学期、Unit 与 Week 浏览 Markdown 主笔记。": ["按学期、Unit 与 Week 浏览 Markdown 主笔记。", "Browse primary Markdown notes by semester, unit and week. "],
    "按原有文件夹浏览 Markdown。": ["按原有文件夹浏览 Markdown。", "Browse Markdown in its existing folders. "],
    "外部工具保存文件后，目录与当前文档会自动更新。": ["外部工具保存文件后，目录与当前文档会自动更新。", "The contents list and current document update automatically when an external tool saves a file."],
    "这个资料库还没有可阅读的 Markdown 文档。": ["这个资料库还没有可阅读的 Markdown 文档。", "This library has no readable Markdown documents yet."],
    "没有找到匹配的笔记。": ["没有找到匹配的笔记。", "No matching notes found."],
    "正在检索正文…": ["正在检索正文…", "Searching note contents…"],
    "正在服务器上检索全部笔记": ["正在检索本机全部笔记", "Searching all notes on this computer"],
    "全文中没有找到匹配内容。可以尝试更短的关键词或英文术语。": ["全文中没有找到匹配内容。可以尝试更短的关键词或英文术语。", "No matching content found. Try shorter keywords or alternative terms."],
    "全文检索服务暂时不可用": ["全文检索服务暂时不可用", "Full-text search is temporarily unavailable"],
    "笔记阅读不受影响；请稍后重试，或检查 Note Portal 服务。": ["笔记阅读不受影响；请稍后重试，或检查 Note Portal 服务。", "You can still read notes. Try again later or check the Note Portal service."],
    "Semester study notes": ["学期学习笔记", "Semester study notes"],
    "Loading library…": ["正在加载资料库…", "Loading library…"],
    "Study overview": ["学习概览", "Study overview"],
    "Local library": ["本机资料库", "Local library"],
    "Synced notes": ["已同步笔记", "Synced notes"],
    "On this page": ["本页目录", "On this page"],
    "Semester notes": ["学期笔记", "Semester notes"],
    "Loading…": ["正在加载…", "Loading…"],
    "All semesters": ["全部学期", "All semesters"],
    "Breadcrumb": ["导航路径", "Breadcrumb"],
    "Markdown document": ["Markdown 文档", "Markdown document"],
    "Markdown reader": ["Markdown 阅读器", "Markdown reader"],
    "Local-first": ["本地优先", "Local-first"],
    "Portal copyright": ["阅读器信息", "Reader information"],
    "Previous note": ["上一篇", "Previous note"],
    "Next note": ["下一篇", "Next note"],
    "locally": ["本机", "locally"],
    "Search unavailable": ["搜索暂不可用", "Search unavailable"],
    "language": ["界面语言", "Interface language"],
    "libraryUnavailable": ["无法加载资料库。请在 Note Portal 控制窗口检查服务状态，然后重新打开阅读器。", "Could not load the library. Check the service in the Note Portal control window, then reopen the reader."],
    "followApp": ["跟随应用", "Follow app"],
    "languageHint": ["只更改阅读器界面，不翻译笔记正文。选择会保存在当前浏览器；跟随应用时，修改小窗口语言后请刷新此页。", "Only the reader interface changes; notes are never translated. This browser remembers your choice. When following the app, refresh this page after changing the control-window language."],
    "languageStorageError": ["浏览器不允许保存语言选择。请允许本地存储后重试。", "This browser could not save the language choice. Allow local storage and try again."],
    "documentsCount": ["{count} 篇文档", "{count} documents"],
    "documentsCountOne": ["{count} 篇文档", "{count} document"],
    "notesCount": ["{count} 篇笔记", "{count} notes"],
    "notesCountOne": ["{count} 篇笔记", "{count} note"],
    "resultsCount": ["{count} 条结果", "{count} results"],
    "resultsCountOne": ["{count} 条结果", "{count} result"],
    "studyCounts": ["{units} 门课程 · {notes} 篇笔记", "{units} active units · {notes} notes"],
    "lastSynced": ["最近同步：{time}", "Last synced {time}"],
    "updated": ["更新于 {time}", "Updated {time}"],
    "jumpLast": ["跳转到上次阅读位置：{label}", "Jump to last reading position: {label}"],
    "lastRead": ["上次读到：{label}", "Last read: {label}"],
    "lastProgress": ["约 {percent}% 处 · 可继续跳转，或先从当前页开始看", "Around {percent}% · Jump back or continue from this page"],
    "currentTime": ["当前时间：{date} {time}", "Current time: {date} {time}"],
    "currentDocument": ["当前文档：{title}", "Current document: {title}"],
    "closePanel": ["关闭{panel}", "Close {panel}"],
    "readFailed": ["无法读取 {path}。请检查原文件后刷新此页。", "Could not read {path}. Check the original file, then refresh this page."],
  };
  const storageKey = "note-portal-reader-language";
  let choice = "app";
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "zh" || saved === "en") choice = saved;
  } catch {
    // A read-only/private browser can still follow the app language without storage.
  }
  const appLanguage = window.PORTAL_DATA?.language;
  const language = choice !== "app" ? choice
    : appLanguage === "zh" || appLanguage === "en" ? appLanguage
    : navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  const locale = language === "zh" ? "zh-CN" : "en-AU";
  function t(key, values = {}) {
    const entry = (values.count === 1 && messages[`${key}One`]) || messages[key];
    if (!entry) throw new Error(`Unknown UI translation: ${key}`);
    return entry[language === "zh" ? 0 : 1].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
  }
  function applyStatic(root) {
    // Only explicitly marked app-owned elements, never arbitrary text or document subtrees.
    root.querySelectorAll("[data-i18n]").forEach((node) => { node.textContent = t(node.dataset.i18n); });
    for (const attribute of ["aria-label", "title", "placeholder"]) {
      root.querySelectorAll(`[data-i18n-${attribute}]`).forEach((node) => {
        node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`)));
      });
    }
  }
  function saveChoice(next) {
    if (!["app", "zh", "en"].includes(next)) throw new Error("Unsupported interface language");
    if (next === "app") localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, next);
  }
  window.NotePortalI18n = Object.freeze({ t, language, locale, choice, applyStatic, saveChoice });
})();
