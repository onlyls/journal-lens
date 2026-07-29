const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "extension");
const src = path.join(root, "src");
const storageValues = {
  "journalLens.settings": {
    metricSourceMode: "easyScholar",
    easyScholarSecretKey: "test-key-not-for-production",
    easyScholarFields: ["xr", "sci", "sciif", "jci"],
    enableAbleSciAssist: true,
    ableSciAutoLookup: true
  }
};
const sessionValues = {};
let messageListener = null;
let fetchCount = 0;
const requestedUrls = [];
const openedTabs = [];

global.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(listener) { messageListener = listener; } }
  },
  contextMenus: {
    removeAll(callback) { if (callback) callback(); },
    create() {},
    onClicked: { addListener() {} }
  },
  tabs: {
    create: async ({ url }) => {
      openedTabs.push(url);
      return { id: 77 };
    },
    onRemoved: { addListener() {} }
  },
  storage: {
    local: {
      get(defaults, callback) {
        if (defaults === null) {
          callback({ ...storageValues });
          return;
        }
        const result = {};
        for (const [key, fallback] of Object.entries(defaults || {})) {
          result[key] = Object.prototype.hasOwnProperty.call(storageValues, key)
            ? storageValues[key]
            : fallback;
        }
        callback(result);
      },
      set(values, callback) {
        Object.assign(storageValues, values);
        if (callback) callback();
        return Promise.resolve();
      },
      remove(keys, callback) {
        (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete storageValues[key]);
        if (callback) callback();
      }
    },
    session: {
      get(defaults, callback) {
        const result = {};
        for (const [key, fallback] of Object.entries(defaults || {})) {
          result[key] = Object.prototype.hasOwnProperty.call(sessionValues, key)
            ? sessionValues[key]
            : fallback;
        }
        callback(result);
      },
      set(values, callback) {
        Object.assign(sessionValues, values);
        if (callback) callback();
        return Promise.resolve();
      }
    }
  }
};

global.importScripts = (...fileNames) => {
  fileNames.forEach((fileName) => require(path.join(src, fileName)));
};

global.fetch = async (url) => {
  fetchCount += 1;
  requestedUrls.push(String(url));
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        code: 200,
        msg: "SUCCESS",
        data: {
          customRank: { rankInfo: [], rank: [] },
          officialRank: {
            all: { xr: "医学2区", sci: "Q1", sciif: "6.7", jci: "1.32" },
            select: {}
          }
        }
      };
    }
  };
};

require(path.join(src, "background.js"));

function send(message, sender = {}) {
  return new Promise((resolve) => {
    const keepChannelOpen = messageListener(message, sender, resolve);
    assert.equal(keepChannelOpen, true);
  });
}

