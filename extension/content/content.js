(() => {
  "use strict";

  const shared = window.JournalLensShared;
  const store = window.JournalLensStore;
  const build = window.JournalLensBuild || {};
  const DEBUG_VERSION = build.version || "0.4.2";
  const RELATED_CONTEXT_PATTERN = /reference|recommend|related|similar|bibliograph|citation|search-result|docsum/i;
  const state = {
    settings: null,
    dataset: null,
    index: null,
    pageMode: "unknown",
    record: null,
    localMetric: null,
    easyScholarMetric: null,
    metric: null,
    easyScholarLoading: false,
    easyScholarResolved: false,
    easyScholarError: "",
    easyScholarCached: false,
    easyScholarRequestName: "",
    easyScholarRequestToken: 0,
    openAlex: null,
    articleHost: null,
    annotatedContainers: new WeakSet(),
    annotatedItemHosts: new Map(),
    relatedCount: 0,
    observer: null,
    observerTimer: 0,
    reloadTimer: 0,
    resolveQueue: [],
    activeResolutions: 0
  };

  if (window.__journalLensInjected) return;
  window.__journalLensInjected = true;

  init();

  async function init() {
    const [settings, dataset] = await Promise.all([loadContentSettings(), store.getDataset()]);
    state.settings = settings;
    state.dataset = dataset;
    state.index = shared.buildMetricIndex(dataset.rows);
    readPageContext();
    renderCurrentPage();
    bindMessages();
    bindStorageChanges();
  }

  async function loadContentSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "JournalLens:getContentSettings" });
      if (response && response.ok && response.settings) {
        return { ...shared.DEFAULT_SETTINGS, ...response.settings };
      }
    } catch (_error) {
      // Keep the page usable if the service worker is restarting.
    }
    return {
      ...shared.DEFAULT_SETTINGS,
      easyScholarConfigured: false
    };
  }

  function readPageContext() {
    const meta = collectMeta();
    const jsonLd = collectJsonLd();
    state.pageMode = detectPageMode(meta, jsonLd);
    state.record = extractPageRecord(meta, jsonLd, state.pageMode);
    state.localMetric = state.pageMode === "article"
      ? shared.findMetricForRecord(state.record, state.index)
      : null;
    state.easyScholarMetric = null;
    state.easyScholarLoading = false;
    state.easyScholarResolved = false;
    state.easyScholarError = "";
    state.easyScholarCached = false;
    state.easyScholarRequestName = "";
    state.easyScholarRequestToken += 1;
    state.metric = mergeMetricSources(state.localMetric, state.easyScholarMetric);
  }

  function renderCurrentPage() {
    if (state.pageMode === "article") {
      renderArticleBadge();
      enrichWithOpenAlex();
      enrichArticleWithEasyScholar();
    }

    if (relatedMode() !== "off") {
      annotateRelatedArticles();
      observeDynamicContent();
    }
  }

  function relatedMode() {
    if (!state.settings || state.settings.annotateLists === false) return "off";
    return ["manual", "auto", "off"].includes(state.settings.relatedArticleMode)
      ? state.settings.relatedArticleMode
      : "manual";
  }

  function debugFeaturesAvailable() {
    return build.enableDebug !== false;
  }

  function debugModeEnabled() {
    return debugFeaturesAvailable() && Boolean(state.settings && state.settings.debugMode);
  }

  function ableSciAssistEnabled() {
    return Boolean(state.settings && state.settings.enableAbleSciAssist !== false);
  }

  function metricSourceMode() {
    const mode = state.settings && state.settings.metricSourceMode;
    return ["local", "hybrid", "easyScholar"].includes(mode) ? mode : "local";
  }

  function easyScholarEnabled() {
    return metricSourceMode() !== "local"
      && Boolean(state.settings && state.settings.easyScholarConfigured);
  }

  function easyScholarNeedsKey() {
    return metricSourceMode() !== "local"
      && !Boolean(state.settings && state.settings.easyScholarConfigured);
  }

  function mergeMetricSources(localMetric, easyScholarMetric) {
    const mode = metricSourceMode();
    if (mode === "local") return localMetric || null;
    if (mode === "easyScholar") return easyScholarMetric || null;
    if (!localMetric) return easyScholarMetric || null;
    if (!easyScholarMetric) return localMetric;

    const merged = { ...easyScholarMetric, ...localMetric };
    ["xrPartition", "casPartition", "jcrQuartile", "impactFactor", "warning", "year"].forEach((field) => {
      merged[field] = shared.collapseWhitespace(localMetric[field])
        || shared.collapseWhitespace(easyScholarMetric[field]);
    });
    merged.title = shared.collapseWhitespace(localMetric.title || easyScholarMetric.title);
    merged.source = shared.unique([localMetric.source, easyScholarMetric.source]).join(" + ");
    merged.provider = "hybrid";
    merged.extraMetrics = mergeExtraMetrics(easyScholarMetric.extraMetrics, localMetric.extraMetrics);
    return merged;
  }

  function mergeExtraMetrics(...groups) {
    const result = [];
    const seen = new Set();
    groups.flatMap((group) => Array.isArray(group) ? group : []).forEach((entry) => {
      const label = shared.collapseWhitespace(entry && entry.label);
      const value = shared.collapseWhitespace(entry && entry.value);
      if (!label || !value) return;
      const key = shared.collapseWhitespace(entry.key) || `${label}:${value}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ ...entry, key, label, value });
    });
    return result;
  }

  function easyScholarPublicationName(record, localMetric) {
    return shared.collapseWhitespace(
      (localMetric && localMetric.title)
      || (record && (record.journal || record.containerTitle || record.source))
    );
  }

  function bindMessages() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== "JournalLens:getPageStatus") return false;
      sendResponse({
        ok: true,
        pageMode: state.pageMode,
        relatedCount: state.relatedCount,
        record: state.record,
        metric: state.metric,
        openAlex: state.openAlex,
        features: {
          ableSciAssist: ableSciAssistEnabled()
        },
        easyScholar: {
          mode: metricSourceMode(),
          configured: Boolean(state.settings && state.settings.easyScholarConfigured),
          loading: state.easyScholarLoading,
          resolved: state.easyScholarResolved,
          cached: state.easyScholarCached,
          error: state.easyScholarError,
          metric: state.easyScholarMetric
        },
        dataset: {
          rows: state.dataset ? state.dataset.rows.length : 0,
          importedAt: state.dataset ? state.dataset.importedAt : "",
          fileName: state.dataset ? state.dataset.fileName : ""
        }
      });
      return true;
    });
  }

  function bindStorageChanges() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (!changes["journalLens.dataset"] && !changes["journalLens.settings"]) return;
      window.clearTimeout(state.reloadTimer);
      state.reloadTimer = window.setTimeout(reloadFromStorage, 120);
    });
  }

  async function reloadFromStorage() {
    const [settings, dataset] = await Promise.all([loadContentSettings(), store.getDataset()]);
    state.settings = settings;
    state.dataset = dataset;
    state.index = shared.buildMetricIndex(dataset.rows);
    state.openAlex = null;
    clearRenderedComponents();
    readPageContext();
    renderCurrentPage();
  }

  function clearRenderedComponents() {
    if (state.articleHost && state.articleHost.isConnected) state.articleHost.remove();
    document.querySelectorAll(".journal-lens-related-host,.journal-lens-related-slot,.journal-lens-inline-host")
      .forEach((node) => node.remove());
    state.articleHost = null;
    state.relatedCount = 0;
    state.annotatedContainers = new WeakSet();
    state.annotatedItemHosts = new Map();
    state.resolveQueue = [];
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }

  function detectPageMode(meta, jsonLd) {
    const host = location.hostname;
    if (host === "pubmed.ncbi.nlm.nih.gov" && document.querySelector("main.search-page article.full-docsum")) {
      return "list";
    }

    const hasCitationMetadata = Boolean(
      firstValue(meta.citation_title)
      && firstValue(meta.citation_doi, meta.citation_journal_title, meta.prism_publicationname)
    );
    const isPubMedArticle = host === "pubmed.ncbi.nlm.nih.gov" && /^\/\d+\/?$/.test(location.pathname);
    const isDoiArticle = /\/doi\/(?:abs\/|full\/|epdf\/)?10\.\d{4,9}\//i.test(location.pathname);
    if (hasCitationMetadata || jsonLd.isArticle || isPubMedArticle || isDoiArticle) return "article";
    if (document.querySelector("article.full-docsum,[class*='search-result' i]")) return "list";
    return "unknown";
  }

  function extractPageRecord(meta, jsonLd, mode) {
    const articleMode = mode === "article";
    const doi = articleMode ? shared.normalizeDoi(firstValue(
      meta.citation_doi,
      meta.dc_identifier,
      meta["dc.identifier"],
      meta.doi,
      jsonLd.doi,
      extractDoiFromText(location.href),
      extractDoiFromText(document.body ? document.body.innerText.slice(0, 8000) : "")
    )) : "";
    const issns = articleMode ? shared.unique([
      ...valuesForPrefix(meta, "citation_issn").map(shared.normalizeIssn),
      ...valuesForPrefix(meta, "prism.issn").map(shared.normalizeIssn),
      ...valuesForPrefix(meta, "dc.issn").map(shared.normalizeIssn),
      ...(Array.isArray(jsonLd.issns) ? jsonLd.issns.map(shared.normalizeIssn) : [])
    ]) : [];

    return {
      title: articleMode ? shared.collapseWhitespace(firstValue(
        meta.citation_title,
        meta.dc_title,
        meta["dc.title"],
        meta.og_title,
        jsonLd.title,
        textFromSelector("h1")
      )) : "",
      journal: articleMode ? shared.collapseWhitespace(firstValue(
        meta.citation_journal_title,
        meta.prism_publicationname,
        meta["prism.publicationname"],
        meta.dc_source,
        meta["dc.source"],
        jsonLd.journal,
        textFromSelector("[data-test='journal-title']"),
        textFromSelector("[data-testid='journal-title']"),
        textFromSelector("[data-qa='journal-title']"),
        textFromSelector(".journal-title")
      )) : "",
      doi,
      issn: issns[0] || "",
      issns,
      url: location.href,
      host: location.hostname,
      pageTitle: document.title
    };
  }

  function collectMeta() {
    const result = {};
    document.querySelectorAll("meta").forEach((node) => {
      const rawName = node.getAttribute("name") || node.getAttribute("property") || node.getAttribute("http-equiv");
      const content = node.getAttribute("content");
      if (!rawName || !content) return;
      const key = rawName.toLowerCase().replace(/[:\s-]+/g, "_");
      if (!result[key]) result[key] = content;
      else if (Array.isArray(result[key])) result[key].push(content);
      else result[key] = [result[key], content];
    });
    return result;
  }

  function valuesForPrefix(meta, prefix) {
    const normalizedPrefix = prefix.toLowerCase().replace(/[:\s-]+/g, "_");
    return Object.entries(meta)
      .filter(([key]) => key === normalizedPrefix || key.startsWith(`${normalizedPrefix}_`))
      .flatMap(([, value]) => Array.isArray(value) ? value : [value]);
  }

  function collectJsonLd() {
    const candidates = [];
    document.querySelectorAll("script[type='application/ld+json']").forEach((node) => {
      try {
        candidates.push(JSON.parse(node.textContent || "null"));
      } catch (_error) {
        // Publisher pages commonly contain one malformed JSON-LD block.
      }
    });

    const flattened = [];
    const visit = (value) => {
      if (!value) return;
      if (Array.isArray(value)) value.forEach(visit);
      else if (typeof value === "object") {
        flattened.push(value);
        if (Array.isArray(value["@graph"])) value["@graph"].forEach(visit);
      }
    };
    candidates.forEach(visit);

    const article = flattened.find((entry) => {
      const type = String(entry["@type"] || "").toLowerCase();
      return type.includes("scholarlyarticle") || type === "article" || type.endsWith("article");
    });
    if (!article) return { isArticle: false, title: "", journal: "", doi: "", issns: [] };

    const isPartOf = article.isPartOf || article.publisher || {};
    const periodical = Array.isArray(isPartOf) ? isPartOf[0] : isPartOf;
    const issns = shared.unique([
      periodical && periodical.issn,
      article.issn,
      ...(Array.isArray(periodical && periodical.issn) ? periodical.issn : []),
      ...(Array.isArray(article.issn) ? article.issn : [])
    ].flat());

    return {
      isArticle: true,
      title: article.headline || article.name || "",
      journal: (periodical && (periodical.name || periodical.displayName)) || "",
      doi: article.doi || article.identifier || "",
      issns
    };
  }

  function firstValue(...values) {
    for (const value of values) {
      if (Array.isArray(value)) {
        const inner = firstValue(...value);
        if (inner) return inner;
      } else if (shared.collapseWhitespace(value)) {
        return value;
      }
    }
    return "";
  }

  function textFromSelector(selector, root = document) {
    const node = root.querySelector(selector);
    return node ? shared.collapseWhitespace(node.textContent) : "";
  }

  function extractDoiFromText(text) {
    return shared.normalizeDoi(text);
  }

  function renderArticleBadge() {
    if (state.pageMode !== "article") return;
    if (!state.record || (!state.record.journal && !state.record.doi && !state.record.title)) return;
    if (!state.metric && !state.settings.showUnmatchedArticleBadge && metricSourceMode() === "local") return;

    const target = findArticleTarget();
    if (!target) return;
    const host = createArticleBadge(state.record, state.metric, state.openAlex, {
      loading: state.easyScholarLoading,
      resolved: state.easyScholarResolved,
      error: state.easyScholarError,
      needsKey: easyScholarNeedsKey()
    });
    host.classList.add("journal-lens-host");

    if (state.articleHost && state.articleHost.isConnected) state.articleHost.replaceWith(host);
    else target.insertAdjacentElement("afterend", host);
    state.articleHost = host;
  }

  function findArticleTarget() {
    return document.querySelector("h1:not(.usa-sr-only)")
      || document.querySelector("[data-test='article-title']")
      || document.querySelector("[data-testid='article-title']")
      || document.querySelector("[class*='article-title' i]");
  }

  function annotateRelatedArticles() {
    if (relatedMode() === "off") return;
    for (const [key, host] of state.annotatedItemHosts) {
      if (!host || !host.isConnected) state.annotatedItemHosts.delete(key);
    }
    const items = collectRelatedItems().slice(0, 500);
    for (const item of items) {
      if (!item.container) continue;
      const existingHost = item.key ? state.annotatedItemHosts.get(item.key) : null;
      if (existingHost && existingHost.isConnected) {
        if (item.exclusive) removeDuplicateRelatedHosts(item.container, existingHost);
        refreshRelatedEntry(existingHost.__journalLensEntry, item);
        continue;
      }
      if (item.key && existingHost) state.annotatedItemHosts.delete(item.key);
      if (!item.key && state.annotatedContainers.has(item.container)) continue;
      if (item.exclusive) removeDuplicateRelatedHosts(item.container);
      const localMetric = shared.findMetricForRecord(item.record, state.index)
        || findMetricInCitation(item.container, item.record);
      if (localMetric && !item.record.journal) item.record.journal = localMetric.title;

      const entry = {
        container: item.container,
        target: item.target,
        record: item.record,
        localMetric,
        easyScholarMetric: null,
        metric: mergeMetricSources(localMetric, null),
        key: item.key || "",
        debugSource: item.debugSource || debugSourceFromKey(item.key),
        journalAuthoritative: Boolean(item.journalAuthoritative),
        placement: item.placement || "after",
        expanded: relatedMode() === "auto",
        loading: false,
        resolved: false,
        error: "",
        easyScholarLoading: false,
        easyScholarResolved: false,
        easyScholarError: "",
        easyScholarCached: false,
        easyScholarRequestName: "",
        easyScholarRequestToken: 0,
        host: document.createElement("span")
      };
      entry.host.classList.add("journal-lens-related-host");
      entry.host.dataset.journalLensKey = item.key || "";
      entry.host.__journalLensEntry = entry;
      entry.host.attachShadow({ mode: "open" });
      renderRelatedControl(entry);
      insertRelatedControl(entry);
      state.annotatedContainers.add(item.container);
      if (item.key) state.annotatedItemHosts.set(item.key, entry.host);
      state.relatedCount += 1;

      if (entry.expanded) startRelatedEnrichment(entry);
    }
    for (const item of items) {
      if (!item.exclusive || !item.container) continue;
      const canonicalHost = item.key ? state.annotatedItemHosts.get(item.key) : null;
      if (canonicalHost && canonicalHost.isConnected) {
        removeDuplicateRelatedHosts(item.container, canonicalHost);
      }
    }
    state.relatedCount = document.querySelectorAll(".journal-lens-related-host").length;
  }

  function removeDuplicateRelatedHosts(container, keepHost = null) {
    if (!container || !container.querySelectorAll) return;
    container.querySelectorAll(".journal-lens-related-host").forEach((host) => {
      if (host === keepHost) return;
      for (const [key, mappedHost] of state.annotatedItemHosts) {
        if (mappedHost === host) state.annotatedItemHosts.delete(key);
      }
      host.remove();
    });
    container.querySelectorAll(".journal-lens-related-slot").forEach((slot) => {
      if (!slot.querySelector(".journal-lens-related-host")) slot.remove();
    });
  }

  function refreshRelatedEntry(entry, item) {
    if (!entry || !item) return;
    entry.container = item.container;
    entry.target = item.target;
    entry.key = item.key || entry.key;
    entry.debugSource = item.debugSource || entry.debugSource || debugSourceFromKey(item.key);
    entry.journalAuthoritative = Boolean(entry.journalAuthoritative || item.journalAuthoritative);
    entry.placement = item.placement || entry.placement;
    entry.record = mergeRelatedRecords(entry.record, item.record);
    const localMetric = shared.findMetricForRecord(entry.record, state.index)
      || findMetricInCitation(item.container, entry.record);
    if (localMetric) {
      entry.localMetric = localMetric;
      if (!entry.record.journal) entry.record.journal = localMetric.title;
    }
    entry.metric = mergeMetricSources(entry.localMetric, entry.easyScholarMetric);
    renderRelatedControl(entry);
    if (entry.expanded) startRelatedEnrichment(entry);
  }

  function mergeRelatedRecords(current = {}, incoming = {}) {
    const merged = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
      if (Array.isArray(value)) {
        merged[key] = shared.unique([...(Array.isArray(merged[key]) ? merged[key] : []), ...value]);
      } else if (value !== undefined && value !== null && value !== "") {
        merged[key] = value;
      }
    }
    return merged;
  }

  function collectRelatedItems() {
    const items = [];
    const seenContainers = new Set();
    const seenItemKeys = new Set();
    const handledRoots = [];

    const addItem = (item) => {
      if (!item || !item.container || !item.target || !hasUsefulRecord(item.record)) return;
      const key = item.key || buildRelatedItemKey(item.record, item.context || item.container);
      if (seenContainers.has(item.container) || (key && seenItemKeys.has(key))) return;
      items.push({ ...item, key });
      seenContainers.add(item.container);
      if (key) seenItemKeys.add(key);
    };

    document.querySelectorAll("article.full-docsum").forEach((container) => {
      const record = parsePubMedResult(container);
      const target = container.querySelector(".full-journal-citation")
        || container.querySelector(".docsum-journal-citation")
        || container.querySelector(".docsum-title");
      if (target && hasUsefulRecord(record)) {
        addItem({
          container,
          target,
          record,
          key: `pubmed:${record.pubmedId || relatedRecordIdentity(record)}`
        });
        handledRoots.push(container);
      }
    });

    const scienceDirect = collectScienceDirectReferences();
    scienceDirect.items.forEach(addItem);
    handledRoots.push(...scienceDirect.roots);

    const nature = collectNatureReferences();
    nature.items.forEach(addItem);
    handledRoots.push(...nature.roots);

    const wiley = collectWileyItems();
    wiley.items.forEach(addItem);
    handledRoots.push(...wiley.roots);

    const acsRecommended = collectAcsRecommendedArticles();
    acsRecommended.items.forEach(addItem);
    handledRoots.push(...acsRecommended.roots);

    const links = document.querySelectorAll([
      "a[href*='doi.org/']",
      "a[href*='/doi/']",
      "a[href*='/article/']",
      "a[href*='/articles/']"
    ].join(","));

    for (const link of links) {
      if (link.closest(".journal-lens-host,.journal-lens-related-host")) continue;
      if (handledRoots.some((root) => root === link || root.contains(link))) continue;
      if (isInScienceDirectReferenceList(link)) continue;
      const context = findRelatedContext(link);
      if (!context) continue;
      const container = findRelatedContainer(link, context);
      if (!container || seenContainers.has(container) || container.contains(state.articleHost)) continue;
      const record = parseGenericRelatedRecord(container, link);
      if (!hasUsefulRecord(record) || isMainArticleRecord(record)) continue;
      const target = pickRelatedTarget(container, link);
      if (!target) continue;
      addItem({ container, target, record, context });
    }
    return items;
  }

  function collectScienceDirectReferences() {
    if (location.hostname !== "www.sciencedirect.com") return { items: [], roots: [] };
    const markers = [...document.querySelectorAll("[id]")].filter((node) => /^bib\d+/i.test(node.id));
    const referenceRoot = findScienceDirectReferencesRoot(markers);
    let descriptors = markers.map((marker, index) => ({
      container: resolveScienceDirectReferenceContainer(marker),
      key: marker.id || `bib-${index}`
    })).filter((entry) => entry.container);

    const modernRoot = referenceRoot || document;
    [...modernRoot.querySelectorAll("li")].forEach((container, index) => {
      const reference = container.querySelector(":scope > span.reference[id],:scope > .reference[id]")
        || container.querySelector("span.reference[id]");
      const citation = container.querySelector(":scope > span.reference .host,:scope > .reference .host,.host");
      if (!reference || !citation || !isScienceDirectReferenceContent(container)) return;
      descriptors.push({
        container,
        key: reference.id || buildScienceDirectReferenceKey(container, index)
      });
    });

    const termRoot = referenceRoot || document;
    [...termRoot.querySelectorAll("dt")].forEach((term, index) => {
      const container = term.nextElementSibling && term.nextElementSibling.matches("dd")
        ? term.nextElementSibling
        : null;
      if (!container || !isScienceDirectReferenceContent(container)) return;
      const marker = term.querySelector("[id^='bib' i]");
      const ordinal = extractReferenceOrdinal(term.textContent);
      descriptors.push({
        container,
        key: (marker && marker.id) || (ordinal ? `bib-${ordinal}` : `term-${index}`)
      });
    });

    const citationScope = referenceRoot || document;
    findScienceDirectCitationNodes(citationScope).forEach((citationNode, index) => {
      const container = resolveScienceDirectCitationContainer(citationNode);
      if (!container) return;
      descriptors.push({
        container,
        key: buildScienceDirectReferenceKey(container, index)
      });
    });

    if (referenceRoot) {
      [...referenceRoot.querySelectorAll([
        "li[id^='bib' i]",
        "li[id^='ref' i]",
        "[role='listitem'][id]",
        "[class*='reference-entry' i]",
        "[class*='reference-item' i]"
      ].join(","))].forEach((container, index) => {
        if (!isScienceDirectReferenceContent(container)) return;
        const marker = container.matches("[id^='bib' i]")
          ? container
          : container.querySelector("[id^='bib' i]");
        const ordinal = extractReferenceOrdinal(container.textContent);
        descriptors.push({
          container,
          key: (marker && marker.id) || container.id || (ordinal ? `bib-${ordinal}` : `entry-${index}`)
        });
      });
    }

    if (!descriptors.length) {
      const section = referenceRoot || findLabeledSection(/^references?$/i);
      if (section) {
        const doiLinks = [...section.querySelectorAll("a[href]")].filter((link) => {
          return Boolean(extractDoiFromText(link.href) || extractDoiFromText(link.textContent));
        });
        descriptors = shared.unique(doiLinks.map((link) => findSmallestUniqueContainer(link, section, doiLinks)))
          .map((container, index) => ({ container, key: `fallback-${index}` }));
      }
    }

    const seenRoots = new Set();
    descriptors = descriptors.filter(({ container }) => {
      if (seenRoots.has(container) || !isScienceDirectReferenceContent(container)) return false;
      seenRoots.add(container);
      return true;
    });

    const items = [];
    descriptors.forEach(({ container, key }, index) => {
      const links = [...container.querySelectorAll("a[href]")];
      const sourceLink = links.find((link) => extractDoiFromText(link.href) || extractDoiFromText(link.textContent))
        || links.find((link) => /view at publisher|view article/i.test(link.textContent));
      const titleNode = findScienceDirectReferenceTitle(container);
      const title = shared.collapseWhitespace(titleNode && titleNode.textContent)
        || extractScienceDirectReferenceTitle(container);
      const containerText = shared.collapseWhitespace(container.textContent).slice(0, 1800);
      const sourceUrl = sourceLink ? new URL(sourceLink.getAttribute("href"), location.href).href : "";
      const record = {
        title,
        journal: extractScienceDirectJournal(container, title),
        doi: extractDoiFromText(containerText)
          || links.map((link) => extractDoiFromText(link.href)).find(Boolean)
          || "",
        url: sourceUrl,
        host: location.hostname,
        issns: []
      };
      if (!record.doi && !record.journal) return;
      items.push({
        container,
        target: findScienceDirectCitationNode(container) || titleNode || container,
        record,
        key: `sciencedirect:${key || relatedRecordIdentity(record) || index}`,
        exclusive: true,
        placement: "after-block"
      });
    });
    return {
      items,
      roots: shared.unique([referenceRoot, ...descriptors.map((entry) => entry.container)])
    };
  }

  function findScienceDirectReferencesRoot(markers) {
    const modernRoot = [...document.querySelectorAll([
      "[class~='bibliography']",
      "[class*='bibliograph' i]",
      "[id^='bi'][class*='text' i]"
    ].join(","))].find((node) => {
      return node.querySelector("li > span.reference[id],li > .reference[id]");
    });
    if (modernRoot) return modernRoot;

    const heading = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")]
      .find((node) => /^references?$/i.test(shared.collapseWhitespace(node.textContent)));
    if (heading && markers.length) {
      let node = heading.parentElement;
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        if (node !== document.body && !node.matches("main") && markers.some((marker) => node.contains(marker))) {
          return node;
        }
        if (node === document.body) break;
      }
    }
    const markerRoot = markers[0] && markers[0].closest([
      "section",
      "[role='region']",
      "[class*='references' i]",
      "[id*='references' i]"
    ].join(","));
    return markerRoot && markerRoot !== document.body ? markerRoot : null;
  }

  function extractReferenceOrdinal(value) {
    const match = shared.collapseWhitespace(value).match(/^\[?\s*(\d{1,4})\s*\]?/);
    return match ? match[1] : "";
  }

  function isInScienceDirectReferenceList(node) {
    if (location.hostname !== "www.sciencedirect.com" || !node || !node.closest) return false;
    const modernReference = node.closest("span.reference,[class~='reference']");
    if (modernReference && modernReference.querySelector(".host")) return true;
    const modernItem = node.closest("li");
    if (modernItem && modernItem.querySelector(":scope > span.reference[id],:scope > .reference[id]")) {
      return true;
    }
    const description = node.closest("dd");
    if (description) {
      const term = description.previousElementSibling;
      if (term && term.matches("dt")
        && (term.querySelector("[id^='bib' i]") || extractReferenceOrdinal(term.textContent))) {
        return true;
      }
    }
    const referenceRoot = node.closest([
      "dl.references",
      "[id*='reference-links' i]",
      "[class*='references-list' i]",
      "[class*='reference-list' i]"
    ].join(","));
    if (referenceRoot && referenceRoot.querySelector("dt,[id^='bib' i]")) return true;
    const referenceItem = node.closest([
      "li[id^='bib' i]",
      "li[id^='ref' i]",
      "[role='listitem'][class*='reference' i]",
      "[class*='reference-entry' i]",
      "[class*='reference-item' i]"
    ].join(","));
    return Boolean(referenceItem && isScienceDirectReferenceContent(referenceItem));
  }

  function resolveScienceDirectCitationContainer(citationNode) {
    const modernReference = citationNode.closest("span.reference,[class~='reference']");
    const modernItem = modernReference && modernReference.closest("li");
    if (modernItem) return modernItem;
    const description = citationNode.closest("dd");
    if (description) {
      const term = description.previousElementSibling;
      if (term && term.matches("dt")
        && (term.querySelector("[id^='bib' i]") || extractReferenceOrdinal(term.textContent))) {
        return description;
      }
    }
    const referenceItem = citationNode.closest([
      "li[id^='bib' i]",
      "li[id^='ref' i]",
      "[role='listitem'][class*='reference' i]",
      "[class*='reference-entry' i]",
      "[class*='reference-item' i]"
    ].join(","));
    return referenceItem && isScienceDirectReferenceContent(referenceItem) ? referenceItem : null;
  }

  function buildScienceDirectReferenceKey(container, index) {
    const modernReference = container.querySelector(":scope > span.reference[id],:scope > .reference[id]")
      || container.querySelector("span.reference[id]");
    if (modernReference && modernReference.id) return modernReference.id;
    const descriptionTerm = container.matches("dd") ? container.previousElementSibling : null;
    const marker = (descriptionTerm && descriptionTerm.querySelector("[id^='bib' i]"))
      || (container.matches("[id^='bib' i]") ? container : container.querySelector("[id^='bib' i]"));
    const ordinal = extractReferenceOrdinal((descriptionTerm && descriptionTerm.textContent) || container.textContent);
    return (marker && marker.id) || container.id || (ordinal ? `bib-${ordinal}` : `citation-${index}`);
  }

  function resolveScienceDirectReferenceContainer(marker) {
    if (isScienceDirectReferenceContent(marker)) return marker;

    const direct = marker.closest([
      "li",
      "article",
      "[role='listitem']",
      "[class*='reference-entry' i]",
      "[class*='reference-item' i]"
    ].join(","));
    if (direct && isScienceDirectReferenceContent(direct)) return direct;

    const term = marker.closest("dt");
    if (term && term.nextElementSibling && term.nextElementSibling.matches("dd")) {
      return term.nextElementSibling;
    }

    let node = marker;
    let best = null;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      const sibling = node.nextElementSibling;
      if (sibling && isScienceDirectReferenceContent(sibling)) return sibling;
      if (isScienceDirectReferenceContent(node)) best = node;
      const markerCount = node.querySelectorAll ? node.querySelectorAll("[id^='bib']").length : 0;
      if (markerCount > 1 || node === document.body || (node.matches && node.matches("main"))) break;
    }
    return best;
  }

  function isScienceDirectReferenceContent(node) {
    if (!node) return false;
    const text = shared.collapseWhitespace(node.textContent);
    if (text.length < 25) return false;
    return /(?:19|20)\d{2}|view article|view at publisher|crossref|google scholar/i.test(text);
  }

  function findScienceDirectReferenceTitle(container) {
    const explicitCandidates = [...container.querySelectorAll([
      "[class*='reference-title' i]",
      "[class*='ref-title' i]",
      "[data-testid*='title' i]",
      "[class*='title' i]"
    ].join(","))].filter((node) => {
      const signature = elementSignature(node);
      const text = shared.collapseWhitespace(node.textContent);
      return !/journal|publication|source/i.test(signature) && text.length >= 8 && text.length <= 500;
    });
    if (explicitCandidates.length) return explicitCandidates[0];

    const inferredTitle = extractScienceDirectReferenceTitle(container);
    if (inferredTitle) {
      const exactNode = findElementByExactText(container, inferredTitle);
      if (exactNode) return exactNode;
    }

    const citation = findScienceDirectCitationNode(container);
    if (!citation) return null;
    let sibling = citation.previousElementSibling;
    while (sibling && shared.collapseWhitespace(sibling.textContent).length < 8) {
      sibling = sibling.previousElementSibling;
    }
    return sibling;
  }

  function findScienceDirectCitationNode(container) {
    const citationNode = findScienceDirectCitationNodes(container)[0];
    if (citationNode) return citationNode;
    const citationLine = visibleTextLines(container).find(isScienceDirectCitationLine);
    if (citationLine) {
      const exactNode = findElementByExactText(container, citationLine);
      if (exactNode) return exactNode;
    }
    return null;
  }

  function findScienceDirectCitationNodes(scope) {
    const matches = [...scope.querySelectorAll("dd,div,p,span")].filter((node) => {
      if (node.closest(".journal-lens-related-host,.journal-lens-related-slot")) return false;
      const text = shared.collapseWhitespace(node.textContent);
      return text.length >= 8 && text.length <= 360 && Boolean(extractScienceDirectJournalFromText(text));
    });
    return matches.filter((node) => !matches.some((other) => other !== node && node.contains(other)));
  }

  function extractScienceDirectReferenceTitle(container) {
    const lines = visibleTextLines(container);
    const citationIndex = lines.findIndex(isScienceDirectCitationLine);
    if (citationIndex <= 0) return "";
    for (let index = citationIndex - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (line.length >= 8 && !/^\[?\d+\]?$/.test(line)) return line;
    }
    return "";
  }

  function isScienceDirectCitationLine(line) {
    return /^[A-Za-z][A-Za-z0-9 .&'()-]{1,110}?,\s*\d+(?:\s*\([^)]*\))?\s*\((?:19|20)\d{2}\)/.test(line);
  }

  function findElementByExactText(container, text) {
    const matches = [...container.querySelectorAll("div,p,span")].filter((node) => {
      return !node.closest(".journal-lens-related-host")
        && shared.collapseWhitespace(node.innerText || node.textContent) === text;
    });
    return matches.reduce((deepest, node) => deepest && deepest.contains(node) ? node : deepest, matches[0] || null);
  }

  function extractScienceDirectJournal(container) {
    const citationNodes = findScienceDirectCitationNodes(container);
    for (const citationNode of citationNodes) {
      const candidate = extractScienceDirectJournalFromText(citationNode.textContent);
      if (candidate) return candidate;
    }

    const lines = visibleTextLines(container);
    let fallback = "";
    for (const line of lines) {
      const match = line.match(/^([A-Za-z][A-Za-z0-9 .&'()-]{1,110}?),\s*\d+(?:\s*\([^)]*\))?\s*\((?:19|20)\d{2}\)/);
      if (!match) continue;
      const candidate = shared.collapseWhitespace(match[1]);
      if (shared.findMetricByText(candidate, state.index)) return candidate;
      const suffix = findMatchingJournalSuffix(candidate);
      if (suffix) return suffix;
      if (!fallback) fallback = candidate;
    }
    const inlineCandidate = extractScienceDirectJournalFromText(container.textContent);
    if (inlineCandidate) return inlineCandidate;
    return fallback;
  }

  function extractScienceDirectJournalFromText(value) {
    const text = shared.collapseWhitespace(value);
    const matches = [...text.matchAll(/([A-Za-z][A-Za-z0-9 .&'()-]{1,220}?),\s*\d+(?:\s*\([^)]*\))?\s*\((?:19|20)\d{2}\)/g)];
    for (const match of matches) {
      const candidate = shared.collapseWhitespace(match[1]);
      if (shared.findMetricByText(candidate, state.index)) return candidate;
      const suffix = findMatchingJournalSuffix(candidate);
      if (suffix) return suffix;
    }
    return "";
  }

  function findMatchingJournalSuffix(value, maxTokens = 12) {
    const tokens = shared.collapseWhitespace(value).split(/\s+/).filter(Boolean);
    for (let length = Math.min(maxTokens, tokens.length); length >= 1; length -= 1) {
      const candidate = tokens.slice(-length).join(" ")
        .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.)]+$/g, "");
      if (candidate && candidate.length <= 160 && shared.findMetricByText(candidate, state.index)) {
        return candidate;
      }
    }
    return "";
  }

  function collectNatureReferences() {
    if (location.hostname !== "www.nature.com") return { items: [], roots: [] };
    const referenceRoot = findNatureReferencesRoot();
    const scope = referenceRoot || document;
    const seeds = [...scope.querySelectorAll([
      "[id^='ref-CR' i]",
      "li.c-article-references__item",
      "[data-test='reference-item']",
      "[data-testid='reference-item']"
    ].join(","))];
    if (referenceRoot) {
      [...referenceRoot.querySelectorAll("li")]
        .filter(isNatureReferenceContent)
        .forEach((node) => seeds.push(node));
    }

    const containers = [];
    const seen = new Set();
    seeds.forEach((seed) => {
      const container = seed.closest([
        "li",
        "[role='listitem']",
        ".c-article-references__item",
        "[data-test='reference-item']",
        "[data-testid='reference-item']"
      ].join(",")) || seed;
      if (!seen.has(container) && isNatureReferenceContent(container)) {
        seen.add(container);
        containers.push(container);
      }
    });

    const items = containers.map((container, index) => {
      const citationNode = findNatureCitationNode(container);
      const links = [...container.querySelectorAll("a[href]")];
      const doi = extractDoiFromText(container.textContent)
        || links.map((link) => extractDoiFromText(link.href)).find(Boolean)
        || "";
      const sourceLink = links.find((link) => extractDoiFromText(link.href))
        || links.find((link) => /^(article|publisher|pubmed|crossref)$/i.test(shared.collapseWhitespace(link.textContent)));
      const marker = container.matches("[id^='ref-CR' i]")
        ? container
        : container.querySelector("[id^='ref-CR' i]");
      const ordinal = extractReferenceOrdinal(container.textContent);
      return {
        container,
        target: citationNode || container.firstElementChild || container,
        record: {
          title: "",
          journal: extractNatureJournal(container, citationNode),
          doi,
          url: sourceLink ? new URL(sourceLink.getAttribute("href"), location.href).href : "",
          host: location.hostname,
          issns: []
        },
        key: `nature:${(marker && marker.id) || container.id || ordinal || index}`,
        exclusive: true,
        placement: "inside-block"
      };
    }).filter((item) => hasUsefulRecord(item.record));

    return {
      items,
      roots: shared.unique([referenceRoot, ...containers])
    };
  }

  function findNatureReferencesRoot() {
    const knownRoots = [...document.querySelectorAll([
      "section#references",
      "[data-title='References']",
      "[data-container-type='reference-list']",
      ".c-article-references"
    ].join(","))];
    const known = knownRoots.find((node) => {
      return node.querySelector("[id^='ref-CR' i],li.c-article-references__item")
        || [...node.querySelectorAll("li")].some(isNatureReferenceContent);
    });
    if (known) return known;

    const heading = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")]
      .find((node) => /^references?$/i.test(shared.collapseWhitespace(node.textContent)));
    if (!heading) return null;
    let node = heading.parentElement;
    for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
      const hasKnownItems = node.querySelector("[id^='ref-CR' i],li.c-article-references__item");
      const referenceItems = [...node.querySelectorAll("li")].filter(isNatureReferenceContent);
      if (hasKnownItems || referenceItems.length >= 2) return node;
      if (node === document.body || node.matches("main")) break;
    }
    return null;
  }

  function isNatureReferenceContent(node) {
    if (!node) return false;
    const text = shared.collapseWhitespace(node.textContent);
    return text.length >= 24 && /\((?:19|20)\d{2}\)/.test(text);
  }

  function findNatureCitationNode(container) {
    return container.querySelector([
      ".c-article-references__text",
      "[data-test*='citation' i]",
      "[data-testid*='citation' i]",
      "[class*='reference-text' i]",
      "p"
    ].join(",")) || container;
  }

  function extractNatureJournal(container, citationNode) {
    const candidates = [...container.querySelectorAll([
      "[data-test*='journal' i]",
      "[data-testid*='journal' i]",
      "[class*='journal' i]",
      "cite",
      "em",
      "i"
    ].join(","))]
      .map((node) => shared.collapseWhitespace(node.textContent))
      .filter((text) => text.length >= 2 && text.length <= 160);
    for (const candidate of candidates) {
      if (shared.findMetricByText(candidate, state.index)) return candidate;
    }

    const citationText = shared.collapseWhitespace((citationNode || container).textContent);
    const volumeMatches = [...citationText.matchAll(/([A-Za-z][A-Za-z0-9 .&'()/-]{1,180}?)\s+\d{1,5}(?:\s*\(\d+\))?\s*,/g)];
    for (const match of volumeMatches) {
      const suffix = findMatchingJournalSuffix(match[1]);
      if (suffix) return suffix;
    }
    return "";
  }

  function collectWileyItems() {
    if (!isWileyHost()) return { items: [], roots: [] };
    const recommended = collectWileyRecommendedArticles();
    const references = collectWileyReferences();
    return {
      items: [...recommended.items, ...references.items],
      roots: shared.unique([...recommended.roots, ...references.roots])
    };
  }

  function isWileyHost() {
    return /(^|\.)onlinelibrary\.wiley\.com$/i.test(location.hostname);
  }

  function collectWileyRecommendedArticles() {
    const items = [];
    const roots = [];
    const titleLinks = [...document.querySelectorAll(".creative-work__title a[href*='/doi/' i]")];

    titleLinks.forEach((titleLink, index) => {
      const context = findRelatedContext(titleLink);
      if (!context || !/recommend|related/i.test(elementSignature(context))) return;
      const container = titleLink.closest("li.grid-item,li,article,[role='listitem']")
        || titleLink.closest(".creative-work");
      if (!container) return;
      const title = shared.collapseWhitespace(titleLink.textContent);
      const journal = extractWileyRecommendedJournal(container);
      const href = new URL(titleLink.getAttribute("href"), location.href).href;
      const record = {
        title,
        journal,
        doi: extractDoiFromText(href) || extractDoiFromText(container.textContent),
        url: href,
        host: location.hostname,
        issns: []
      };
      if (!hasUsefulRecord(record) || isMainArticleRecord(record)) return;
      const identity = relatedRecordIdentity(record) || `item-${index}`;
      items.push({
        container,
        target: container.querySelector(".creative-work__title") || titleLink,
        record,
        key: `wiley-recommended:${identity}`,
        debugSource: "wiley-recommended",
        journalAuthoritative: Boolean(journal),
        exclusive: true
      });
      roots.push(context, container);
    });
    return { items, roots: shared.unique(roots) };
  }

  function extractWileyRecommendedJournal(container) {
    const selectors = [
      ".parent-item a[href*='/journal/' i]",
      ".parent-item a",
      ".parent-item",
      "a[href*='/journal/' i]"
    ];
    for (const selector of selectors) {
      const candidates = [...container.querySelectorAll(selector)];
      for (const node of candidates) {
        if (node.closest(".journal-lens-related-host,.journal-lens-related-slot")) continue;
        const value = shared.collapseWhitespace(node.textContent);
        if (value.length >= 2 && value.length <= 180) return value;
      }
    }
    return "";
  }

  function collectWileyReferences() {
    const roots = findWileyReferenceRoots();
    const candidates = [...document.querySelectorAll("li.references__item")];
    roots.forEach((root) => {
      const selector = root.matches("ol,ul")
        ? ":scope > li"
        : "li.references__item,ol.references > li,ul.references > li,ol.rlist > li,ul.rlist > li,[role='listitem']";
      root.querySelectorAll(selector).forEach((node) => candidates.push(node));
    });

    const containers = [];
    const seen = new Set();
    candidates.forEach((candidate) => {
      const container = candidate.closest("li.references__item,li,[role='listitem']") || candidate;
      if (seen.has(container) || !isWileyReferenceContent(container)) return;
      seen.add(container);
      containers.push(container);
    });

    const items = containers.map((container, index) => {
      const citationNode = container.querySelector(".references__note,[class*='reference-note' i],[class*='citation' i]")
        || container;
      const titleNode = container.querySelector(".references__article-title,[class*='reference-title' i]");
      const links = [...container.querySelectorAll("a[href]")];
      const doi = extractDoiFromText(container.textContent)
        || links.map((link) => extractDoiFromText(link.href)).find(Boolean)
        || "";
      const sourceLink = links.find((link) => extractDoiFromText(link.href)) || null;
      const journal = extractWileyReferenceJournal(container, citationNode, titleNode);
      const title = shared.collapseWhitespace(titleNode && titleNode.textContent);
      const ordinalNode = container.querySelector(".label,[class*='reference-number' i]");
      const ordinal = extractReferenceOrdinal((ordinalNode && ordinalNode.textContent) || container.textContent);
      const identity = doi
        ? `doi:${doi}`
        : container.id || (ordinal ? `ref-${ordinal}` : `${shared.normalizeJournalName(journal) || "item"}-${index}`);
      return {
        container,
        target: citationNode,
        record: {
          title,
          journal,
          doi,
          url: sourceLink ? new URL(sourceLink.getAttribute("href"), location.href).href : "",
          host: location.hostname,
          issns: []
        },
        key: `wiley-reference:${identity}`,
        debugSource: "wiley-reference",
        journalAuthoritative: Boolean(journal),
        exclusive: true,
        placement: "inside-block"
      };
    }).filter((item) => hasUsefulRecord(item.record));

    return {
      items,
      roots: shared.unique([...roots, ...containers])
    };
  }

  function findWileyReferenceRoots() {
    const roots = [...document.querySelectorAll([
      "ol.references",
      "ul.references",
      "ol.rlist",
      "ul.rlist",
      "[id*='reference-list' i]",
      "[class*='reference-list' i]",
      "[data-section-name*='reference' i]"
    ].join(","))];
    const labels = [...document.querySelectorAll("button,a,summary,h1,h2,h3,h4,h5,h6,[role='tab']")]
      .filter((node) => /^references?$/i.test(shared.collapseWhitespace(node.textContent)));
    labels.forEach((label) => {
      const control = label.getAttribute("aria-controls")
        || (label.getAttribute("href") || "").match(/#([^#]+)$/)?.[1]
        || "";
      let controlled = null;
      if (control) {
        try {
          controlled = document.getElementById(decodeURIComponent(control));
        } catch (_error) {
          controlled = document.getElementById(control);
        }
      }
      if (controlled) roots.push(controlled);
      const section = label.closest("section,details,[class*='article-section' i]");
      if (section) roots.push(section);
    });
    return shared.unique(roots.filter((root) => root && root !== document.body));
  }

  function isWileyReferenceContent(node) {
    if (!node || node.querySelector(".creative-work__title")) return false;
    const text = shared.collapseWhitespace(node.textContent);
    if (text.length < 12 || !/(?:19|20)\d{2}/.test(text)) return false;
    if (node.matches(".references__item")) return true;
    return Boolean(node.closest([
      "ol.references",
      "ul.references",
      "ol.rlist",
      "ul.rlist",
      "[id*='reference-list' i]",
      "[class*='reference-list' i]",
      "[data-section-name*='reference' i]"
    ].join(",")));
  }

  function extractWileyReferenceJournal(container, citationNode, titleNode) {
    const explicitNodes = [...container.querySelectorAll([
      "[class*='journal' i]",
      "[class*='source' i]",
      "cite",
      "em",
      "i"
    ].join(","))].filter((node) => {
      if (node.closest(".journal-lens-related-host,.journal-lens-related-slot")) return false;
      const text = shared.collapseWhitespace(node.textContent);
      return text.length >= 2 && text.length <= 180;
    });
    let semanticFallback = "";
    for (const node of explicitNodes) {
      const candidate = shared.collapseWhitespace(node.textContent).replace(/[.;,:\s]+$/g, "");
      if (shared.findMetricByText(candidate, state.index)) return candidate;
      if (!semanticFallback && /journal|source/i.test(elementSignature(node))) semanticFallback = candidate;
    }

    const title = shared.collapseWhitespace(titleNode && titleNode.textContent);
    let citation = shared.collapseWhitespace((citationNode || container).textContent);
    if (title) citation = citation.replace(title, " ");
    const years = [...citation.matchAll(/(?:19|20)\d{2}/g)];
    for (const year of years) {
      const beforeYear = citation.slice(0, year.index).replace(/^[^A-Za-z]+|[.;,:\s]+$/g, "");
      const suffix = findMatchingJournalSuffix(beforeYear, 16);
      if (suffix) return suffix;
    }

    const parsed = extractJournalFromCitation(citation, "");
    if (parsed) return parsed;
    return semanticFallback;
  }

  function collectAcsRecommendedArticles() {
    if (location.hostname !== "pubs.acs.org") return { items: [], roots: [] };
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading'],strong")]
      .filter((node) => /^recommended articles$/i.test(shared.collapseWhitespace(node.textContent)));
    const items = [];
    const roots = [];

    headings.forEach((heading) => {
      const root = findAcsRecommendedRoot(heading);
      if (!root || roots.includes(root)) return;
      const titleLinks = findAcsRecommendedTitleLinks(root, heading);
      if (!titleLinks.length) return;
      roots.push(root);

      titleLinks.forEach((titleLink, index) => {
        const container = findPreferredAcsItemContainer(titleLink, root)
          || findSmallestUniqueContainer(titleLink, root, titleLinks);
        const record = parseGenericRelatedRecord(container, titleLink);
        record.title = shared.collapseWhitespace(titleLink.textContent);
        record.journal = record.journal || extractAcsRecommendedJournal(container, record.title);
        if (!hasUsefulRecord(record) || isMainArticleRecord(record)) return;
        items.push({
          container,
          target: container === root ? titleLink : container,
          record,
          key: `acs-recommended:${relatedRecordIdentity(record) || index}`
        });
      });
    });
    return { items, roots };
  }

  function findAcsRecommendedRoot(heading) {
    let node = heading.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      if (findAcsRecommendedTitleLinks(node, heading).length) return node;
      if (node === document.body || node.matches("main")) break;
    }
    return null;
  }

  function findAcsRecommendedTitleLinks(root, heading) {
    return [...root.querySelectorAll("a[href]")].filter((link) => {
      const text = shared.collapseWhitespace(link.textContent);
      if (text.length < 8 || text.split(" ").length < 2) return false;
      if (/google scholar|crossref|follow journal|article activity|view article|open pdf|full text|read more|supporting information/i.test(text)) {
        return false;
      }
      return Boolean(heading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
  }

  function findPreferredAcsItemContainer(link, root) {
    const candidate = link.closest([
      "article",
      "li",
      "[role='listitem']",
      "[class*='recommend'][class*='item' i]",
      "[class*='recommend'][class*='row' i]",
      "[class*='recommend'][class*='card' i]",
      "[class*='article'][class*='card' i]"
    ].join(","));
    return candidate && root.contains(candidate) ? candidate : null;
  }

  function extractAcsRecommendedJournal(container, title) {
    const lines = visibleTextLines(container, title);
    let fallback = "";
    for (const line of lines) {
      const match = line.match(/^(.+?)\s*\(\s*(?:[A-Za-z]+\s*,?\s*)?(?:19|20)\d{2}\s*\)/);
      if (!match) continue;
      const candidate = shared.collapseWhitespace(match[1]).replace(/[.;,:\s]+$/g, "");
      if (shared.findMetricByText(candidate, state.index)) return candidate;
      if (!fallback) fallback = candidate;
    }
    if (fallback) return fallback;
    const compact = shared.collapseWhitespace(container.textContent).replace(title || "", " ");
    const match = compact.match(/([A-Za-z][A-Za-z0-9 .&'-]{1,100}?)\s*\(\s*(?:[A-Za-z]+\s*,?\s*)?(?:19|20)\d{2}\s*\)/);
    return match ? shared.collapseWhitespace(match[1]).replace(/[.;,:\s]+$/g, "") : "";
  }

  function visibleTextLines(container, title = "") {
    const raw = String(container.innerText || container.textContent || "");
    return raw.split(/\r?\n/)
      .map(shared.collapseWhitespace)
      .map((line) => title ? line.replace(title, "").trim() : line)
      .filter(Boolean);
  }

  function findLabeledSection(pattern) {
    const heading = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")]
      .find((node) => pattern.test(shared.collapseWhitespace(node.textContent)));
    if (!heading) return null;
    let node = heading.parentElement;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      if (node.querySelector("a[href*='doi.org/'],a[href*='/doi/']")) return node;
      if (node === document.body || node.matches("main")) break;
    }
    return heading.parentElement;
  }

  function findSmallestUniqueContainer(element, root, peerElements) {
    let best = element;
    let node = element.parentElement;
    while (node && node !== root && root.contains(node)) {
      const peerCount = peerElements.filter((peer) => node.contains(peer)).length;
      if (peerCount !== 1) break;
      best = node;
      node = node.parentElement;
    }
    return best;
  }

  function relatedRecordIdentity(record) {
    const doi = shared.normalizeDoi(record && record.doi);
    if (doi) return `doi:${doi}`;
    if (record && record.pubmedId) return `pmid:${record.pubmedId}`;
    if (record && record.url) {
      try {
        const url = new URL(record.url, location.href);
        url.hash = "";
        url.search = "";
        return `url:${url.href.toLowerCase()}`;
      } catch (_error) {
        // Fall through to the title identity.
      }
    }
    const title = shared.collapseWhitespace(record && record.title).toLowerCase();
    return title ? `title:${title}` : "";
  }

  function buildRelatedItemKey(record, context) {
    const identity = relatedRecordIdentity(record);
    if (!identity) return "";
    let semanticRoot = context;
    let node = context;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const signature = elementSignature(node);
      if (RELATED_CONTEXT_PATTERN.test(signature)) semanticRoot = node;
      if (node === document.body || (node.matches && node.matches("main"))) break;
    }
    return `generic:${elementSignature(semanticRoot).slice(0, 120)}:${identity}`;
  }

  function elementSignature(node) {
    if (!node) return "page";
    return [node.id, typeof node.className === "string" ? node.className : "", node.getAttribute && node.getAttribute("aria-label")]
      .filter(Boolean)
      .join(" ") || node.tagName || "item";
  }

  function parsePubMedResult(container) {
    const titleLink = container.querySelector("a.docsum-title");
    const citationNode = container.querySelector(".full-journal-citation")
      || container.querySelector(".docsum-journal-citation");
    const citation = shared.collapseWhitespace(citationNode && citationNode.textContent);
    const href = titleLink ? new URL(titleLink.getAttribute("href"), location.href).href : location.href;
    const pubmedId = (href.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/) || href.match(/\/(\d+)\/?$/) || [])[1] || "";
    return {
      title: shared.collapseWhitespace(titleLink && titleLink.textContent),
      journal: extractJournalBeforeYear(citation),
      doi: extractDoiFromText(citation),
      pubmedId,
      url: href,
      host: location.hostname,
      issns: []
    };
  }

  function parseGenericRelatedRecord(container, sourceLink) {
    const titleNode = container.querySelector([
      "[class*='article-title' i] a",
      "[class*='title' i] a",
      "h3 a",
      "h4 a",
      "h5 a"
    ].join(","));
    const href = sourceLink ? new URL(sourceLink.getAttribute("href"), location.href).href : location.href;
    const containerText = shared.collapseWhitespace(container.textContent).slice(0, 1800);
    let title = shared.collapseWhitespace(titleNode && titleNode.textContent);
    const sourceLinkText = shared.collapseWhitespace(sourceLink && sourceLink.textContent);
    if (!title && sourceLinkText && !/^(doi|crossref|pubmed|google scholar|view article)$/i.test(sourceLinkText)) {
      title = sourceLinkText;
    }
    const explicitJournal = textFromSelector([
      "[data-test*='journal' i]",
      "[data-testid*='journal' i]",
      "[class*='journal-title' i]",
      "[class*='publication-title' i]"
    ].join(","), container);
    return {
      title,
      journal: explicitJournal || extractJournalFromCitation(containerText, title),
      doi: extractDoiFromText(href) || extractDoiFromText(containerText),
      url: href,
      host: location.hostname,
      issns: []
    };
  }

  function findRelatedContext(link) {
    let node = link.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const signature = [node.id, node.className, node.getAttribute && node.getAttribute("aria-label")]
        .filter((value) => typeof value === "string")
        .join(" ");
      if (RELATED_CONTEXT_PATTERN.test(signature)) return node;
      if (node === document.body || node.matches("main")) break;
    }
    return null;
  }

  function findRelatedContainer(link, context) {
    let node = link;
    let fallback = context;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      if (node.matches && node.matches("article,li,tr,[role='listitem'],[class*='reference' i],[class*='citation' i],[class*='card' i],[class$='-item'],[class*='__item']")) {
        fallback = node;
        break;
      }
      if (node === context) break;
    }
    return fallback;
  }

  function pickRelatedTarget(container, fallback) {
    return container.querySelector([
      "[class*='article-title' i]",
      "[class*='title' i]",
      "h3",
      "h4",
      "h5",
      ".full-journal-citation"
    ].join(",")) || fallback;
  }

  function hasUsefulRecord(record) {
    return Boolean(record && (record.title || record.journal || record.doi || record.pubmedId));
  }

  function isMainArticleRecord(record) {
    if (state.pageMode !== "article") return false;
    const doi = shared.normalizeDoi(record.doi);
    if (doi && doi === shared.normalizeDoi(state.record.doi)) return true;
    const title = shared.collapseWhitespace(record.title).toLowerCase();
    return Boolean(title && title === shared.collapseWhitespace(state.record.title).toLowerCase());
  }

  function extractJournalBeforeYear(text) {
    const value = shared.collapseWhitespace(text);
    const match = value.match(/^(.+?)\.?\s+(?:19|20)\d{2}\b/);
    return match ? match[1].replace(/[.;,:\s]+$/g, "") : "";
  }

  function extractJournalFromCitation(text, title) {
    let value = shared.collapseWhitespace(text);
    if (title) value = value.replace(shared.collapseWhitespace(title), " ");
    const matches = [...value.matchAll(/(?:^|[.;])\s*([^.;]{2,100}?)\.?\s+(?:19|20)\d{2}\b/g)];
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const candidate = shared.collapseWhitespace(matches[index][1]).replace(/^[,;:\s]+|[,;:\s]+$/g, "");
      if (shared.findMetricByText(candidate, state.index)) return candidate;
    }
    return "";
  }

  function findMetricInCitation(container, record) {
    const direct = shared.findMetricForRecord(record, state.index);
    if (direct) return direct;
    const candidates = [...container.querySelectorAll("em,i,[class*='journal' i],[class*='publication' i]")]
      .map((node) => shared.collapseWhitespace(node.textContent))
      .filter((text) => text.length >= 2 && text.length <= 140);
    for (const candidate of candidates) {
      const metric = shared.findMetricByText(candidate, state.index);
      if (metric) return metric;
    }
    return null;
  }

  function insertRelatedControl(entry) {
    const target = entry.target;
    if (!target || !target.parentElement) return;
    if (entry.placement === "inside-block") {
      let slot = [...target.children].find((node) => node.classList.contains("journal-lens-related-slot"));
      if (!slot) {
        slot = document.createElement("span");
        slot.className = "journal-lens-related-slot";
        target.append(slot);
      }
      slot.append(entry.host);
      return;
    }
    if (entry.placement === "after-block") {
      let slot = target.nextElementSibling;
      if (!slot || !slot.classList.contains("journal-lens-related-slot")) {
        slot = document.createElement("span");
        slot.className = "journal-lens-related-slot";
        target.insertAdjacentElement("afterend", slot);
      }
      slot.append(entry.host);
      return;
    }
    target.insertAdjacentElement("afterend", entry.host);
  }

  function renderRelatedControl(entry) {
    const shadow = entry.host.shadowRoot;
    const debugEnabled = debugModeEnabled();
    if (!debugEnabled) entry.debugOpen = false;
    const journalName = shared.collapseWhitespace(
      (entry.localMetric && entry.localMetric.title)
      || (entry.metric && entry.metric.title)
      || entry.record.journal
      || ""
    );
    const isBusy = Boolean(entry.loading || entry.easyScholarLoading);
    const needsEasyScholarKey = easyScholarNeedsKey();
    const easyScholarNoResult = easyScholarEnabled()
      && entry.easyScholarResolved
      && !entry.easyScholarMetric
      && !entry.easyScholarError;
    const hasDoi = Boolean(shared.normalizeDoi(entry.record && entry.record.doi));
    const metricContent = entry.metric
      ? renderMetricChips(entry.metric, true)
      : isBusy || needsEasyScholarKey || easyScholarNoResult || entry.easyScholarError
        ? ""
        : renderMetricChips(null, true);
    const content = entry.expanded
      ? `
        <span class="panel">
          ${debugEnabled
            ? `<button type="button" class="mark debug-trigger" title="查看调试参数" aria-label="查看调试参数">JL</button>`
            : `<span class="mark">JL</span>`}
          <span class="journal">${escapeHtml(journalName || (isBusy ? "正在识别期刊" : "未识别期刊"))}</span>
          ${metricContent}
          ${entry.loading ? `<span class="chip loading">补全题录中</span>` : ""}
          ${entry.easyScholarLoading ? `<span class="chip loading">EasyScholar 查询中</span>` : ""}
          ${needsEasyScholarKey ? `<span class="chip missing">未配置 EasyScholar</span>` : ""}
          ${easyScholarNoResult ? `<span class="chip missing">EasyScholar 无结果</span>` : ""}
          ${entry.error ? `<span class="chip missing" title="${escapeAttribute(entry.error)}">题录补全失败</span>` : ""}
          ${entry.easyScholarError
            ? `<span class="chip missing" title="${escapeAttribute(entry.easyScholarError)}">EasyScholar 失败</span>`
            : ""}
          ${hasDoi && ableSciAssistEnabled()
            ? `<button type="button" class="ablesci icon" title="在科研通发起文献求助" aria-label="在科研通发起文献求助">?</button>`
            : ""}
          <button type="button" class="lookup icon" title="检索该论文" aria-label="检索该论文">↗</button>
          <button type="button" class="collapse icon" title="收起指标" aria-label="收起指标">−</button>
        </span>`
      : `<span class="compact-actions">
          <button type="button" class="reveal" title="查看这篇论文的期刊指标" aria-label="查看这篇论文的期刊指标"><span class="mark">JL</span></button>
          ${hasDoi && ableSciAssistEnabled()
            ? `<button type="button" class="ablesci icon" title="在科研通发起文献求助" aria-label="在科研通发起文献求助">?</button>`
            : ""}
        </span>`;

    if (debugEnabled && entry.debugOpen) entry.debugPayload = buildRelatedDebugPayload(entry);
    const debugJson = entry.debugPayload ? JSON.stringify(entry.debugPayload, null, 2) : "";
    const debugOverlay = debugEnabled && entry.debugOpen
      ? `
        <div class="debug-overlay" role="presentation">
          <section class="debug-dialog" role="dialog" aria-modal="true" aria-label="Journal Lens 调试参数">
            <header class="debug-header">
              <div><strong>Journal Lens Debug</strong><span>${escapeHtml(DEBUG_VERSION)}</span></div>
              <button type="button" class="debug-close" title="关闭" aria-label="关闭">×</button>
            </header>
            <div class="debug-actions">
              <button type="button" class="debug-copy-json">复制 JSON</button>
              <button type="button" class="debug-copy-html">复制 HTML</button>
              <span class="debug-copy-status" aria-live="polite">${escapeHtml(entry.debugCopyStatus || "")}</span>
            </div>
            <pre>${escapeHtml(debugJson)}</pre>
          </section>
        </div>`
      : "";

    replaceShadowMarkup(shadow, `<style>${relatedStyles()}</style>${content}${debugOverlay}`);
    const reveal = shadow.querySelector(".reveal");
    if (reveal) reveal.addEventListener("click", (event) => {
      stopButtonEvent(event);
      entry.expanded = true;
      entry.debugOpen = debugEnabled;
      entry.debugCopyStatus = "";
      renderRelatedControl(entry);
      startRelatedEnrichment(entry);
    });
    const debugTrigger = shadow.querySelector(".debug-trigger");
    if (debugTrigger) debugTrigger.addEventListener("click", (event) => {
      stopButtonEvent(event);
      entry.debugOpen = true;
      entry.debugCopyStatus = "";
      renderRelatedControl(entry);
    });
    const collapse = shadow.querySelector(".collapse");
    if (collapse) collapse.addEventListener("click", (event) => {
      stopButtonEvent(event);
      entry.debugOpen = false;
      entry.expanded = false;
      renderRelatedControl(entry);
    });
    const lookup = shadow.querySelector(".lookup");
    if (lookup) lookup.addEventListener("click", (event) => {
      stopButtonEvent(event);
      chrome.runtime.sendMessage({ type: "JournalLens:openLookup", record: entry.record });
    });
    const ableSciButton = shadow.querySelector(".ablesci");
    if (ableSciButton) ableSciButton.addEventListener("click", (event) => {
      stopButtonEvent(event);
      openAbleSciAssist(entry.record, ableSciButton);
    });
    const closeDebug = shadow.querySelector(".debug-close");
    if (closeDebug) closeDebug.addEventListener("click", (event) => {
      stopButtonEvent(event);
      entry.debugOpen = false;
      renderRelatedControl(entry);
    });
    const debugOverlayNode = shadow.querySelector(".debug-overlay");
    if (debugOverlayNode) debugOverlayNode.addEventListener("click", (event) => {
      if (event.target !== debugOverlayNode) return;
      stopButtonEvent(event);
      entry.debugOpen = false;
      renderRelatedControl(entry);
    });
    const copyJson = shadow.querySelector(".debug-copy-json");
    if (copyJson) copyJson.addEventListener("click", async (event) => {
      stopButtonEvent(event);
      const ok = await copyDebugText(JSON.stringify(buildRelatedDebugPayload(entry), null, 2));
      entry.debugCopyStatus = ok ? "JSON 已复制" : "复制失败";
      renderRelatedControl(entry);
    });
    const copyHtml = shadow.querySelector(".debug-copy-html");
    if (copyHtml) copyHtml.addEventListener("click", async (event) => {
      stopButtonEvent(event);
      const ok = await copyDebugText((entry.container && entry.container.outerHTML) || "");
      entry.debugCopyStatus = ok ? "HTML 已复制" : "复制失败";
      renderRelatedControl(entry);
    });
  }

  function relatedStyles() {
    return `
      :host { all: initial; display: inline-flex; max-width: 100%; vertical-align: middle; }
      .panel,.reveal { font-family: Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; line-height: 1.2; }
      .compact-actions { align-items:center; display:inline-flex; gap:4px; max-width:100%; }
      .panel { align-items:center; background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; color:#0f172a; display:inline-flex; flex-wrap:wrap; gap:5px; max-width:min(680px,100%); padding:3px 5px; }
      .reveal { align-items:center; appearance:none; background:#ffffff; border:1px solid #94a3b8; border-radius:6px; color:#334155; cursor:pointer; display:inline-flex; font-size:11px; font-weight:700; gap:4px; height:24px; padding:0 6px; }
      .mark { align-items:center; appearance:none; background:#0f766e; border:0; border-radius:4px; color:#ffffff; display:inline-flex; font-size:10px; font-weight:800; height:18px; justify-content:center; min-width:20px; padding:0 3px; }
      button.mark { cursor:pointer; }
      .journal { color:#334155; font-size:11px; font-weight:650; max-width:190px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .chip { align-items:center; background:#e0f2fe; border:1px solid #bae6fd; border-radius:5px; color:#075985; display:inline-flex; font-size:11px; font-weight:650; min-height:18px; padding:1px 5px; white-space:nowrap; }
      .chip.missing { background:#fff7ed; border-color:#fed7aa; color:#9a3412; }
      .chip.loading { background:#f1f5f9; border-color:#cbd5e1; color:#475569; }
      button.icon { align-items:center; appearance:none; border:0; border-radius:5px; color:#ffffff; cursor:pointer; display:inline-flex; font-size:13px; font-weight:800; height:22px; justify-content:center; min-width:24px; padding:0 5px; }
      button.lookup { background:#111827; }
      button.ablesci { background:#2563eb; }
      button.collapse { background:#64748b; }
      button:disabled { cursor:not-allowed; opacity:.62; }
      button:focus-visible { outline:2px solid #38bdf8; outline-offset:2px; }
      .debug-overlay { align-items:center; background:rgba(15,23,42,.42); box-sizing:border-box; display:flex; inset:0; justify-content:center; padding:16px; position:fixed; z-index:2147483647; }
      .debug-dialog { background:#ffffff; border:1px solid #94a3b8; border-radius:6px; box-shadow:0 18px 44px rgba(15,23,42,.28); box-sizing:border-box; color:#0f172a; display:flex; flex-direction:column; font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; height:min(76vh,720px); max-width:calc(100vw - 32px); overflow:hidden; width:820px; }
      .debug-header { align-items:center; border-bottom:1px solid #cbd5e1; display:flex; justify-content:space-between; min-height:46px; padding:0 12px; }
      .debug-header div { align-items:baseline; display:flex; gap:8px; }
      .debug-header strong { font-size:14px; }
      .debug-header span { color:#64748b; font-size:11px; }
      .debug-close { appearance:none; background:transparent; border:0; color:#334155; cursor:pointer; font-size:24px; height:34px; line-height:1; width:34px; }
      .debug-actions { align-items:center; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; gap:8px; min-height:44px; padding:0 12px; }
      .debug-actions button { appearance:none; background:#ffffff; border:1px solid #94a3b8; border-radius:5px; color:#0f172a; cursor:pointer; font-size:12px; font-weight:700; height:28px; padding:0 10px; }
      .debug-copy-status { color:#047857; font-size:12px; margin-left:auto; }
      .debug-dialog pre { background:#0f172a; box-sizing:border-box; color:#e2e8f0; flex:1; font-family:Consolas,"SFMono-Regular",monospace; font-size:12px; line-height:1.45; margin:0; overflow:auto; padding:14px; text-align:left; user-select:text; white-space:pre-wrap; word-break:break-word; }
    `;
  }

  function debugSourceFromKey(key = "") {
    const value = String(key);
    if (value.startsWith("sciencedirect:")) return "sciencedirect-reference";
    if (value.startsWith("nature:")) return "nature-reference";
    if (value.startsWith("pubmed:")) return "pubmed-result";
    if (value.startsWith("acs-recommended:")) return "acs-recommended";
    if (value.startsWith("wiley-recommended:")) return "wiley-recommended";
    if (value.startsWith("wiley-reference:")) return "wiley-reference";
    return "generic-related-item";
  }

  function buildRelatedDebugPayload(entry) {
    const container = entry.container;
    const target = entry.target;
    const recordJournal = shared.collapseWhitespace(entry.record && entry.record.journal);
    const scienceDirectJournal = location.hostname === "www.sciencedirect.com" && container
      ? extractScienceDirectJournal(container)
      : "";
    const natureJournal = location.hostname === "www.nature.com" && container
      ? extractNatureJournal(container, findNatureCitationNode(container))
      : "";
    const wileyJournal = isWileyHost() && container
      ? entry.debugSource === "wiley-recommended"
        ? extractWileyRecommendedJournal(container)
        : extractWileyReferenceJournal(
          container,
          container.querySelector(".references__note,[class*='reference-note' i],[class*='citation' i]") || container,
          container.querySelector(".references__article-title,[class*='reference-title' i]")
        )
      : "";
    const journalInputs = shared.unique([recordJournal, scienceDirectJournal, natureJournal, wileyJournal]);
    const candidateTexts = container
      ? shared.unique([...container.querySelectorAll("dd,div,p,span,em,i,cite")]
        .filter((node) => !node.closest(".journal-lens-related-host,.journal-lens-related-slot"))
        .map((node) => shared.collapseWhitespace(node.textContent))
        .filter((text) => text.length >= 2 && text.length <= 500)
        .filter((text) => /(?:19|20)\d{2}|journal|source|host/i.test(text)))
        .slice(0, 80)
      : [];
    const outerHtml = container && container.outerHTML ? container.outerHTML : "";
    const manifest = chrome.runtime && typeof chrome.runtime.getManifest === "function"
      ? chrome.runtime.getManifest()
      : null;

    return {
      debugVersion: DEBUG_VERSION,
      extensionVersion: manifest ? (manifest.version_name || manifest.version || "") : DEBUG_VERSION,
      capturedAt: new Date().toISOString(),
      page: {
        url: location.href,
        host: location.hostname,
        title: document.title
      },
      item: {
        adapter: entry.debugSource || debugSourceFromKey(entry.key),
        key: entry.key || "",
        placement: entry.placement || "",
        expanded: Boolean(entry.expanded),
        loading: Boolean(entry.loading),
        resolved: Boolean(entry.resolved),
        error: entry.error || "",
        easyScholar: {
          enabled: easyScholarEnabled(),
          configured: Boolean(state.settings && state.settings.easyScholarConfigured),
          loading: Boolean(entry.easyScholarLoading),
          resolved: Boolean(entry.easyScholarResolved),
          cached: Boolean(entry.easyScholarCached),
          publicationName: easyScholarPublicationName(entry.record, entry.localMetric),
          error: entry.easyScholarError || ""
        }
      },
      inputRecord: { ...(entry.record || {}) },
      extractedNow: {
        scienceDirectJournal,
        natureJournal,
        wileyJournal,
        scienceDirectTitle: location.hostname === "www.sciencedirect.com" && container
          ? extractScienceDirectReferenceTitle(container)
          : "",
        scienceDirectCitationNodes: location.hostname === "www.sciencedirect.com" && container
          ? findScienceDirectCitationNodes(container).map((node) => shared.collapseWhitespace(node.textContent)).slice(0, 20)
          : [],
        visibleTextLines: container ? visibleTextLines(container).slice(0, 60) : [],
        candidateElementTexts: candidateTexts
      },
      matching: {
        localMetric: debugMetric(entry.localMetric),
        easyScholarMetric: debugMetric(entry.easyScholarMetric),
        finalMetric: debugMetric(entry.metric),
        inputs: journalInputs.map((journal) => debugJournalMatch(journal))
      },
      dom: {
        container: debugElement(container),
        target: debugElement(target),
        containerText: shared.collapseWhitespace(container && (container.innerText || container.textContent)).slice(0, 6000),
        containerHtmlLength: outerHtml.length,
        containerHtmlPreview: outerHtml.slice(0, 12000),
        containerHtmlTruncated: outerHtml.length > 12000
      }
    };
  }

  function debugJournalMatch(journal) {
    const normalized = shared.normalizeJournalName(journal);
    const strictLoose = shared.normalizeJournalStrictLoose(journal);
    const loose = shared.normalizeJournalLoose(journal);
    return {
      input: journal,
      normalized,
      strictLoose,
      loose,
      exact: debugMetric(state.index.byName[normalized]),
      alias: debugMetric(state.index.byAliasName && state.index.byAliasName[normalized]),
      abbreviation: debugMetric(shared.findMetricByAbbreviation(journal, state.index)),
      strictLooseMatch: debugMetric(state.index.byStrictLooseName && state.index.byStrictLooseName[strictLoose]),
      looseMatch: debugMetric(state.index.byLooseName && state.index.byLooseName[loose]),
      final: debugMetric(shared.findMetricForRecord({ journal }, state.index))
    };
  }

  function debugMetric(metric) {
    if (!metric) return null;
    return {
      id: metric.id || "",
      title: metric.title || "",
      issn: metric.issn || "",
      eissn: metric.eissn || "",
      xrPartition: metric.xrPartition || "",
      casPartition: metric.casPartition || "",
      jcrQuartile: metric.jcrQuartile || "",
      impactFactor: metric.impactFactor || "",
      year: metric.year || "",
      source: metric.source || "",
      provider: metric.provider || "",
      extraMetrics: Array.isArray(metric.extraMetrics) ? metric.extraMetrics : []
    };
  }

  function debugElement(node) {
    if (!node) return null;
    return {
      tag: node.tagName || "",
      id: node.id || "",
      className: typeof node.className === "string" ? node.className : "",
      role: node.getAttribute && node.getAttribute("role"),
      text: shared.collapseWhitespace(node.innerText || node.textContent).slice(0, 1000)
    };
  }

  async function copyDebugText(value) {
    const text = String(value || "");
    if (!text) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_error) {
      // Fall back to execCommand for pages that block the Clipboard API.
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    } catch (_error) {
      return false;
    }
  }

  function canResolveRecord(record) {
    return Boolean(record && (record.pubmedId || shared.normalizeDoi(record.doi)));
  }

  function startRelatedEnrichment(entry) {
    if (!entry || !entry.expanded) return;
    if (!entry.localMetric && canResolveRecord(entry.record) && !entry.resolved) {
      queueRecordResolution(entry);
      return;
    }
    queueEasyScholarLookup(entry);
  }

  function queueEasyScholarLookup(entry) {
    if (!easyScholarEnabled() || !entry || !entry.expanded) return;
    const publicationName = easyScholarPublicationName(entry.record, entry.localMetric);
    if (!publicationName) {
      entry.easyScholarResolved = true;
      entry.easyScholarError = "缺少期刊名称";
      if (entry.host.isConnected) renderRelatedControl(entry);
      return;
    }

    const requestName = shared.normalizeJournalName(publicationName) || publicationName.toLowerCase();
    if (entry.easyScholarRequestName === requestName
      && (entry.easyScholarLoading || entry.easyScholarResolved)) return;

    const requestToken = (entry.easyScholarRequestToken || 0) + 1;
    entry.easyScholarRequestToken = requestToken;
    entry.easyScholarRequestName = requestName;
    entry.easyScholarMetric = null;
    entry.easyScholarLoading = true;
    entry.easyScholarResolved = false;
    entry.easyScholarError = "";
    entry.easyScholarCached = false;
    entry.metric = mergeMetricSources(entry.localMetric, null);
    if (entry.host.isConnected) renderRelatedControl(entry);

    chrome.runtime.sendMessage({
      type: "JournalLens:lookupEasyScholar",
      publicationName
    }).then((response) => {
      if (entry.easyScholarRequestToken !== requestToken) return;
      if (!response || !response.ok) throw new Error(response && response.error || "接口无响应");
      entry.easyScholarMetric = response.metric || null;
      entry.easyScholarCached = Boolean(response.cached);
      entry.easyScholarResolved = true;
      entry.metric = mergeMetricSources(entry.localMetric, entry.easyScholarMetric);
    }).catch((error) => {
      if (entry.easyScholarRequestToken !== requestToken) return;
      entry.easyScholarResolved = true;
      entry.easyScholarError = error && error.message ? error.message : "EasyScholar 请求失败";
      entry.metric = mergeMetricSources(entry.localMetric, null);
    }).finally(() => {
      if (entry.easyScholarRequestToken !== requestToken) return;
      entry.easyScholarLoading = false;
      if (entry.host.isConnected) renderRelatedControl(entry);
    });
  }

  function queueRecordResolution(entry) {
    if (entry.loading || entry.resolved) return;
    entry.loading = true;
    entry.error = "";
    renderRelatedControl(entry);
    state.resolveQueue.push(entry);
    pumpResolveQueue();
  }

  function pumpResolveQueue() {
    while (state.activeResolutions < 4 && state.resolveQueue.length) {
      const entry = state.resolveQueue.shift();
      state.activeResolutions += 1;
      resolveRelatedEntry(entry).finally(() => {
        state.activeResolutions -= 1;
        pumpResolveQueue();
      });
    }
  }

  async function resolveRelatedEntry(entry) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "JournalLens:resolveArticleMetadata",
        record: entry.record
      });
      if (response && response.ok && response.result) {
        const authoritativeJournal = entry.journalAuthoritative
          ? shared.collapseWhitespace(entry.record && entry.record.journal)
          : "";
        entry.record = mergeRelatedRecords(entry.record, response.result);
        if (authoritativeJournal) entry.record.journal = authoritativeJournal;
        entry.localMetric = (authoritativeJournal
          ? shared.findMetricForRecord({ journal: authoritativeJournal }, state.index)
          : null) || shared.findMetricForRecord(entry.record, state.index);
        entry.metric = mergeMetricSources(entry.localMetric, entry.easyScholarMetric);
      }
    } catch (error) {
      entry.error = error && error.message ? error.message : "resolve failed";
    } finally {
      entry.loading = false;
      entry.resolved = true;
      if (entry.host.isConnected) renderRelatedControl(entry);
      startRelatedEnrichment(entry);
    }
  }

  function observeDynamicContent() {
    if (state.observer || relatedMode() === "off") return;
    state.observer = new MutationObserver((mutations) => {
      const shouldRescan = mutations.some((mutation) => {
        if (isJournalLensNode(mutation.target)) return false;
        if (mutation.type === "attributes" || mutation.type === "characterData") return true;
        return [...mutation.addedNodes].some((node) => !isJournalLensNode(node));
      });
      if (!shouldRescan) return;
      window.clearTimeout(state.observerTimer);
      state.observerTimer = window.setTimeout(annotateRelatedArticles, 350);
    });
    state.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["aria-expanded", "aria-hidden", "class", "hidden", "style"],
      characterData: true,
      childList: true,
      subtree: true
    });
  }

  function isJournalLensNode(node) {
    const element = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    if (!element || !element.closest) return false;
    return Boolean(element.closest([
      ".journal-lens-host",
      ".journal-lens-related-host",
      ".journal-lens-related-slot",
      ".journal-lens-inline-host"
    ].join(",")));
  }

  async function enrichWithOpenAlex() {
    if (state.pageMode !== "article" || !state.settings.enableOpenAlex) return;
    if (!state.record.journal && !(state.record.issns || []).length) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "JournalLens:lookupOpenAlex",
        record: state.record
      });
      if (response && response.ok && response.result) {
        state.openAlex = response.result;
        renderArticleBadge();
      }
    } catch (_error) {
      // Local imported metrics remain usable when enrichment is unavailable.
    }
  }

  async function enrichArticleWithEasyScholar() {
    if (state.pageMode !== "article" || !easyScholarEnabled()) return;
    const publicationName = easyScholarPublicationName(state.record, state.localMetric);
    if (!publicationName) {
      state.easyScholarResolved = true;
      state.easyScholarError = "缺少期刊名称";
      renderArticleBadge();
      return;
    }

    const requestName = shared.normalizeJournalName(publicationName) || publicationName.toLowerCase();
    if (state.easyScholarRequestName === requestName
      && (state.easyScholarLoading || state.easyScholarResolved)) return;

    const requestToken = state.easyScholarRequestToken + 1;
    state.easyScholarRequestToken = requestToken;
    state.easyScholarRequestName = requestName;
    state.easyScholarMetric = null;
    state.easyScholarLoading = true;
    state.easyScholarResolved = false;
    state.easyScholarError = "";
    state.easyScholarCached = false;
    state.metric = mergeMetricSources(state.localMetric, null);
    renderArticleBadge();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "JournalLens:lookupEasyScholar",
        publicationName
      });
      if (state.easyScholarRequestToken !== requestToken) return;
      if (!response || !response.ok) throw new Error(response && response.error || "接口无响应");
      state.easyScholarMetric = response.metric || null;
      state.easyScholarCached = Boolean(response.cached);
      state.easyScholarResolved = true;
      state.metric = mergeMetricSources(state.localMetric, state.easyScholarMetric);
    } catch (error) {
      if (state.easyScholarRequestToken !== requestToken) return;
      state.easyScholarResolved = true;
      state.easyScholarError = error && error.message ? error.message : "EasyScholar 请求失败";
      state.metric = mergeMetricSources(state.localMetric, null);
    } finally {
      if (state.easyScholarRequestToken !== requestToken) return;
      state.easyScholarLoading = false;
      renderArticleBadge();
    }
  }

  async function openAbleSciAssist(record, button) {
    if (!button || button.disabled) return;
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "…";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "JournalLens:openAbleSciRequest",
        record
      });
      if (!response || !response.ok) throw new Error(response && response.error || "无法打开科研通");
      button.textContent = "✓";
      button.title = "已打开科研通求助表单";
    } catch (error) {
      button.textContent = "!";
      button.title = error && error.message ? error.message : "打开科研通失败";
    } finally {
      window.setTimeout(() => {
        if (!button.isConnected) return;
        button.disabled = false;
        button.textContent = originalLabel;
        button.title = "在科研通发起文献求助";
      }, 1400);
    }
  }

  function createArticleBadge(record, metric, openAlex, easyScholarStatus = {}) {
    const host = document.createElement("span");
    const shadow = host.attachShadow({ mode: "open" });
    const journalName = shared.collapseWhitespace(
      (state.localMetric && state.localMetric.title)
      || (metric && metric.title)
      || record.journal
      || "未识别期刊"
    );
    const hasDoi = Boolean(shared.normalizeDoi(record.doi));
    const easyScholarNoResult = easyScholarEnabled()
      && easyScholarStatus.resolved
      && !state.easyScholarMetric
      && !easyScholarStatus.error;
    const metricContent = metric
      ? renderMetricChips(metric, false)
      : easyScholarStatus.loading || easyScholarStatus.needsKey || easyScholarNoResult || easyScholarStatus.error
        ? ""
        : renderMetricChips(null, false);
    replaceShadowMarkup(shadow, `
      <style>
        :host { all:initial; display:inline-flex; max-width:100%; font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; line-height:1.2; vertical-align:middle; }
        .lens { align-items:center; background:#f8fafc; border:1px solid #cbd5e1; border-radius:7px; box-shadow:0 6px 16px rgba(15,23,42,.07); color:#0f172a; display:inline-flex; flex-wrap:wrap; gap:6px; max-width:min(760px,100%); padding:6px 7px; position:relative; z-index:2147483000; }
        .mark { align-items:center; background:#0f766e; border-radius:5px; color:#fff; display:inline-flex; font-size:11px; font-weight:800; height:20px; justify-content:center; min-width:22px; padding:0 5px; }
        .journal { color:#334155; font-size:12px; font-weight:650; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .chip { align-items:center; background:#e0f2fe; border:1px solid #bae6fd; border-radius:5px; color:#075985; display:inline-flex; font-size:12px; font-weight:650; min-height:20px; padding:1px 6px; white-space:nowrap; }
        .chip.missing { background:#fff7ed; border-color:#fed7aa; color:#9a3412; }
        .chip.loading { background:#f1f5f9; border-color:#cbd5e1; color:#475569; }
        .chip.openalex { background:#ecfdf5; border-color:#bbf7d0; color:#166534; }
        button { align-items:center; appearance:none; background:#111827; border:0; border-radius:5px; color:#fff; cursor:pointer; display:inline-flex; font-size:12px; font-weight:800; height:24px; justify-content:center; min-width:28px; padding:0 7px; }
        button.copy { background:#475569; }
        button.ablesci { background:#2563eb; min-width:26px; padding:0 6px; }
        button:disabled { cursor:not-allowed; opacity:.62; }
        button:focus-visible { outline:2px solid #38bdf8; outline-offset:2px; }
      </style>
      <span class="lens" title="${escapeAttribute(journalName)} · ${escapeAttribute(shared.metricLabel(metric))}">
        <span class="mark">JL</span>
        <span class="journal">${escapeHtml(journalName)}</span>
        ${metricContent}
        ${easyScholarStatus.loading ? `<span class="chip loading">EasyScholar 查询中</span>` : ""}
        ${easyScholarStatus.needsKey ? `<span class="chip missing">未配置 EasyScholar</span>` : ""}
        ${easyScholarNoResult ? `<span class="chip missing">EasyScholar 无结果</span>` : ""}
        ${easyScholarStatus.error
          ? `<span class="chip missing" title="${escapeAttribute(easyScholarStatus.error)}">EasyScholar 失败</span>`
          : ""}
        ${renderOpenAlexChip(openAlex)}
        ${hasDoi && ableSciAssistEnabled()
          ? `<button type="button" class="ablesci" title="在科研通发起文献求助" aria-label="在科研通发起文献求助">?</button>`
          : ""}
        <button type="button" class="lookup" title="检索开放获取或馆藏入口" aria-label="检索开放获取或馆藏入口">↗</button>
        ${hasDoi ? `<button type="button" class="copy" title="复制 DOI" aria-label="复制 DOI">DOI</button>` : ""}
      </span>`);

    shadow.querySelector(".lookup").addEventListener("click", (event) => {
      stopButtonEvent(event);
      chrome.runtime.sendMessage({ type: "JournalLens:openLookup", record });
    });
    const ableSciButton = shadow.querySelector(".ablesci");
    if (ableSciButton) ableSciButton.addEventListener("click", (event) => {
      stopButtonEvent(event);
      openAbleSciAssist(record, ableSciButton);
    });
    const copyButton = shadow.querySelector(".copy");
    if (copyButton) copyButton.addEventListener("click", async (event) => {
      stopButtonEvent(event);
      await navigator.clipboard.writeText(shared.normalizeDoi(record.doi));
      copyButton.textContent = "OK";
      window.setTimeout(() => { copyButton.textContent = "DOI"; }, 1100);
    });
    return host;
  }

  function renderMetricChips(metric, compact) {
    if (!metric) return `<span class="chip missing">未匹配</span>`;
    const chips = [];
    if (metric.xrPartition) chips.push(`<span class="chip">新锐 ${escapeHtml(metric.xrPartition)}</span>`);
    if (metric.casPartition) chips.push(`<span class="chip">中科院 ${escapeHtml(metric.casPartition)}</span>`);
    if (metric.jcrQuartile) chips.push(`<span class="chip">JCR ${escapeHtml(metric.jcrQuartile)}</span>`);
    if (metric.impactFactor) chips.push(`<span class="chip">IF ${escapeHtml(metric.impactFactor)}</span>`);
    if (metric.warning) chips.push(`<span class="chip missing">预警 ${escapeHtml(metric.warning)}</span>`);
    if (Array.isArray(metric.extraMetrics)) {
      metric.extraMetrics.forEach((entry) => {
        const label = shared.collapseWhitespace(entry && entry.label);
        const value = shared.collapseWhitespace(entry && entry.value);
        if (!label || !value) return;
        const toneClass = entry.tone === "warning" ? " missing" : "";
        chips.push(`<span class="chip${toneClass}">${escapeHtml(label)} ${escapeHtml(value)}</span>`);
      });
    }
    if (!compact && metric.year) chips.push(`<span class="chip">${escapeHtml(metric.year)}</span>`);
    if (!chips.length) chips.push(`<span class="chip">已匹配</span>`);
    return chips.join("");
  }

  function renderOpenAlexChip(openAlex) {
    if (!openAlex || openAlex.twoYearMeanCitedness === ""
      || openAlex.twoYearMeanCitedness === null
      || openAlex.twoYearMeanCitedness === undefined) return "";
    const value = Number(openAlex.twoYearMeanCitedness);
    const formatted = Number.isFinite(value) ? value.toFixed(2) : String(openAlex.twoYearMeanCitedness);
    return `<span class="chip openalex" title="OpenAlex 两年平均被引次数；口径类似影响因子，但不是 JCR IF">OA 2yr ${escapeHtml(formatted)}</span>`;
  }

  function replaceShadowMarkup(shadow, markup) {
    const range = document.createRange();
    range.selectNode(document.body || document.documentElement);
    shadow.replaceChildren(range.createContextualFragment(markup));
  }

  function stopButtonEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }
})();




