const EMPTY_PORTAL_DATA = Object.freeze({
  id: "note-portal",
  label: "Note Portal",
  pickerLabel: "Note Portal",
  generatedAt: "",
  units: [],
});

let portalData = window.PORTAL_DATA && Array.isArray(window.PORTAL_DATA.units)
  ? window.PORTAL_DATA
  : EMPTY_PORTAL_DATA;
let portalManifestAvailable = portalData !== EMPTY_PORTAL_DATA;
let portalManifestLoadComplete = portalManifestAvailable;
let portalReleaseEventsStarted = false;
const PORTAL_UPDATE_CHECK_INTERVAL = 15_000;
const PORTAL_RELEASE_SESSION_KEY = "study-portal-release-id";
const ASSISTANT_UI_ENABLED = false;
const ASSISTANT_SELECTION_MAXIMUM_CHARACTERS = 1200;
const ASSISTANT_DEFAULT_PLACEHOLDER = "询问当前章节…";
const WELCOME_STORE_KEY = "study-portal-welcome:onboarding-immersive-v2";
const WELCOME_SUPPORT_MINIMUM_VIEW_MS = 5000;
const FEEDBACK_MAXIMUM_CHARACTERS = 4000;
let portalUpdateCheckInFlight = false;
let portalReleaseRefreshInFlight = false;
let observedPortalReleaseId = "";

// 笔记正文是 fetch 之后异步渲染的。浏览器的原生滚动恢复发生在内容到位之前，
// 那时文档还只有一屏高，保存的位置会被截断为 0。改为手动接管。
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

