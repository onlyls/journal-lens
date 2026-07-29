importScripts("build-flags.js", "shared.js", "storage.js");

const shared = globalThis.JournalLensShared;
const store = globalThis.JournalLensStore;
const build = globalThis.JournalLensBuild || {};
const OPENALEX_CACHE_KEY = "journalLens.openAlexCache";
const ARTICLE_META_CACHE_KEY = "journalLens.articleMetaCache";
const EASY_SCHOLAR_CACHE_KEY = "journalLens.easyScholarCache";
const ABLE_SCI_PENDING_KEY = "journalLens.ableSciPending";
const ABLE_SCI_PENDING_TTL = 20 * 60 * 1000;
const EASY_SCHOLAR_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const EASY_SCHOLAR_MIN_INTERVAL = 550;
const easyScholarInFlight = new Map();
let easyScholarRequestQueue = Promise.resolve();
let easyScholarLastRequestAt = 0;

chrome.runtime.onInstalled.addListener(async () => {
  await store.saveSettings(await store.getSettings());
  refreshContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  refreshContextMenus();
});

function debugFeaturesEnabled() {
  return build.enableDebug !== false;
}

function refreshContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "journalLens.lookupSelection",
      title: "Journal Lens: 检索选中文本",
      contexts: ["selection"]
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "journalLens.lookupSelection") return;
  const settings = await store.getSettings();
  const url = shared.buildResolverUrl(settings, {
    title: info.selectionText || "",
    url: info.pageUrl || ""
  });
  if (url) {
    chrome.tabs.create({ url });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleMessage(message, sender = {}) {
  if (!message || !message.type) {
    return { ok: false, error: "Empty message" };
  }

  if (message.type === "JournalLens:openLookup") {
    const settings = await store.getSettings();
    const url = shared.buildResolverUrl(settings, message.record || {});
    if (!url) {
      return { ok: false, error: "No valid lookup URL" };
    }
    await chrome.tabs.create({ url });
    return { ok: true, url };
  }

  if (message.type === "JournalLens:getContentSettings") {
    const settings = await store.getSettings();
    const { easyScholarSecretKey, ...publicSettings } = settings;
    publicSettings.debugMode = debugFeaturesEnabled() && Boolean(publicSettings.debugMode);
    return {
      ok: true,
      settings: {
        ...publicSettings,
        easyScholarConfigured: Boolean(shared.collapseWhitespace(easyScholarSecretKey))
      }
    };
  }

  if (message.type === "JournalLens:openAbleSciRequest") {
    const settings = await store.getSettings();
    if (!settings.enableAbleSciAssist) {
      return { ok: false, error: "科研通表单辅助已在设置中关闭" };
    }
    const result = await openAbleSciRequest(message.record || {});
    return { ok: true, ...result };
  }

  if (message.type === "JournalLens:getAbleSciPending") {
    const settings = await store.getSettings();
    if (!settings.enableAbleSciAssist) return { ok: true, disabled: true, request: null };
    const request = await getAbleSciPending(message.requestId, sender && sender.tab && sender.tab.id);
    return {
      ok: true,
      request,
      autoLookup: Boolean(settings.ableSciAutoLookup),
      debugMode: debugFeaturesEnabled() && Boolean(settings.debugMode)
    };
  }

  if (message.type === "JournalLens:updateAbleSciPending") {
    await updateAbleSciPending(
      message.requestId,
      sender && sender.tab && sender.tab.id,
      message.status
    );
    return { ok: true };
  }

  if (message.type === "JournalLens:lookupOpenAlex") {
    const settings = await store.getSettings();
    if (!settings.enableOpenAlex) {
      return { ok: true, disabled: true };
    }
    const result = await lookupOpenAlex(message.record || {});
    return { ok: true, result };
  }

  if (message.type === "JournalLens:resolveArticleMetadata") {
    const result = await resolveArticleMetadata(message.record || {});
    return { ok: true, result };
  }

  if (message.type === "JournalLens:lookupEasyScholar") {
    const settings = await store.getSettings();
    const result = await lookupEasyScholar(message.publicationName, settings, false);
    return { ok: true, ...result };
  }

  if (message.type === "JournalLens:testEasyScholar") {
    const settings = await store.getSettings();
    const result = await lookupEasyScholar(message.publicationName, settings, true);
    return { ok: true, ...result };
  }

  return { ok: false, error: `Unknown message type: ${message.type}` };
}

async function openAbleSciRequest(record) {
  const doi = shared.normalizeDoi(record && record.doi);
  if (!doi) throw new Error("当前论文没有可用 DOI");

  const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const pending = await getAbleSciPendingStore();
  pruneAbleSciPending(pending);
  pending.requests[requestId] = {
    requestId,
    createdAt: Date.now(),
    tabId: null,
    status: "created",
    record: {
      doi
    }
  };
  await setAbleSciPendingStore(pending);

  const url = `https://www.ablesci.com/assist/create#journal-lens=${encodeURIComponent(requestId)}`;
  const tab = await chrome.tabs.create({ url });
  if (tab && Number.isInteger(tab.id)) {
    const latest = await getAbleSciPendingStore();
    if (latest.requests[requestId]) {
      latest.requests[requestId].tabId = tab.id;
      latest.requests[requestId].status = "opened";
      await setAbleSciPendingStore(latest);
    }
  }
  return { requestId, url, tabId: tab && tab.id };
}

async function getAbleSciPending(requestId, tabId) {
  const pending = await getAbleSciPendingStore();
  const changed = pruneAbleSciPending(pending);
  const normalizedId = shared.collapseWhitespace(requestId);
  let request = normalizedId ? pending.requests[normalizedId] : null;
  if (request && Number.isInteger(tabId) && Number.isInteger(request.tabId) && request.tabId !== tabId) {
    request = null;
  }
  if (!request && Number.isInteger(tabId)) {
    request = Object.values(pending.requests)
      .filter((entry) => entry && entry.tabId === tabId)
      .sort((left, right) => right.createdAt - left.createdAt)[0] || null;
  }
  if (request && Number.isInteger(tabId) && !Number.isInteger(request.tabId)) {
    request.tabId = tabId;
    request.status = request.status === "created" ? "opened" : request.status;
    await setAbleSciPendingStore(pending);
  } else if (changed) {
    await setAbleSciPendingStore(pending);
  }
  if (!request) return null;
  return {
    requestId: request.requestId,
    createdAt: request.createdAt,
    status: request.status,
    record: { ...request.record }
  };
}

async function updateAbleSciPending(requestId, tabId, status) {
  const allowedStatuses = new Set([
    "opened",
    "login-required",
    "form-detected",
    "doi-filled",
    "lookup-triggered",
    "dismissed"
  ]);
  const nextStatus = allowedStatuses.has(status) ? status : "";
  if (!nextStatus) return;
  const pending = await getAbleSciPendingStore();
  pruneAbleSciPending(pending);
  const request = pending.requests[shared.collapseWhitespace(requestId)];
  if (!request) return;
  if (Number.isInteger(request.tabId) && Number.isInteger(tabId) && request.tabId !== tabId) return;
  if (nextStatus === "dismissed") delete pending.requests[request.requestId];
  else request.status = nextStatus;
  await setAbleSciPendingStore(pending);
}

function pruneAbleSciPending(pending) {
  let changed = false;
  const cutoff = Date.now() - ABLE_SCI_PENDING_TTL;
  Object.entries(pending.requests).forEach(([requestId, request]) => {
    if (!request || Number(request.createdAt) < cutoff) {
      delete pending.requests[requestId];
      changed = true;
    }
  });
  return changed;
}

function getAbleSciPendingStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

function getAbleSciPendingStore() {
  return new Promise((resolve) => {
    getAbleSciPendingStorageArea().get({ [ABLE_SCI_PENDING_KEY]: { requests: {} } }, (values) => {
      const stored = values[ABLE_SCI_PENDING_KEY];
      resolve(stored && typeof stored === "object" && stored.requests
        ? stored
        : { requests: {} });
    });
  });
}

function setAbleSciPendingStore(value) {
  return new Promise((resolve) => {
    getAbleSciPendingStorageArea().set({ [ABLE_SCI_PENDING_KEY]: value }, resolve);
  });
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const pending = await getAbleSciPendingStore();
    let changed = pruneAbleSciPending(pending);
    Object.entries(pending.requests).forEach(([requestId, request]) => {
      if (request && request.tabId === tabId) {
        delete pending.requests[requestId];
        changed = true;
      }
    });
    if (changed) await setAbleSciPendingStore(pending);
  });
}

