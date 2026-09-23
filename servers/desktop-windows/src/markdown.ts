import markedAssetUrl from "../../../vendor/marked.umd.js?url";

type MarkedRuntime = { parse: (source: string, options: { async: false; gfm: true }) => string | Promise<string> };

declare global {
  interface Window { marked?: MarkedRuntime }
}

let markedLoad: Promise<MarkedRuntime> | undefined;

function loadMarked(): Promise<MarkedRuntime> {
  if (window.marked) return Promise.resolve(window.marked);
  if (!markedLoad) {
    markedLoad = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = markedAssetUrl;
      script.onload = () => window.marked ? resolve(window.marked) : reject(new Error("Markdown renderer did not start"));
      script.onerror = () => reject(new Error("Markdown renderer could not load"));
      document.head.append(script);
    });
  }
  return markedLoad;
}

const allowedTags = new Set([
  "a", "blockquote", "br", "code", "del", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "li", "ol", "p", "pre", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
]);
const blockedTags = new Set([
  "audio", "base", "button", "embed", "form", "iframe", "img", "input", "link", "meta", "object",
  "script", "select", "style", "svg", "template", "textarea", "video",
]);

function safeLink(href: string): string | null {
  if (href === "LIBRARY_STRUCTURE.md") {
    return "https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/blob/master/servers/desktop-windows/docs/LIBRARY_STRUCTURE.md";
  }
  try {
    const url = new URL(href);
    return ["https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function sanitize(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  [...template.content.querySelectorAll("*")].reverse().forEach((element) => {
    const tag = element.tagName.toLowerCase();
    if (blockedTags.has(tag)) {
      element.remove();
      return;
    }
    if (!allowedTags.has(tag)) {
      element.replaceWith(...element.childNodes);
      return;
    }
    const href = tag === "a" ? safeLink(element.getAttribute("href") || "") : null;
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    if (tag === "a") {
      if (href) {
        element.setAttribute("href", href);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
    }
  });
  return template.innerHTML;
}

export async function renderMarkdown(source: string): Promise<string> {
  const marked = await loadMarked();
  const html = marked.parse(source, { async: false, gfm: true });
  if (typeof html !== "string") throw new Error("Markdown renderer returned an unexpected result");
  return sanitize(html);
}