function normalizeMathSource(source) {
  return source.replace(/(?<!\\)%/g, "\\%").replace(/(?<!\\)#/g, "\\#");
}

function renderMathFormula(formula) {
  try {
    return window.katex.renderToString(normalizeMathSource(formula.source.trim()), {
      displayMode: formula.displayMode,
      throwOnError: false,
      strict: "warn",
      output: "htmlAndMathml",
    });
  } catch (error) {
    console.warn("[KaTeX]", error);
    return `<code class="math-source-fallback">${escapeHtml(formula.raw)}</code>`;
  }
}

function protectMathText(text, formulas) {
  const reserve = (raw, source, displayMode) => {
    const token = `PORTALMATHTOKEN${formulas.length}END`;
    formulas.push({ raw, source, displayMode });
    return token;
  };

  const withDisplayMath = text.replace(/\$\$([\s\S]+?)\$\$/g, (raw, source) =>
    reserve(raw, source, true),
  );
  return withDisplayMath.replace(/\$(?!\$)([^\n$]+?)\$(?!\$)/g, (raw, source, offset, whole) => {
    const followingCharacter = whole[offset + raw.length] || "";
    if (/\d/.test(followingCharacter)) return raw;
    return reserve(raw, source, false);
  });
}

function protectMathInMarkdown(markdown) {
  const formulas = [];
  const fencedSegments = markdown.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  const protectedMarkdown = fencedSegments
    .map((segment, index) => {
      if (index % 2) return segment;
      let output = "";
      let cursor = 0;
      const inlineCodePattern = /(`+)([\s\S]*?)\1/g;
      for (const match of segment.matchAll(inlineCodePattern)) {
        output += protectMathText(segment.slice(cursor, match.index), formulas);
        output += match[0];
        cursor = match.index + match[0].length;
      }
      output += protectMathText(segment.slice(cursor), formulas);
      return output;
    })
    .join("");

  return { markdown: protectedMarkdown, formulas };
}

function renderMarkdownWithMath(markdown) {
  const protectedContent = protectMathInMarkdown(markdown);
  const html = window.marked.parse(protectedContent.markdown, { gfm: true, breaks: false });
  const output = document.createElement("template");
  output.innerHTML = sanitizeNoteHtml(html);
  const walker = document.createTreeWalker(output.content, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => {
    const text = node.textContent || "";
    const matches = [...text.matchAll(/PORTALMATHTOKEN(\d+)END/g)];
    if (!matches.length) return;
    const replacement = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      replacement.append(document.createTextNode(text.slice(offset, match.index)));
      const formula = protectedContent.formulas[Number(match[1])];
      if (formula) {
        const math = document.createElement("template");
        math.innerHTML = renderMathFormula(formula);
        replacement.append(math.content);
      } else {
        replacement.append(document.createTextNode(match[0]));
      }
      offset = match.index + match[0].length;
    }
    replacement.append(document.createTextNode(text.slice(offset)));
    node.replaceWith(replacement);
  });
  return output.innerHTML;
}

function isSafeNoteUrl(value, image = false) {
  const href = String(value || "").trim();
  if (!href) return false;
  if (!image && href.startsWith("#")) return true;
  try {
    const url = new URL(href, window.location.href);
    if (image) return url.origin === window.location.origin && ["http:", "https:"].includes(url.protocol);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch (error) {
    return false;
  }
}

function sanitizeNoteHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowed = new Set([
    "a", "blockquote", "br", "code", "del", "details", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "img", "input", "li", "ol", "p", "pre", "span", "strong", "sub", "summary", "sup", "table",
    "tbody", "td", "th", "thead", "tr", "ul",
  ]);
  const blocked = new Set(["audio", "button", "embed", "form", "iframe", "object", "script", "select", "style", "svg", "template", "textarea", "video"]);
  [...template.content.querySelectorAll("*")].reverse().forEach((element) => {
    const tag = element.tagName.toLowerCase();
    if (blocked.has(tag)) {
      element.remove();
      return;
    }
    if (!allowed.has(tag)) {
      element.replaceWith(...element.childNodes);
      return;
    }
    if (tag === "input" && (element.getAttribute("type") !== "checkbox" || !element.hasAttribute("disabled"))) {
      element.remove();
      return;
    }
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      const safe = (tag === "a" && name === "href" && isSafeNoteUrl(value))
        || (tag === "img" && name === "src" && isSafeNoteUrl(value, true))
        || (tag === "img" && ["alt", "title"].includes(name))
        || (tag === "a" && name === "title")
        || (name === "id" && /^[^<>"'\s]{1,120}$/u.test(value))
        || (name === "class" && /^[\w\s-]{1,120}$/.test(value))
        || (name === "align" && ["td", "th"].includes(tag) && /^(left|center|right)$/i.test(value))
        || (tag === "details" && name === "open")
        || (tag === "input" && ["type", "disabled", "checked"].includes(name));
      if (!safe) element.removeAttribute(attribute.name);
    });
  });
  return template.innerHTML;
}

function isSafeAssistantLink(value) {
  const href = String(value || "").trim();
  if (href.startsWith("#")) return true;
  try {
    const url = new URL(href, window.location.href);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch (error) {
    return false;
  }
}

function sanitizeAssistantMarkdownHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowedTags = new Set([
    "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "li", "ol", "p", "pre", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
  ]);
  const blockedTags = new Set([
    "audio", "button", "embed", "form", "iframe", "img", "input", "object", "script", "select",
    "style", "textarea", "video",
  ]);

  [...template.content.querySelectorAll("*")].reverse().forEach((element) => {
    const tag = element.tagName.toLocaleLowerCase();
    if (blockedTags.has(tag)) {
      element.remove();
      return;
    }
    if (!allowedTags.has(tag)) {
      element.replaceWith(...[...element.childNodes]);
      return;
    }

    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLocaleLowerCase();
      const value = attribute.value;
      const keepLink = tag === "a" && name === "href" && isSafeAssistantLink(value);
      const keepTitle = tag === "a" && name === "title";
      const keepLanguageClass = (tag === "code" || tag === "pre")
        && name === "class"
        && /^language-[a-z0-9_+-]+$/i.test(value);
      const keepAlignment = (tag === "th" || tag === "td")
        && name === "align"
        && /^(left|center|right)$/i.test(value);
      if (!keepLink && !keepTitle && !keepLanguageClass && !keepAlignment) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return template.innerHTML;
}

function renderAssistantMarkdown(markdown) {
  const protectedContent = protectMathInMarkdown(markdown);
  const html = window.marked.parse(protectedContent.markdown, { gfm: true, breaks: false });
  const safeHtml = sanitizeAssistantMarkdownHtml(html);
  return safeHtml.replace(/PORTALMATHTOKEN(\d+)END/g, (_, index) =>
    renderMathFormula(protectedContent.formulas[Number(index)]),
  );
}

let flatNotes = flattenPortalNotes(portalData);
let activeUnits = portalData.units.filter((unit) => unit.weeks.length);
const LAST_NOTE_STORE_KEY = `study-portal-last-note:${portalData.id}`;
const ASSISTANT_CONVERSATION_STORE_KEY = `study-portal-assistant-conversation:${portalData.id}`;
const READING_THEME_STORE_KEY = "study-portal-reading-theme";
const READING_THEMES = new Set(["light", "warm", "dark"]);
const IMMERSION_CLOCK_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const IMMERSION_CLOCK_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("zh-CN", { weekday: "short" });
const IMMERSION_CLOCK_COMPACT_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
});
const IMMERSION_CLOCK_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
// This is a browser-only, non-secret preference. API keys never belong in the reader.
const ASSISTANT_BACKEND_STORE_KEY = `study-portal-assistant-backend:${portalData.id}`;
const ASSISTANT_BACKEND_NAMES = new Set([
  "gemini_flash",
  "deepseek_v4_flash",
  "local_qwen_4b",
]);
const LAST_READ_STORE_PREFIX = `study-portal-last-read:${portalData.id}:`;
const LAST_READ_SCHEMA_VERSION = 1;
const LAST_READ_MINIMUM_SCROLL_PX = 96;

function flattenPortalNotes(data) {
  if (data.profile === "general") return Array.isArray(data.documents) ? data.documents : [];
  return data.units.flatMap((unit) =>
    unit.weeks.map((note) => ({ ...note, unitCode: unit.code, unitName: unit.name })),
  );
}

function formatWeekLabel(note) {
  if (portalData.profile === "general") return note.location || "资料库最外层";
  return note.weekLabel || `Week ${note.week}`;
}

function formatWeekIndex(note) {
  const range = note.weekLabel?.match(/^Week\s+(\d+)\s*[-–—]\s*(\d+)$/i);
  if (range) return `${range[1].padStart(2, "0")}–${range[2].padStart(2, "0")}`;
  return String(note.week).padStart(2, "0");
}

function formatCompactSemesterLabel(label) {
  const match = String(label || "").match(/(\d{4}).*Semester\s+(\d+)/i);
  return match ? `${match[1]} S${match[2]}` : String(label || "Semester");
}

function formatCompactWeekLabel(note) {
  return formatWeekLabel(note).replace(/^Week\s*/i, "W").replaceAll(" ", "");
}

function readRememberedNoteId() {
  try {
    const noteId = localStorage.getItem(LAST_NOTE_STORE_KEY);
    return flatNotes.some((note) => note.id === noteId) ? noteId : null;
  } catch (error) {
    return null;
  }
}

function rememberNote(noteId) {
  try {
    localStorage.setItem(LAST_NOTE_STORE_KEY, noteId);
  } catch (error) {
    /* 无痕模式等场景下 localStorage 不可用，继续使用本次会话状态。 */
  }
}

function createAssistantConversationId() {
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `web_${randomPart}`.slice(0, 64);
}

function readAssistantConversationId() {
  try {
    const saved = localStorage.getItem(ASSISTANT_CONVERSATION_STORE_KEY);
    if (/^[A-Za-z0-9_-]{1,64}$/.test(saved || "")) return saved;
    const next = createAssistantConversationId();
    localStorage.setItem(ASSISTANT_CONVERSATION_STORE_KEY, next);
    return next;
  } catch (error) {
    return createAssistantConversationId();
  }
}

function replaceAssistantConversationId() {
  const next = createAssistantConversationId();
  try {
    localStorage.setItem(ASSISTANT_CONVERSATION_STORE_KEY, next);
  } catch (error) {
    /* Private browsing may deny local storage; keep the per-page fallback ID. */
  }
  return next;
}

function readBrowserAssistantBackend() {
  try {
    const saved = String(localStorage.getItem(ASSISTANT_BACKEND_STORE_KEY) || "");
    return ASSISTANT_BACKEND_NAMES.has(saved) ? saved : "gemini_flash";
  } catch (error) {
    return "gemini_flash";
  }
}

function rememberBrowserAssistantBackend(backend) {
  if (!ASSISTANT_BACKEND_NAMES.has(backend)) return;
  try {
    localStorage.setItem(ASSISTANT_BACKEND_STORE_KEY, backend);
  } catch (error) {
    /* Private browsing may deny local storage; retain the per-page choice. */
  }
}

function readReadingTheme() {
  try {
    const saved = String(localStorage.getItem(READING_THEME_STORE_KEY) || "");
    return READING_THEMES.has(saved) ? saved : "light";
  } catch (error) {
    return "light";
  }
}

function rememberReadingTheme(theme) {
  if (!READING_THEMES.has(theme)) return;
  try {
    localStorage.setItem(READING_THEME_STORE_KEY, theme);
  } catch (error) {
    /* Reading remains usable when private browsing disallows local storage. */
  }
}

function getLatestNote() {
  return flatNotes.reduce((latest, note) => {
    if (!latest) return note;
    return String(note.updated || "") > String(latest.updated || "") ? note : latest;
  }, null);
}

function getContinueNote() {
  const rememberedId = readRememberedNoteId();
  return flatNotes.find((note) => note.id === rememberedId) || getLatestNote();
}

function formatSyncTime(value) {
  if (!value) return "locally";
  const parsed = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

const state = {
  activeNoteId: getNoteIdFromHash() || readRememberedNoteId() || getLatestNote()?.id,
  expandedUnits: new Set(),
  overviewExpandedUnits: new Set(),
  overviewAllNotesOpen: false,
  view: getViewFromHash(),
  sidebarCollapsed: false,
  immersionMode: false,
  immersiveSidebarCollapsed: true,
  immersiveTocCollapsed: false,
  readingTheme: readReadingTheme(),
  utilityTab: "toc",
  assistantScope: "section",
  assistantBackend: readBrowserAssistantBackend(),
  // Empty means the request uses the browser's reply-length choice only.
  assistantReplyTokenBudget: null,
  assistantReasoningMode: "",
};

let printRestoreState = null;

const courseNavigation = document.querySelector("#course-navigation");
const viewRoot = document.querySelector("#view-root");
const tocNavigation = document.querySelector("#toc-navigation");
const tocPanel = document.querySelector("#toc-panel");
const tocToggle = document.querySelector("#toc-toggle");
const assistantToggle = document.querySelector("#assistant-toggle");
const tocClose = document.querySelector("#toc-close");
const tocScrim = document.querySelector("#toc-scrim");
const tocTab = document.querySelector("#toc-tab");
const preferencesTab = document.querySelector("#preferences-tab");
const assistantTab = document.querySelector("#assistant-tab");
const tocView = document.querySelector("#toc-view");
const preferencesView = document.querySelector("#preferences-view");
const assistantView = document.querySelector("#assistant-view");
const sidebar = document.querySelector("#sidebar");
const navToggle = document.querySelector("#nav-toggle");
const sidebarEdgeToggle = document.querySelector("#sidebar-edge-toggle");
const navClose = document.querySelector("#nav-close");
const navScrim = document.querySelector("#sidebar-scrim");
const libraryLink = document.querySelector("#library-link");
const brandHome = document.querySelector("#brand-home");
const searchDialog = document.querySelector("#search-dialog");
const topbarReadingUtility = document.querySelector("#topbar-reading-utility");
const printTrigger = document.querySelector("#print-trigger");
const immersionClock = document.querySelector("#immersion-clock");
const immersionClockDate = document.querySelector("#immersion-clock-date");
const immersionClockCompactDate = document.querySelector("#immersion-clock-date-compact");
const immersionClockTime = document.querySelector("#immersion-clock-time");
const searchTrigger = document.querySelector("#search-trigger");
const searchClose = document.querySelector("#search-close");
const searchInput = document.querySelector("#search-input");
const searchResults = document.querySelector("#search-results");
const searchCount = document.querySelector("#search-count");
const semesterPicker = document.querySelector("#semester-picker");
const semesterSelect = document.querySelector("#semester-select");
const currentNoteIndicator = document.querySelector("#current-note-indicator");
const currentNoteLabel = document.querySelector("#current-note-label");
const currentNoteUnit = document.querySelector("#current-note-unit");
const currentNoteWeek = document.querySelector("#current-note-week");
const currentNoteWeekShort = document.querySelector("#current-note-week-short");
const sidebarTerm = document.querySelector("#sidebar-term");
const sidebarSummary = document.querySelector("#sidebar-summary");
const searchScopeTerm = document.querySelector("#search-scope-term");
const readingProgress = document.querySelector("#reading-progress");
const readingProgressBar = readingProgress.querySelector("span");
const lastReadMarker = document.querySelector("#last-read-marker");
const readerControlDock = document.querySelector("#reader-control-dock");
const immersionToggle = document.querySelector("#immersion-toggle");
const backToTop = document.querySelector("#back-to-top");
const readingThemeOptions = [...document.querySelectorAll("[data-reading-theme]")];
const supportLink = document.querySelector("#support-link");
const settingsTrigger = document.querySelector("#settings-trigger");
const settingsDialog = document.querySelector("#settings-dialog");
const settingsClose = document.querySelector("#settings-close");
const settingsAccountStatus = document.querySelector("#settings-account-status");
const settingsAccountEmail = document.querySelector("#settings-account-email");
const settingsFeedback = document.querySelector("#settings-feedback");
const settingsWelcome = document.querySelector("#settings-welcome");
const feedbackDialog = document.querySelector("#feedback-dialog");
const feedbackForm = document.querySelector("#feedback-form");
const feedbackClose = document.querySelector("#feedback-close");
const feedbackCancel = document.querySelector("#feedback-cancel");
const feedbackIdentity = document.querySelector("#feedback-identity");
const feedbackKind = document.querySelector("#feedback-kind");
const feedbackMessage = document.querySelector("#feedback-message");
const feedbackStatus = document.querySelector("#feedback-status");
const feedbackSubmit = document.querySelector("#feedback-submit");
const welcomeDialog = document.querySelector("#welcome-dialog");
const welcomeStage = document.querySelector("#welcome-stage");
const welcomeSteps = [...document.querySelectorAll("[data-welcome-step]")];
const welcomeProgress = [...document.querySelectorAll(".welcome-dialog__progress span")];
const welcomeSupportLink = document.querySelector("#welcome-support-link");
const welcomeSupportAmount = document.querySelector("#welcome-support-amount");
const welcomeSupportWait = document.querySelector("#welcome-support-wait");
const welcomeBack = document.querySelector("#welcome-back");
const welcomeNext = document.querySelector("#welcome-next");
const selectionAskAi = document.querySelector("#selection-ask-ai");
const assistantStatus = document.querySelector("#assistant-status");
const assistantStatusLabel = document.querySelector("#assistant-status-label");
const assistantRecovery = document.querySelector("#assistant-recovery");
const assistantRecoveryMessage = document.querySelector("#assistant-recovery-message");
const assistantRetry = document.querySelector("#assistant-retry");
const assistantClear = document.querySelector("#assistant-clear");
const assistantSessionNotice = document.querySelector("#assistant-session-notice");
const assistantScopeSelect = document.querySelector("#assistant-scope");
const assistantScopeControl = document.querySelector("#assistant-scope-control");
const assistantBackend = document.querySelector("#assistant-backend");
const assistantAdvancedSettings = document.querySelector("#assistant-advanced-settings");
const assistantReplyLength = document.querySelector("#assistant-reply-length");
const assistantReasoningMode = document.querySelector("#assistant-reasoning-mode");
const assistantReasoningSetting = document.querySelector("#assistant-reasoning-setting");
const assistantContextMeta = document.querySelector("#assistant-context-meta");
const assistantMessages = document.querySelector("#assistant-messages");
const assistantEmpty = document.querySelector("#assistant-empty");
const assistantForm = document.querySelector("#assistant-form");
const assistantInput = document.querySelector("#assistant-input");
const assistantSelectionReference = document.querySelector("#assistant-selection-reference");
const assistantSelectionLabel = document.querySelector("#assistant-selection-label");
const assistantSelectionText = document.querySelector("#assistant-selection-text");
const assistantSelectionClear = document.querySelector("#assistant-selection-clear");
const assistantSend = document.querySelector("#assistant-send");
const assistantStop = document.querySelector("#assistant-stop");
const assistantModelLabel = document.querySelector("#assistant-model-label");
const assistantModelLabelText = document.querySelector("#assistant-model-label-text");
let noteRenderSequence = 0;
let tocScrollFrame = 0;
let readingAnchorFrame = 0;
let readingAnchorSnapshotFrame = 0;
let stableReadingAnchor = null;
let resizeReadingAnchor = null;
let resizeAnchorSettleTimer = 0;
let cleanupReadingAnchorRestore = () => {};
let cleanupTocTracking = () => {};
const SIDEBAR_AUTO_COLLAPSE_DELAY = 2000;
const SIDEBAR_LAYOUT_SETTLE_MS = 620;
// `renderNote()` replaces the Overview DOM asynchronously.  Give the browser one short,
// bounded opportunity to settle its hover hit testing before starting the normal idle timer.
// This is not a polling loop: genuine pointer or keyboard interaction still prevents collapse.
const SIDEBAR_POST_RENDER_RECHECK_DELAY = 180;
let sidebarAutoCollapseTimer = 0;
let sidebarInteractionMode = "pointer";
let searchDebounceTimer = 0;
let searchRequestController = null;
let searchRequestSequence = 0;
let immersionClockTimer = 0;
let immersionOwnsFullscreen = false;
let assistantRequestController = null;
let assistantStatusTimer = 0;
let assistantReady = false;
let assistantRemoteDisabled = false;
let assistantMasterDisabled = false;
let assistantCloudBackendDisabled = false;
let assistantPausedForRag = false;
let assistantContextWindow = 0;
let assistantConversationHistory = [];
let assistantConversationSequence = 0;
let assistantConversationId = readAssistantConversationId();
let assistantSelection = null;
let activeAssistantAnswerElements = null;
let selectionPopoverCandidate = null;
let selectionPopoverFrame = 0;
let lastUtilityTrigger = tocToggle;
let compactNavigationBeforeResize = isCompactNavigation();
let welcomeStepIndex = 0;
let welcomeTransitioning = false;
let welcomeSupportWaitTimer = 0;
let welcomeSupportWaitUntil = 0;
const viewerSession = {
  loaded: false,
  loading: null,
  email: "",
  feedback: false,
  error: "",
};

/* ---------------- 阅读位置记忆 ---------------- */

const SCROLL_STORE_PREFIX = "study-portal-scroll:";
const SCROLL_SAVE_INTERVAL = 250;
let scrollSaveTimer = 0;
let activeLastReadPosition = null;

function scrollStorageKey(noteId) {
  return `${SCROLL_STORE_PREFIX}${noteId}`;
}

function lastReadStorageKey(note) {
  // `updated` comes from the authoritative source note rather than the release timestamp.
  // A newly built release of unchanged notes therefore retains its marker, while an edited
  // note starts fresh instead of jumping to a section that may have moved.
  return `${LAST_READ_STORE_PREFIX}${note.id}:${note.updated || "unversioned"}`;
}

function lastReadStoragePrefixForNote(note) {
  return `${LAST_READ_STORE_PREFIX}${note.id}:`;
}

function normalizeLastReadPosition(value) {
  if (!value || value.version !== LAST_READ_SCHEMA_VERSION) return null;
  const anchorId = typeof value.anchorId === "string" ? value.anchorId.trim() : "";
  const anchorLabel = typeof value.anchorLabel === "string"
    ? value.anchorLabel.replace(/\s+/g, " ").trim()
    : "";
  const progress = Number(value.progress);
  if (!anchorId || anchorId.length > 240 || !Number.isFinite(progress) || progress <= 0 || progress > 1) {
    return null;
  }
  return {
    anchorId,
    anchorLabel: anchorLabel.slice(0, 180),
    progress,
  };
}

function readLastReadPosition(note) {
  try {
    return normalizeLastReadPosition(JSON.parse(localStorage.getItem(lastReadStorageKey(note)) || "null"));
  } catch (error) {
    return null;
  }
}

function clearLastReadPosition(note) {
  try {
    localStorage.removeItem(lastReadStorageKey(note));
  } catch (error) {
    /* Storage can be unavailable in a private reader; the current page still works normally. */
  }
}

function clearOlderLastReadPositions(note) {
  try {
    const currentKey = lastReadStorageKey(note);
    const prefix = lastReadStoragePrefixForNote(note);
    const staleKeys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix) && key !== currentKey) staleKeys.push(key);
    }
    staleKeys.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    /* Best-effort cleanup only; never make note reading depend on browser storage. */
  }
}

function captureLastReadPosition() {
  if (state.view !== "note") return null;
  const article = viewRoot.querySelector("#markdown-article");
  if (!article || article.querySelector(".note-loading")) return null;

  const headerHeight = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--header-height"),
  ) || 64;
  const readingLine = headerHeight + Math.min(156, Math.max(96, window.innerHeight * 0.34));
  const headings = [...article.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  let anchor = article.querySelector(".article-top-anchor");
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top > readingLine) break;
    anchor = heading;
  }

  const scrollRange = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const scrollTop = Math.max(0, window.scrollY);
  return {
    anchorId: anchor?.id || "note-top",
    anchorLabel: anchor?.textContent?.replace(/\s+/g, " ").trim() || "笔记开头",
    progress: scrollRange > 0 ? Math.min(1, Math.max(0, scrollTop / scrollRange)) : 0,
    scrollTop,
  };
}

function saveLastReadPosition() {
  if (state.view !== "note") return;
  const note = getActiveNote();
  const position = captureLastReadPosition();
  if (!note || !position) return;

  try {
    if (position.scrollTop < LAST_READ_MINIMUM_SCROLL_PX || position.progress <= 0) {
      localStorage.removeItem(lastReadStorageKey(note));
      return;
    }
    clearOlderLastReadPositions(note);
    localStorage.setItem(
      lastReadStorageKey(note),
      JSON.stringify({
        version: LAST_READ_SCHEMA_VERSION,
        anchorId: position.anchorId,
        anchorLabel: position.anchorLabel,
        progress: position.progress,
      }),
    );
  } catch (error) {
    /* Reading progress is a convenience feature, never a requirement for the reader. */
  }
}

function saveScrollPosition() {
  if (state.view !== "note" || !state.activeNoteId) return;
  try {
    sessionStorage.setItem(scrollStorageKey(state.activeNoteId), String(Math.round(window.scrollY)));
  } catch (error) {
    /* 无痕模式等场景下 sessionStorage 不可用，静默跳过 */
  }
  saveLastReadPosition();
}

// 用定时器而不是 requestAnimationFrame：rAF 在页面不合成帧时（后台标签页、
// 窗口最小化）不会触发，那样滚动位置就存不下来。
function scheduleScrollSave() {
  if (scrollSaveTimer) return;
  scrollSaveTimer = window.setTimeout(() => {
    scrollSaveTimer = 0;
    saveScrollPosition();
  }, SCROLL_SAVE_INTERVAL);
}

function readSavedScroll(noteId) {
  try {
    const raw = sessionStorage.getItem(scrollStorageKey(noteId));
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch (error) {
    return null;
  }
}

// styles.css 对 :root 设了 scroll-behavior: smooth，直接 scrollTo 会变成一路滚动动画，
// 因此恢复位置时临时切回 auto（与 restoreReadingAnchor 中的处理方式一致）。
function scrollToInstantly(top) {
  const root = document.documentElement;
  const previousBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  window.scrollTo({ top, behavior: "instant" });
  root.style.scrollBehavior = previousBehavior;
}

function restoreScrollPosition(noteId) {
  const saved = readSavedScroll(noteId);
  if (saved === null) return false;
  const apply = () => {
    if (state.activeNoteId !== noteId) return;
    const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    scrollToInstantly(Math.min(saved, maxTop));
  };
  // 渲染刚结束时布局仍可能收敛（字体替换、KaTeX 度量、图片占位），跨两帧再对齐一次。
  apply();
  requestAnimationFrame(() => requestAnimationFrame(apply));
  return true;
}

function clearLastReadPresentation() {
  activeLastReadPosition = null;
  lastReadMarker.hidden = true;
  lastReadMarker.style.removeProperty("top");
}

function dismissLastReadPrompt() {
  const prompt = viewRoot.querySelector("#last-read-prompt");
  if (prompt) prompt.hidden = true;
}

function getLastReadTarget(record) {
  const article = viewRoot.querySelector("#markdown-article");
  const target = document.getElementById(record?.anchorId || "");
  return article && target && article.contains(target) ? target : null;
}

function positionLastReadMarker() {
  if (!activeLastReadPosition || lastReadMarker.hidden) return;
  const headerHeight = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--header-height"),
  ) || 64;
  const topBoundary = headerHeight + 18;
  const bottomBoundary = Math.max(topBoundary, window.innerHeight - 28);
  const markerProgress = Math.min(0.97, Math.max(0.03, activeLastReadPosition.progress));
  lastReadMarker.style.top = `${Math.round(topBoundary + (bottomBoundary - topBoundary) * markerProgress)}px`;
}

function jumpToLastReadPosition() {
  const position = activeLastReadPosition;
  const note = getActiveNote();
  if (!position || !note || position.noteId !== note.id) return;
  const target = getLastReadTarget(position);
  if (!target) {
    clearLastReadPosition(note);
    clearLastReadPresentation();
    return;
  }

  dismissLastReadPrompt();
  clearLastReadPresentation();
  target.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
  target.classList.add("last-read-target");
  window.setTimeout(() => target.classList.remove("last-read-target"), 1800);
}

function presentLastReadPosition(note) {
  const position = readLastReadPosition(note);
  if (!position) return;
  const target = getLastReadTarget(position);
  if (!target) {
    // The note may have changed without its timestamp changing. Do not offer a misleading jump.
    clearLastReadPosition(note);
    return;
  }

  const label = target.textContent?.replace(/\s+/g, " ").trim() || position.anchorLabel || "笔记开头";
  activeLastReadPosition = { ...position, noteId: note.id };
  lastReadMarker.hidden = false;
  lastReadMarker.setAttribute("aria-label", `跳转到上次阅读位置：${label}`);
  lastReadMarker.title = `上次读到：${label}`;
  positionLastReadMarker();

  const prompt = viewRoot.querySelector("#last-read-prompt");
  const heading = viewRoot.querySelector("#last-read-heading");
  const meta = viewRoot.querySelector("#last-read-meta");
  if (!prompt || !heading || !meta) return;
  heading.textContent = label;
  meta.textContent = `约 ${Math.round(position.progress * 100)}% 处 · 可继续跳转，或先从当前页开始看`;
  prompt.hidden = false;
  viewRoot.querySelector("#last-read-resume")?.addEventListener("click", jumpToLastReadPosition);
  viewRoot.querySelector("#last-read-dismiss")?.addEventListener("click", dismissLastReadPrompt);
}

function isImmersionActive() {
  return state.view === "note" && state.immersionMode;
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function requestImmersionFullscreen() {
  if (getFullscreenElement()) return false;

  const target = document.documentElement;
  const requestFullscreen = target.requestFullscreen || target.webkitRequestFullscreen;
  if (!requestFullscreen) return false;

  try {
    immersionOwnsFullscreen = true;
    const requestResult = target.requestFullscreen
      ? target.requestFullscreen({ navigationUI: "hide" })
      : requestFullscreen.call(target);
    Promise.resolve(requestResult).catch(() => {
      immersionOwnsFullscreen = false;
    });
    return true;
  } catch (error) {
    immersionOwnsFullscreen = false;
    return false;
  }
}

function exitImmersionFullscreen() {
  const currentFullscreenElement = getFullscreenElement();
  const shouldExit = immersionOwnsFullscreen && currentFullscreenElement === document.documentElement;
  immersionOwnsFullscreen = false;
  if (!shouldExit) return;

  const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exitFullscreen) return;

  try {
    Promise.resolve(exitFullscreen.call(document)).catch(() => {});
  } catch (error) {
    /* Visual immersion still exits when a browser declines its fullscreen request. */
  }
}

function applyReadingTheme(theme, options = {}) {
  const nextTheme = READING_THEMES.has(theme) ? theme : "light";
  state.readingTheme = nextTheme;
  document.documentElement.dataset.readingTheme = nextTheme;
  readingThemeOptions.forEach((option) => {
    option.setAttribute("aria-pressed", String(option.dataset.readingTheme === nextTheme));
  });
  if (options.persist !== false) rememberReadingTheme(nextTheme);
}

function getSupportSettings() {
  const rawUrl = typeof portalData.support?.url === "string" ? portalData.support.url.trim() : "";
  let url;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    return null;
  }
  const hostname = url.hostname.toLocaleLowerCase().replace(/^www\./, "");
  if (url.protocol !== "https:" || hostname !== "buymeacoffee.com" || url.username || url.password) {
    return null;
  }
  const configuredAmount = Number(portalData.support?.suggestedAmountAud);
  const suggestedAmountAud = Number.isFinite(configuredAmount) && configuredAmount > 0
    ? Math.min(100, Math.round(configuredAmount))
    : 5;
  return { url: url.href, suggestedAmountAud };
}

function updateSupportPresentation() {
  const support = getSupportSettings();
  [supportLink, welcomeSupportLink].forEach((link) => {
    link.hidden = !support;
    if (support) link.href = support.url;
    else link.removeAttribute("href");
  });
  welcomeSupportAmount.textContent = `A$${support?.suggestedAmountAud || 5}`;
}

function setFeedbackStatus(message = "", stateName = "") {
  feedbackStatus.textContent = message;
  if (stateName) feedbackStatus.dataset.state = stateName;
  else delete feedbackStatus.dataset.state;
}

function updateViewerSessionPresentation() {
  if (viewerSession.email) {
    settingsAccountStatus.textContent = "已通过 Access 验证";
    settingsAccountStatus.dataset.state = "verified";
    settingsAccountEmail.textContent = viewerSession.email;
    feedbackIdentity.textContent = `将以 ${viewerSession.email} 的身份提交；邮箱由服务器验签确认。`;
  } else if (viewerSession.loading) {
    settingsAccountStatus.textContent = "正在读取身份…";
    delete settingsAccountStatus.dataset.state;
    settingsAccountEmail.textContent = "—";
    feedbackIdentity.textContent = "正在确认当前用户…";
  } else {
    settingsAccountStatus.textContent = viewerSession.error || "本地访问";
    delete settingsAccountStatus.dataset.state;
    settingsAccountEmail.textContent = "未提供登录邮箱";
    feedbackIdentity.textContent = "此访问方式未提供经验证的邮箱，无法向手机服务器提交反馈。";
  }
  settingsFeedback.disabled = !viewerSession.feedback;
}

async function loadViewerSession(options = {}) {
  if (portalData.desktop) {
    viewerSession.loaded = true;
    viewerSession.feedback = false;
    viewerSession.error = "仅本机访问";
    updateViewerSessionPresentation();
    return viewerSession;
  }
  if (viewerSession.loading) return viewerSession.loading;
  if (viewerSession.loaded && !options.force) return viewerSession;

  viewerSession.error = "";
  viewerSession.loading = (async () => {
    try {
      const response = await fetch("/api/session", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("application/json")) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const email = typeof payload.email === "string" ? payload.email.trim() : "";
      if (!payload.authenticated || !email || email.length > 320 || !email.includes("@")) {
        throw new Error("invalid session response");
      }
      viewerSession.loaded = true;
      viewerSession.email = email;
      viewerSession.feedback = payload.capabilities?.feedback === true;
      viewerSession.error = "";
    } catch (error) {
      viewerSession.loaded = false;
      viewerSession.email = "";
      viewerSession.feedback = false;
      viewerSession.error = "未连接共享服务器";
    }
    return viewerSession;
  })();
  updateViewerSessionPresentation();
  try {
    return await viewerSession.loading;
  } finally {
    viewerSession.loading = null;
    updateViewerSessionPresentation();
  }
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function openSettingsDialog() {
  if (!settingsDialog.open) settingsDialog.showModal();
  void loadViewerSession();
}

async function openFeedbackDialog() {
  closeDialog(settingsDialog);
  closeDialog(welcomeDialog);
  feedbackForm.reset();
  feedbackSubmit.disabled = false;
  feedbackSubmit.textContent = "提交反馈";
  setFeedbackStatus();
  if (!feedbackDialog.open) feedbackDialog.showModal();

  const session = await loadViewerSession();
  if (!feedbackDialog.open) return;
  if (!session.feedback) {
    setFeedbackStatus("请通过受保护的共享网址访问后再提交反馈。", "error");
    feedbackSubmit.disabled = true;
    return;
  }
  feedbackMessage.focus();
}

async function submitFeedback(event) {
  event.preventDefault();
  const message = feedbackMessage.value.replace(/\r\n?/g, "\n").trim();
  if (!message) {
    feedbackMessage.setCustomValidity("请填写反馈内容");
    feedbackMessage.reportValidity();
    feedbackMessage.setCustomValidity("");
    return;
  }
  if ([...message].length > FEEDBACK_MAXIMUM_CHARACTERS) {
    setFeedbackStatus(`反馈内容不能超过 ${FEEDBACK_MAXIMUM_CHARACTERS} 个字符。`, "error");
    return;
  }

  feedbackSubmit.disabled = true;
  feedbackSubmit.textContent = "正在提交…";
  setFeedbackStatus("正在安全提交到手机服务器…");
  try {
    const response = await fetch("/api/feedback", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: feedbackKind.value,
        message,
        route: window.location.hash,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfter = response.headers.get("retry-after");
      throw error;
    }
    feedbackMessage.value = "";
    feedbackSubmit.textContent = "已提交";
    setFeedbackStatus("反馈已保存到手机服务器，感谢你的建议。", "success");
  } catch (error) {
    feedbackSubmit.disabled = false;
    feedbackSubmit.textContent = "重新提交";
    if (error.status === 429) {
      setFeedbackStatus(`提交稍快，请等待约 ${error.retryAfter || 20} 秒后再试。`, "error");
    } else if (error.status === 401) {
      setFeedbackStatus("登录已失效，请刷新页面并重新完成邮箱验证。", "error");
    } else {
      setFeedbackStatus("暂时无法保存反馈，请稍后重试。", "error");
    }
  }
}

function hasCompletedWelcome() {
  try {
    return localStorage.getItem(WELCOME_STORE_KEY) === "complete";
  } catch (error) {
    return false;
  }
}

function rememberWelcomeComplete() {
  try {
    localStorage.setItem(WELCOME_STORE_KEY, "complete");
  } catch (error) {
    /* Private browsing can deny local storage; the welcome flow remains dismissible for this page. */
  }
}

function isWelcomeSupportStep(index = welcomeStepIndex) {
  return index === welcomeSteps.length - 1;
}

function welcomeSupportWaitSeconds() {
  if (!isWelcomeSupportStep() || !welcomeSupportWaitUntil) return 0;
  return Math.max(0, Math.ceil((welcomeSupportWaitUntil - Date.now()) / 1000));
}

function clearWelcomeSupportWait() {
  if (welcomeSupportWaitTimer) window.clearInterval(welcomeSupportWaitTimer);
  welcomeSupportWaitTimer = 0;
  welcomeSupportWaitUntil = 0;
  welcomeSupportWait.hidden = true;
  welcomeSupportWait.textContent = "";
}

function updateWelcomeControls() {
  const heading = welcomeSteps[welcomeStepIndex]?.querySelector("h2");
  if (heading?.id) welcomeDialog.setAttribute("aria-labelledby", heading.id);
  welcomeBack.hidden = welcomeStepIndex === 0;
  const remainingSeconds = welcomeSupportWaitSeconds();
  const waitingForSupportStep = remainingSeconds > 0;
  welcomeSupportWait.hidden = !waitingForSupportStep;
  welcomeSupportWait.textContent = waitingForSupportStep
    ? `请稍候 ${remainingSeconds} 秒后继续。`
    : "";
  welcomeNext.textContent = waitingForSupportStep
    ? `请稍候 ${remainingSeconds} 秒`
    : (isWelcomeSupportStep() ? "开始阅读" : "下一步");
  welcomeBack.disabled = welcomeTransitioning;
  welcomeNext.disabled = welcomeTransitioning || waitingForSupportStep;
}

function startWelcomeSupportWait() {
  clearWelcomeSupportWait();
  if (!isWelcomeSupportStep()) return;

  welcomeSupportWaitUntil = Date.now() + WELCOME_SUPPORT_MINIMUM_VIEW_MS;
  const refreshWelcomeSupportWait = () => {
    updateWelcomeControls();
    if (Date.now() < welcomeSupportWaitUntil) return;
    window.clearInterval(welcomeSupportWaitTimer);
    welcomeSupportWaitTimer = 0;
    welcomeSupportWaitUntil = 0;
    updateWelcomeControls();
  };

  refreshWelcomeSupportWait();
  welcomeSupportWaitTimer = window.setInterval(refreshWelcomeSupportWait, 200);
}

async function setWelcomeStep(index, options = {}) {
  const nextIndex = Math.max(0, Math.min(welcomeSteps.length - 1, index));
  if (welcomeTransitioning || nextIndex === welcomeStepIndex) {
    welcomeSteps.forEach((step, stepIndex) => {
      step.hidden = stepIndex !== welcomeStepIndex;
    });
    updateWelcomeControls();
    return;
  }

  const previousIndex = welcomeStepIndex;
  const previousStep = welcomeSteps[previousIndex];
  const nextStep = welcomeSteps[nextIndex];
  if (isWelcomeSupportStep(previousIndex)) clearWelcomeSupportWait();
  const shouldAnimate = options.animate !== false
    && welcomeDialog.open
    && typeof nextStep?.animate === "function"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  welcomeStepIndex = nextIndex;
  welcomeProgress.forEach((marker, markerIndex) => {
    marker.classList.toggle("is-active", markerIndex === nextIndex);
    marker.classList.toggle("is-complete", markerIndex < nextIndex);
  });
  updateWelcomeControls();

  if (!shouldAnimate) {
    welcomeSteps.forEach((step, stepIndex) => {
      step.hidden = stepIndex !== nextIndex;
    });
    if (isWelcomeSupportStep(nextIndex)) startWelcomeSupportWait();
    else updateWelcomeControls();
    return;
  }

  welcomeTransitioning = true;
  welcomeDialog.classList.add("is-transitioning");
  updateWelcomeControls();
  nextStep.hidden = false;
  const direction = nextIndex > previousIndex ? 1 : -1;
  const offset = 22 * direction;
  const timing = { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" };

  const outgoing = previousStep.animate([
    { opacity: 1, transform: "translateY(0) scale(1)" },
    { opacity: 0, transform: `translateY(${-offset}px) scale(0.985)` },
  ], timing);
  const incoming = nextStep.animate([
    { opacity: 0, transform: `translateY(${offset}px) scale(0.985)` },
    { opacity: 1, transform: "translateY(0) scale(1)" },
  ], timing);

  await Promise.allSettled([outgoing.finished, incoming.finished]);
  previousStep.hidden = true;
  previousStep.getAnimations().forEach((animation) => animation.cancel());
  nextStep.getAnimations().forEach((animation) => animation.cancel());
  welcomeDialog.classList.remove("is-transitioning");
  welcomeTransitioning = false;
  if (isWelcomeSupportStep(nextIndex)) startWelcomeSupportWait();
  else updateWelcomeControls();
}

function openWelcomeDialog(options = {}) {
  if (!options.force && hasCompletedWelcome()) return;
  closeDialog(settingsDialog);
  clearWelcomeSupportWait();
  welcomeStepIndex = 0;
  welcomeSteps.forEach((step, stepIndex) => {
    step.hidden = stepIndex !== 0;
  });
  welcomeProgress.forEach((marker, markerIndex) => {
    marker.classList.toggle("is-active", markerIndex === 0);
    marker.classList.remove("is-complete");
  });
  updateWelcomeControls();
  if (!welcomeDialog.open) welcomeDialog.showModal();
}

function completeWelcome() {
  clearWelcomeSupportWait();
  rememberWelcomeComplete();
  closeDialog(welcomeDialog);
}

function maybeShowWelcome() {
  if (portalData.desktop) return;
  if (hasCompletedWelcome() || welcomeDialog.open) return;
  requestAnimationFrame(() => openWelcomeDialog());
}

function updateImmersionClock() {
  const now = new Date();
  const dateText = `${IMMERSION_CLOCK_DATE_FORMATTER.format(now)} · ${IMMERSION_CLOCK_WEEKDAY_FORMATTER.format(now)}`;
  const compactDateText = IMMERSION_CLOCK_COMPACT_DATE_FORMATTER.format(now);
  const timeText = IMMERSION_CLOCK_TIME_FORMATTER.format(now);
  immersionClock.dateTime = now.toISOString();
  immersionClock.setAttribute("aria-label", `当前时间：${dateText} ${timeText}`);
  immersionClockDate.textContent = dateText;
  immersionClockCompactDate.textContent = compactDateText;
  immersionClockTime.textContent = timeText;
}

function syncImmersionClock() {
  const shouldRun = isImmersionActive() && !document.hidden;
  if (!shouldRun) {
    if (immersionClockTimer) window.clearInterval(immersionClockTimer);
    immersionClockTimer = 0;
    return;
  }

  updateImmersionClock();
  if (!immersionClockTimer) immersionClockTimer = window.setInterval(updateImmersionClock, 1000);
}

function syncImmersionPresentation() {
  const active = isImmersionActive();
  const desktop = !isCompactNavigation();
  const tocOpen = active && desktop && !state.immersiveTocCollapsed;
  document.body.classList.toggle("immersion-mode", active);
  document.body.classList.toggle("immersion-toc-open", tocOpen);
}

function updateImmersionControls() {
  const isNote = state.view === "note";
  const active = isImmersionActive();
  const desktop = !isCompactNavigation();
  const tocCollapsed = active && desktop && state.immersiveTocCollapsed;

  syncImmersionPresentation();
  topbarReadingUtility.hidden = !isNote;
  printTrigger.toggleAttribute("inert", active);
  if (active) printTrigger.setAttribute("aria-hidden", "true");
  else printTrigger.removeAttribute("aria-hidden");
  immersionClock.setAttribute("aria-hidden", String(!active));
  syncImmersionClock();
  readerControlDock.hidden = !isNote;
  immersionToggle.hidden = !isNote;
  immersionToggle.setAttribute("aria-pressed", String(active));
  immersionToggle.setAttribute("aria-label", active ? "退出全屏沉浸阅读" : "进入全屏沉浸阅读");
  immersionToggle.title = active ? "退出全屏沉浸阅读" : "进入全屏沉浸阅读";

  if (active && desktop) {
    tocToggle.setAttribute("aria-expanded", String(!tocCollapsed));
    tocToggle.setAttribute("aria-label", tocCollapsed ? "展开本页目录" : "本页目录已展开");
    tocToggle.title = tocCollapsed ? "展开本页目录" : "本页目录已展开";
    tocClose.setAttribute("aria-label", "收起阅读工具");
    tocClose.title = "收起阅读工具";
  } else {
    tocToggle.removeAttribute("title");
    tocClose.removeAttribute("title");
  }
}

function setImmersiveTocCollapsed(collapsed, options = {}) {
  if (!isImmersionActive() || isCompactNavigation()) return;
  const nextCollapsed = Boolean(collapsed);
  if (state.immersiveTocCollapsed === nextCollapsed) return;

  const readingAnchor = options.preserveAnchor === false ? null : captureReadingAnchor();
  const moveFocusToTrigger = nextCollapsed && tocPanel.contains(document.activeElement);
  state.immersiveTocCollapsed = nextCollapsed;
  updateImmersionControls();
  updateDrawerAccessibility();
  if (moveFocusToTrigger) tocToggle.focus({ preventScroll: true });
  restoreReadingAnchor(readingAnchor);
}

function setImmersionMode(enabled) {
  if (state.view !== "note") return;
  const nextMode = Boolean(enabled);
  if (state.immersionMode === nextMode) return;

  const readingAnchor = captureReadingAnchor() || stableReadingAnchor;
  cleanupReadingAnchorRestore();
  cancelSidebarAutoCollapse();
  if (nextMode && isCompactNavigation()) closeTocNavigation();

  state.immersionMode = nextMode;
  // Each entry begins with both reading rails folded. Their regular-layout state stays untouched.
  state.immersiveSidebarCollapsed = true;
  state.immersiveTocCollapsed = nextMode;
  updateNavigationToggle();
  updateImmersionControls();
  restoreReadingAnchor(readingAnchor, { settleDuration: SIDEBAR_LAYOUT_SETTLE_MS });

  if (!nextMode && !state.sidebarCollapsed) requestAnimationFrame(scheduleSidebarAutoCollapse);
}

function enterImmersionMode() {
  // Start the browser request directly from the button gesture; browsers reject delayed requests.
  requestImmersionFullscreen();
  setImmersionMode(true);
}

function exitImmersionMode() {
  setImmersionMode(false);
  exitImmersionFullscreen();
}

function toggleImmersionMode() {
  if (isImmersionActive()) exitImmersionMode();
  else enterImmersionMode();
}

function handleImmersionFullscreenChange() {
  if (getFullscreenElement() === document.documentElement || !immersionOwnsFullscreen) return;

  immersionOwnsFullscreen = false;
  if (isImmersionActive()) setImmersionMode(false);
}

function handleImmersionFullscreenError() {
  if (getFullscreenElement() !== document.documentElement) immersionOwnsFullscreen = false;
}

function updateBackToTopVisibility() {
  const isNote = state.view === "note";
  const shouldShow = isNote && window.scrollY > 560;

  if (!isNote) {
    backToTop.hidden = true;
    backToTop.classList.remove("is-visible");
    backToTop.setAttribute("aria-hidden", "true");
    backToTop.setAttribute("tabindex", "-1");
    backToTop.toggleAttribute("inert", true);
    readerControlDock?.classList.remove("has-back-to-top");
    return;
  }

  backToTop.hidden = false;
  backToTop.classList.toggle("is-visible", shouldShow);
  backToTop.setAttribute("aria-hidden", String(!shouldShow));
  backToTop.tabIndex = shouldShow ? 0 : -1;
  backToTop.toggleAttribute("inert", !shouldShow);
  readerControlDock?.classList.toggle("has-back-to-top", shouldShow);
}

window.addEventListener("scroll", () => {
  scheduleScrollSave();
  scheduleStableReadingAnchorCapture();
  updateBackToTopVisibility();
  hideSelectionAskAi();
}, { passive: true });
// 节流窗口内可能还没落盘，这两个事件直接同步写入，确保离开页面前的位置不丢。
window.addEventListener("pagehide", () => {
  saveScrollPosition();
  if (immersionClockTimer) window.clearInterval(immersionClockTimer);
  immersionClockTimer = 0;
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    saveScrollPosition();
    syncImmersionClock();
    return;
  }
  syncImmersionClock();
  checkForPortalUpdate();
});

function readPortalDataFromManifest(source) {
  const assignment = "window.PORTAL_DATA = ";
  const start = source.indexOf(assignment);
  const end = source.lastIndexOf(";");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(source.slice(start + assignment.length, end));
  } catch (error) {
    return null;
  }
}

async function loadPortalManifest() {
  if (portalManifestLoadComplete) return;
  try {
    const response = await fetch(`notes-manifest.js?initial-load=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    const latestPortalData = readPortalDataFromManifest(await response.text());
    if (!latestPortalData || !Array.isArray(latestPortalData.units)) return;
    portalManifestAvailable = true;
    applyPortalUpdate(latestPortalData);
    watchForPublishedPortalRelease();
  } catch (error) {
    /* A framework-only deployment intentionally has no private manifest. */
  } finally {
    portalManifestLoadComplete = true;
    if (!portalManifestAvailable) {
      if (state.view === "overview") renderOverview({ preserveUrl: true });
      else renderLibraryHome({ preserveUrl: true });
    }
    maybeShowWelcome();
  }
}

function applyPortalUpdate(latestPortalData) {
  saveScrollPosition();
  portalData = latestPortalData;
  portalManifestAvailable = true;
  portalManifestLoadComplete = true;
  flatNotes = flattenPortalNotes(portalData);
  activeUnits = portalData.units.filter((unit) => unit.weeks.length);
  document.body.classList.toggle("profile-general", portalData.profile === "general");
  renderPortalIdentity();

  const requestedNoteId = getNoteIdFromHash();
  if (requestedNoteId) state.activeNoteId = requestedNoteId;
  const activeNote = flatNotes.find((note) => note.id === state.activeNoteId);
  if ((state.view === "note" || requestedNoteId) && activeNote) {
    renderNavigation();
    renderNote(activeNote, { restoreScroll: true });
    return;
  }
  if (!activeNote) state.activeNoteId = getLatestNote()?.id;
  if (state.view === "home") {
    renderLibraryHome({ preserveUrl: true });
    return;
  }
  renderOverview({ preserveUrl: true });
}

async function checkForPortalUpdate() {
  if (!portalManifestAvailable || portalUpdateCheckInFlight || document.visibilityState === "hidden") return;
  portalUpdateCheckInFlight = true;
  try {
    const response = await fetch(`notes-manifest.js?update-check=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    const latestPortalData = readPortalDataFromManifest(await response.text());
    if (latestPortalData?.generatedAt && latestPortalData.generatedAt !== portalData.generatedAt) {
      applyPortalUpdate(latestPortalData);
    }
  } catch (error) {
    /* 手机短暂离线或切换网络时静默等待下一轮检查。 */
  } finally {
    portalUpdateCheckInFlight = false;
  }
}

window.setInterval(checkForPortalUpdate, PORTAL_UPDATE_CHECK_INTERVAL);

function getKnownPortalRelease() {
  try {
    return window.sessionStorage.getItem(PORTAL_RELEASE_SESSION_KEY) || "";
  } catch (error) {
    return "";
  }
}

function rememberPortalRelease(releaseId) {
  try {
    window.sessionStorage.setItem(PORTAL_RELEASE_SESSION_KEY, releaseId);
  } catch (error) {
    /* Storage may be disabled in a private browser context; EventSource still stays harmless. */
  }
}

function handlePublishedPortalRelease(releaseId) {
  if (!releaseId) return;
  // A few embedded Android browsers disable sessionStorage. Keep the baseline in
  // memory as well, so a connected page still detects the next publication.
  const knownReleaseId = observedPortalReleaseId || getKnownPortalRelease();
  if (!knownReleaseId) {
    observedPortalReleaseId = releaseId;
    rememberPortalRelease(releaseId);
    return;
  }
  if (knownReleaseId === releaseId || portalReleaseRefreshInFlight) return;
  void refreshPublishedPortalRelease(releaseId);
}

/**
 * A new verified release normally changes notes-manifest.js.  Refresh the current in-memory
 * catalogue instead of navigating the entire document: an open note retains its reading anchor,
 * while overview/home remain on their current route.  The 15-second polling fallback below still
 * covers browsers without EventSource or a transient event connection failure.
 */
async function refreshPublishedPortalRelease(releaseId) {
  if (portalReleaseRefreshInFlight || !releaseId) return;
  portalReleaseRefreshInFlight = true;
  try {
    const response = await fetch(`notes-manifest.js?release-event=${encodeURIComponent(releaseId)}&t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    const latestPortalData = readPortalDataFromManifest(await response.text());
    if (!latestPortalData?.generatedAt) return;
    if (latestPortalData.generatedAt !== portalData.generatedAt) {
      applyPortalUpdate(latestPortalData);
    }
    // Record only after a valid current manifest was read. If Wi-Fi briefly drops, the next SSE
    // reconnect can retry this release instead of incorrectly treating it as already applied.
    observedPortalReleaseId = releaseId;
    rememberPortalRelease(releaseId);
  } catch (error) {
    /* EventSource reconnects and the compatibility poll will retry after a short network gap. */
  } finally {
    portalReleaseRefreshInFlight = false;
  }
}

function watchForPublishedPortalRelease() {
  if (portalReleaseEventsStarted || !("EventSource" in window)) return;
  portalReleaseEventsStarted = true;
  const releaseEvents = new EventSource("api/portal-events");
  releaseEvents.addEventListener("release", (event) => {
    try {
      handlePublishedPortalRelease(JSON.parse(event.data || "{}").releaseId);
    } catch (error) {
      /* A malformed update event must never interrupt note reading. */
    }
  });
  if (portalData.desktop) {
    releaseEvents.addEventListener("error", () => {
      if (document.querySelector(".portal-connection-warning")) return;
      const warning = document.createElement("div");
      warning.className = "portal-connection-warning";
      warning.setAttribute("role", "alert");
      warning.textContent = "本地服务已断开；当前内容可能不是最新版本。请在 Note Portal 窗口重新打开阅读器。";
      document.body.prepend(warning);
    });
    releaseEvents.addEventListener("open", () => {
      document.querySelector(".portal-connection-warning")?.remove();
    });
  }
}

function renderPortalIdentity() {
  document.body.classList.toggle("profile-desktop", portalData.desktop === true);
  document.body.classList.toggle("profile-general", portalData.profile === "general");
  if (portalData.desktop) {
    document.querySelector(".brand__product").textContent = "Note Portal";
    document.querySelector(".brand__usyd-logo")?.remove();
    document.querySelector("#library-link span").textContent = "资料库目录";
    document.querySelector("#sidebar")?.setAttribute("aria-label", "文件夹与文档导航");
    document.querySelector("#course-navigation")?.setAttribute("aria-label", "文件夹与文档列表");
    document.querySelector("#search-trigger")?.setAttribute("aria-label", "搜索文档");
  }
  if (portalData.profile === "general") {
    semesterSelect.innerHTML = `<option value="${escapeHtml(portalData.id)}">${escapeHtml(portalData.label)}</option>`;
    semesterSelect.value = portalData.id;
    sidebarTerm.textContent = portalData.label;
    sidebarSummary.textContent = `${flatNotes.length} ${flatNotes.length === 1 ? "document" : "documents"}`;
    searchScopeTerm.textContent = portalData.label;
    updateSupportPresentation();
    return;
  }
  semesterSelect.innerHTML = `
    <option value="__home__">All semesters</option>
    <option value="${escapeHtml(portalData.id)}">${escapeHtml(portalData.pickerLabel || portalData.label)}</option>`;
  semesterSelect.value = state.view === "home" ? "__home__" : portalData.id;
  sidebarTerm.textContent = portalData.label;
  sidebarSummary.textContent = `${activeUnits.length} active ${activeUnits.length === 1 ? "unit" : "units"} · ${flatNotes.length} ${flatNotes.length === 1 ? "note" : "notes"}`;
  searchScopeTerm.textContent = portalData.label;
  updateSupportPresentation();
}

function renderCurrentNoteIndicator(note, unit) {
  if (portalData.desktop || portalData.profile === "general") {
    currentNoteLabel.textContent = "当前文档";
    currentNoteUnit.textContent = note.title;
    currentNoteWeek.textContent = note.location || "资料库最外层";
    currentNoteWeekShort.textContent = "文档";
    currentNoteIndicator.setAttribute("aria-label", `当前文档：${note.title}`);
    currentNoteIndicator.title = note.title;
    return;
  }
  const semesterLabel = formatCompactSemesterLabel(portalData.label);
  const weekLabel = formatWeekLabel(note);
  const accessibleLabel = `当前笔记：${portalData.label}，${unit.code} ${unit.name}，${weekLabel}`;

  currentNoteLabel.textContent = `当前笔记：${semesterLabel}`;
  currentNoteUnit.textContent = unit.code;
  currentNoteWeek.textContent = weekLabel;
  currentNoteWeekShort.textContent = formatCompactWeekLabel(note);
  currentNoteIndicator.setAttribute("aria-label", accessibleLabel);
  currentNoteIndicator.title = accessibleLabel;
}

renderPortalIdentity();

function getNoteIdFromHash() {
  const match = window.location.hash.match(/^#note=(.+)$/);
  return match && flatNotes.some((note) => note.id === match[1]) ? match[1] : null;
}

function getViewFromHash() {
  if (!window.location.hash || window.location.hash === "#home") return "home";
  if (window.location.hash === "#overview") return "overview";
  return "note";
}

function updateDocumentTitle(view, note = null) {
  if (portalData.desktop || portalData.profile === "general") {
    document.title = view === "note" ? `${(note || getActiveNote())?.title || portalData.label} | Note Portal` : `${portalData.label} | Note Portal`;
    return;
  }
  if (view === "home") {
    document.title = "Note Portal";
    return;
  }

  if (view === "overview") {
    document.title = `${portalData.label} | Note Portal`;
    return;
  }

  const activeNote = note || getActiveNote();
  document.title = activeNote
    ? `${activeNote.unitCode} · ${formatWeekLabel(activeNote)} | Note Portal`
    : `${portalData.label} | Note Portal`;
}

function setViewMode(view, note = null) {
  if (view !== "note" && (state.immersionMode || immersionOwnsFullscreen)) exitImmersionMode();

  state.view = view;
  const isHome = view === "home";
  const isOverview = view === "overview";
  const isNote = view === "note";

  if (!isNote) {
    state.immersionMode = false;
    state.immersiveTocCollapsed = false;
  }

  document.body.classList.toggle("view-home", isHome);
  document.body.classList.toggle("view-overview", isOverview);
  semesterPicker.hidden = isHome || portalData.desktop || portalData.profile === "general";
  currentNoteIndicator.hidden = !isNote;
  printTrigger.hidden = !isNote;
  printTrigger.disabled = !isNote;
  searchTrigger.hidden = isHome;
  navToggle.hidden = !isNote;
  sidebar.hidden = !isNote;
  sidebarEdgeToggle.hidden = !isNote;
  navScrim.hidden = !isNote;
  tocPanel.hidden = !isNote;
  tocToggle.hidden = !isNote;
  assistantToggle.hidden = !isNote || !ASSISTANT_UI_ENABLED;
  tocScrim.hidden = !isNote;
  readingProgress.hidden = !isNote;
  updateImmersionControls();
  updateBackToTopVisibility();
  semesterSelect.value = isHome ? "__home__" : portalData.id;
  brandHome.setAttribute("aria-label", portalData.desktop ? "返回 Note Portal 首页" : (isHome ? "学习门户首页" : "返回学习门户首页"));
  updateDocumentTitle(view, note);

  if (!isNote) {
    closeTocNavigation();
    hideSelectionAskAi();
    clearLastReadPresentation();
  }
  if (!isNote) {
    closeMobileNavigation();
    cancelSidebarAutoCollapse();
  }
  if (isHome && searchDialog.open) searchDialog.close();
  updateNavigationToggle();
}

function getActiveNote() {
  return flatNotes.find((note) => note.id === state.activeNoteId) || flatNotes[0];
}

function getUnitForNote(noteId) {
  if (portalData.profile === "general") {
    const note = flatNotes.find((item) => item.id === noteId);
    return { code: note?.location || "Documents", name: note?.location || portalData.label };
  }
  return portalData.units.find((unit) => unit.weeks.some((note) => note.id === noteId));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function generalTreeHtml(nodes) {
  return `<ul class="general-tree">${nodes.map((node) => node.id
    ? `<li><button class="general-tree__note" type="button" data-note-id="${escapeHtml(node.id)}" ${node.id === state.activeNoteId ? 'aria-current="page"' : ""}>${escapeHtml(node.label)}</button></li>`
    : `<li><details open><summary>${escapeHtml(node.label)}</summary>${generalTreeHtml(node.children || [])}</details></li>`).join("")}</ul>`;
}

function renderNavigation() {
  if (portalData.desktop || portalData.profile === "general") {
    courseNavigation.innerHTML = generalTreeHtml(portalData.tree || []);
    courseNavigation.querySelectorAll("[data-note-id]").forEach((button) => {
      button.addEventListener("click", () => openNote(button.dataset.noteId));
    });
    return;
  }
  if (!portalData.units.length) {
    courseNavigation.innerHTML = '<p class="empty-week">No study units are configured yet.</p>';
    return;
  }
  courseNavigation.innerHTML = portalData.units
    .map((unit) => {
      const expanded = state.expandedUnits.has(unit.code);
      const active = unit.weeks.some((note) => note.id === state.activeNoteId) && state.view === "note";
      const weeksContent = unit.weeks.length
        ? unit.weeks
            .map(
              (note) => `
                <button
                  class="week-link"
                  type="button"
                  data-note-id="${note.id}"
                  ${note.id === state.activeNoteId && state.view === "note" ? 'aria-current="page"' : ""}
                >
                  <span class="week-link__number">${formatWeekIndex(note)}</span>
                  <span>${formatWeekLabel(note)}</span>
                </button>`,
            )
            .join("")
        : '<p class="empty-week">No review notes yet</p>';
      const weeks = `
        <div
          class="week-list${expanded ? " is-expanded" : ""}"
          id="weeks-${unit.code}"
          aria-hidden="${!expanded}"
          ${expanded ? "" : "inert"}
        >
          <div class="week-list__content">${weeksContent}</div>
        </div>`;

      return `
        <section class="course-group${active ? " course-group--active" : ""}">
          <button
            class="course-toggle"
            type="button"
            data-unit-code="${unit.code}"
            aria-expanded="${expanded}"
            aria-controls="weeks-${unit.code}"
          >
            <span class="course-toggle__copy">
              <span class="course-code">${unit.code}</span>
              <span class="course-name">${unit.name}</span>
            </span>
            <span class="course-toggle__count">${unit.weeks.length || "—"}</span>
            <svg class="course-toggle__chevron" aria-hidden="true" viewBox="0 0 24 24">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
          ${weeks}
        </section>`;
    })
    .join("");

  courseNavigation.querySelectorAll("[data-unit-code]").forEach((button) => {
    button.addEventListener("click", () => {
      const code = button.dataset.unitCode;
      setUnitExpansion(code, !state.expandedUnits.has(code));
    });
  });

  courseNavigation.querySelectorAll("[data-note-id]").forEach((button) => {
    button.addEventListener("click", () => openNote(button.dataset.noteId));
  });
}

function setSingleExpandedUnit(unitCode) {
  state.expandedUnits.clear();
  if (unitCode) state.expandedUnits.add(unitCode);
}

function setUnitExpansion(unitCode, expanded) {
  if (!unitCode) return;
  if (expanded) {
    // Sidebar navigation is an accordion: revealing one Unit always closes every other Unit.
    setSingleExpandedUnit(unitCode);
  } else {
    state.expandedUnits.delete(unitCode);
  }

  // Keep the existing sidebar DOM in place so the CSS transition and keyboard focus remain stable.
  courseNavigation.querySelectorAll("[data-unit-code]").forEach((toggle) => {
    const code = toggle.dataset.unitCode;
    const isExpanded = state.expandedUnits.has(code);
    const list = document.getElementById(`weeks-${code}`);
    toggle.setAttribute("aria-expanded", String(isExpanded));
    list?.classList.toggle("is-expanded", isExpanded);
    list?.setAttribute("aria-hidden", String(!isExpanded));
    list?.toggleAttribute("inert", !isExpanded);
  });
}

function openNote(noteId, options = {}) {
  const note = flatNotes.find((item) => item.id === noteId);
  if (!note) return;
  const switchingNote = state.activeNoteId !== noteId;
  if (switchingNote) saveScrollPosition();
  hideSelectionAskAi();
  if (switchingNote) clearAssistantSelection();
  state.activeNoteId = noteId;
  rememberNote(noteId);
  setViewMode("note", note);
  setSingleExpandedUnit(note.unitCode);
  window.location.hash = `note=${noteId}`;
  renderNavigation();
  if (isCompactNavigation()) closeMobileNavigation();
  const renderPromise = renderNote(note, options);
  // Overview has no sidebar to emit a pointer-leave event. Once its note button is
  // replaced by the reader, start the same idle-collapse path used by sidebar entry.
  // Do this after the async reader render: the former one-frame check could observe the
  // discarded Overview card as :hover, then never retry until the pointer entered the sidebar.
  // The recheck is bounded and the normal guards still preserve real pointer/keyboard use.
  renderPromise.then(() => {
    if (state.activeNoteId !== note.id || isCompactNavigation()) return;
    requestAnimationFrame(() => {
      scheduleSidebarAutoCollapse();
      window.setTimeout(() => {
        if (state.activeNoteId === note.id && !isCompactNavigation()) {
          scheduleSidebarAutoCollapse();
        }
      }, SIDEBAR_POST_RENDER_RECHECK_DELAY);
    });
  });
  if (!options.preserveScroll && !options.targetAnchor) window.scrollTo({ top: 0, behavior: "instant" });
  return renderPromise;
}

async function renderNote(note, options = {}) {
  const renderSequence = ++noteRenderSequence;
  hideSelectionAskAi();
  cleanupTocTracking();
  clearLastReadPresentation();
  stableReadingAnchor = null;
  const unit = getUnitForNote(note.id);
  renderCurrentNoteIndicator(note, unit);
  refreshAssistantStatus();
  rememberNote(note.id);
  setViewMode("note", note);
  printTrigger.disabled = true;
  libraryLink.removeAttribute("aria-current");

  viewRoot.innerHTML = portalData.desktop || portalData.profile === "general" ? `
    <div class="reading-container">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <button type="button" data-view="overview">${escapeHtml(portalData.label)}</button>
        <span aria-hidden="true">/</span><span>${escapeHtml(note.location || "资料库最外层")}</span>
      </nav>
      <header class="note-header">
        <div class="note-context"><span class="unit-label">Markdown document</span><span class="preview-label">Local-first</span></div>
        <h1>${escapeHtml(note.title)}</h1>
        <p class="note-subtitle">${escapeHtml(note.relativePath || note.location || "")}</p>
        <div class="note-meta"><span>Updated ${escapeHtml(note.updated || "locally")}</span></div>
      </header>
      <article class="article markdown-article" id="markdown-article" aria-live="polite"><div class="note-loading" role="status"><p>正在载入文档…</p></div></article>
      ${renderPagination(note)}
    </div>` : `
    <div class="reading-container">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <button type="button" data-view="overview">${escapeHtml(portalData.label)}</button>
        <span aria-hidden="true">/</span>
        <span>${unit.code}</span>
        <span aria-hidden="true">/</span>
        <span>${formatWeekLabel(note)}</span>
      </nav>

       <header class="note-header">
        <div class="note-context">
          <span class="unit-label">${unit.code}</span>
          <span class="preview-label">${formatWeekLabel(note)}</span>
          <span class="preview-label">Synced Markdown</span>
        </div>
        <h1>${escapeHtml(note.title)}</h1>
        <p class="note-subtitle">
          ${escapeHtml(unit.name)} · 完整复习笔记
        </p>
        <div class="note-meta">
          <span>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 4.5h12v15H6zM9 8h6M9 12h6M9 16h4" /></svg>
            Review notes
          </span>
          <span>
            <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
            Local Markdown copy
          </span>
          <span>Updated ${escapeHtml(note.updated || "locally")}</span>
         </div>
       </header>

       <section class="last-read-prompt" id="last-read-prompt" aria-live="polite" hidden>
         <div class="last-read-prompt__copy">
           <p>上次读到</p>
           <strong id="last-read-heading">章节</strong>
           <span id="last-read-meta">可一键跳转到上次的阅读位置</span>
         </div>
         <div class="last-read-prompt__actions">
           <button class="last-read-prompt__resume" id="last-read-resume" type="button">继续阅读</button>
           <button class="last-read-prompt__dismiss" id="last-read-dismiss" type="button">暂不跳转</button>
         </div>
       </section>

       <article class="article markdown-article" id="markdown-article" aria-live="polite">
        <div class="note-loading" role="status">
          <span></span><span></span><span></span>
          <p>正在载入完整笔记…</p>
        </div>
      </article>
      ${renderPagination(note)}
    </div>`;

  viewRoot.querySelector("[data-view='overview']")?.addEventListener("click", renderOverview);
  viewRoot.querySelectorAll("[data-note-id]").forEach((button) => {
    button.addEventListener("click", () => openNote(button.dataset.noteId));
  });
  try {
    const response = await fetch(note.path, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const markdown = await response.text();
    if (renderSequence !== noteRenderSequence || state.activeNoteId !== note.id) return;

    const article = viewRoot.querySelector("#markdown-article");
    article.innerHTML = renderMarkdownWithMath(markdown);
    resolveArticleAssetUrls(article, note.assetBase || note.path, portalData.desktop ? portalData.generatedAt : "");
    resolveArticleDocumentLinks(article, note);
    enhanceMarkdownArticle(article);
    printTrigger.disabled = false;
    buildTableOfContents();
    requestAnimationFrame(scheduleStableReadingAnchorCapture);
    if (options.targetAnchor) {
      requestAnimationFrame(() => {
        const target = document.getElementById(options.targetAnchor);
        if (!target) {
          window.scrollTo({ top: 0, behavior: "instant" });
          return;
        }
        target.scrollIntoView({ block: "start", behavior: "smooth" });
        target.classList.add("search-target-heading");
        window.setTimeout(() => target.classList.remove("search-target-heading"), 1800);
      });
    } else {
      const restoredSessionPosition = options.restoreScroll && restoreScrollPosition(note.id);
      if (!restoredSessionPosition) presentLastReadPosition(note);
    }
  } catch (error) {
    if (renderSequence !== noteRenderSequence) return;
    viewRoot.querySelector("#markdown-article").innerHTML = `
      <div class="callout callout--warning">
        <p class="callout__title">笔记载入失败</p>
        <p>未能读取 <code>${escapeHtml(note.relativePath || note.path)}</code>。请检查原文件后点击刷新。</p>
      </div>`;
    tocNavigation.innerHTML = "";
    console.error(error);
  }
}

function restorePrintState() {
  const restore = printRestoreState;
  if (!restore) return;
  printRestoreState = null;
  document.title = restore.documentTitle;
  document.body.classList.remove("is-printing");
  restore.details.forEach(({ element, open }) => {
    element.open = open;
  });
}

function recordPortalActivity(action, note = getActiveNote()) {
  if (portalData.desktop) return;
  const payload = JSON.stringify({
    action,
    noteId: note?.id || "",
    notePath: note?.path || "",
    route: window.location.hash,
  });
  const blob = new Blob([payload], { type: "application/json" });
  if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/activity", blob)) return;
  void fetch("/api/activity", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

function printCurrentNote() {
  const note = getActiveNote();
  const unit = note ? getUnitForNote(note.id) : null;
  const article = viewRoot.querySelector("#markdown-article");
  if (state.view !== "note" || !note || !unit || !article || printTrigger.disabled) return;

  restorePrintState();
  const details = [...article.querySelectorAll("details")].map((element) => ({ element, open: element.open }));
  details.forEach(({ element }) => {
    element.open = true;
  });
  printRestoreState = {
    documentTitle: document.title,
    details,
  };
  document.title = portalData.desktop ? `${note.title} — Note Portal` : `${unit.code} · ${formatWeekLabel(note)} · ${note.title} — Note Portal`;
  document.body.classList.add("is-printing");
  recordPortalActivity("print", note);
  window.print();
}

/**
 * 把正文里的相对资源地址按**笔记自身的 URL** 解析，而不是按页面地址。
 *
 * 渲染出来的 HTML 是插进根页面的，浏览器于是拿页面地址当基准：写在
 * `notes/<unit>/week-N.md` 里的 `assets/week-N/x.png` 会被请求成 `/assets/week-N/x.png`，
 * 但文件实际在 `/notes/<unit>/assets/week-N/x.png` —— 同步器
 * （content/sync-notes.py）就是把图片复制到笔记旁边的 assets/ 下的，
 * 所以这种相对写法必须成立，否则插图静默加载失败。
 *
 * 只改相对路径的媒体地址。带协议的、根路径的、#锚点一律原样保留；`<a href>` 也不动，
 * 改了会让「链到另一篇笔记」变成直接跳去原始 .md，而目录锚点也会跟着失效。
 */
function resolveArticleAssetUrls(article, notePath, assetVersion = "") {
  let noteUrl;
  try {
    noteUrl = new URL(notePath, window.location.href);
  } catch (error) {
    return;
  }

  const isRelative = (value) =>
    Boolean(value)
    && !value.startsWith("#")
    && !value.startsWith("/")
    && !/^[a-z][a-z0-9+.-]*:/i.test(value);

  const resolve = (value) => {
    try {
      const url = new URL(value, noteUrl);
      if (assetVersion && url.origin === window.location.origin) url.searchParams.set("v", assetVersion);
      return url.href;
    } catch (error) {
      return null;
    }
  };

  article.querySelectorAll("img[src], video[src], audio[src], source[src], embed[src]")
    .forEach((element) => {
      const value = element.getAttribute("src").trim();
      if (!isRelative(value)) return;
      const resolved = resolve(value);
      if (resolved) element.setAttribute("src", resolved);
    });

  article.querySelectorAll("img[srcset], source[srcset]").forEach((element) => {
    const rewritten = element.getAttribute("srcset").split(",").map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      if (!parts[0] || !isRelative(parts[0])) return candidate.trim();
      const resolved = resolve(parts[0]);
      if (!resolved) return candidate.trim();
      return [resolved, ...parts.slice(1)].join(" ");
    });
    element.setAttribute("srcset", rewritten.join(", "));
  });
}

function resolveArticleDocumentLinks(article, note) {
  if (!portalData.desktop || !note.assetBase) return;
  const base = new URL(note.assetBase, window.location.href);
  article.querySelectorAll("a[href]").forEach((link) => {
    const raw = link.getAttribute("href");
    if (!raw || !/\.md(?:[?#]|$)/i.test(raw)) return;
    try {
      const url = new URL(raw, base);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/library/")) return;
      const relativePath = decodeURIComponent(url.pathname.slice("/library/".length));
      const target = flatNotes.find((item) => item.relativePath === relativePath);
      if (!target) return;
      const targetAnchor = decodeURIComponent(url.hash.slice(1));
      link.href = `#note=${encodeURIComponent(target.id)}`;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        openNote(target.id, { targetAnchor });
      });
    } catch (error) {
      /* Invalid Markdown links remain inert after URL sanitisation. */
    }
  });
}

function enhanceMarkdownArticle(article) {
  const usedIds = new Set();
  article.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
    const base = heading.textContent
      .trim()
      .toLocaleLowerCase("en-US")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "") || "section";
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    heading.id = id;
  });

  // The visual note header already supplies the document title, so the Markdown H1 is hidden.
  // Keep its generated ID on a real in-flow marker so top-of-note search and Assistant
  // citations can navigate to it instead of silently falling back to the page start.
  const topLevelHeading = article.querySelector(":scope > h1");
  const topAnchor = document.createElement("span");
  topAnchor.className = "article-top-anchor";
  topAnchor.setAttribute("aria-hidden", "true");
  if (topLevelHeading) {
    topAnchor.id = topLevelHeading.id;
    topLevelHeading.before(topAnchor);
    topLevelHeading.remove();
  } else {
    topAnchor.id = "note-top";
    article.prepend(topAnchor);
  }

  article.querySelectorAll("table").forEach((table) => {
    const wrapper = document.createElement("div");
    wrapper.className = "table-wrap";
    wrapper.tabIndex = 0;
    wrapper.setAttribute("aria-label", "表格，可横向滚动");
    table.before(wrapper);
    wrapper.append(table);
  });

  article.querySelectorAll("a[href^='http']").forEach((link) => {
    link.target = "_blank";
    link.rel = "noreferrer";
  });
}

function normalizeAssistantSelectionText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateAssistantSelectionText(value) {
  if (value.length <= ASSISTANT_SELECTION_MAXIMUM_CHARACTERS) return value;
  return `${value.slice(0, ASSISTANT_SELECTION_MAXIMUM_CHARACTERS - 1).trimEnd()}…`;
}

function katexElementForNode(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest?.(".katex") || null;
}

function selectedKatexSource(range) {
  const startFormula = katexElementForNode(range.startContainer);
  const endFormula = katexElementForNode(range.endContainer);
  if (!startFormula || startFormula !== endFormula) return "";
  return normalizeAssistantSelectionText(
    startFormula.querySelector("annotation[encoding='application/x-tex']")?.textContent,
  );
}

function sectionAnchorForArticleNode(node, article) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  if (!element || !article.contains(element)) return "note-top";
  const ownHeading = element.closest("h1, h2, h3, h4, h5, h6");
  if (ownHeading?.id && article.contains(ownHeading)) return ownHeading.id;

  let precedingHeading = null;
  article.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
    if (heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) {
      precedingHeading = heading;
    }
  });
  return precedingHeading?.id || article.querySelector(".article-top-anchor")?.id || "note-top";
}

function getArticleSelectionCandidate() {
  if (state.view !== "note") return null;
  const article = viewRoot.querySelector("#markdown-article");
  const nativeSelection = window.getSelection();
  if (!article || !nativeSelection || nativeSelection.rangeCount !== 1 || nativeSelection.isCollapsed) return null;

  const range = nativeSelection.getRangeAt(0);
  if (!article.contains(range.commonAncestorContainer)) return null;

  const formulaSource = selectedKatexSource(range);
  const rawText = formulaSource || normalizeAssistantSelectionText(range.toString());
  if (!rawText || (!formulaSource && rawText.length < 2)) return null;

  const note = getActiveNote();
  const unit = getUnitForNote(note.id);
  const rects = [...range.getClientRects()];
  const rect = rects.at(-1) || range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;

  return {
    noteId: note.id,
    unitCode: unit.code,
    unitName: unit.name,
    weekLabel: formatWeekLabel(note),
    noteTitle: note.title,
    kind: formulaSource ? "formula" : "text",
    text: truncateAssistantSelectionText(rawText),
    sectionAnchor: sectionAnchorForArticleNode(range.startContainer, article),
    rect,
  };
}

function hideSelectionAskAi() {
  window.cancelAnimationFrame(selectionPopoverFrame);
  selectionPopoverFrame = 0;
  selectionPopoverCandidate = null;
  selectionAskAi.hidden = true;
  selectionAskAi.removeAttribute("data-placement");
}

function showSelectionAskAi(candidate) {
  const horizontalPadding = 78;
  const left = Math.min(
    window.innerWidth - horizontalPadding,
    Math.max(horizontalPadding, candidate.rect.left + candidate.rect.width / 2),
  );
  // Android WebView places its native text-selection toolbar above the selection. Put our
  // reader action below it on compact screens whenever there is room, so “问 AI” remains
  // reachable instead of sitting beneath the system toolbar.
  const compact = isCompactNavigation();
  const compactBottomReserve = 86;
  const canPlaceBelow = candidate.rect.bottom + 58 <= window.innerHeight - compactBottomReserve;
  const placeBelow = compact ? canPlaceBelow : candidate.rect.top < 74;
  selectionAskAi.style.left = `${left}px`;
  selectionAskAi.style.top = `${placeBelow ? candidate.rect.bottom : candidate.rect.top}px`;
  selectionAskAi.dataset.placement = placeBelow ? "below" : "above";
  selectionPopoverCandidate = candidate;
  selectionAskAi.hidden = false;
}

function updateSelectionAskAi() {
  selectionPopoverFrame = 0;
  const candidate = getArticleSelectionCandidate();
  if (!candidate) {
    hideSelectionAskAi();
    return;
  }
  showSelectionAskAi(candidate);
}

function scheduleSelectionAskAi() {
  if (!ASSISTANT_UI_ENABLED) {
    hideSelectionAskAi();
    return;
  }
  window.cancelAnimationFrame(selectionPopoverFrame);
  selectionPopoverFrame = window.requestAnimationFrame(updateSelectionAskAi);
}

function setAssistantSelection(selection) {
  assistantSelection = selection;
  assistantSelectionLabel.textContent = selection.kind === "formula" ? "引用公式" : "引用正文";
  assistantSelectionText.textContent = selection.text;
  assistantSelectionReference.hidden = false;
  assistantInput.placeholder = selection.kind === "formula"
    ? "围绕这条公式提问…"
    : "围绕已引用正文提问…";
  // “问 AI” should make the exact current section the evidence boundary by default. Gemini has
  // no automatic note retrieval, so its explicitly selected passage must not silently alter a
  // hidden retrieval scope.
  if (!isIndependentGeminiBackend()) setAssistantScope("section");
}

function clearAssistantSelection() {
  assistantSelection = null;
  assistantSelectionLabel.textContent = "引用正文";
  assistantSelectionText.textContent = "";
  assistantSelectionReference.hidden = true;
  assistantInput.placeholder = ASSISTANT_DEFAULT_PLACEHOLDER;
}

function openAssistantForSelection(selection) {
  setAssistantSelection(selection);
  if (isCompactNavigation()) openAssistantPanel();
  else setUtilityTab("assistant");
  window.requestAnimationFrame(() => assistantInput.focus());
}

function renderPagination(note) {
  const index = flatNotes.findIndex((item) => item.id === note.id);
  const previous = flatNotes[index - 1];
  const next = flatNotes[index + 1];

  return `
    <div class="note-endcap">
      <nav class="note-pagination" aria-label="上一篇和下一篇笔记">
        ${
          previous
            ? `<button class="pagination-button" type="button" data-note-id="${previous.id}"><span>Previous note</span><strong>${escapeHtml(portalData.desktop || portalData.profile === "general" ? previous.title : `${previous.unitCode} · ${formatWeekLabel(previous)}`)}</strong></button>`
            : "<span></span>"
        }
        ${
          next
            ? `<button class="pagination-button" type="button" data-note-id="${next.id}"><span>Next note</span><strong>${escapeHtml(portalData.desktop || portalData.profile === "general" ? next.title : `${next.unitCode} · ${formatWeekLabel(next)}`)}</strong></button>`
            : "<span></span>"
        }
      </nav>
      <footer class="portal-attribution" aria-label="Portal copyright">
        <span>Note Portal</span>
        <span aria-hidden="true">·</span>
        <span>Markdown reader</span>
        <span aria-hidden="true">·</span>
        <span>Local-first</span>
      </footer>
    </div>`;
}

function renderLibraryHome(options = {}) {
  if (portalData.desktop || portalData.profile === "general") {
    renderDesktopOverview(options);
    return;
  }
  saveScrollPosition();
  cleanupTocTracking();
  setViewMode("home");
  if (!options.preserveUrl && window.location.hash !== "#home") {
    window.location.hash = "home";
  }
  libraryLink.removeAttribute("aria-current");
  readingProgressBar.style.transform = "scaleX(0)";
  closeMobileNavigation();

  const noteLabel = `${flatNotes.length} ${flatNotes.length === 1 ? "note" : "notes"}`;
  const unitLabel = `${activeUnits.length} active ${activeUnits.length === 1 ? "unit" : "units"}`;

  const emptyLibraryMessage = !portalManifestLoadComplete
    ? "Loading your content library…"
    : !portalManifestAvailable
      ? "This framework ships without private content. Add your own manifest and Markdown files in a separate deployment."
      : "This content library does not contain any Markdown documents yet.";

  viewRoot.innerHTML = `
    <div class="library-home-container">
      <header class="library-home-header">
        <h1>选择学期</h1>
        <p>选择一个学期，进入 Unit 与周次导航。</p>
      </header>

      <section class="semester-library" aria-labelledby="semester-library-title">
        <div class="semester-library__header">
          <h2 id="semester-library-title">Available semesters</h2>
          <p>按学期浏览完整复习笔记</p>
        </div>
        ${
          flatNotes.length || portalData.units.length
            ? `<button class="semester-entry" type="button" data-semester-id="${escapeHtml(portalData.id)}">
          <span class="semester-entry__identity">
            <strong>${escapeHtml(portalData.label)}</strong>
            <span>${unitLabel} · ${noteLabel}</span>
          </span>
          <span class="semester-entry__sync">Last synced ${escapeHtml(formatSyncTime(portalData.generatedAt))}</span>
          <span class="semester-entry__action">
            进入学期
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
          </span>
        </button>`
            : `<p class="portal-empty-state" role="status">${escapeHtml(emptyLibraryMessage)}</p>`
        }
      </section>
    </div>`;

  viewRoot.querySelector("[data-semester-id]")?.addEventListener("click", renderOverview);
  window.scrollTo({ top: 0, behavior: "instant" });
}

function renderOverviewNoteList(notes, unit = null) {
  return `
    <ul class="overview-note-list">
      ${notes
        .map((note) => {
          const noteUnit = unit || getUnitForNote(note.id);
          const location = `${noteUnit?.code || "Unit"} · ${formatWeekLabel(note)}`;
          return `
            <li>
              <button class="overview-note-row" type="button" data-note-id="${escapeHtml(note.id)}">
                <span class="overview-note-row__meta">${escapeHtml(location)}</span>
                <span class="overview-note-row__copy">
                  <strong>${escapeHtml(note.title)}</strong>
                  <small>Updated ${escapeHtml(note.updated || "locally")}</small>
                </span>
                <svg class="overview-note-row__chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            </li>`;
        })
        .join("")}
    </ul>`;
}

// Unit toggles intentionally keep the Overview DOM in place. Re-rendering this view makes the
// reading column flash, resets browser focus, and prevents the expandable panel from animating.
function setOverviewExpandableState(toggle, panel, expanded) {
  toggle?.setAttribute("aria-expanded", String(expanded));
  panel?.classList.toggle("is-expanded", expanded);
  panel?.setAttribute("aria-hidden", String(!expanded));
  panel?.toggleAttribute("inert", !expanded);
}

function setOverviewAllNotesExpansion(expanded) {
  state.overviewAllNotesOpen = expanded;
  const toggle = viewRoot.querySelector("[data-overview-all-notes]");
  const panel = viewRoot.querySelector("#overview-all-notes-list");
  setOverviewExpandableState(toggle, panel, expanded);
  const stateLabel = toggle?.querySelector(".overview-all-notes__state");
  if (stateLabel) stateLabel.textContent = expanded ? "收起列表" : "展开列表";
}

function setOverviewUnitExpansion(unitCode, expanded) {
  if (!unitCode) return;
  if (expanded) state.overviewExpandedUnits.add(unitCode);
  else state.overviewExpandedUnits.delete(unitCode);

  const toggle = [...viewRoot.querySelectorAll("[data-overview-unit-code]")]
    .find((button) => button.dataset.overviewUnitCode === unitCode);
  const panel = document.getElementById(`overview-weeks-${unitCode}`);
  setOverviewExpandableState(toggle, panel, expanded);

  const unit = portalData.units.find((item) => item.code === unitCode);
  const noteLabel = `${unit?.weeks.length || 0} ${(unit?.weeks.length || 0) === 1 ? "note" : "notes"}`;
  const stateLabel = toggle?.querySelector(".overview-unit__state");
  if (stateLabel) stateLabel.textContent = `${expanded ? "收起" : "展开"} · ${noteLabel}`;
}

function renderOverview(options = {}) {
  if (portalData.desktop || portalData.profile === "general") {
    renderDesktopOverview(options);
    return;
  }
  saveScrollPosition();
  const scrollTop = options.preserveScroll ? window.scrollY : 0;
  cleanupTocTracking();
  setViewMode("overview");
  if (!options.preserveUrl && window.location.hash !== "#overview") {
    window.location.hash = "overview";
  }
  libraryLink.setAttribute("aria-current", "page");
  readingProgressBar.style.transform = "scaleX(0)";
  renderNavigation();
  closeMobileNavigation();
  if (!portalData.units.length) {
    viewRoot.innerHTML = `
      <div class="overview-container">
        <header class="overview-header">
          <h1>${escapeHtml(portalData.label)}</h1>
          <p class="portal-empty-state" role="status">No units or Markdown documents are configured yet.</p>
        </header>
      </div>`;
    window.scrollTo({ top: options.preserveScroll ? scrollTop : 0, behavior: "instant" });
    return;
  }
  const continueNote = getContinueNote();
  const continueUnit = continueNote ? getUnitForNote(continueNote.id) : null;
  const noteLabel = `${flatNotes.length} ${flatNotes.length === 1 ? "note" : "notes"}`;
  const unitLabel = `${activeUnits.length} active ${activeUnits.length === 1 ? "unit" : "units"}`;

  viewRoot.innerHTML = `
    <div class="overview-container">
      <header class="overview-header">
        <h1>${escapeHtml(portalData.label)}</h1>
        <p class="overview-header__meta">${unitLabel} · ${noteLabel} · Last synced ${escapeHtml(formatSyncTime(portalData.generatedAt))}</p>
        <p>从 Unit 进入每一周的完整复习笔记。新增周次后，导航会按文件结构自动更新。</p>
      </header>
      ${
        continueNote
          ? `<section class="continue-reading" aria-labelledby="continue-reading-title">
              <div class="continue-reading__copy">
                <h2 id="continue-reading-title">Continue reading</h2>
                <p class="continue-reading__title">${escapeHtml(continueNote.title)}</p>
                <p class="continue-reading__meta">${escapeHtml(continueUnit.code)} · ${formatWeekLabel(continueNote)} · Updated ${escapeHtml(continueNote.updated || "locally")}</p>
              </div>
              <button class="continue-reading__action" type="button" data-note-id="${continueNote.id}">
                <span>继续阅读</span>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            </section>`
          : ""
      }
      <div class="overview-list__header">
        <h2>Units</h2>
        <p>展开一个 Unit，选择要阅读的周次</p>
      </div>
      <section class="overview-all-notes" aria-labelledby="overview-all-notes-title">
        <button
          class="overview-all-notes__toggle"
          type="button"
          data-overview-all-notes
          aria-expanded="${String(state.overviewAllNotesOpen)}"
          aria-controls="overview-all-notes-list"
        >
          <span>
            <strong id="overview-all-notes-title">全部笔记</strong>
            <small>${noteLabel} · 按课程与周次浏览</small>
          </span>
          <span class="overview-all-notes__state">${state.overviewAllNotesOpen ? "收起列表" : "展开列表"}</span>
        </button>
        <div
          id="overview-all-notes-list"
          class="overview-all-notes__list${state.overviewAllNotesOpen ? " is-expanded" : ""}"
          aria-hidden="${String(!state.overviewAllNotesOpen)}"
          ${state.overviewAllNotesOpen ? "" : "inert"}
        >
          <div class="overview-expandable__content">
            ${renderOverviewNoteList(flatNotes)}
          </div>
        </div>
      </section>
      <div class="overview-unit-list">
        ${portalData.units
          .map((unit) => {
            const unitNoteLabel = `${unit.weeks.length} ${unit.weeks.length === 1 ? "note" : "notes"}`;
            const expanded = state.overviewExpandedUnits.has(unit.code);
            const weeksId = `overview-weeks-${unit.code}`;
            return `
              <section class="overview-unit">
                <button
                  class="overview-unit__toggle"
                  type="button"
                  data-overview-unit-code="${escapeHtml(unit.code)}"
                  aria-expanded="${String(expanded)}"
                  aria-controls="${escapeHtml(weeksId)}"
                >
                  <span class="overview-unit__summary">
                    <span class="overview-unit__code">${escapeHtml(unit.code)}</span>
                    <span>
                      <strong class="overview-unit__name">${escapeHtml(unit.name)}</strong>
                      <small class="overview-unit__topics">${escapeHtml(unit.topics)}</small>
                    </span>
                  </span>
                  <span class="overview-unit__state">${expanded ? "收起" : "展开"} · ${unitNoteLabel}</span>
                </button>
                <div
                  id="${escapeHtml(weeksId)}"
                  class="overview-unit__notes${expanded ? " is-expanded" : ""}"
                  aria-hidden="${String(!expanded)}"
                  ${expanded ? "" : "inert"}
                >
                  <div class="overview-expandable__content">
                    ${
                      unit.weeks.length
                        ? renderOverviewNoteList(unit.weeks, unit)
                        : '<p class="overview-unit__empty">这个 Unit 的第一份笔记还在准备中。</p>'
                    }
                  </div>
                </div>
              </section>`;
          })
          .join("")}
      </div>
    </div>`;

  viewRoot.querySelectorAll("[data-note-id]").forEach((button) => {
    button.addEventListener("click", () => openNote(button.dataset.noteId));
  });
  viewRoot.querySelector("[data-overview-all-notes]")?.addEventListener("click", () => {
    setOverviewAllNotesExpansion(!state.overviewAllNotesOpen);
  });
  viewRoot.querySelectorAll("[data-overview-unit-code]").forEach((button) => {
    button.addEventListener("click", () => {
      const code = button.dataset.overviewUnitCode;
      if (!code) return;
      setOverviewUnitExpansion(code, !state.overviewExpandedUnits.has(code));
    });
  });
  window.scrollTo({ top: options.preserveScroll ? scrollTop : 0, behavior: "instant" });
}

function renderDesktopOverview(options = {}) {
  saveScrollPosition();
  cleanupTocTracking();
  const scrollTop = options.preserveScroll ? window.scrollY : 0;
  setViewMode("overview");
  if (!options.preserveUrl && window.location.hash !== "#overview") window.location.hash = "overview";
  libraryLink.setAttribute("aria-current", "page");
  readingProgressBar.style.transform = "scaleX(0)";
  renderNavigation();
  closeMobileNavigation();
  viewRoot.innerHTML = `<div class="overview-container general-overview">
    <header class="overview-header"><h1>${escapeHtml(portalData.label)}</h1>
      <p class="overview-header__meta">${flatNotes.length} documents · Last synced ${escapeHtml(formatSyncTime(portalData.generatedAt))}</p>
      <p>${portalData.profile === "study" ? "按学期、Unit 与 Week 浏览 Markdown 主笔记。" : "按原有文件夹浏览 Markdown。"}外部工具保存文件后，目录与当前文档会自动更新。</p>
    </header>
    ${flatNotes.length ? `<section class="general-overview__tree" aria-label="文件夹与文档">${generalTreeHtml(portalData.tree || [])}</section>`
      : '<p class="portal-empty-state" role="status">这个资料库还没有可阅读的 Markdown 文档。</p>'}
  </div>`;
  viewRoot.querySelectorAll("[data-note-id]").forEach((button) => {
    button.addEventListener("click", () => openNote(button.dataset.noteId));
  });
  window.scrollTo({ top: scrollTop, behavior: "instant" });
}

function buildTableOfContents() {
  cleanupTocTracking();
  const headings = [...viewRoot.querySelectorAll(".article h1, .article h2, .article h3")];
  const baseHeadingLevel = headings.length
    ? Math.min(...headings.map((heading) => Number(heading.tagName.slice(1))))
    : 1;
  tocNavigation.innerHTML = headings
    .map(
      (heading) => {
        const headingLevel = Number(heading.tagName.slice(1));
        const relativeLevel = Math.min(headingLevel - baseHeadingLevel, 2);
        return `<a class="toc-link toc-link--level-${relativeLevel}" href="#${heading.id}" data-heading-id="${heading.id}">${escapeHtml(heading.textContent)}</a>`;
      },
    )
    .join("");

  if (!headings.length) return;

  const links = new Map(
    [...tocNavigation.querySelectorAll("[data-heading-id]")].map((link) => [link.dataset.headingId, link]),
  );
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let activeHeadingId = "";

  function keepActiveLinkInReadingBand(link) {
    if (getComputedStyle(tocPanel).display === "none") return;
    const navigationRect = tocNavigation.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const linkCenter = linkRect.top + linkRect.height / 2;
    const readingBandTop = navigationRect.top + navigationRect.height * 0.18;
    const readingBandBottom = navigationRect.top + navigationRect.height * 0.48;

    // Let nearby headings remain still, but follow the reading position before it
    // reaches the edge of the navigation. The target line sits in the upper
    // middle so the current section remains easy to find without hiding what follows.
    if (linkCenter >= readingBandTop && linkCenter <= readingBandBottom) return;

    const targetLine = navigationRect.top + navigationRect.height * 0.32;
    const maxScrollTop = Math.max(0, tocNavigation.scrollHeight - tocNavigation.clientHeight);
    const targetScrollTop = Math.min(
      maxScrollTop,
      Math.max(0, tocNavigation.scrollTop + linkCenter - targetLine),
    );

    tocNavigation.scrollTo({
      top: targetScrollTop,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  function setActiveHeading(headingId, follow = true) {
    if (!headingId || headingId === activeHeadingId) return;
    links.forEach((link) => link.removeAttribute("aria-current"));
    const activeLink = links.get(headingId);
    if (!activeLink) return;
    activeLink.setAttribute("aria-current", "location");
    activeHeadingId = headingId;
    if (follow) keepActiveLinkInReadingBand(activeLink);
  }

  function updateActiveHeading() {
    tocScrollFrame = 0;
    const headerOffset = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--header-height"),
    );
    const readingLine = headerOffset + 92;
    let activeHeading = headings[0];

    for (const heading of headings) {
      if (heading.getBoundingClientRect().top > readingLine) break;
      activeHeading = heading;
    }

    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      activeHeading = headings.at(-1);
    }
    setActiveHeading(activeHeading.id);
    const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollRange > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollRange)) : 0;
    readingProgressBar.style.transform = `scaleX(${progress})`;
  }

  function scheduleActiveHeadingUpdate() {
    if (tocScrollFrame) return;
    tocScrollFrame = requestAnimationFrame(updateActiveHeading);
  }

  links.forEach((link, headingId) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setActiveHeading(headingId);
      const targetHeading = document.getElementById(headingId);
      const compact = isCompactNavigation();
      if (compact) closeTocNavigation();
      targetHeading?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
      if (compact && targetHeading) {
        targetHeading.setAttribute("tabindex", "-1");
        targetHeading.focus({ preventScroll: true });
      }
    });
  });

  window.addEventListener("scroll", scheduleActiveHeadingUpdate, { passive: true });
  window.addEventListener("resize", scheduleActiveHeadingUpdate);
  cleanupTocTracking = () => {
    window.removeEventListener("scroll", scheduleActiveHeadingUpdate);
    window.removeEventListener("resize", scheduleActiveHeadingUpdate);
    if (tocScrollFrame) cancelAnimationFrame(tocScrollFrame);
    tocScrollFrame = 0;
    cleanupTocTracking = () => {};
  };
  updateActiveHeading();
}

function isCompactNavigation() {
  return window.matchMedia("(max-width: 1180px)").matches;
}

function cancelSidebarAutoCollapse() {
  if (!sidebarAutoCollapseTimer) return;
  window.clearTimeout(sidebarAutoCollapseTimer);
  sidebarAutoCollapseTimer = 0;
}

function hasKeyboardFocusInSidebar() {
  return (
    sidebarInteractionMode === "keyboard" &&
    (Boolean(sidebar.querySelector(":focus-visible")) || sidebarEdgeToggle.matches(":focus-visible"))
  );
}

function canAutoCollapseSidebar() {
  return (
    !isCompactNavigation() &&
    state.view !== "home" &&
    !state.immersionMode &&
    !state.sidebarCollapsed &&
    !sidebar.matches(":hover") &&
    !sidebarEdgeToggle.matches(":hover") &&
    !hasKeyboardFocusInSidebar()
  );
}

function scheduleSidebarAutoCollapse() {
  cancelSidebarAutoCollapse();
  if (!canAutoCollapseSidebar()) return;

  sidebarAutoCollapseTimer = window.setTimeout(() => {
    sidebarAutoCollapseTimer = 0;
    if (!canAutoCollapseSidebar()) return;
    // The grid width changes over the full sidebar transition. Capture at the
    // instant of automatic collapse and keep correcting through its end.
    const readingAnchor = captureReadingAnchor() || stableReadingAnchor;
    cleanupReadingAnchorRestore();
    state.sidebarCollapsed = true;
    updateNavigationToggle();
    restoreReadingAnchor(readingAnchor, { settleDuration: SIDEBAR_LAYOUT_SETTLE_MS });
  }, SIDEBAR_AUTO_COLLAPSE_DELAY);
}

function updateDrawerAccessibility() {
  const compact = isCompactNavigation();
  const immersiveSidebarInactive = !compact && isImmersionActive() && state.immersiveSidebarCollapsed;
  const sidebarInactive = (compact && !document.body.classList.contains("nav-open")) || immersiveSidebarInactive;
  const immersiveTocInactive = !compact && isImmersionActive() && state.immersiveTocCollapsed;
  const tocInactive = (compact && !document.body.classList.contains("toc-open")) || immersiveTocInactive;
  const focusWasInSidebar = sidebarInactive && (
    sidebar.contains(document.activeElement) || document.activeElement === sidebarEdgeToggle
  );
  const focusWasInToc = tocInactive && tocPanel.contains(document.activeElement);

  sidebar.toggleAttribute("inert", sidebarInactive);
  tocPanel.toggleAttribute("inert", tocInactive);
  if (sidebarInactive) sidebar.setAttribute("aria-hidden", "true");
  else sidebar.removeAttribute("aria-hidden");
  if (tocInactive) tocPanel.setAttribute("aria-hidden", "true");
  else tocPanel.removeAttribute("aria-hidden");
  sidebarEdgeToggle.removeAttribute("aria-hidden");
  sidebarEdgeToggle.removeAttribute("tabindex");

  if (focusWasInToc) tocToggle.focus({ preventScroll: true });
  if (focusWasInSidebar) {
    (!compact && isImmersionActive() ? sidebarEdgeToggle : navToggle).focus({ preventScroll: true });
  }
}

function openMobileNavigation() {
  cancelSidebarAutoCollapse();
  closeTocNavigation();
  document.body.classList.add("nav-open");
  navToggle.setAttribute("aria-expanded", "true");
  updateDrawerAccessibility();
  navClose.focus();
}

function setUtilityTab(tab, options = {}) {
  const availableTabs = ASSISTANT_UI_ENABLED ? ["toc", "assistant"] : ["toc"];
  const nextTab = availableTabs.includes(tab) ? tab : "toc";
  if (!isCompactNavigation() && isImmersionActive() && state.immersiveTocCollapsed) {
    setImmersiveTocCollapsed(false);
  }
  state.utilityTab = nextTab;
  const showingToc = nextTab === "toc";
  const showingPreferences = nextTab === "preferences";
  const showingAssistant = nextTab === "assistant";
  tocTab.setAttribute("aria-selected", String(showingToc));
  preferencesTab.setAttribute("aria-selected", String(showingPreferences));
  assistantTab.setAttribute("aria-selected", String(showingAssistant));
  tocView.hidden = !showingToc;
  preferencesView.hidden = !showingPreferences;
  assistantView.hidden = !showingAssistant;
  const panelLabel = showingAssistant ? "问笔记" : showingPreferences ? "阅读外观" : "本页目录";
  tocPanel.setAttribute("aria-label", panelLabel);
  tocClose.setAttribute("aria-label", `关闭${panelLabel}`);
  if (showingAssistant) refreshAssistantStatus();
  if (options.focus) (showingAssistant ? assistantTab : showingPreferences ? preferencesTab : tocTab).focus();
}

function openUtilityPanel(tab = "toc", trigger = null) {
  if (!isCompactNavigation() || state.view !== "note") return;
  closeMobileNavigation();
  setUtilityTab(tab);
  const showingAssistant = state.utilityTab === "assistant";
  const showingPreferences = state.utilityTab === "preferences";
  lastUtilityTrigger = trigger || (showingAssistant ? assistantToggle : tocToggle);
  document.body.classList.add("toc-open");
  tocToggle.setAttribute("aria-expanded", String(!showingAssistant));
  assistantToggle.setAttribute("aria-expanded", String(showingAssistant));
  tocToggle.setAttribute(
    "aria-label",
    showingAssistant ? "打开本页目录" : showingPreferences ? "关闭阅读外观" : "关闭本页目录",
  );
  assistantToggle.setAttribute("aria-label", showingAssistant ? "关闭问笔记" : "打开问笔记");
  updateDrawerAccessibility();
  tocClose.focus();
}

function openTocNavigation() {
  if (!isCompactNavigation() && isImmersionActive()) {
    setUtilityTab("toc");
    setImmersiveTocCollapsed(false);
    tocClose.focus({ preventScroll: true });
    return;
  }
  openUtilityPanel("toc", tocToggle);
}

function openAssistantPanel() {
  if (!ASSISTANT_UI_ENABLED) return;
  openUtilityPanel("assistant", assistantToggle);
}

function closeTocNavigation(restoreFocus = false) {
  if (!isCompactNavigation() && isImmersionActive()) {
    setImmersiveTocCollapsed(true);
    return;
  }
  const wasOpen = document.body.classList.contains("toc-open");
  document.body.classList.remove("toc-open");
  tocToggle.setAttribute("aria-expanded", "false");
  assistantToggle.setAttribute("aria-expanded", "false");
  tocToggle.setAttribute("aria-label", "打开本页目录");
  assistantToggle.setAttribute("aria-label", "打开问笔记");
  updateDrawerAccessibility();
  if (restoreFocus && wasOpen) lastUtilityTrigger?.focus();
}

function captureReadingAnchor() {
  if (state.view !== "note") return null;

  const article = viewRoot.querySelector(".article");
  const main = document.querySelector(".main");
  if (!article || !main) return null;

  const mainRect = main.getBoundingClientRect();
  const anchorX = Math.min(mainRect.right - 48, Math.max(mainRect.left + 48, mainRect.left + mainRect.width * 0.52));
  const anchorYs = [0.42, 0.56, 0.68, 0.3].map((ratio) =>
    Math.min(window.innerHeight - 120, Math.max(180, window.innerHeight * ratio)),
  );

  for (const anchorY of anchorYs) {
    const textAnchor = document.caretPositionFromPoint?.(anchorX, anchorY);
    const legacyTextAnchor = textAnchor ? null : document.caretRangeFromPoint?.(anchorX, anchorY);
    const node = textAnchor?.offsetNode || legacyTextAnchor?.startContainer;
    const offset = textAnchor?.offset ?? legacyTextAnchor?.startOffset;
    const nodeElement = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;

    if (node && Number.isInteger(offset) && nodeElement?.closest(".article") === article) {
      const range = document.createRange();
      const maximumOffset = node.nodeType === Node.TEXT_NODE ? node.textContent.length : node.childNodes.length;
      const startOffset = Math.max(0, Math.min(offset, maximumOffset));
      const endOffset = Math.min(maximumOffset, startOffset + 1);
      range.setStart(node, startOffset);
      range.setEnd(node, endOffset);
      const rangeRect = range.getBoundingClientRect();
      if (rangeRect.height) return { range, top: rangeRect.top };
    }

    const element = document
      .elementsFromPoint(anchorX, anchorY)
      .map((item) => item.closest?.("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, table, figure"))
      .find((item) => item?.closest(".article") === article);
    if (element) return { element, top: element.getBoundingClientRect().top };
  }

  return null;
}

function scheduleStableReadingAnchorCapture() {
  if (readingAnchorSnapshotFrame) return;
  readingAnchorSnapshotFrame = requestAnimationFrame(() => {
    readingAnchorSnapshotFrame = 0;
    stableReadingAnchor = captureReadingAnchor();
  });
}

function restoreReadingAnchor(anchor, options = {}) {
  if (!anchor) return;
  cleanupReadingAnchorRestore();

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const requestedSettleDuration = Number(options.settleDuration);
  const settleDuration = Number.isFinite(requestedSettleDuration)
    ? Math.max(34, requestedSettleDuration)
    : 420;
  const deadline = performance.now() + (reduceMotion ? 34 : settleDuration);
  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;
  const previousOverflowAnchor = root.style.overflowAnchor;
  root.style.scrollBehavior = "auto";
  root.style.overflowAnchor = "none";
  const getAnchorTop = () => {
    if (anchor.range?.commonAncestorContainer && !anchor.range.commonAncestorContainer.isConnected) return NaN;
    if (anchor.element && !anchor.element.isConnected) return NaN;
    return anchor.range?.getBoundingClientRect().top ?? anchor.element?.getBoundingClientRect().top;
  };
  const correctPosition = () => {
    const currentTop = getAnchorTop();
    if (!Number.isFinite(currentTop)) return;
    const offset = currentTop - anchor.top;
    if (Math.abs(offset) > 0.25) window.scrollBy(0, offset);
  };
  const settle = () => {
    correctPosition();
    readingAnchorFrame = 0;
    root.style.scrollBehavior = previousScrollBehavior;
    root.style.overflowAnchor = previousOverflowAnchor;
    cleanupReadingAnchorRestore = () => {};
  };
  const followLayout = (now) => {
    correctPosition();
    if (now < deadline) {
      readingAnchorFrame = requestAnimationFrame(followLayout);
    } else {
      readingAnchorFrame = requestAnimationFrame(settle);
    }
  };

  readingAnchorFrame = requestAnimationFrame(followLayout);
  cleanupReadingAnchorRestore = () => {
    if (readingAnchorFrame) cancelAnimationFrame(readingAnchorFrame);
    readingAnchorFrame = 0;
    root.style.scrollBehavior = previousScrollBehavior;
    root.style.overflowAnchor = previousOverflowAnchor;
    cleanupReadingAnchorRestore = () => {};
  };
}

function updateNavigationToggle() {
  syncImmersionPresentation();
  const desktop = !isCompactNavigation();
  const collapsed = desktop && (isImmersionActive() ? state.immersiveSidebarCollapsed : state.sidebarCollapsed);
  if (desktop) {
    document.body.classList.remove("nav-open", "toc-open");
    tocToggle.setAttribute("aria-expanded", "false");
    assistantToggle.setAttribute("aria-expanded", "false");
    tocToggle.setAttribute("aria-label", "打开本页目录");
    assistantToggle.setAttribute("aria-label", "打开问笔记");
  } else {
    cancelSidebarAutoCollapse();
  }
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  navToggle.setAttribute("aria-expanded", String(desktop ? !collapsed : document.body.classList.contains("nav-open")));
  navToggle.setAttribute("aria-label", desktop ? (collapsed ? "展开课程导航" : "收起课程导航") : "打开课程导航");
  sidebarEdgeToggle.setAttribute("aria-expanded", String(!collapsed));
  sidebarEdgeToggle.setAttribute("aria-label", collapsed ? "展开课程导航" : "收起课程导航");
  updateDrawerAccessibility();
  updateImmersionControls();
}

function togglePrimaryNavigation() {
  if (!isCompactNavigation()) {
    const readingAnchor = captureReadingAnchor();
    cleanupReadingAnchorRestore();
    cancelSidebarAutoCollapse();
    if (isImmersionActive()) state.immersiveSidebarCollapsed = !state.immersiveSidebarCollapsed;
    else state.sidebarCollapsed = !state.sidebarCollapsed;
    updateNavigationToggle();
    restoreReadingAnchor(readingAnchor);
    if (!isImmersionActive() && !state.sidebarCollapsed) requestAnimationFrame(scheduleSidebarAutoCollapse);
    return;
  }
  openMobileNavigation();
}

function closeMobileNavigation(restoreFocus = false) {
  const wasOpen = document.body.classList.contains("nav-open");
  document.body.classList.remove("nav-open");
  navToggle.setAttribute("aria-expanded", "false");
  updateDrawerAccessibility();
  if (restoreFocus && wasOpen) navToggle.focus();
}

/* ---------------- Optional local assistant interface ---------------- */

function setAssistantScope(scope) {
  const supported = new Set(["section", "week", "unit", "all"]);
  state.assistantScope = supported.has(scope) ? scope : "section";
  if (assistantScopeSelect) assistantScopeSelect.value = state.assistantScope;
}

function isIndependentGeminiBackend(backend = state.assistantBackend) {
  return backend === "gemini_flash";
}

function isCloudAssistantBackend(backend = state.assistantBackend) {
  return backend === "gemini_flash" || backend === "deepseek_v4_flash";
}

function applyAssistantBackendPresentation() {
  const independent = isIndependentGeminiBackend();
  const cloud = isCloudAssistantBackend();
  const controlsDisabled = assistantRemoteDisabled || assistantMasterDisabled || assistantCloudBackendDisabled;
  if (assistantBackend) assistantBackend.value = state.assistantBackend;
  if (assistantScopeControl) assistantScopeControl.hidden = independent;
  if (assistantScopeSelect) assistantScopeSelect.disabled = controlsDisabled || independent;
  if (assistantAdvancedSettings) assistantAdvancedSettings.hidden = cloud;
  assistantReplyLength.disabled = controlsDisabled || cloud;
  assistantReasoningMode.disabled = controlsDisabled || cloud;
  if (assistantReasoningSetting) assistantReasoningSetting.hidden = cloud;
}

function getAssistantSectionAnchor() {
  const selectedAnchor = String(assistantSelection?.sectionAnchor || "").trim();
  if (selectedAnchor) return selectedAnchor;
  const activeTocLink = tocNavigation.querySelector("[aria-current='location']");
  const activeAnchor = String(activeTocLink?.dataset.headingId || "").trim();
  if (activeAnchor) return activeAnchor;
  const article = viewRoot.querySelector("#markdown-article");
  return article?.querySelector("h1, h2, h3, h4, h5, h6, .article-top-anchor")?.id || "note-top";
}

function updateAssistantContextMeta(payload = {}) {
  if (isCloudAssistantBackend()) {
    assistantContextWindow = 0;
    assistantContextMeta.textContent = "云端输出不设 Portal 长度上限，由模型与账户配额决定。";
    assistantContextMeta.title = "不会继承本地 Qwen 的上下文或回答长度设置。";
    return;
  }
  const reportedContextWindow = Number(payload.contextWindow ?? payload.contextTokens);
  if (Number.isFinite(reportedContextWindow) && reportedContextWindow > 0) {
    assistantContextWindow = reportedContextWindow;
  }
  const contextWindow = assistantContextWindow;
  const replyTokenBudget = [
    Number(payload.replyTokenBudget),
    Number(payload.configuredReplyTokenBudget),
    Number(state.assistantReplyTokenBudget),
  ].find((value) => Number.isFinite(value) && value > 0);
  const totalTokens = Number(payload.totalTokens);
  const plannedTokens = Number(payload.plannedTokens);
  const promptTokens = Number(payload.promptTokens);
  const inputTokens = Number(payload.inputTokens);
  const usedTokens = Number.isFinite(totalTokens) && totalTokens > 0
    ? totalTokens
    : (Number.isFinite(plannedTokens) && plannedTokens > 0
      ? plannedTokens
      : (Number.isFinite(promptTokens) && promptTokens > 0 ? promptTokens : inputTokens));
  const historyTurns = Math.max(0, Number(payload.historyTurns) || 0);
  const estimated = payload.tokenUsage !== "actual";
  if (Number.isFinite(contextWindow) && contextWindow > 0) {
    const contextText = new Intl.NumberFormat("en-AU").format(contextWindow);
    const usedText = Number.isFinite(usedTokens) && usedTokens > 0
      ? `${estimated ? "约 " : "已用 "}${new Intl.NumberFormat("en-AU").format(usedTokens)} / ${contextText}`
      : `窗口 ${contextText}`;
    const historyText = historyTurns > 0 ? `历史 ${historyTurns} 轮` : "连续对话";
    const truncationText = payload.historyTruncated ? "历史已压缩" : "";
    const outputText = Number.isFinite(replyTokenBudget)
      ? `输出≤${new Intl.NumberFormat("en-AU").format(replyTokenBudget)}`
      : "输出跟随 App";
    const label = [usedText, historyText, outputText, truncationText]
      .filter(Boolean)
      .join(" · ");
    assistantContextMeta.textContent = label;
    const details = [
      label,
      Number.isFinite(Number(payload.systemTokens)) ? `系统 ${payload.systemTokens}` : "",
      Number.isFinite(Number(payload.conversationTokens)) ? `历史 ${payload.conversationTokens}` : "",
      Number.isFinite(Number(payload.retrievalTokens)) ? `笔记依据 ${payload.retrievalTokens}` : "",
      estimated ? "token 为预算估计；生成结束后会显示模型报告的实际用量。" : "token 用量来自本轮模型响应。",
    ].filter(Boolean).join(" · ");
    assistantContextMeta.title = details;
    return;
  }
  assistantContextMeta.textContent = "连续对话上下文读取中…";
  assistantContextMeta.removeAttribute("title");
}

function setAssistantReplyTokenBudget(value) {
  if (value === "") {
    state.assistantReplyTokenBudget = null;
    assistantReplyLength.value = "";
    updateAssistantContextMeta();
    return;
  }
  const nextBudget = Number(value);
  if (!Number.isInteger(nextBudget) || nextBudget < 64 || nextBudget > 8192) return;
  state.assistantReplyTokenBudget = nextBudget;
  assistantReplyLength.value = String(nextBudget);
  updateAssistantContextMeta();
}

function setAssistantStatus(payload = {}) {
  const statusState = payload.state || (payload.ready ? "ready" : "unavailable");
  assistantRemoteDisabled = statusState === "remote_disabled";
  assistantCloudBackendDisabled = statusState === "cloud_disabled" || payload.cloudEnabled === false;
  assistantPausedForRag = statusState === "paused_for_rag";
  // The host owns the master switch. A browser may report its state but must not
  // revive a generator that its owner deliberately unloaded.
  assistantMasterDisabled = payload.enabled === false
    || statusState === "stopping"
    || /^Local AI is off\./i.test(String(payload.message || ""));
  assistantReady = Boolean(payload.ready) && !assistantRemoteDisabled && !assistantMasterDisabled && !assistantCloudBackendDisabled;
  assistantStatus.dataset.state = statusState;
  assistantModelLabel.dataset.state = statusState;
  updateAssistantContextMeta(payload);

  const labels = {
    ready: "可用",
    starting: "启动中",
    checking: "检查中",
    unavailable: "暂不可用",
    not_configured: "未配置",
    cloud_disabled: "已关闭",
    remote_disabled: "不可用",
    paused_for_rag: "索引中",
    stopped: assistantMasterDisabled ? "已关闭" : "未加载",
  };
  assistantStatusLabel.textContent = labels[statusState] || labels.unavailable;
  updateAssistantModelLabel(payload, statusState);
  const configuredMode = String(payload.configuredReasoningMode || "").toLowerCase();
  if (!state.assistantReasoningMode && (configuredMode === "thinking" || configuredMode === "non_thinking")) {
    assistantReasoningMode.value = "";
    assistantReasoningMode.title = configuredMode === "thinking"
      ? "当前跟随 App：深入推理（私有推理不会显示）"
      : "当前跟随 App：快速回答";
  }
  assistantSend.disabled = !assistantReady || Boolean(assistantRequestController);

  const showRecovery = !assistantReady && statusState !== "checking";
  assistantRecovery.hidden = !showRecovery;
  assistantRetry.hidden = assistantRemoteDisabled || assistantMasterDisabled || assistantCloudBackendDisabled;
  assistantRetry.disabled = statusState === "starting";
  assistantRetry.textContent = statusState === "starting"
    ? "正在启动…"
    : (assistantPausedForRag ? "暂停索引并恢复 AI" : "重新启动模型");
  assistantRecoveryMessage.textContent = assistantRemoteDisabled
    ? "本地 AI 仅在私有主机中可用；此浏览器仍可阅读与搜索已配置的内容。"
    : (assistantCloudBackendDisabled
      ? (payload.message || "云端模型已关闭；笔记阅读与搜索不受影响。")
    : (assistantMasterDisabled
      ? "Local AI 已由主机关闭。请在私有部署中重新开启；浏览器阅读与搜索不受影响。"
    : (assistantPausedForRag
      ? "内容正在更新语义索引，Local AI 临时暂停以释放模型内存；阅读和普通搜索不受影响。可等待自动恢复，或立即暂停索引并恢复 AI。"
    : (payload.message || (
    statusState === "starting"
      ? "已配置的本地模型正在载入；内容阅读与搜索保持可用。"
      : "AI 服务暂时无法启动，笔记阅读与搜索不受影响。"
    )))));
  const assistantControlsDisabled = assistantRemoteDisabled || assistantMasterDisabled || assistantCloudBackendDisabled;
  assistantInput.disabled = assistantControlsDisabled;
  assistantReplyLength.disabled = assistantControlsDisabled || isCloudAssistantBackend();
  assistantReasoningMode.disabled = assistantControlsDisabled || isCloudAssistantBackend();
  if (assistantScopeSelect) assistantScopeSelect.disabled = assistantControlsDisabled;
  assistantClear.disabled = assistantControlsDisabled;
  const emptyTitle = assistantEmpty.querySelector("h3");
  if (isIndependentGeminiBackend() && !assistantRemoteDisabled) {
    if (emptyTitle) emptyTitle.textContent = "开始提问";
  } else if (assistantRemoteDisabled) {
    if (emptyTitle) emptyTitle.textContent = "AI 暂不可用";
  } else if (assistantMasterDisabled) {
    if (emptyTitle) emptyTitle.textContent = "Local AI 已关闭";
  } else if (assistantCloudBackendDisabled) {
    if (emptyTitle) emptyTitle.textContent = "云端模型已关闭";
  } else if (assistantPausedForRag) {
    if (emptyTitle) emptyTitle.textContent = "正在更新笔记语义索引";
  } else {
    if (emptyTitle) emptyTitle.textContent = "开始提问";
  }

  applyAssistantBackendPresentation();

  window.clearTimeout(assistantStatusTimer);
  if (statusState === "starting") {
    assistantStatusTimer = window.setTimeout(refreshAssistantStatus, 1800);
  }
}

function updateAssistantModelLabel(payload, statusState) {
  const modelId = String(payload.modelId || "").trim();
  const backend = String(payload.backend || "").trim();
  const contextTokens = Number(payload.contextTokens);
  let label = isIndependentGeminiBackend() ? "Gemini 云端对话" : "AI 未就绪";
  if (statusState === "remote_disabled") {
    label = "仅私有主机中的本地 AI 可用";
  } else if (assistantCloudBackendDisabled) {
    label = "云端模型已在 App 关闭";
  } else if (assistantMasterDisabled) {
    label = "Local AI 已由主机关闭";
  } else if (assistantPausedForRag) {
    label = "内容索引更新中，AI 暂停";
  } else if (statusState === "starting") {
    label = "本地模型启动中…";
  } else if (modelId) {
    const context = Number.isFinite(contextTokens) && contextTokens > 0
      ? ` · ${new Intl.NumberFormat("en-AU").format(contextTokens)} ctx`
      : "";
    label = isIndependentGeminiBackend()
      ? `${modelId} · 独立云端对话 · 可发送手动选中正文`
      : (state.assistantBackend === "deepseek_v4_flash"
        ? `${modelId} · Portal RAG`
        : `本地 ${modelId}${backend ? ` · ${backend}` : " · 后端待报告"}${context}`);
  }
  assistantModelLabelText.textContent = label;
  assistantModelLabel.title = payload.message || label;
}

async function refreshAssistantStatus() {
  if (!ASSISTANT_UI_ENABLED || state.view !== "note") return;
  try {
    const response = await fetch(`/api/assistant/status?backend=${encodeURIComponent(state.assistantBackend)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 403 && (payload.error === "assistant_loopback_only" || payload.error === "assistant_private_network_only")) {
      setAssistantStatus({
        state: "remote_disabled",
        ready: false,
        message: payload.message,
      });
      return;
    }
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    setAssistantStatus(payload);
  } catch (error) {
    setAssistantStatus({
      state: "unavailable",
      ready: false,
      message: "AI 状态接口暂时不可用；笔记本体仍可正常阅读。",
    });
  }
}