async function lookupEasyScholar(publicationName, settings, forceRefresh) {
  const name = shared.collapseWhitespace(publicationName);
  const secretKey = shared.collapseWhitespace(settings && settings.easyScholarSecretKey);
  if (!name) throw new Error("缺少期刊名称");
  if (!secretKey) throw new Error("尚未配置 EasyScholar SecretKey");

  const cacheKey = shared.normalizeJournalName(name) || name.toLowerCase();
  if (!forceRefresh) {
    const cache = await getEasyScholarCache();
    const cached = cache[cacheKey];
    if (cached && Date.now() - cached.cachedAt < EASY_SCHOLAR_CACHE_TTL) {
      return {
        publicationName: cached.publicationName || name,
        metric: shared.parseEasyScholarMetric(cached.data, settings.easyScholarFields, cached.publicationName || name),
        cached: true
      };
    }
    if (easyScholarInFlight.has(cacheKey)) return easyScholarInFlight.get(cacheKey);
  }

  const request = requestEasyScholar(name, secretKey).then(async (payload) => {
    const cache = await getEasyScholarCache();
    cache[cacheKey] = {
      cachedAt: Date.now(),
      publicationName: name,
      data: payload.data
    };
    await chrome.storage.local.set({ [EASY_SCHOLAR_CACHE_KEY]: cache });
    return {
      publicationName: name,
      metric: shared.parseEasyScholarMetric(payload.data, settings.easyScholarFields, name),
      cached: false
    };
  });

  if (!forceRefresh) easyScholarInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (!forceRefresh && easyScholarInFlight.get(cacheKey) === request) {
      easyScholarInFlight.delete(cacheKey);
    }
  }
}