(async () => {
  const publicSettings = await send({ type: "JournalLens:getContentSettings" });
  assert.equal(publicSettings.ok, true);
  assert.equal(publicSettings.settings.easyScholarConfigured, true);
  assert.equal(publicSettings.settings.enableAbleSciAssist, true);
  assert.equal(publicSettings.settings.ableSciAutoLookup, true);
  assert.deepEqual(publicSettings.settings.metricDisplayFields, ["xr", "sci", "sciif", "jci"],
    "legacy easyScholarFields settings migrate to the unified display field setting");
  assert.equal(Object.prototype.hasOwnProperty.call(publicSettings.settings, "easyScholarSecretKey"), false);

  const ableSci = await send({
    type: "JournalLens:openAbleSciRequest",
    record: {
      doi: "https://doi.org/10.1016/J.EJMECH.2026.100001",
      title: "A paper that needs help",
      journal: "European Journal of Medicinal Chemistry",
      url: "https://example.test/article"
    }
  });
  assert.equal(ableSci.ok, true);
  assert.equal(openedTabs.length, 1);
  const ableSciUrl = new URL(openedTabs[0]);
  assert.equal(ableSciUrl.origin, "https://www.ablesci.com");
  assert.equal(ableSciUrl.pathname, "/assist/create");
  assert.equal(ableSciUrl.href.includes("10.1016"), false, "the DOI must not be placed in the URL");
  const requestId = new URLSearchParams(ableSciUrl.hash.slice(1)).get("journal-lens");
  assert.ok(requestId);

  const pending = await send(
    { type: "JournalLens:getAbleSciPending", requestId },
    { tab: { id: 77 } }
  );
  assert.equal(pending.ok, true);
  assert.equal(pending.autoLookup, true);
  assert.equal(pending.request.record.doi, "10.1016/j.ejmech.2026.100001");
  assert.deepEqual(Object.keys(pending.request.record), ["doi"], "only the DOI is retained in session storage");
  const wrongTab = await send(
    { type: "JournalLens:getAbleSciPending", requestId },
    { tab: { id: 78 } }
  );
  assert.equal(wrongTab.request, null, "a pending request stays bound to the tab opened for it");

  await send(
    { type: "JournalLens:updateAbleSciPending", requestId, status: "dismissed" },
    { tab: { id: 77 } }
  );
  const dismissed = await send(
    { type: "JournalLens:getAbleSciPending", requestId },
    { tab: { id: 77 } }
  );
  assert.equal(dismissed.request, null);

  const publicationName = "European Journal of Medicinal Chemistry & Design";
  const first = await send({ type: "JournalLens:lookupEasyScholar", publicationName });
  assert.equal(first.ok, true);
  assert.equal(first.metric.xrPartition, "医学2区");
  assert.equal(first.metric.impactFactor, "6.7");
  assert.deepEqual(first.metric.extraMetrics, [
    { key: "jci", label: "JCI", value: "1.32", tone: "" }
  ]);
  const parsedUrl = new URL(requestedUrls[0]);
  assert.equal(parsedUrl.searchParams.get("secretKey"), "test-key-not-for-production");
  assert.equal(parsedUrl.searchParams.get("publicationName"), publicationName);

  const cached = await send({ type: "JournalLens:lookupEasyScholar", publicationName });
  assert.equal(cached.cached, true);
  assert.equal(fetchCount, 1, "the second journal lookup should use the local cache");

  const cacheKey = globalThis.JournalLensShared.normalizeJournalName(publicationName);
  storageValues["journalLens.easyScholarCache"][cacheKey].cachedAt = Date.now() - 400 * 24 * 60 * 60 * 1000;
  storageValues["journalLens.settings"].easyScholarCacheTtlDays = 0;
  const permanent = await send({ type: "JournalLens:lookupEasyScholar", publicationName });
  assert.equal(permanent.cached, true, "permanent mode keeps an old EasyScholar cache entry usable");
  assert.equal(fetchCount, 1);

  storageValues["journalLens.settings"].easyScholarCacheTtlDays = 30;
  const expired = await send({ type: "JournalLens:lookupEasyScholar", publicationName });
  assert.equal(expired.cached, false, "a cache entry older than the configured TTL is refreshed");
  assert.equal(fetchCount, 2);

  storageValues["journalLens.openAlexCache"] = { example: { cachedAt: Date.now(), value: {} } };
  storageValues["journalLens.articleMetaCache"] = { example: { cachedAt: Date.now(), value: {} } };
  storageValues["journalLens.csl.metadata:example"] = { cachedAt: Date.now(), item: {} };
  storageValues["journalLens.csl.styleIndex"] = { cachedAt: Date.now(), entries: [] };
  storageValues["journalLens.csl.registry"] = { installed: ["keep"] };
  storageValues["journalLens.csl.style:keep"] = { xml: "<style/>" };

  const summary = await send({ type: "JournalLens:getCacheSummary" });
  assert.equal(summary.easyScholarEntries, 1);
  assert.equal(summary.otherEntries, 4);

  const clearedOther = await send({ type: "JournalLens:clearOtherCaches" });
  assert.equal(clearedOther.removedEntries, 4);
  assert.ok(storageValues["journalLens.easyScholarCache"], "other-cache cleanup preserves EasyScholar");
  assert.ok(storageValues["journalLens.csl.registry"], "installed CSL registry is not a temporary cache");
  assert.ok(storageValues["journalLens.csl.style:keep"], "installed CSL XML is preserved");
  assert.ok(storageValues["journalLens.settings"], "settings are preserved");

  const clearedEasyScholar = await send({ type: "JournalLens:clearEasyScholarCache" });
  assert.equal(clearedEasyScholar.removedEntries, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(storageValues, "journalLens.easyScholarCache"), false);
  assert.ok(storageValues["journalLens.settings"]);
  console.log("EasyScholar background request smoke tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
