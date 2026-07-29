const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..", "extension");
const resources = {
  "/options/options.html": ["text/html", fs.readFileSync(path.join(root, "options", "options.html"), "utf8")],
  "/options/options.css": ["text/css", fs.readFileSync(path.join(root, "options", "options.css"), "utf8")],
  "/options/options.js": ["text/javascript", fs.readFileSync(path.join(root, "options", "options.js"), "utf8")],
  "/src/build-flags.js": ["text/javascript", fs.readFileSync(path.join(root, "src", "build-flags.js"), "utf8")],
  "/src/shared.js": ["text/javascript", fs.readFileSync(path.join(root, "src", "shared.js"), "utf8")],
  "/src/showjcr.js": ["text/javascript", fs.readFileSync(path.join(root, "src", "showjcr.js"), "utf8")],
  "/src/storage.js": ["text/javascript", fs.readFileSync(path.join(root, "src", "storage.js"), "utf8")],
  "/vendor/citeproc/before.js": ["text/javascript", fs.readFileSync(path.join(root, "vendor", "citeproc", "before.js"), "utf8")],
  "/vendor/citeproc/citeproc.js": ["text/javascript", fs.readFileSync(path.join(root, "vendor", "citeproc", "citeproc.js"), "utf8")],
  "/vendor/citeproc/after.js": ["text/javascript", fs.readFileSync(path.join(root, "vendor", "citeproc", "after.js"), "utf8")],
  "/src/citation/csl-engine.js": ["text/javascript", fs.readFileSync(path.join(root, "src", "citation", "csl-engine.js"), "utf8")]
};