async function retryAssistantModel() {
  if (assistantRemoteDisabled || assistantMasterDisabled || assistantCloudBackendDisabled) return;
  setAssistantStatus({
    state: "starting",
    ready: false,
    message: assistantPausedForRag
      ? "正在暂停索引更新并恢复本地模型…"
      : "正在请求本地服务器重新启动模型…",
  });
  try {
    const response = await fetch("/api/assistant/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    if (payload.state === "paused_for_rag") {
      // The native service accepts the hand-off before its serial model executor has observed
      // it. Keep polling rather than presenting the stale pre-handoff snapshot as a rejection.
      setAssistantStatus({
        state: "starting",
        ready: false,
        message: "正在暂停索引更新并恢复本地模型…",
      });
    } else {
      setAssistantStatus(payload);
    }
  } catch (error) {
    setAssistantStatus({
      state: "unavailable",
      ready: false,
      message: error.message || "模型启动失败，请稍后重试。",
    });
  }
}

function clearAssistantConversation() {
  if (assistantRemoteDisabled || assistantMasterDisabled || assistantCloudBackendDisabled) return;
  const previousConversationId = assistantConversationId;
  stopAssistantGeneration();
  assistantRequestController = null;
  assistantConversationHistory = [];
  assistantConversationSequence = 0;
  assistantConversationId = replaceAssistantConversationId();
  setAssistantSessionNotice("已开始新的本地会话；正在确认旧会话清理…");
  void clearAssistantServerConversation(previousConversationId).then((cleared) => {
    setAssistantSessionNotice(
      cleared
        ? "已清空当前本地会话与服务端上下文。"
        : "已开始新的本地会话；旧服务端会话清理未确认，不会被新会话引用。",
    );
  });
  assistantMessages.querySelectorAll(".assistant-turn").forEach((turn) => turn.remove());
  assistantEmpty.hidden = false;
  assistantStop.hidden = true;
  assistantSend.disabled = !assistantReady;
  updateAssistantContextMeta({
    contextWindow: assistantContextWindow,
    replyTokenBudget: state.assistantReplyTokenBudget,
    conversationMode: "contextual",
    historyTurns: 0,
  });
}

