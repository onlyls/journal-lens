const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "extension");
const shared = {
  collapseWhitespace: (value) => String(value || "").replace(/\s+/g, " ").trim(),
  normalizeDoi(value) {
    const match = String(value || "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
    return match ? match[0].toLowerCase() : "";
  },
  normalizeIssn(value) {
    const match = String(value || "").toUpperCase().match(/[0-9]{4}-?[0-9]{3}[0-9X]/);
    return match ? `${match[0].replace("-", "").slice(0, 4)}-${match[0].replace("-", "").slice(4)}` : "";
  },
  unique: (values) => [...new Set(values.filter(Boolean))]
};
global.JournalLensShared = shared;

const storage = {};
global.chrome = {
  runtime: {
    lastError: null,
    getURL(relativePath) { return `chrome-extension://journal-lens/${relativePath}`; }
  },
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
      remove(keys, callback) {
        (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete storage[key]);
        if (callback) callback();
      }
    }
  }
};

const dependentXml = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
  <info><title>Fixture Journal</title><id>http://www.zotero.org/styles/fixture-journal</id>
  <link href="http://www.zotero.org/styles/fixture-parent" rel="independent-parent"/>
  <updated>2026-07-29T00:00:00+00:00</updated><rights license="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA</rights></info>
</style>`;
const parentXml = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text">
  <info><title>Fixture Parent</title><id>http://www.zotero.org/styles/fixture-parent</id><updated>2026-07-29T00:00:00+00:00</updated></info>
  <citation><layout><text variable="title"/></layout></citation>
  <bibliography><layout><text variable="title"/></layout></bibliography>
</style>`;
const indexPayload = {
  version: 1,
  entries: [{
    id: "http://www.zotero.org/styles/fixture-parent",
    title: "Fixture Parent",
    fileName: "fixture-parent.csl",
    path: "fixture-parent.csl",
    dependent: false,
    parentId: "",
    updated: "2026-07-29T00:00:00+00:00",
    categories: [],
    issns: []
  }]
};
let remoteStyleFetches = 0;
global.fetch = async (url) => {
  const value = String(url);
  const response = (body, contentType = "application/xml", status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    text: async () => body,
    json: async () => JSON.parse(body)
  });
  if (value.startsWith("chrome-extension://journal-lens/")) {
    const relativePath = value.replace("chrome-extension://journal-lens/", "");
    return response(fs.readFileSync(path.join(root, relativePath), "utf8"));
  }
  if (value.includes("onlyls/journal-lens")) return response(JSON.stringify(indexPayload), "application/json");
  if (value.endsWith("dependent/fixture-journal.csl")) { remoteStyleFetches += 1; return response(dependentXml); }
  if (value.endsWith("fixture-parent.csl")) { remoteStyleFetches += 1; return response(parentXml); }
  if (value.includes("locales-fr-FR.xml")) return response("not found", "text/plain", 404);
  return response("not found", "text/plain", 404);
};

require(path.join(root, "src", "citation", "csl-metadata.js"));
require(path.join(root, "src", "citation", "csl-style-manager.js"));
global.CSL = require("citeproc");
require(path.join(root, "src", "citation", "csl-engine.js"));

const styles = global.JournalLensCslStyles;
const metadata = global.JournalLensCslMetadata;
const engine = global.JournalLensCslEngine;