async function preparePage(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 1050 } });
  await page.addInitScript(() => {
    const values = {
      "journalLens.settings": {
        resolverId: "googleScholar",
        customResolverTemplate: "",
        enableOpenAlex: true,
        annotateLists: true,
        relatedArticleMode: "manual",
        showUnmatchedArticleBadge: true,
        debugMode: false,
        enableAbleSciAssist: true,
        ableSciAutoLookup: true,
        metricSourceMode: "hybrid",
        easyScholarSecretKey: "fixture-key",
        easyScholarFields: ["xr", "sciUp", "sci", "sciif", "jci"],
        easyScholarCacheTtlDays: 30
      },
      "journalLens.dataset": {
        version: 1,
        importedAt: "2026-07-27T12:00:00.000Z",
        fileName: "fixture.csv",
        rows: [{ title: "Example Journal", impactFactor: "1.0" }]
      }
    };
    window.__journalLensStorageValues = values;
    window.__journalLensMessages = [];
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          window.__journalLensMessages.push(message);
          if (message.type === "JournalLens:listCitationStyles") {
            return {
              ok: true,
              defaultStyleId: "http://www.zotero.org/styles/apa",
              styles: [{
                id: "http://www.zotero.org/styles/apa",
                title: "American Psychological Association 7th edition",
                updated: "2025-12-18T12:00:00+00:00",
                source: "bundled",
                builtIn: true,
                dependent: false
              }]
            };
          }
          if (message.type === "JournalLens:searchCitationStyles") {
            return {
              ok: true,
              results: [{
                id: "http://www.zotero.org/styles/nature-biotechnology",
                title: "Nature Biotechnology",
                fileName: "nature-biotechnology.csl",
                path: "dependent/nature-biotechnology.csl",
                dependent: true,
                parentId: "http://www.zotero.org/styles/nature",
                updated: "2014-06-16T12:00:00+00:00",
                installed: false
              }]
            };
          }
          if (message.type === "JournalLens:getCacheSummary") {
            return { ok: true, easyScholarEntries: 12, otherEntries: 4 };
          }
          if (message.type === "JournalLens:clearEasyScholarCache") {
            return { ok: true, removedEntries: 12 };
          }
          if (message.type === "JournalLens:clearOtherCaches") {
            return { ok: true, removedEntries: 4 };
          }
          if (message.type !== "JournalLens:testEasyScholar") return { ok: true };
          return {
            ok: true,
            metric: {
              title: message.publicationName,
              xrPartition: "医学2区",
              jcrQuartile: "Q1",
              impactFactor: "6.7",
              extraMetrics: [{ key: "jci", label: "JCI", value: "1.32" }]
            }
          };
        }
      },
      storage: {
        local: {
          get(defaults, callback) {
            const result = {};
            Object.entries(defaults || {}).forEach(([key, fallback]) => {
              result[key] = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
            });
            callback(result);
          },
          set(patch, callback) {
            Object.assign(values, patch);
            if (callback) callback();
          },
          remove(keys, callback) {
            (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete values[key]);
            if (callback) callback();
          }
        }
      }
    };
  });
  await page.route("https://journal-lens.test/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const resource = resources[pathname];
    if (!resource) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ status: 200, contentType: resource[0], body: resource[1] });
  });
  await page.goto("https://journal-lens.test/options/options.html");
  await page.waitForFunction(() => document.querySelectorAll("#metricDisplayFields input").length === 15);
  return page;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.JOURNAL_LENS_CHROME_PATH || undefined
  });
  try {
    const desktop = await preparePage(browser, 1000);
    assert.equal(await desktop.locator("#easyScholarSecretKey").getAttribute("type"), "password");
    assert.equal(await desktop.locator("#metricSourceMode").inputValue(), "hybrid");
    assert.equal(await desktop.locator("#metricDisplayFields input:checked").count(), 5);
    assert.equal(await desktop.locator("#metricDisplayFields small").filter({ hasText: "ShowJCR + EasyScholar" }).count(), 7);
    assert.equal(await desktop.locator("#metricDisplayFields small").filter({ hasText: "仅 EasyScholar" }).count(), 8);
    assert.equal(await desktop.locator("#easyScholarCacheTtlDays").inputValue(), "30");
    assert.equal(await desktop.locator("#easyScholarCacheForever").isChecked(), false);
    assert.match(await desktop.locator("#cacheStatus").textContent(), /EasyScholar 12 条.*其他临时缓存 4 条/);
    assert.equal(await desktop.locator("#enableAbleSciAssist").isChecked(), true);
    assert.equal(await desktop.locator("#ableSciAutoLookup").isChecked(), true);
    await desktop.locator("#enableAbleSciAssist").uncheck();
    assert.equal(await desktop.locator("#ableSciAutoLookup").isDisabled(), true);
    await desktop.locator("#enableAbleSciAssist").check();
    assert.equal(await desktop.locator("#ableSciAutoLookup").isDisabled(), false);
    await desktop.locator("#easyScholarCacheForever").check();
    assert.equal(await desktop.locator("#easyScholarCacheTtlDays").isDisabled(), true);
    await desktop.waitForFunction(() => window.__journalLensStorageValues["journalLens.settings"].easyScholarCacheTtlDays === 0);

    desktop.on("dialog", (dialog) => dialog.accept());
    await desktop.locator("#clearEasyScholarCacheButton").click();
    await desktop.waitForFunction(() => /已清除EasyScholar 查询缓存/.test(document.getElementById("cacheStatus").textContent));
    await desktop.locator("#clearOtherCachesButton").click();
    await desktop.waitForFunction(() => /已清除其他临时缓存/.test(document.getElementById("cacheStatus").textContent));
    const cacheMessages = await desktop.evaluate(() => window.__journalLensMessages
      .filter((message) => /Cache/.test(message.type))
      .map((message) => message.type));
    assert.ok(cacheMessages.includes("JournalLens:clearEasyScholarCache"));
    assert.ok(cacheMessages.includes("JournalLens:clearOtherCaches"));
    assert.deepEqual(await desktop.locator(".credits a").allTextContents(), ["ShowJCR", "EasyScholar", "科研通"]);
    assert.equal(await desktop.locator(".credits .powered").textContent(), "Powered by Codex");
    assert.equal(await desktop.locator("#easyScholarTestJournal").inputValue(), "Nature");
    assert.match(await desktop.locator("#defaultCitationStyle").textContent(), /American Psychological Association/);
    await desktop.locator("#citationStyleQuery").fill("Nature Biotechnology");
    await desktop.locator("#searchCitationStylesButton").click();
    await desktop.waitForFunction(() => /Nature Biotechnology/.test(document.getElementById("citationSearchResults").textContent));
    assert.match(await desktop.locator("#citationSearchResults").textContent(), /dependent/);
    await desktop.locator("#testEasyScholarButton").click();
    await desktop.waitForFunction(() => /查询成功/.test(document.getElementById("easyScholarStatus").textContent));
    assert.match(await desktop.locator("#easyScholarStatus").textContent(), /JCI 1\.32/);

    const artifactDir = process.env.JOURNAL_LENS_ARTIFACT_DIR;
    if (artifactDir) {
      fs.mkdirSync(artifactDir, { recursive: true });
      await desktop.screenshot({ path: path.join(artifactDir, "options-desktop.png"), fullPage: true });
    }
    await desktop.close();

    const mobile = await preparePage(browser, 430);
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `settings page has ${overflow}px horizontal overflow`);
    if (artifactDir) {
      await mobile.screenshot({ path: path.join(artifactDir, "options-mobile.png"), fullPage: true });
    }
    await mobile.close();
    console.log("options page smoke tests passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