async function clearAssistantServerConversation(conversationId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(conversationId || "")) return false;
  try {
    const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(conversationId)}/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      keepalive: true,
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok && payload.cleared === true;
  } catch (error) {
    return false;
  }
}

function setAssistantSessionNotice(message = "") {
  assistantSessionNotice.textContent = String(message || "");
  assistantSessionNotice.hidden = !message;
}

function stopAssistantGeneration() {
  const controller = assistantRequestController;
  if (!controller) return;
  const activeElements = activeAssistantAnswerElements;
  assistantStop.disabled = true;
  assistantStop.textContent = "正在停止…";
  const conversationId = assistantConversationId;
  void requestAssistantServerCancellation(conversationId).then((cancelled) => {
    // The response turn can already be gone after a new clear/session. Only update the current
    // visible notice when the same conversation still owns the request.
    if (assistantConversationId !== conversationId) return;
    if (cancelled) {
      setAssistantSessionNotice("已确认停止本地模型生成。已收到的内容会保留。");
      if (activeElements?.turn?.isConnected) {
        activeElements.warning.textContent = "已确认停止本地模型生成；已收到的内容会保留。";
      }
    }
  });
  controller.abort();
}

async function requestAssistantServerCancellation(conversationId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(conversationId || "")) return false;
  try {
    const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(conversationId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      keepalive: true,
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok && payload.cancelled === true;
  } catch (error) {
    return false;
  }
}

