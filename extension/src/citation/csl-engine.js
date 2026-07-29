(() => {
  "use strict";

  const root = globalThis;

  function normalizeLanguage(value) {
    const parts = String(value || "en-US").replace(/_/g, "-").split("-").filter(Boolean);
    return parts.length > 1 ? `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}` : (parts[0] || "en").toLowerCase();
  }

  function findLocale(locales, language) {
    const normalized = normalizeLanguage(language);
    if (locales[normalized]) return locales[normalized];
    const primary = normalized.split("-")[0];
    const matching = Object.keys(locales).find((key) => normalizeLanguage(key).split("-")[0] === primary);
    return locales[matching] || locales["en-US"] || Object.values(locales)[0] || "";
  }

  function sanitizeHtml(entryHtml) {
    const raw = String(entryHtml || "").trim();
    if (typeof DOMParser !== "function") {
      return raw
        .replace(/<script\b[\s\S]*?<\/script>/gi, "")
        .replace(/\son\w+\s*=\s*(["']).*?\1/gi, "");
    }
    const documentNode = new DOMParser().parseFromString(`<div id="journal-lens-csl-root">${raw}</div>`, "text/html");
    const container = documentNode.getElementById("journal-lens-csl-root");
    const allowed = new Set(["DIV", "SPAN", "I", "EM", "B", "STRONG", "SUP", "SUB", "A", "BR"]);
    [...container.querySelectorAll("*")].forEach((node) => {
      if (!allowed.has(node.tagName)) {
        node.replaceWith(...node.childNodes);
        return;
      }
      [...node.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (name === "class") return;
        if (node.tagName === "A" && name === "href") {
          try {
            const url = new URL(attribute.value);
            if (url.protocol === "http:" || url.protocol === "https:") return;
          } catch (_error) {
            // Remove invalid links below.
          }
        }
        node.removeAttribute(attribute.name);
      });
    });
    return container.innerHTML.trim();
  }

  function plainTextFromHtml(html) {
    if (typeof DOMParser !== "function") {
      return String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
    }
    const documentNode = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    return String(documentNode.body.textContent || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  }

  function renderBibliography({ item, styleXml, parentStyleXml = "", locales = {}, language = "en-US", warnings = [] }) {
    if (!root.CSL || typeof root.CSL.Engine !== "function") throw new Error("CSL 处理器未加载");
    if (!item || !item.id) throw new Error("缺少可渲染的 CSL-JSON item");
    const effectiveStyle = parentStyleXml || styleXml;
    if (!effectiveStyle) throw new Error("CSL 样式 XML 缺失");
    const localeWarnings = [];
    const system = {
      retrieveLocale(requestedLanguage) {
        const xml = findLocale(locales, requestedLanguage);
        if (!xml) throw new Error("没有可用的 CSL locale");
        if (!locales[normalizeLanguage(requestedLanguage)]) {
          localeWarnings.push(`locale ${requestedLanguage || "(default)"} 缺失，已回退到 en-US`);
        }
        return xml;
      },
      retrieveItem(id) {
        return String(id) === String(item.id) ? item : null;
      }
    };
    let engine;
    try {
      engine = new root.CSL.Engine(system, effectiveStyle, normalizeLanguage(language), true);
      engine.setOutputFormat("html");
      engine.updateItems([String(item.id)]);
      const bibliography = engine.makeBibliography();
      const entries = bibliography && bibliography[1];
      if (!Array.isArray(entries) || !entries.length) throw new Error("CSL 处理器没有返回 bibliography entry");
      const entryHtml = sanitizeHtml(entries[0]);
      const html = `<div class="journal-lens-citation">${entryHtml}</div>`;
      return {
        plainText: plainTextFromHtml(html),
        html,
        warnings: [...new Set([...(warnings || []), ...localeWarnings])]
      };
    } catch (error) {
      throw new Error(`题录生成失败：${error && error.message ? error.message : String(error)}`);
    }
  }

  root.JournalLensCslEngine = { plainTextFromHtml, renderBibliography, sanitizeHtml };
})();