async function requestEasyScholar(publicationName, secretKey) {
  return enqueueEasyScholarRequest(async () => {
    const url = new URL("https://www.easyscholar.cc/open/getPublicationRank");
    url.searchParams.set("secretKey", secretKey);
    url.searchParams.set("publicationName", publicationName);
    let response;
    try {
      response = await fetch(url.href, { headers: { accept: "application/json" } });
    } catch (_error) {
      throw new Error("EasyScholar 网络请求失败");
    }
    if (!response.ok) throw new Error(`EasyScholar 请求失败（HTTP ${response.status}）`);
    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      throw new Error("EasyScholar 返回了无法解析的数据");
    }
    if (!payload || Number(payload.code) !== 200 || !payload.data) {
      const message = shared.collapseWhitespace(payload && payload.msg).slice(0, 160) || "接口返回错误";
      throw new Error(`EasyScholar：${message}`);
    }
    return payload;
  });
}

function enqueueEasyScholarRequest(task) {
  const request = easyScholarRequestQueue.then(async () => {
    const waitTime = Math.max(0, EASY_SCHOLAR_MIN_INTERVAL - (Date.now() - easyScholarLastRequestAt));
    if (waitTime) await new Promise((resolve) => setTimeout(resolve, waitTime));
    easyScholarLastRequestAt = Date.now();
    return task();
  });
  easyScholarRequestQueue = request.catch(() => undefined);
  return request;
}

function getEasyScholarCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [EASY_SCHOLAR_CACHE_KEY]: {} }, (values) => {
      resolve(values[EASY_SCHOLAR_CACHE_KEY] || {});
    });
  });
}

async function resolveArticleMetadata(record) {
  const doi = shared.normalizeDoi(record.doi);
  const pubmedId = String(record.pubmedId || "").match(/\d+/)?.[0] || "";
  const cacheKey = pubmedId ? `pmid:${pubmedId}` : doi ? `doi:${doi}` : "";
  if (!cacheKey) return record;

  const cache = await getArticleMetaCache();
  const cached = cache[cacheKey];
  if (cached && Date.now() - cached.cachedAt < 30 * 24 * 60 * 60 * 1000) {
    return { ...record, ...cached.value };
  }

  let resolved = null;
  if (pubmedId) {
    resolved = await fetchPubMedSummary(pubmedId);
  }
  if ((!resolved || !resolved.journal) && doi) {
    resolved = mergeRecords(resolved, await fetchOpenAlexWork(doi));
  }

  const value = mergeRecords(record, resolved);
  cache[cacheKey] = { cachedAt: Date.now(), value };
  await chrome.storage.local.set({ [ARTICLE_META_CACHE_KEY]: cache });
  return value;
}

async function getArticleMetaCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [ARTICLE_META_CACHE_KEY]: {} }, (values) => {
      resolve(values[ARTICLE_META_CACHE_KEY] || {});
    });
  });
}