function buildAssistantScopePayload() {
  const note = getActiveNote();
  const unit = note ? getUnitForNote(note.id) : null;
  if (!note || !unit) return {};
  switch (state.assistantScope) {
    case "section":
      return {
        unitCode: unit.code,
        weekLabel: formatWeekLabel(note),
        noteId: note.id,
        sectionAnchor: getAssistantSectionAnchor(),
      };
    case "week":
      return {
        unitCode: unit.code,
        weekLabel: formatWeekLabel(note),
      };
    case "unit":
      return { unitCode: unit.code };
    case "all":
      return {};
    default:
      return {
        unitCode: unit.code,
        weekLabel: formatWeekLabel(note),
        noteId: note.id,
        sectionAnchor: getAssistantSectionAnchor(),
      };
  }
}

function truncateAssistantHistoryText(value, maximumLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maximumLength ? `${text.slice(0, maximumLength - 1).trim()}…` : text;
}

function buildAssistantHistoryPayload() {
  return assistantConversationHistory.slice(-3).map((turn) => ({
    turnId: turn.turnId,
    question: truncateAssistantHistoryText(turn.question, 520),
    answer: truncateAssistantHistoryText(turn.answer, 1400),
    selection: turn.selection ? {
      kind: turn.selection.kind,
      text: truncateAssistantHistoryText(turn.selection.text, 520),
    } : undefined,
    sources: turn.sources.map(({ noteId, anchor, heading }) => ({ noteId, anchor, heading })),
  }));
}

