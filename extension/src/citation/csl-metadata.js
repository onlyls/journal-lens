(() => {
  "use strict";

  const root = globalThis;
  const shared = root.JournalLensShared;

  function text(value) {
    return shared.collapseWhitespace(value);
  }

  function normalizeDoi(value) {
    return shared.normalizeDoi(value);
  }

  function normalizeIssns(value) {
    const values = Array.isArray(value) ? value : String(value || "").split(/[;,]/);
    return shared.unique(values.map(shared.normalizeIssn));
  }

  function parseName(value) {
    if (!value) return null;
    if (typeof value === "object") {
      const literal = text(value.literal || value.name);
      const family = text(value.family || value.familyName || value.lastName);
      const given = text(value.given || value.givenName || value.firstName);
      if (family || given) return { family, given };
      return literal ? { literal } : null;
    }
    const name = text(value);
    if (!name) return null;
    if (name.includes(",")) {
      const [family, ...given] = name.split(",");
      return { family: text(family), given: text(given.join(" ")) };
    }
    if (/^[\u3400-\u9fff]{2,4}$/.test(name.replace(/\s/g, ""))) {
      const compact = name.replace(/\s/g, "");
      return { family: compact.slice(0, 1), given: compact.slice(1) };
    }
    const parts = name.split(/\s+/);
    if (parts.length === 1) return { literal: name };
    return { family: parts.pop(), given: parts.join(" ") };
  }

  function normalizeAuthors(value) {
    let authors = value;
    if (!Array.isArray(authors)) authors = authors ? [authors] : [];
    return authors.map(parseName).filter(Boolean);
  }

  function normalizeDate(value) {
    if (!value) return undefined;
    if (value["date-parts"] && Array.isArray(value["date-parts"])) {
      const parts = value["date-parts"][0]
        .map(Number)
        .filter((part) => Number.isInteger(part) && part > 0)
        .slice(0, 3);
      return parts.length ? { "date-parts": [parts] } : undefined;
    }
    if (Array.isArray(value)) {
      const parts = value.map(Number).filter((part) => Number.isInteger(part) && part > 0).slice(0, 3);
      return parts.length ? { "date-parts": [parts] } : undefined;
    }
    if (typeof value === "object") {
      const year = Number(value.year || value.dateYear);
      const month = Number(value.month || value.dateMonth);
      const day = Number(value.day || value.dateDay);
      return year > 0 ? { "date-parts": [[year, ...(month > 0 ? [month] : []), ...(day > 0 ? [day] : [])]] } : undefined;
    }
    const raw = text(value);
    const match = raw.match(/(?:^|\D)((?:18|19|20|21)\d{2})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?/);
    if (!match) return undefined;
    const parts = [Number(match[1])];
    if (Number(match[2]) >= 1 && Number(match[2]) <= 12) parts.push(Number(match[2]));
    if (parts.length === 2 && Number(match[3]) >= 1 && Number(match[3]) <= 31) parts.push(Number(match[3]));
    return { "date-parts": [parts] };
  }

  function pageFirst(page) {
    return text(page).split(/[-–—]/)[0] || "";
  }

  function createId(input) {
    const doi = normalizeDoi(input.DOI || input.doi);
    if (doi) return `doi:${doi}`;
    const pmid = text(input.PMID || input.pubmedId);
    if (pmid) return `pmid:${pmid}`;
    const seed = text(input.id || input.URL || input.url || input.title || "article").toLowerCase();
    let hash = 2166136261;
    for (const char of seed) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `journal-lens:${(hash >>> 0).toString(36)}`;
  }

  function normalizeItem(input = {}, source = "unknown") {
    const page = text(input.page || input.pages || input.pagination);
    const articleNumber = text(input.number || input.articleNumber || input["article-number"]);
    const DOI = normalizeDoi(input.DOI || input.doi);
    const containerTitle = text(input["container-title"] || input.containerTitle || input.journal || input.journalTitle);
    const item = {
      id: createId(input),
      type: text(input.type) || "article-journal",
      title: text(input.title),
      author: normalizeAuthors(input.author || input.authors || input.creator),
      "container-title": containerTitle,
      "container-title-short": text(input["container-title-short"] || input.containerTitleShort || input.journalAbbreviation || input.source),
      issued: normalizeDate(input.issued || input.published || input.publicationDate || input.date || input.year),
      volume: text(input.volume),
      issue: text(input.issue || input.numberIssue),
      page: page || articleNumber,
      "page-first": text(input["page-first"] || input.pageFirst) || pageFirst(page || articleNumber),
      number: articleNumber,
      DOI,
      URL: text(input.URL || input.url) || (DOI ? `https://doi.org/${DOI}` : ""),
      ISSN: normalizeIssns(input.ISSN || input.issns || [input.issn, input.eissn]),
      publisher: text(input.publisher),
      language: text(input.language || input.inLanguage)
    };
    const sources = {};
    Object.entries(item).forEach(([key, value]) => {
      if (hasValue(value)) sources[key] = source;
    });
    return { item, sources };
  }

  function hasValue(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return value !== "" && value !== null && value !== undefined;
  }

  function mergeNormalized(base, patch, options = {}) {
    const result = { item: { ...(base && base.item || {}) }, sources: { ...(base && base.sources || {}) } };
    const incoming = patch && patch.item || {};
    const preferPatch = Boolean(options.preferPatch);
    for (const [key, value] of Object.entries(incoming)) {
      if (!hasValue(value)) continue;
      if (key === "ISSN") {
        result.item.ISSN = shared.unique([...(result.item.ISSN || []), ...value]);
        if (!result.sources.ISSN) result.sources.ISSN = patch.sources.ISSN;
        continue;
      }
      if (preferPatch || !hasValue(result.item[key])) {
        result.item[key] = value;
        result.sources[key] = patch.sources[key] || "unknown";
      }
    }
    const doi = normalizeDoi(result.item.DOI);
    if (doi) {
      result.item.DOI = doi;
      if (!result.item.URL) result.item.URL = `https://doi.org/${doi}`;
      result.item.id = `doi:${doi}`;
    }
    return result;
  }

  function metadataWarnings(item) {
    const missing = [];
    if (!item.title) missing.push("题名");
    if (!Array.isArray(item.author) || !item.author.length) missing.push("作者");
    if (!item["container-title"]) missing.push("期刊");
    if (!item.issued) missing.push("年份");
    if (!item.volume) missing.push("卷号");
    if (!item.page && !item.number) missing.push("页码或文章编号");
    if (!item.DOI) missing.push("DOI");
    return missing.length ? [`元数据不完整：缺少${missing.join("、")}`] : [];
  }

  function isUsable(item) {
    if (item.DOI && item.title) return true;
    return Boolean(item.title && item["container-title"] && item.issued && item.author && item.author.length);
  }

  root.JournalLensCslMetadata = {
    hasValue,
    isUsable,
    mergeNormalized,
    metadataWarnings,
    normalizeAuthors,
    normalizeDate,
    normalizeItem
  };
})();