async function fetchPubMedSummary(pubmedId) {
  const params = new URLSearchParams({
    db: "pubmed",
    id: pubmedId,
    retmode: "json"
  });
  const response = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params}`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`PubMed request failed: ${response.status}`);
  }

  const payload = await response.json();
  const entry = payload && payload.result && payload.result[pubmedId];
  if (!entry) return null;
  const articleIds = Array.isArray(entry.articleids) ? entry.articleids : [];
  const resolvedDoi = articleIds.find((item) => String(item.idtype).toLowerCase() === "doi");
  const issns = shared.unique([
    shared.normalizeIssn(entry.issn),
    shared.normalizeIssn(entry.essn)
  ]);

  return {
    title: shared.collapseWhitespace(entry.title),
    journal: shared.collapseWhitespace(entry.fulljournalname || entry.source),
    doi: shared.normalizeDoi((resolvedDoi && resolvedDoi.value) || entry.elocationid),
    issn: issns[0] || "",
    eissn: issns[1] || "",
    issns,
    pubmedId
  };
}

async function fetchOpenAlexWork(doi) {
  const url = encodeURI(`https://api.openalex.org/works/https://doi.org/${doi}`);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`OpenAlex work request failed: ${response.status}`);
  }

  const work = await response.json();
  const locations = [work.primary_location, work.best_oa_location, ...(work.locations || [])].filter(Boolean);
  const source = locations.map((location) => location.source).find(Boolean) || {};
  const issns = shared.unique([
    shared.normalizeIssn(source.issn_l),
    ...(Array.isArray(source.issn) ? source.issn.map(shared.normalizeIssn) : [])
  ]);
  return {
    title: shared.collapseWhitespace(work.display_name || work.title),
    journal: shared.collapseWhitespace(source.display_name),
    doi,
    issn: issns[0] || "",
    eissn: issns[1] || "",
    issns
  };
}

function mergeRecords(base, patch) {
  const left = base || {};
  const right = patch || {};
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (value !== "" && value !== null && value !== undefined) {
      merged[key] = value;
    }
  }
  merged.issns = shared.unique([
    ...(Array.isArray(left.issns) ? left.issns : []),
    ...(Array.isArray(right.issns) ? right.issns : []),
    shared.normalizeIssn(merged.issn),
    shared.normalizeIssn(merged.eissn)
  ]);
  return merged;
}

async function lookupOpenAlex(record) {
  const issns = shared.unique([
    ...(Array.isArray(record.issns) ? record.issns.map(shared.normalizeIssn) : []),
    shared.normalizeIssn(record.issn),
    shared.normalizeIssn(record.eissn)
  ]);
  const journal = shared.collapseWhitespace(record.journal || record.containerTitle || record.source || "");
  const cacheKey = issns[0] || shared.normalizeJournalName(journal);
  if (!cacheKey) return null;

  const cache = await getOpenAlexCache();
  const cached = cache[cacheKey];
  if (cached && Date.now() - cached.cachedAt < 7 * 24 * 60 * 60 * 1000) {
    return cached.value;
  }

  let result = null;
  for (const issn of issns) {
    result = summarizeOpenAlexSource(
      await fetchOpenAlexSource(`https://api.openalex.org/sources/issn:${encodeURIComponent(issn)}`)
    );
    if (result) break;
  }

  if (!result && journal) {
    const params = new URLSearchParams({
      filter: "type:journal",
      per_page: "3",
      search: journal
    });
    const searchResult = await fetchOpenAlexSource(`https://api.openalex.org/sources?${params}`);
    result = pickOpenAlexSource(searchResult, journal);
  }

  cache[cacheKey] = {
    cachedAt: Date.now(),
    value: result
  };
  await chrome.storage.local.set({ [OPENALEX_CACHE_KEY]: cache });
  return result;
}

async function getOpenAlexCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [OPENALEX_CACHE_KEY]: {} }, (values) => {
      resolve(values[OPENALEX_CACHE_KEY] || {});
    });
  });
}

async function fetchOpenAlexSource(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`OpenAlex request failed: ${response.status}`);
  }
  return response.json();
}

function pickOpenAlexSource(payload, journal) {
  if (!payload) return null;
  if (!Array.isArray(payload.results)) {
    return summarizeOpenAlexSource(payload);
  }

  const key = shared.normalizeJournalName(journal);
  const exact = payload.results.find((entry) => shared.normalizeJournalName(entry.display_name) === key);
  return summarizeOpenAlexSource(exact || payload.results[0]);
}

function summarizeOpenAlexSource(source) {
  if (!source) return null;
  const stats = source.summary_stats || {};
  return {
    displayName: source.display_name || "",
    homepageUrl: source.homepage_url || "",
    issnL: source.issn_l || "",
    issn: Array.isArray(source.issn) ? source.issn : [],
    worksCount: source.works_count || 0,
    citedByCount: source.cited_by_count || 0,
    hIndex: stats.h_index || "",
    i10Index: stats.i10_index || "",
    twoYearMeanCitedness: stats["2yr_mean_citedness"] || ""
  };
}