function rememberAssistantTurn(question, answer, sources, selection = null) {
  const sourceReferences = sources
    .map(({ noteId, anchor, heading }) => ({
      noteId: String(noteId || ""),
      anchor: String(anchor || ""),
      heading: String(heading || ""),
    }))
    .filter((source) => source.noteId);
  assistantConversationHistory.push({
    turnId: `turn-${++assistantConversationSequence}`,
    question: String(question || ""),
    answer: String(answer || ""),
    selection: selection ? { kind: selection.kind, text: String(selection.text || "") } : null,
    sources: sourceReferences,
  });
  if (assistantConversationHistory.length > 3) assistantConversationHistory.shift();
}

function scrollAssistantToLatest() {
  requestAnimationFrame(() => {
    assistantMessages.scrollTop = assistantMessages.scrollHeight;
  });
}

function appendUserQuestion(question, selection = null) {
  assistantEmpty.hidden = true;
  const turn = document.createElement("article");
  turn.className = "assistant-turn assistant-turn--user";
  const label = document.createElement("p");
  label.className = "assistant-turn__label";
  label.textContent = "你";
  if (selection) {
    const reference = document.createElement("div");
    reference.className = "assistant-user-reference";
    const referenceLabel = document.createElement("span");
    referenceLabel.className = "assistant-user-reference__label";
    referenceLabel.textContent = selection.kind === "formula" ? "引用公式" : "引用正文";
    const referenceText = document.createElement("p");
    referenceText.textContent = selection.text;
    reference.append(referenceLabel, referenceText);
    turn.append(label, reference);
  } else {
    turn.append(label);
  }
  const content = document.createElement("p");
  content.className = "assistant-user-question";
  content.textContent = question;
  turn.append(content);
  assistantMessages.append(turn);
}

