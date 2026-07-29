const assert = require("node:assert/strict");
const path = require("node:path");

const src = path.resolve(__dirname, "..", "extension", "src");
const storage = {};
let listener = null;
let doiFetches = 0;
let openAlexFetches = 0;

global.chrome = {
  runtime: {
    lastError: null,
    getURL: (value) => `chrome-extension://journal-lens/${value}`,
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(value) { listener = value; } }
  },
  contextMenus: { removeAll(callback) { callback(); }, create() {}, onClicked: { addListener() {} } },
  tabs: { create: async () => ({ id: 1 }), onRemoved: { addListener() {} } },
  storage: {
    local: {
      get(defaults, callback) {
        const result = {};
        Object.entries(defaults || {}).forEach(([key, fallback]) => {
          result[key] = Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : fallback;
        });
        callback(result);
      },
      set(values, callback) { Object.assign(storage, values); if (callback) callback(); },
      remove(keys, callback) { (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete storage[key]); if (callback) callback(); }
    },
    session: { get(defaults, callback) { callback(defaults); }, set(_values, callback) { if (callback) callback(); } }
  }
};
global.importScripts = (...names) => names.forEach((name) => require(path.join(src, name)));
global.fetch = async (url) => {
  const value = String(url);
  if (value.startsWith("https://doi.org/")) {
    doiFetches += 1;
    if (value.includes("10.5555%2Ffallback")) throw new Error("offline");
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/vnd.citationstyles.csl+json" },
      json: async () => ({
        id: "https://doi.org/10.5555/full",
        type: "article-journal",
        title: "Complete DOI metadata",
        author: [{ family: "Doe", given: "Jane" }, { family: "Li", given: "Ming" }],
        "container-title": "Metadata Journal",
        issued: { "date-parts": [[2026, 6, 2]] },
        volume: "8",
        issue: "2",
        page: "55-63",
        DOI: "10.5555/full"
      })
    };
  }
  if (value.includes("api.openalex.org/works/")) {
    openAlexFetches += 1;
    if (value.includes("fallback")) throw new Error("offline");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        display_name: "OpenAlex lower-priority title",
        publication_date: "2026-06-02",
        language: "en",
        authorships: [],
        biblio: { volume: "8", issue: "2", first_page: "55", last_page: "63" },
        primary_location: { source: { display_name: "Metadata Journal", issn: ["1234-567X"] } },
        locations: []
      })
    };
  }
  throw new Error(`unexpected fetch ${value}`);
};

require(path.join(src, "background.js"));
function send(message) {
  return new Promise((resolve) => {
    assert.equal(listener(message, {}, resolve), true);
  });
}

(async () => {
  const record = { doi: "10.5555/full", title: "Page title", journal: "Page Journal", url: "https://example.test/full" };
  const first = await send({ type: "JournalLens:getCitationMetadata", record });
  assert.equal(first.ok, true);
  assert.equal(first.result.item.title, "Complete DOI metadata");
  assert.deepEqual(first.result.item.author[0], { family: "Doe", given: "Jane" });
  assert.deepEqual(first.result.item.issued, { "date-parts": [[2026, 6, 2]] });
  assert.equal(first.result.item.volume, "8");
  assert.equal(first.result.item.issue, "2");
  assert.equal(first.result.item.page, "55-63");
  const second = await send({ type: "JournalLens:getCitationMetadata", record });
  assert.equal(second.result.cached, true);
  assert.equal(doiFetches, 1, "a DOI cache hit avoids another content negotiation request");
  assert.equal(openAlexFetches, 1, "a DOI cache hit avoids another OpenAlex request");

  const fallback = await send({
    type: "JournalLens:getCitationMetadata",
    record: {
      doi: "10.5555/fallback",
      title: "Offline page metadata",
      authors: [{ family: "王", given: "明" }],
      journal: "中文测试期刊",
      publicationDate: "2026-07-29",
      volume: "2",
      issue: "1",
      articleNumber: "e10",
      language: "zh-CN"
    }
  });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.result.item.title, "Offline page metadata");
  assert.equal(fallback.result.item.page, "e10");
  assert.match(fallback.result.warnings.join(" "), /DOI 元数据获取失败/);
  console.log("citation DOI negotiation, fallback and cache smoke tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