(async () => {
  const apaXml = fs.readFileSync(path.join(root, "assets", "citation", "styles", "apa.csl"), "utf8");
  assert.equal(styles.parseCslStyle(apaXml).dependent, false);
  const dependent = styles.parseCslStyle(dependentXml);
  assert.equal(dependent.dependent, true);
  assert.equal(dependent.parentId, "http://www.zotero.org/styles/fixture-parent");
  assert.throws(() => styles.parseCslStyle("<html><body>Not found</body></html>"), /HTML|根元素/);
  assert.throws(() => styles.parseCslStyle("<style><info></style>"), /解析|闭合/);
  assert.throws(() => styles.parseCslStyle("<!DOCTYPE style [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><style/>"), /DTD|实体/);

  const installed = await styles.installStyle({
    id: dependent.id,
    title: dependent.title,
    fileName: "fixture-journal.csl",
    path: "dependent/fixture-journal.csl",
    dependent: true,
    parentId: dependent.parentId
  });
  assert.equal(installed.style.dependent, true);
  assert.ok(installed.style.parentStorageKey);
  assert.equal(remoteStyleFetches, 2, "dependent style and its parent are downloaded once");
  const duplicate = await styles.installStyle({
    id: dependent.id,
    fileName: "fixture-journal.csl",
    path: "dependent/fixture-journal.csl"
  });
  assert.equal(duplicate.alreadyInstalled, true);
  assert.equal(remoteStyleFetches, 2, "already installed styles are not downloaded again");
  const payload = await styles.getStylePayload(dependent.id, "fr-FR");
  assert.equal(payload.parentStyleXml, parentXml);
  assert.ok(payload.locales["en-US"], "missing locale falls back to bundled en-US");

  const doiItem = metadata.normalizeItem({
    DOI: "https://doi.org/10.5555/EXAMPLE",
    title: "Structured metadata",
    author: [{ family: "Zhang", given: "Wei" }, { family: "Smith", given: "Jane" }],
    "container-title": "Example Journal",
    issued: { "date-parts": [[2026, 7, 29]] },
    volume: "12",
    issue: "4",
    page: "101-109",
    ISSN: ["1234-567X"]
  }, "doi");
  assert.equal(doiItem.item.DOI, "10.5555/example");
  assert.deepEqual(doiItem.item.author[0], { family: "Zhang", given: "Wei" });
  assert.deepEqual(doiItem.item.issued, { "date-parts": [[2026, 7, 29]] });
  assert.equal(doiItem.item["page-first"], "101");
  const pageItem = metadata.normalizeItem({ title: "", volume: "99", issue: "", journal: "Example Journal" }, "page");
  const merged = metadata.mergeNormalized(doiItem, pageItem);
  assert.equal(merged.item.title, "Structured metadata", "empty fields never replace valid values");
  assert.equal(merged.item.volume, "12", "lower-priority page data does not replace DOI data");

  const locale = fs.readFileSync(path.join(root, "assets", "citation", "locales", "locales-en-US.xml"), "utf8");
  const sample = {
    ...doiItem.item,
    author: [
      { family: "Zhang", given: "Wei" }, { family: "Smith", given: "Jane" },
      { family: "Garcia", given: "Luis" }, { family: "Müller", given: "Anna" },
      { family: "Brown", given: "Taylor" }, { family: "Kim", given: "Min" },
      { family: "Singh", given: "Asha" }, { family: "Wilson", given: "James" }
    ],
    title: "Catalysis with H<sub>2</sub>O and special characters β",
    number: "e20260001",
    page: "e20260001"
  };
  const rendered = ["apa.csl", "elsevier-vancouver.csl", "american-chemical-society.csl"].map((fileName) => {
    const styleXml = fs.readFileSync(path.join(root, "assets", "citation", "styles", fileName), "utf8");
    return engine.renderBibliography({ item: sample, styleXml, locales: { "en-US": locale } });
  });
  assert.equal(new Set(rendered.map((entry) => entry.plainText)).size, 3, "three real CSL styles produce different output");
  assert.ok(rendered.every((entry) => entry.plainText.includes("Structured metadata") || entry.plainText.includes("Catalysis")));
  assert.ok(rendered.some((entry) => /<i>|<b>|<strong>/.test(entry.html)), "rich HTML keeps CSL emphasis");
  assert.ok(rendered.some((entry) => /et al\./i.test(entry.plainText)), "style et-al thresholds are applied by citeproc-js");
  console.log("citation style, metadata and rendering smoke tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
