(() => {
  "use strict";

  const root = globalThis;
  const shared = root.JournalLensShared;
  const REGISTRY_KEY = "journalLens.csl.registry";
  const INDEX_KEY = "journalLens.csl.styleIndex";
  const STORAGE_VERSION = 1;
  const INDEX_TTL = 7 * 24 * 60 * 60 * 1000;
  const MAX_XML_BYTES = 2 * 1024 * 1024;
  const STYLE_BRANCH = "v1.0.2";
  const STYLE_RAW_BASE = `https://raw.githubusercontent.com/citation-style-language/styles/${STYLE_BRANCH}/`;
  const LOCALE_RAW_BASE = `https://raw.githubusercontent.com/citation-style-language/locales/${STYLE_BRANCH}/`;
  const REMOTE_INDEX_URL = "https://raw.githubusercontent.com/onlyls/journal-lens/main/extension/assets/citation/csl-style-index.json";
  const BUNDLED_INDEX_URL = "assets/citation/csl-style-index.json";
  const DEFAULT_STYLE_ID = "http://www.zotero.org/styles/apa";
  const BUILT_INS = [
    { id: DEFAULT_STYLE_ID, fileName: "apa.csl", title: "American Psychological Association 7th edition" },
    { id: "http://www.zotero.org/styles/elsevier-vancouver", fileName: "elsevier-vancouver.csl", title: "Elsevier - Vancouver" },
    { id: "http://www.zotero.org/styles/american-chemical-society", fileName: "american-chemical-society.csl", title: "American Chemical Society" }
  ];

  function getLocalUrl(relativePath) {
    return chrome.runtime.getURL(relativePath);
  }

  function storageGet(defaults) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(defaults, (values) => {
        const error = chrome.runtime && chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(values);
      });
    });
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(values, () => {
        const error = chrome.runtime && chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        const error = chrome.runtime && chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }

  function emptyRegistry() {
    return { version: STORAGE_VERSION, defaultStyleId: DEFAULT_STYLE_ID, styles: [] };
  }

  function collapse(value) {
    return shared ? shared.collapseWhitespace(value) : String(value || "").replace(/\s+/g, " ").trim();
  }

  function decodeXml(value) {
    return String(value || "")
      .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#([0-9]+);/g, (_match, number) => String.fromCodePoint(parseInt(number, 10)))
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  function textOf(xml, tagName) {
    const match = String(xml || "").match(new RegExp(`<(?:[\\w.-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tagName}>`, "i"));
    return match ? collapse(decodeXml(match[1].replace(/<[^>]+>/g, " "))) : "";
  }

  function attributeOf(tag, name) {
    const match = String(tag || "").match(new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
    return match ? decodeXml(match[2]) : "";
  }

  function assertWellFormedXml(xml) {
    const input = String(xml || "").replace(/^\uFEFF/, "").trim();
    if (!input) throw new Error("CSL 文件为空");
    if (input.length > MAX_XML_BYTES) throw new Error("CSL XML 超过 2 MB 大小限制");
    if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new Error("CSL 文件包含不允许的 DTD 或外部实体");
    if (/^\s*<(?:!doctype\s+)?html\b/i.test(input) || /<html\b/i.test(input.slice(0, 1000))) {
      throw new Error("下载结果是 HTML 页面，不是 CSL XML");
    }
    if (typeof DOMParser === "function") {
      const documentNode = new DOMParser().parseFromString(input, "application/xml");
      if (documentNode.querySelector("parsererror")) throw new Error("CSL XML 无法解析");
      return input;
    }
    const withoutSpecial = input
      .replace(/<\?xml[\s\S]*?\?>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
    const stack = [];
    const tags = withoutSpecial.match(/<[^>]+>/g) || [];
    if (!tags.length) throw new Error("CSL XML 没有元素");
    for (const tag of tags) {
      if (/^<\//.test(tag)) {
        const name = tag.match(/^<\/\s*([^\s>]+)/)?.[1];
        if (!name || stack.pop() !== name) throw new Error("CSL XML 元素没有正确闭合");
      } else if (!/^<!|^<\?/.test(tag) && !/\/\s*>$/.test(tag)) {
        const name = tag.match(/^<\s*([^\s/>]+)/)?.[1];
        if (!name) throw new Error("CSL XML 包含无效元素");
        stack.push(name);
      }
    }
    if (stack.length) throw new Error("CSL XML 元素没有正确闭合");
    return input;
  }

  function parseCslStyle(xml) {
    const input = assertWellFormedXml(xml);
    const rootTag = input.match(/<(?:[\w.-]+:)?style\b[^>]*>/i)?.[0] || "";
    if (!rootTag || !/^<(?:[\w.-]+:)?style\b/i.test(rootTag)) throw new Error("根元素必须是 CSL <style>");
    const beforeRoot = input.slice(0, input.indexOf(rootTag)).replace(/<\?xml[\s\S]*?\?>/gi, "").replace(/<!--[\s\S]*?-->/g, "").trim();
    if (beforeRoot) throw new Error("根元素必须是 CSL <style>");
    const info = input.match(/<(?:[\w.-]+:)?info\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?info>/i)?.[1] || "";
    if (!info) throw new Error("CSL 样式缺少 <info>");
    const links = [...info.matchAll(/<(?:[\w.-]+:)?link\b[^>]*\/?>/gi)];
    const parentLink = links.find((match) => attributeOf(match[0], "rel") === "independent-parent");
    const parentId = parentLink ? collapse(attributeOf(parentLink[0], "href")) : "";
    const id = textOf(info, "id");
    const title = textOf(info, "title");
    if (!id || !/^https?:\/\//i.test(id)) throw new Error("CSL 样式缺少有效的样式 ID");
    if (!title) throw new Error("CSL 样式缺少标题");
    const hasBibliography = /<(?:[\w.-]+:)?bibliography\b/i.test(input);
    const hasCitation = /<(?:[\w.-]+:)?citation\b/i.test(input);
    const dependent = Boolean(parentId) && !hasBibliography && !hasCitation;
    if (!hasBibliography && !hasCitation && !parentId) throw new Error("CSL 样式既没有渲染规则，也没有 independent-parent");
    if (parentId && !dependent) throw new Error("dependent style 不能同时包含独立渲染规则");
    const rightsMatch = info.match(/<(?:[\w.-]+:)?rights\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?rights>/i);
    const localeMatches = [...input.matchAll(/<(?:[\w.-]+:)?locale\b[^>]*>/gi)]
      .map((match) => attributeOf(match[0], "xml:lang"))
      .filter(Boolean);
    return {
      id,
      title,
      shortTitle: textOf(info, "title-short"),
      updated: textOf(info, "updated"),
      rights: rightsMatch ? collapse(decodeXml(rightsMatch[2].replace(/<[^>]+>/g, " "))) : "",
      rightsLicense: rightsMatch ? attributeOf(rightsMatch[1], "license") : "",
      dependent,
      parentId,
      defaultLocale: attributeOf(rootTag, "default-locale"),
      locales: [...new Set(localeMatches)]
    };
  }

  function parseLocale(xml) {
    const input = assertWellFormedXml(xml);
    if (!/^\s*(?:<\?xml[\s\S]*?\?>\s*)?<(?:[\w.-]+:)?locale\b/i.test(input)) {
      throw new Error("locale 文件根元素必须是 <locale>");
    }
    return input;
  }

  function hashId(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function styleStorageKey(id, parent = false) {
    return `journalLens.csl.${parent ? "parent" : "style"}:${hashId(id)}`;
  }

  function localeStorageKey(language) {
    return `journalLens.csl.locale:${String(language || "en-US").replace(/[^a-z0-9-]/gi, "")}`;
  }

  async function getRegistry() {
    const values = await storageGet({ [REGISTRY_KEY]: emptyRegistry() });
    const stored = values[REGISTRY_KEY];
    if (!stored || stored.version !== STORAGE_VERSION || !Array.isArray(stored.styles)) return emptyRegistry();
    return { ...emptyRegistry(), ...stored };
  }

  async function saveRegistry(registry) {
    await storageSet({ [REGISTRY_KEY]: { ...registry, version: STORAGE_VERSION } });
  }

  async function fetchText(url, description) {
    let response;
    try {
      response = await fetch(url, { cache: "no-store", headers: { accept: "application/xml,text/xml,text/plain" } });
    } catch (_error) {
      throw new Error(`${description}网络请求失败`);
    }
    if (!response.ok) throw new Error(`${description}下载失败（HTTP ${response.status}）`);
    const text = await response.text();
    if (!text.trim()) throw new Error(`${description}为空`);
    return text;
  }

  async function ensureInitialized() {
    const registry = await getRegistry();
    let changed = false;
    for (const builtIn of BUILT_INS) {
      const existing = registry.styles.find((style) => style.id === builtIn.id);
      if (existing) continue;
      const xml = await fetchText(getLocalUrl(`assets/citation/styles/${builtIn.fileName}`), "内置 CSL 样式");
      const metadata = parseCslStyle(xml);
      const storageKey = styleStorageKey(metadata.id);
      await storageSet({ [storageKey]: xml });
      registry.styles.push({
        ...metadata,
        storageKey,
        fileName: builtIn.fileName,
        path: builtIn.fileName,
        source: "bundled",
        sourceUrl: getLocalUrl(`assets/citation/styles/${builtIn.fileName}`),
        builtIn: true,
        installedAt: new Date().toISOString(),
        downloadedAt: ""
      });
      changed = true;
    }
    if (!registry.styles.some((style) => style.id === registry.defaultStyleId)) {
      registry.defaultStyleId = DEFAULT_STYLE_ID;
      changed = true;
    }
    if (changed) await saveRegistry(registry);
    return registry;
  }

  async function loadIndexFrom(url) {
    const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`样式索引下载失败（HTTP ${response.status}）`);
    const payload = await response.json();
    if (!payload || payload.version !== 1 || !Array.isArray(payload.entries) || !payload.entries.length) {
      throw new Error("样式索引格式无效");
    }
    return payload;
  }

  async function getStyleIndex(forceRefresh = false) {
    const values = await storageGet({ [INDEX_KEY]: null });
    const cached = values[INDEX_KEY];
    if (!forceRefresh && cached && Array.isArray(cached.entries) && Date.now() - Number(cached.cachedAt || 0) < INDEX_TTL) {
      return { ...cached, cached: true };
    }
    let payload;
    let source = REMOTE_INDEX_URL;
    try {
      payload = await loadIndexFrom(REMOTE_INDEX_URL);
    } catch (_error) {
      source = getLocalUrl(BUNDLED_INDEX_URL);
      payload = await loadIndexFrom(source);
    }
    const next = { ...payload, cachedAt: Date.now(), source };
    await storageSet({ [INDEX_KEY]: next });
    return { ...next, cached: false };
  }

  function normalizeSearch(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[\u2010-\u2015]/g, "-")
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreIndexEntry(entry, query) {
    const title = normalizeSearch(entry.title);
    const shortTitle = normalizeSearch(entry.shortTitle);
    const fileName = normalizeSearch(String(entry.fileName || "").replace(/\.csl$/i, ""));
    const issns = Array.isArray(entry.issns) ? entry.issns.map(normalizeSearch) : [];
    const candidates = [title, shortTitle, fileName, ...issns].filter(Boolean);
    let score = -1;
    for (const candidate of candidates) {
      if (candidate === query) score = Math.max(score, 1000);
      else if (candidate.startsWith(query)) score = Math.max(score, 700 - candidate.length / 100);
      else if (candidate.includes(query)) score = Math.max(score, 450 - candidate.indexOf(query) / 100);
      else {
        const tokens = query.split(" ").filter(Boolean);
        if (tokens.length > 1 && tokens.every((token) => candidate.includes(token))) score = Math.max(score, 250);
      }
    }
    if (score >= 0 && !entry.dependent) score += 1;
    return score;
  }

  async function searchStyles(query, limit = 15) {
    const normalized = normalizeSearch(query);
    if (normalized.length < 2) throw new Error("请输入至少两个字符");
    const index = await getStyleIndex(false);
    const registry = await ensureInitialized();
    const installed = new Set(registry.styles.map((style) => style.id));
    const results = index.entries
      .map((entry) => ({ ...entry, score: scoreIndexEntry(entry, normalized), installed: installed.has(entry.id) }))
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
      .slice(0, Math.max(1, Math.min(Number(limit) || 15, 30)))
      .map(({ score: _score, ...entry }) => entry);
    return { query: collapse(query), results, index: { generatedAt: index.generatedAt, source: index.source, cached: index.cached } };
  }

  async function findIndexEntry(id) {
    const index = await getStyleIndex(false);
    return index.entries.find((entry) => entry.id === id) || null;
  }

  async function downloadParent(parentId, registry, forceRefresh = false) {
    const existing = registry.styles.find((style) => style.id === parentId);
    if (existing && !forceRefresh) {
      const values = await storageGet({ [existing.storageKey]: "" });
      if (values[existing.storageKey]) return { metadata: existing, xml: values[existing.storageKey] };
    }
    const dependentWithCachedParent = registry.styles.find((style) => style.parentId === parentId && style.parentStorageKey);
    if (dependentWithCachedParent && !forceRefresh) {
      const values = await storageGet({ [dependentWithCachedParent.parentStorageKey]: "" });
      const xml = values[dependentWithCachedParent.parentStorageKey];
      if (xml) {
        const parsed = parseCslStyle(xml);
        return {
          metadata: {
            ...parsed,
            storageKey: dependentWithCachedParent.parentStorageKey,
            title: dependentWithCachedParent.parentTitle || parsed.title
          },
          xml
        };
      }
    }
    const entry = await findIndexEntry(parentId);
    const slug = parentId.split("/").filter(Boolean).pop();
    const relativePath = entry ? entry.path : `${slug}.csl`;
    const xml = await fetchText(`${STYLE_RAW_BASE}${relativePath}`, "dependent style 的父样式");
    const metadata = parseCslStyle(xml);
    if (metadata.dependent || metadata.id !== parentId) throw new Error("independent-parent 指向的不是有效独立样式");
    const storageKey = styleStorageKey(parentId, true);
    await storageSet({ [storageKey]: xml });
    return {
      metadata: {
        ...metadata,
        storageKey,
        fileName: entry ? entry.fileName : `${slug}.csl`,
        path: relativePath,
        source: "csl-project-parent",
        sourceUrl: `${STYLE_RAW_BASE}${relativePath}`,
        builtIn: false,
        installedAt: "",
        downloadedAt: new Date().toISOString()
      },
      xml
    };
  }

  async function saveInstalledStyle(xml, options = {}) {
    const metadata = parseCslStyle(xml);
    const registry = await ensureInitialized();
    const existingIndex = registry.styles.findIndex((style) => style.id === metadata.id);
    if (existingIndex >= 0 && !options.refresh) {
      return { style: registry.styles[existingIndex], alreadyInstalled: true };
    }
    let parent = null;
    if (metadata.dependent) parent = await downloadParent(metadata.parentId, registry, Boolean(options.refresh));
    const storageKey = existingIndex >= 0 ? registry.styles[existingIndex].storageKey : styleStorageKey(metadata.id);
    await storageSet({ [storageKey]: xml });
    const style = {
      ...metadata,
      storageKey,
      parentStorageKey: parent ? parent.metadata.storageKey : "",
      parentTitle: parent ? parent.metadata.title : "",
      parentDefaultLocale: parent ? parent.metadata.defaultLocale : "",
      parentLocales: parent ? parent.metadata.locales : [],
      fileName: options.fileName || "",
      path: options.path || "",
      source: options.source || "local",
      sourceUrl: options.sourceUrl || "",
      builtIn: Boolean(options.builtIn),
      installedAt: existingIndex >= 0 ? registry.styles[existingIndex].installedAt : new Date().toISOString(),
      downloadedAt: options.source === "local" ? "" : new Date().toISOString()
    };
    if (existingIndex >= 0) registry.styles.splice(existingIndex, 1, style);
    else registry.styles.push(style);
    await saveRegistry(registry);
    return { style, alreadyInstalled: false };
  }

  async function installStyle(entryOrId, refresh = false) {
    const entry = typeof entryOrId === "string" ? await findIndexEntry(entryOrId) : entryOrId;
    if (!entry || !entry.id || !entry.path) throw new Error("样式索引中找不到该样式");
    const registry = await ensureInitialized();
    const existing = registry.styles.find((style) => style.id === entry.id);
    if (existing && !refresh) return { style: existing, alreadyInstalled: true };
    const url = `${STYLE_RAW_BASE}${entry.path}`;
    const xml = await fetchText(url, "CSL 样式");
    return saveInstalledStyle(xml, {
      refresh,
      fileName: entry.fileName,
      path: entry.path,
      source: "csl-project",
      sourceUrl: url
    });
  }

  async function importStyle(xml, fileName) {
    if (!/\.csl$/i.test(fileName || "")) throw new Error("只能导入 .csl 文件");
    return saveInstalledStyle(xml, { fileName, source: "local" });
  }

  async function listStyles() {
    const registry = await ensureInitialized();
    return {
      defaultStyleId: registry.defaultStyleId,
      styles: registry.styles.map((style) => ({ ...style, isDefault: style.id === registry.defaultStyleId }))
    };
  }

  async function setDefaultStyle(id) {
    const registry = await ensureInitialized();
    if (!registry.styles.some((style) => style.id === id)) throw new Error("样式尚未安装");
    registry.defaultStyleId = id;
    await saveRegistry(registry);
    return listStyles();
  }

  async function removeStyle(id) {
    const registry = await ensureInitialized();
    const style = registry.styles.find((entry) => entry.id === id);
    if (!style) return listStyles();
    if (style.builtIn) throw new Error("内置样式不能删除");
    registry.styles = registry.styles.filter((entry) => entry.id !== id);
    if (registry.defaultStyleId === id) registry.defaultStyleId = DEFAULT_STYLE_ID;
    await storageRemove(style.storageKey);
    await saveRegistry(registry);
    return listStyles();
  }

  function normalizeLanguage(language) {
    const value = String(language || "").replace(/_/g, "-").trim();
    const parts = value.split("-").filter(Boolean);
    if (!parts.length) return "en-US";
    return parts.length > 1 ? `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}` : parts[0].toLowerCase();
  }

  async function getLocale(language) {
    const normalized = normalizeLanguage(language);
    const candidates = [normalized];
    if (!normalized.includes("-")) candidates.push(normalized === "zh" ? "zh-CN" : `${normalized}-${normalized === "en" ? "US" : normalized.toUpperCase()}`);
    if (!candidates.includes("en-US")) candidates.push("en-US");
    for (const candidate of candidates) {
      const storageKey = localeStorageKey(candidate);
      const values = await storageGet({ [storageKey]: null });
      if (values[storageKey] && values[storageKey].xml) return { language: candidate, ...values[storageKey] };
      const bundled = ["en-US", "zh-CN"].includes(candidate);
      const url = bundled
        ? getLocalUrl(`assets/citation/locales/locales-${candidate}.xml`)
        : `${LOCALE_RAW_BASE}locales-${candidate}.xml`;
      try {
        const xml = parseLocale(await fetchText(url, `CSL locale ${candidate} `));
        const locale = { xml, source: bundled ? "bundled" : "csl-project", downloadedAt: new Date().toISOString() };
        await storageSet({ [storageKey]: locale });
        return { language: candidate, ...locale };
      } catch (error) {
        if (candidate === "en-US") throw error;
      }
    }
    throw new Error("无法加载 CSL locale");
  }

  async function getStylePayload(id = "", preferredLanguage = "") {
    const registry = await ensureInitialized();
    const style = registry.styles.find((entry) => entry.id === (id || registry.defaultStyleId));
    if (!style) throw new Error("未选择有效的题录样式");
    const values = await storageGet({ [style.storageKey]: "", [style.parentStorageKey || "__none__"]: "" });
    const styleXml = values[style.storageKey];
    if (!styleXml) throw new Error("样式 XML 缺失，请刷新或重新安装");
    let parentStyleXml = "";
    if (style.dependent) {
      parentStyleXml = values[style.parentStorageKey];
      if (!parentStyleXml) {
        const parent = await downloadParent(style.parentId, registry);
        parentStyleXml = parent.xml;
        style.parentStorageKey = parent.metadata.storageKey;
        style.parentTitle = parent.metadata.title;
        style.parentDefaultLocale = parent.metadata.defaultLocale;
        style.parentLocales = parent.metadata.locales;
        await saveRegistry(registry);
      }
    }
    const renderLanguage = normalizeLanguage(style.defaultLocale || style.parentDefaultLocale || preferredLanguage || "en-US");
    const localeLanguages = [...new Set([
      renderLanguage,
      ...(Array.isArray(style.locales) ? style.locales.map(normalizeLanguage) : []),
      ...(Array.isArray(style.parentLocales) ? style.parentLocales.map(normalizeLanguage) : []),
      ...(style.parentDefaultLocale ? [normalizeLanguage(style.parentDefaultLocale)] : []),
      "en-US",
      "zh-CN"
    ])];
    const locales = {};
    for (const language of localeLanguages) {
      const locale = await getLocale(language);
      locales[locale.language] = locale.xml;
    }
    return { style, styleXml, parentStyleXml, locales, language: renderLanguage, defaultStyleId: registry.defaultStyleId };
  }

  root.JournalLensCslStyles = {
    DEFAULT_STYLE_ID,
    REGISTRY_KEY,
    ensureInitialized,
    getLocale,
    getStyleIndex,
    getStylePayload,
    importStyle,
    installStyle,
    listStyles,
    parseCslStyle,
    parseLocale,
    removeStyle,
    searchStyles,
    setDefaultStyle
  };
})();