function createAssistantAnswerTurn() {
  const turn = document.createElement("article");
  turn.className = "assistant-turn assistant-turn--answer is-streaming";

  const label = document.createElement("div");
  label.className = "assistant-turn__label assistant-turn__label--answer";
  label.innerHTML = '<span class="assistant-avatar" aria-hidden="true">AI</span><span>笔记助手</span>';

  const sources = document.createElement("section");
  sources.className = "assistant-sources";
  sources.hidden = true;
  const sourcesTitle = document.createElement("h3");
  sourcesTitle.textContent = "笔记依据";
  const sourcesList = document.createElement("div");
  sourcesList.className = "assistant-sources__list";
  sources.append(sourcesTitle, sourcesList);

  const answer = document.createElement("div");
  answer.className = "assistant-answer";
  answer.setAttribute("role", "status");
  answer.textContent = "正在读取笔记依据…";

  const footer = document.createElement("div");
  footer.className = "assistant-answer__footer";
  const warning = document.createElement("span");
  warning.textContent = "回答仅基于已索引笔记；请核对来源。";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "复制";
  copy.disabled = true;
  footer.append(warning, copy);

  turn.append(label, sources, answer, footer);
  assistantMessages.append(turn);
  return { turn, sources, sourcesList, answer, warning, copy };
}

function normalizeAssistantSource(source) {
  const locator = String(source.locator || "");
  const [sourcePath, anchor = ""] = locator.split("#", 2);
  const note = flatNotes.find((candidate) => candidate.path === sourcePath);
  const titleParts = String(source.title || "").split(" · ");
  return {
    id: String(source.sourceId || source.id || "source"),
    noteId: String(source.noteId || note?.id || ""),
    anchor: String(source.anchor || anchor),
    unitCode: String(source.unitCode || note?.unitCode || titleParts[0] || "笔记"),
    weekLabel: String(source.weekLabel || (note ? formatWeekLabel(note) : titleParts[1] || "来源")),
    heading: String(source.heading || titleParts.slice(2).join(" · ") || source.title || "已授权笔记片段"),
    locator,
    isWeb: String(source.kind || "").toLowerCase() === "web" && /^https:\/\//i.test(locator),
  };
}

function assistantSourceDisplayMap(sourceItems) {
  const result = new Map();
  sourceItems.forEach((rawSource, index) => {
    const source = normalizeAssistantSource(rawSource);
    if (source.id) result.set(source.id, { ...source, displayId: `S${index + 1}` });
  });
  return result;
}

function openAssistantSource(source, trigger = null) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(assistantConversationId || "")) return;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(source.id || "")) return;
  if (trigger) trigger.disabled = true;
  void fetch(
    `/api/assistant/conversations/${encodeURIComponent(assistantConversationId)}/sources/${encodeURIComponent(source.id)}`,
    { cache: "no-store" },
  ).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    const verified = normalizeAssistantSource(payload);
    const canOpen = Boolean(verified.noteId) && flatNotes.some((note) => note.id === verified.noteId);
    if (!canOpen) throw new Error("该来源无法定位到当前已发布笔记。");
    openNote(verified.noteId, { targetAnchor: verified.anchor || "" });
    if (isCompactNavigation()) closeTocNavigation();
  }).catch(() => {
    // Do not claim source navigation succeeded when the loopback-only source contract cannot
    // re-verify this conversation's approved source metadata.
    if (trigger) trigger.title = "来源定位暂时不可用。";
  }).finally(() => {
    if (trigger) trigger.disabled = false;
  });
}

function renderAssistantSources(sourceItems, elements) {
  elements.sourcesList.replaceChildren();
  const sourceMap = assistantSourceDisplayMap(sourceItems);
  for (const source of sourceMap.values()) {
    const canOpen = Boolean(source.noteId) && flatNotes.some((note) => note.id === source.noteId);
    const item = document.createElement(canOpen ? "button" : (source.isWeb ? "a" : "div"));
    if (canOpen) item.type = "button";
    if (source.isWeb) {
      item.href = source.locator;
      item.target = "_blank";
      item.rel = "noreferrer";
    }
    item.className = "assistant-source";
    item.innerHTML = `<span>${escapeHtml(source.displayId)}</span><strong>${escapeHtml(source.unitCode)} · ${escapeHtml(source.weekLabel)}</strong><em>${escapeHtml(source.heading)}</em>`;
    if (canOpen) {
      item.addEventListener("click", () => {
        openAssistantSource(source, item);
      });
    }
    elements.sourcesList.append(item);
  }
  elements.sources.hidden = sourceItems.length === 0;
}

function renderAssistantVerifiedParagraphs(elements, rawParagraphs, sourceItems) {
  const sourceMap = assistantSourceDisplayMap(sourceItems);
  const paragraphs = Array.isArray(rawParagraphs) ? rawParagraphs : [];
  elements.answer.replaceChildren();
  paragraphs.forEach((rawParagraph) => {
    const markdown = String(rawParagraph?.markdown || "").trim();
    if (!markdown) return;
    const paragraph = document.createElement("section");
    paragraph.className = "assistant-cited-paragraph";
    const body = document.createElement("div");
    body.className = "assistant-cited-paragraph__body";
    body.innerHTML = renderAssistantMarkdown(markdown);
    paragraph.append(body);
    const citationIds = Array.isArray(rawParagraph?.sourceIds) ? rawParagraph.sourceIds : [];
    const citations = citationIds
      .map((sourceId) => sourceMap.get(String(sourceId || "")))
      .filter(Boolean);
    if (citations.length) {
      const citationList = document.createElement("div");
      citationList.className = "assistant-paragraph-citations";
      citationList.setAttribute("aria-label", "本段笔记依据");
      citations.forEach((source) => {
        const citation = document.createElement("button");
        citation.type = "button";
        citation.className = "assistant-paragraph-citation";
        citation.textContent = source.displayId;
        citation.title = `${source.unitCode} · ${source.weekLabel} · ${source.heading}`;
        citation.addEventListener("click", () => openAssistantSource(source, citation));
        citationList.append(citation);
      });
      paragraph.append(citationList);
    }
    elements.answer.append(paragraph);
  });
}

function parseSseBlock(block) {
  let eventName = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    return { eventName, payload: JSON.parse(data.join("\n")) };
  } catch (error) {
    return null;
  }
}

async function copyAssistantText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.append(fallback);
  fallback.select();
  document.execCommand("copy");
  fallback.remove();
}

function stripLeadingQuestionEcho(answerText, question) {
  const source = String(answerText || "");
  const prompt = String(question || "").trim();
  if (!source || !prompt) return source;
  const questionPattern = escapeRegExp(prompt).replace(/\s+/g, "\\s+");
  const labelPattern = String.raw`(?:(?:\*{1,2}\s*)?(?:(?:用户\s*)?问题|question)(?:\s*\*{1,2})?\s*[：:]\s*)?`;
  const echoPattern = new RegExp(
    String.raw`^\s*${labelPattern}${questionPattern}(?=\s*(?:\r?\n|[。！？!?]+(?:\s|$)|$))`,
    "iu",
  );
  const match = source.match(echoPattern);
  return match ? source.slice(match[0].length).replace(/^[\s：:–—-]+/, "") : source;
}

function shouldHoldQuestionEcho(answerText, question) {
  const leading = String(answerText || "").trimStart();
  const normalizedQuestion = String(question || "").replace(/[\s>*`]/g, "");
  if (!leading || !normalizedQuestion) return false;

  if (/^(?:\*{0,2}\s*)?(?:用|用户|用户问|用户问题|问|问题|q|qu|que|ques|quest|questi|questio|question)\s*$/iu.test(leading)) {
    return true;
  }

  const labelPattern = /^(?:\*{1,2}\s*)?(?:(?:用户\s*)?问题|question)(?:\s*\*{1,2})?\s*[：:]\s*/iu;
  if (!labelPattern.test(leading)) return false;
  const candidate = leading.replace(labelPattern, "").replace(/[\s>*`]/g, "");
  return !candidate || normalizedQuestion.startsWith(candidate);
}

function renderStreamingAssistantText(elements, answerText, question) {
  const visibleAnswer = stripLeadingQuestionEcho(answerText, question);
  elements.answer.textContent = visibleAnswer || (
    shouldHoldQuestionEcho(answerText, question) ? "正在组织回答…" : ""
  );
  return visibleAnswer;
}

function contextLimitWarning(payload = {}) {
  const contextWindow = Number(payload.contextWindow);
  const totalTokens = Number(payload.totalTokens);
  const hasMeasuredUsage = Number.isFinite(contextWindow) && contextWindow > 0
    && Number.isFinite(totalTokens) && totalTokens > 0;
  const usage = hasMeasuredUsage
    ? `（约 ${new Intl.NumberFormat("en-AU").format(totalTokens)} / ${new Intl.NumberFormat("en-AU").format(contextWindow)} tokens）`
    : "";
  return `本轮上下文已接近或达到上限${usage}。请清空对话后，缩小范围或拆分问题重新提问。`;
}

function parseNativeAssistantResponse(payload) {
  if (payload?.kind === "app") {
    const text = String(payload.text || "").trim();
    if (!text) throw new Error("本地助手没有返回可显示的内容。");
    return {
      text,
      sources: [],
      paragraphs: [],
      metadata: {
        ...payload,
        contextTokens: assistantContextWindow || undefined,
        replyTokenBudget: payload.replyTokenBudget || payload.configuredReplyTokenBudget || state.assistantReplyTokenBudget || undefined,
        tokenUsage: "estimated",
      },
    };
  }
  if (payload?.kind === "verified") {
    const paragraphs = Array.isArray(payload.paragraphs) ? payload.paragraphs : [];
    const text = paragraphs.map((paragraph) => String(paragraph?.markdown || "").trim()).filter(Boolean).join("\n\n");
    if (!text) throw new Error("本地模型没有返回通过来源校验的内容。");
    return {
      text,
      sources: Array.isArray(payload.sources) ? payload.sources : [],
      paragraphs: paragraphs
        .map((paragraph) => ({
          markdown: String(paragraph?.markdown || "").trim(),
          sourceIds: Array.isArray(paragraph?.sourceIds) ? paragraph.sourceIds.map(String) : [],
        }))
        .filter((paragraph) => paragraph.markdown),
      metadata: {
        ...payload,
        contextTokens: assistantContextWindow || undefined,
        promptTokens: payload.promptTokensEstimated,
        replyTokenBudget: payload.replyTokenBudget || payload.configuredReplyTokenBudget || state.assistantReplyTokenBudget || undefined,
        tokenUsage: "estimated",
      },
    };
  }
  throw new Error(payload?.message || "AI 服务返回了无法识别的响应。");
}

