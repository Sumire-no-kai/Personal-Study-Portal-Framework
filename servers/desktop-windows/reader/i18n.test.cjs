const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "i18n.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

test("reader application syntax is valid", () => {
  assert.doesNotThrow(() => new vm.Script(app));
});

function load({ saved, language = "en", browser = "zh-CN", denied = false } = {}) {
  const store = new Map(saved ? [["note-portal-reader-language", saved]] : []);
  const context = vm.createContext({
    window: { PORTAL_DATA: { language } },
    navigator: { language: browser },
    localStorage: {
      getItem: key => { if (denied) throw new Error("Storage denied"); return store.get(key); },
      setItem: (key, value) => { if (denied) throw new Error("Storage denied"); store.set(key, value); },
      removeItem: key => { if (denied) throw new Error("Storage denied"); store.delete(key); },
    },
  });
  vm.runInContext(source, context);
  return { ...context.window.NotePortalI18n, store };
}

test("app preference wins over browser language unless explicitly overridden", () => {
  assert.equal(load().language, "en");
  assert.equal(load({ language: "zh", browser: "en" }).language, "zh");
  assert.equal(load({ saved: "zh" }).language, "zh");
  assert.equal(load({ saved: "en", language: "zh" }).language, "en");
  assert.equal(load({ saved: "invalid" }).choice, "app");
  assert.equal(load({ language: "invalid" }).language, "zh");
  assert.equal(load({ denied: true }).language, "en");
});

test("choices persist, following app removes override, write errors are not hidden", () => {
  const ui = load();
  ui.saveChoice("zh");
  assert.equal(ui.store.get("note-portal-reader-language"), "zh");
  ui.saveChoice("app");
  assert.equal(ui.store.size, 0);
  assert.throws(() => ui.saveChoice("fr"), /Unsupported/);
  assert.throws(() => load({ denied: true }).saveChoice("en"), /Storage denied/);
});

test("all referenced keys exist in both languages and English UI contains no Chinese", () => {
  const keys = [
    ...[...source.matchAll(/^    "([^"]+)": \[/gm)].map(match => match[1]),
    ...[...app.matchAll(/\bt\("([^"]+)"/g)].map(match => match[1]),
    ...[...html.matchAll(/data-i18n(?:-aria-label|-title|-placeholder)?="([^"]+)"/g)].map(match => match[1]),
  ];
  assert.ok(keys.length > 80);
  for (const language of ["zh", "en"]) {
    const ui = load({ language });
    for (const key of keys) {
      const value = ui.t(key);
      assert.ok(value.length, key);
      if (language === "en") assert.doesNotMatch(value, /\p{Script=Han}/u, key);
    }
  }
});

test("interpolation preserves original content even when it resembles translated UI", () => {
  assert.equal(load().t("documentsCount", { count: 1 }), "1 document");
  assert.equal(load().t("documentsCount", { count: 2 }), "2 documents");
  const original = "设置 <script> {title} 笔记正文";
  assert.equal(load().t("currentDocument", { title: original }), `Current document: ${original}`);
  assert.equal(load({ language: "zh" }).t("currentDocument", { title: original }), `当前文档：${original}`);
});

test("static localisation visits only marked UI and never document text", () => {
  const note = { textContent: "设置", dataset: {} };
  const label = { textContent: "设置", dataset: { i18n: "设置" } };
  load().applyStatic({ querySelectorAll: selector => selector === "[data-i18n]" ? [label] : [] });
  assert.equal(label.textContent, "Settings");
  assert.equal(note.textContent, "设置");
  assert.equal((app.match(/applyStatic\(/g) || []).length, 1);
  assert.ok(app.indexOf("applyStatic(document)") < app.indexOf("function renderNote("));
});

test("desktop embeds localisation before the application script", () => {
  assert.ok(html.indexOf('src="i18n.js"') < html.indexOf('src="app.js'));
  assert.ok(html.includes('id="reader-language"'));
});