async function sendAssistantQuestion(question, selection = null) {
  if (!assistantReady || assistantRequestController) return;
  appendUserQuestion(question, selection);
  const elements = createAssistantAnswerTurn();
  const controller = new AbortController();
  assistantRequestController = controller;
  activeAssistantAnswerElements = elements;
  assistantSend.disabled = true;
  assistantStop.hidden = false;
  assistantStop.disabled = false;
  assistantStop.textContent = "停止";
  let answerText = "";
  let visibleAnswerText = "";
  let receivedSources = [];
  let receivedParagraphs = [];
  let generationMeta = {};
  scrollAssistantToLatest();

  try {
    const response = await fetch("/api/assistant/chat", {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: assistantConversationId,
        query: question,
        inferenceBackend: state.assistantBackend,
        maxTokens: isCloudAssistantBackend() ? undefined : (state.assistantReplyTokenBudget || undefined),
        reasoningMode: isCloudAssistantBackend() ? undefined : (state.assistantReasoningMode || undefined),
        history: isIndependentGeminiBackend() ? undefined : buildAssistantHistoryPayload(),
        scope: isIndependentGeminiBackend() ? undefined : {
          type: state.assistantScope,
          ...buildAssistantScopePayload(),
        },
        selection: selection ? {
          noteId: selection.noteId,
          text: selection.text,
          kind: selection.kind,
          sectionAnchor: selection.sectionAnchor || undefined,
        } : undefined,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const failure = {
        ...payload,
        code: payload.code || payload.error || "",
      };
      const error = new Error(payload.message || `AI 服务返回 HTTP ${response.status}`);
      error.assistantFailure = failure;
      throw error;
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const parsed = parseNativeAssistantResponse(await response.json());
      answerText = parsed.text;
      receivedSources = parsed.sources;
      receivedParagraphs = parsed.paragraphs;
      generationMeta = parsed.metadata;
      if (receivedSources.length) renderAssistantSources(receivedSources, elements);
      if (receivedParagraphs.length) renderAssistantVerifiedParagraphs(elements, receivedParagraphs, receivedSources);
      updateAssistantContextMeta(generationMeta);
    } else {
      if (!response.body) throw new Error("浏览器不支持流式响应。");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replaceAll("\r\n", "\n");
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const event = parseSseBlock(block);
          if (!event) continue;
          if (event.eventName === "status") {
            generationMeta = { ...generationMeta, ...(event.payload || {}) };
            updateAssistantContextMeta(event.payload || {});
          } else if (event.eventName === "sources") {
            receivedSources = Array.isArray(event.payload.sources) ? event.payload.sources : [];
            renderAssistantSources(receivedSources, elements);
            elements.answer.textContent = "正在组织回答…";
          } else if (event.eventName === "paragraph") {
            const index = Number(event.payload?.index);
            const markdown = String(event.payload?.markdown || "").trim();
            if (Number.isInteger(index) && index >= 0 && markdown) {
              receivedParagraphs[index] = {
                markdown,
                sourceIds: Array.isArray(event.payload?.sourceIds)
                  ? event.payload.sourceIds.map(String)
                  : [],
              };
              renderAssistantVerifiedParagraphs(elements, receivedParagraphs.filter(Boolean), receivedSources);
              elements.answer.removeAttribute("role");
              scrollAssistantToLatest();
            }
          } else if (event.eventName === "token") {
            answerText += event.payload.token || "";
            // New servers send a complete, citation-validated paragraph before the compatible
            // token event. Keep that structured rendering intact rather than overwriting its
            // per-paragraph source chips with an unstructured text stream.
            if (!receivedParagraphs.filter(Boolean).length) {
              visibleAnswerText = renderStreamingAssistantText(elements, answerText, question);
            }
            scrollAssistantToLatest();
          } else if (event.eventName === "done") {
            generationMeta = event.payload || {};
            updateAssistantContextMeta(generationMeta);
          } else if (event.eventName === "error") {
            const failure = event.payload || {};
            const error = new Error(failure.message || "模型生成失败。");
            error.assistantFailure = failure;
            throw error;
          }
        }
        if (done) break;
      }
    }

    const validatedParagraphs = receivedParagraphs.filter((paragraph) => (
      paragraph && String(paragraph.markdown || "").trim()
    ));
    if (validatedParagraphs.length) {
      answerText = validatedParagraphs.map((paragraph) => paragraph.markdown).join("\n\n");
    }
    visibleAnswerText = stripLeadingQuestionEcho(answerText, question);
    if (!visibleAnswerText.trim()) {
      const error = new Error(generationMeta.contextFull
        ? contextLimitWarning(generationMeta)
        : "模型没有返回可显示的内容。");
      error.assistantFailure = generationMeta;
      throw error;
    }
    elements.answer.removeAttribute("role");
    if (validatedParagraphs.length) {
      renderAssistantVerifiedParagraphs(elements, validatedParagraphs, receivedSources);
    } else {
      elements.answer.innerHTML = renderAssistantMarkdown(visibleAnswerText);
    }
    elements.copy.disabled = false;
    elements.copy.addEventListener("click", async () => {
      try {
        await copyAssistantText(visibleAnswerText);
        elements.copy.textContent = "已复制";
        window.setTimeout(() => { elements.copy.textContent = "复制"; }, 1200);
      } catch (error) {
        elements.copy.textContent = "复制失败";
      }
    });
    const warnings = [];
    if (receivedSources.length && !validatedParagraphs.length && generationMeta.kind !== "verified" && !/\[S?\d+\]/.test(visibleAnswerText)) {
      warnings.push("回答缺少完整的段落引用标记，请以“笔记依据”为准。");
    }
    if (generationMeta.contextFull) {
      warnings.push(contextLimitWarning(generationMeta));
    } else if (generationMeta.historyTruncated) {
      warnings.push("为给本轮回答保留输出空间，较早的对话已压缩；需要完整重来时可清空对话。");
    } else if (generationMeta.truncated) {
      const limit = Number(generationMeta.replyTokenBudget);
      warnings.push(
        Number.isFinite(limit) && limit > 0
          ? `回答达到 ${new Intl.NumberFormat("en-AU").format(limit)} tokens 输出上限；可选择“更长”或拆分问题继续提问。`
          : "回答达到本轮输出上限；可选择“更长”或拆分问题继续提问。",
      );
    }
    if (warnings.length) elements.warning.textContent = warnings.join(" ");
    rememberAssistantTurn(question, visibleAnswerText, receivedSources, selection);
  } catch (error) {
    const validatedParagraphs = receivedParagraphs.filter((paragraph) => (
      paragraph && String(paragraph.markdown || "").trim()
    ));
    if (validatedParagraphs.length) {
      answerText = validatedParagraphs.map((paragraph) => paragraph.markdown).join("\n\n");
    }
    visibleAnswerText = stripLeadingQuestionEcho(answerText, question);
    if (error.name === "AbortError") {
      elements.warning.textContent = "已停止当前页面接收；服务器端推理停止尚未确认。已收到的内容会保留。";
      if (visibleAnswerText) {
        elements.answer.removeAttribute("role");
        if (validatedParagraphs.length) {
          renderAssistantVerifiedParagraphs(elements, validatedParagraphs, receivedSources);
        } else {
          elements.answer.innerHTML = renderAssistantMarkdown(visibleAnswerText);
        }
      } else {
        elements.answer.textContent = "已停止当前页面接收。";
      }
      } else {
        const failure = error.assistantFailure || {};
        const scopeNoEvidence = failure.code === "scope_no_evidence";
        if (visibleAnswerText) {
          elements.answer.removeAttribute("role");
          if (validatedParagraphs.length) {
            renderAssistantVerifiedParagraphs(elements, validatedParagraphs, receivedSources);
          } else {
            elements.answer.innerHTML = renderAssistantMarkdown(visibleAnswerText);
          }
        } else {
          elements.answer.textContent = scopeNoEvidence
            ? "当前范围内没有足够的已索引笔记依据。"
            : (failure.contextFull
              ? "本轮上下文已满，请缩小范围后重新提问。"
              : "AI 服务暂时无法完成回答。");
        }
        elements.warning.textContent = scopeNoEvidence
          ? "为避免跨范围猜测，系统没有自动扩大检索范围。请将检索范围改为“当前 Week”、“当前 Unit”或“全部笔记”后重试。"
          : (failure.contextFull
            ? contextLimitWarning(failure)
            : (error.message || "请稍后重试；笔记阅读不受影响。"));
        refreshAssistantStatus();
      }
  } finally {
    elements.turn.classList.remove("is-streaming");
    if (activeAssistantAnswerElements === elements) activeAssistantAnswerElements = null;
    if (assistantRequestController === controller) {
      assistantRequestController = null;
      assistantStop.hidden = true;
      assistantStop.disabled = false;
      assistantStop.textContent = "停止";
      assistantSend.disabled = !assistantReady;
    }
    scrollAssistantToLatest();
  }
}

function renderNoteSearchResults(query = "") {
  const normalized = query.trim().toLocaleLowerCase();
  const matches = normalized
    ? flatNotes.filter((note) =>
        [note.unitCode, note.unitName, note.title, formatWeekLabel(note), ...note.topics]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalized),
      )
    : flatNotes;

  searchCount.textContent = `${matches.length} ${matches.length === 1 ? "note" : "notes"}`;
  searchResults.innerHTML = matches.length
    ? matches
        .map(
          (note) => `
            <button class="search-result" type="button" data-note-id="${note.id}">
              <span class="search-result__context">${note.unitCode} · ${formatWeekLabel(note)}</span>
              <span>
                <span class="search-result__title">${escapeHtml(note.title)}</span>
                <span class="search-result__topics">${note.topics.map(escapeHtml).join(" · ")}</span>
              </span>
            </button>`,
        )
        .join("")
    : '<p class="search-empty">没有找到匹配的笔记。</p>';

  searchResults.querySelectorAll("[data-note-id]").forEach((button) => {
    button.addEventListener("click", () => {
      searchDialog.close();
      openNote(button.dataset.noteId);
    });
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightSearchTerms(value, query) {
  const terms = query.trim().split(/\s+/).filter(Boolean).sort((left, right) => right.length - left.length);
  if (!terms.length) return escapeHtml(value);
  const expression = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "giu");
  return String(value)
    .split(expression)
    .map((part, index) => (index % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join("");
}

function bindSearchResultButtons(query) {
  searchResults.querySelectorAll("[data-note-id]").forEach((button) => {
    button.addEventListener("click", () => {
      searchDialog.close();
      openNote(button.dataset.noteId, {
        targetAnchor: button.dataset.anchor || "",
        searchQuery: query,
      });
    });
  });
}

async function renderFullTextSearchResults(query) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    searchRequestController?.abort();
    renderNoteSearchResults();
    return;
  }

  const requestSequence = ++searchRequestSequence;
  searchRequestController?.abort();
  searchRequestController = new AbortController();
  searchCount.textContent = "正在检索正文…";
  searchResults.innerHTML = `
    <div class="search-loading" role="status">
      <span></span><span></span><span></span>
      <p>正在服务器上检索全部笔记</p>
    </div>`;

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}&limit=24`, {
      cache: "no-store",
      signal: searchRequestController.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (requestSequence !== searchRequestSequence || searchInput.value.trim() !== trimmedQuery) return;

    const results = Array.isArray(payload.results) ? payload.results : [];
    searchCount.textContent = `${results.length} ${results.length === 1 ? "result" : "results"}`;
    searchResults.innerHTML = results.length
      ? results
          .map(
            (result) => `
              <button
                class="search-result search-result--full-text"
                type="button"
                data-note-id="${escapeHtml(result.noteId)}"
                data-anchor="${escapeHtml(result.anchor || "")}"
              >
                <span class="search-result__context">${escapeHtml(result.unitCode)} · ${escapeHtml(result.weekLabel)}</span>
                <span>
                  <span class="search-result__title">${highlightSearchTerms(result.heading || result.noteTitle, trimmedQuery)}</span>
                  <span class="search-result__note">${escapeHtml(result.noteTitle)}</span>
                  <span class="search-result__snippet">${highlightSearchTerms(result.snippet, trimmedQuery)}</span>
                </span>
              </button>`,
          )
          .join("")
      : '<p class="search-empty">全文中没有找到匹配内容。可以尝试更短的关键词或英文术语。</p>';
    bindSearchResultButtons(trimmedQuery);
  } catch (error) {
    if (error.name === "AbortError") return;
    if (requestSequence !== searchRequestSequence) return;
    searchCount.textContent = "Search unavailable";
    searchResults.innerHTML = `
      <div class="search-error" role="status">
        <strong>全文检索服务暂时不可用</strong>
        <span>笔记阅读不受影响；请稍后重试，或检查 Note Portal 服务。</span>
      </div>`;
    console.error("[Search]", error);
  }
}

function scheduleFullTextSearch(query) {
  window.clearTimeout(searchDebounceTimer);
  if (!query.trim()) {
    renderFullTextSearchResults("");
    return;
  }
  searchDebounceTimer = window.setTimeout(() => renderFullTextSearchResults(query), 180);
}

function openSearch() {
  scheduleFullTextSearch(searchInput.value);
  searchDialog.showModal();
  requestAnimationFrame(() => searchInput.focus());
}

navToggle.addEventListener("click", togglePrimaryNavigation);
sidebarEdgeToggle.addEventListener("click", togglePrimaryNavigation);
sidebar.addEventListener("pointerenter", cancelSidebarAutoCollapse);
sidebar.addEventListener("pointerleave", scheduleSidebarAutoCollapse);
sidebar.addEventListener("focusin", cancelSidebarAutoCollapse);
sidebar.addEventListener("focusout", () => requestAnimationFrame(scheduleSidebarAutoCollapse));
sidebarEdgeToggle.addEventListener("pointerenter", cancelSidebarAutoCollapse);
sidebarEdgeToggle.addEventListener("pointerleave", scheduleSidebarAutoCollapse);
sidebarEdgeToggle.addEventListener("focusin", cancelSidebarAutoCollapse);
sidebarEdgeToggle.addEventListener("focusout", () => requestAnimationFrame(scheduleSidebarAutoCollapse));
navClose.addEventListener("click", () => closeMobileNavigation(true));
navScrim.addEventListener("click", () => closeMobileNavigation(true));
tocToggle.addEventListener("click", openTocNavigation);
assistantToggle.addEventListener("click", openAssistantPanel);
tocClose.addEventListener("click", () => closeTocNavigation(true));
tocScrim.addEventListener("click", () => closeTocNavigation(true));
tocTab.addEventListener("click", () => setUtilityTab("toc"));
preferencesTab.addEventListener("click", () => setUtilityTab("preferences"));
assistantTab.addEventListener("click", () => setUtilityTab("assistant"));
assistantRetry.addEventListener("click", retryAssistantModel);
assistantClear.addEventListener("click", clearAssistantConversation);
assistantStop.addEventListener("click", stopAssistantGeneration);
assistantSelectionClear.addEventListener("click", clearAssistantSelection);
selectionAskAi.addEventListener("pointerdown", (event) => event.preventDefault());
selectionAskAi.addEventListener("click", () => {
  const selection = selectionPopoverCandidate;
  if (!selection) return;
  openAssistantForSelection(selection);
  hideSelectionAskAi();
  window.getSelection()?.removeAllRanges();
});
immersionToggle.addEventListener("click", toggleImmersionMode);
readingThemeOptions.forEach((option) => {
  option.addEventListener("click", () => applyReadingTheme(option.dataset.readingTheme));
});
backToTop.addEventListener("click", () => {
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
});
lastReadMarker.addEventListener("click", jumpToLastReadPosition);
assistantScopeSelect.addEventListener("change", () => setAssistantScope(assistantScopeSelect.value));
assistantBackend.addEventListener("change", () => {
  const selected = assistantBackend.value;
  if (!ASSISTANT_BACKEND_NAMES.has(selected)) return;
  state.assistantBackend = selected;
  rememberBrowserAssistantBackend(selected);
  applyAssistantBackendPresentation();
  refreshAssistantStatus();
});
assistantReplyLength.addEventListener("change", () => setAssistantReplyTokenBudget(assistantReplyLength.value));
assistantReasoningMode.addEventListener("change", () => {
  const selected = assistantReasoningMode.value;
  state.assistantReasoningMode = selected === "thinking" || selected === "non_thinking" ? selected : "";
});
assistantForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = assistantInput.value.trim();
  if (!question) return;
  if (!assistantReady) {
    assistantRecovery.hidden = false;
    assistantRecoveryMessage.textContent = "请先启动本地模型；笔记阅读与搜索仍可正常使用。";
    return;
  }
  if (assistantRequestController) return;
  const selection = assistantSelection;
  assistantInput.value = "";
  clearAssistantSelection();
  sendAssistantQuestion(question, selection);
});
assistantInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    assistantForm.requestSubmit();
  }
});
libraryLink.addEventListener("click", renderOverview);
brandHome.addEventListener("click", renderLibraryHome);
semesterSelect.addEventListener("change", () => {
  if (semesterSelect.value === "__home__") renderLibraryHome();
  else renderOverview();
});
searchTrigger.addEventListener("click", openSearch);
printTrigger.addEventListener("click", printCurrentNote);
searchClose.addEventListener("click", () => searchDialog.close());
searchInput.addEventListener("input", (event) => scheduleFullTextSearch(event.target.value));
settingsTrigger.addEventListener("click", openSettingsDialog);
settingsClose.addEventListener("click", () => closeDialog(settingsDialog));
settingsFeedback.addEventListener("click", () => void openFeedbackDialog());
settingsWelcome.addEventListener("click", () => openWelcomeDialog({ force: true }));
feedbackClose.addEventListener("click", () => closeDialog(feedbackDialog));
feedbackCancel.addEventListener("click", () => closeDialog(feedbackDialog));
feedbackForm.addEventListener("submit", submitFeedback);
welcomeDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  event.stopPropagation();
});
welcomeDialog.addEventListener("close", clearWelcomeSupportWait);
welcomeBack.addEventListener("click", () => void setWelcomeStep(welcomeStepIndex - 1));
welcomeNext.addEventListener("click", () => {
  if (welcomeStepIndex < welcomeSteps.length - 1) {
    void setWelcomeStep(welcomeStepIndex + 1);
    return;
  }
  completeWelcome();
});
document.addEventListener("click", (event) => {
  const downloadLink = event.target.closest?.("a[download]");
  if (!downloadLink) return;
  try {
    if (new URL(downloadLink.href, window.location.href).origin === window.location.origin) {
      recordPortalActivity("download");
    }
  } catch (error) {
    /* Ignore malformed third-party links; navigation itself remains unchanged. */
  }
});
document.addEventListener("selectionchange", scheduleSelectionAskAi);

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape" || !welcomeDialog.open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);

document.addEventListener("keydown", (event) => {
  sidebarInteractionMode = "keyboard";
  if (event.key === "/" && state.view !== "home" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const tag = document.activeElement?.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA") {
      event.preventDefault();
      openSearch();
    }
  }
  if (event.key === "Escape" && searchDialog.open) return;
  if (event.key === "Escape" && document.body.classList.contains("toc-open")) {
    closeTocNavigation(true);
  } else if (event.key === "Escape" && document.body.classList.contains("nav-open")) {
    closeMobileNavigation(true);
  } else if (event.key === "Escape" && isImmersionActive()) {
    if (!isCompactNavigation() && !state.immersiveTocCollapsed) {
      setImmersiveTocCollapsed(true);
    } else {
      exitImmersionMode();
    }
  }
});

document.addEventListener("fullscreenchange", handleImmersionFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleImmersionFullscreenChange);
document.addEventListener("fullscreenerror", handleImmersionFullscreenError);
document.addEventListener("webkitfullscreenerror", handleImmersionFullscreenError);

document.addEventListener(
  "pointerdown",
  () => {
    sidebarInteractionMode = "pointer";
  },
  { passive: true },
);

window.addEventListener("hashchange", () => {
  if (!window.location.hash || window.location.hash === "#home") {
    if (state.view !== "home") renderLibraryHome({ preserveUrl: true });
    return;
  }
  if (window.location.hash === "#overview") {
    if (state.view !== "overview") renderOverview({ preserveUrl: true });
    return;
  }
  const noteId = getNoteIdFromHash();
  if (noteId && (noteId !== state.activeNoteId || state.view !== "note")) {
    openNote(noteId, { preserveScroll: false });
  }
});

window.addEventListener("resize", () => {
  hideSelectionAskAi();
  positionLastReadMarker();
  const compactNavigation = isCompactNavigation();
  if (!compactNavigation && compactNavigationBeforeResize) {
    // A mobile utility drawer has no desktop equivalent in immersion mode; keep the rail folded.
    state.immersiveTocCollapsed = true;
  }
  if (compactNavigation && !compactNavigationBeforeResize && state.immersionMode) {
    state.immersiveTocCollapsed = true;
  }
  compactNavigationBeforeResize = compactNavigation;
  if (!resizeReadingAnchor) resizeReadingAnchor = stableReadingAnchor || captureReadingAnchor();
  updateNavigationToggle();
  scheduleSidebarAutoCollapse();
  restoreReadingAnchor(resizeReadingAnchor);
  window.clearTimeout(resizeAnchorSettleTimer);
  resizeAnchorSettleTimer = window.setTimeout(() => {
    resizeReadingAnchor = null;
    scheduleStableReadingAnchorCapture();
  }, 520);
});

window.addEventListener("afterprint", restorePrintState);

if (state.view === "note") setSingleExpandedUnit(getActiveNote()?.unitCode);
renderNavigation();
applyReadingTheme(state.readingTheme, { persist: false });
setUtilityTab("toc");
applyAssistantBackendPresentation();
updateViewerSessionPresentation();
if (!window.location.hash || window.location.hash === "#home") renderLibraryHome({ preserveUrl: true });
else if (window.location.hash === "#overview") renderOverview({ preserveUrl: true });
else if (getActiveNote()) renderNote(getActiveNote(), { restoreScroll: true });
else renderLibraryHome({ preserveUrl: true });
updateNavigationToggle();
void loadViewerSession();
if (portalManifestAvailable) {
  watchForPublishedPortalRelease();
  maybeShowWelcome();
} else {
  void loadPortalManifest();
}
