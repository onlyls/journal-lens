const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..", "extension");
const resources = {
  "/popup/popup.html": ["text/html; charset=utf-8", fs.readFileSync(path.join(root, "popup", "popup.html"), "utf8")],
  "/popup/popup.css": ["text/css", fs.readFileSync(path.join(root, "popup", "popup.css"), "utf8")],
  "/popup/popup.js": ["text/javascript", fs.readFileSync(path.join(root, "popup", "popup.js"), "utf8")],
  "/src/build-flags.js": ["text/javascript", fs.readFileSync(path.join(root, "src", "build-flags.js"), "utf8")],
  "/src/shared.js": ["text/javascript", fs.readFileSync(path.join(root, "src", "shared.js"), "utf8")],
  "/src/storage.js": ["text/javascript", fs.readFileSync(path.join(root, "src", "storage.js"), "utf8")]
  ,"/vendor/citeproc/before.js": ["text/javascript", fs.readFileSync(path.join(root, "vendor", "citeproc", "before.js"), "utf8")]
  ,"/vendor/citeproc/citeproc.js": ["text/javascript", fs.readFileSync(path.join(root, "vendor", "citeproc", "citeproc.js"), "utf8")]
  ,"/vendor/citeproc/after.js": ["text/javascript", fs.readFileSync(path.join(root, "vendor", "citeproc", "after.js"), "utf8")]
  ,"/src/citation/csl-engine.js": ["text/javascript", fs.readFileSync(path.join(root, "src", "citation", "csl-engine.js"), "utf8")]
  ,"/assets/citation/styles/apa.csl": ["application/xml", fs.readFileSync(path.join(root, "assets", "citation", "styles", "apa.csl"), "utf8")]
  ,"/assets/citation/locales/locales-en-US.xml": ["application/xml", fs.readFileSync(path.join(root, "assets", "citation", "locales", "locales-en-US.xml"), "utf8")]
};

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.JOURNAL_LENS_CHROME_PATH || undefined
  });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 650 } });
    await page.addInitScript(() => {
      window.__journalLensMessages = [];
      window.__journalLensClipboardTypes = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          async write(items) { window.__journalLensClipboardTypes = items[0].types || []; },
          async writeText(value) { window.__journalLensPlainClipboard = value; }
        }
      });
      window.chrome = {
        runtime: {
          openOptionsPage() {},
          sendMessage(message) {
            window.__journalLensMessages.push(message);
            if (message.type === "JournalLens:listCitationStyles") {
              return Promise.resolve({
                ok: true,
                defaultStyleId: "http://www.zotero.org/styles/apa",
                styles: [{ id: "http://www.zotero.org/styles/apa", title: "American Psychological Association 7th edition" }]
              });
            }
            if (message.type === "JournalLens:getCitationMetadata") {
              return Promise.resolve({
                ok: true,
                result: {
                  cached: false,
                  warnings: [],
                  item: {
                    id: "doi:10.1021/acscatal.6c01167",
                    type: "article-journal",
                    title: "A compact popup fixture article",
                    author: [{ family: "Zhang", given: "Wei" }, { family: "Smith", given: "Jane" }],
                    "container-title": "ACS Catalysis",
                    issued: { "date-parts": [[2026, 7, 1]] },
                    volume: "16",
                    issue: "7",
                    page: "100-110",
                    DOI: "10.1021/acscatal.6c01167"
                  }
                }
              });
            }
            if (message.type === "JournalLens:getCitationStylePayload") {
              return Promise.all([
                fetch("/assets/citation/styles/apa.csl").then((response) => response.text()),
                fetch("/assets/citation/locales/locales-en-US.xml").then((response) => response.text())
              ]).then(([styleXml, localeXml]) => ({
                ok: true,
                result: { styleXml, parentStyleXml: "", locales: { "en-US": localeXml } }
              }));
            }
            return Promise.resolve({ ok: true });
          }
        },
        tabs: {
          query: async () => [{ id: 9 }],
          sendMessage: async () => ({
            ok: true,
            pageMode: "article",
            relatedCount: 3,
            record: {
              host: "pubs.acs.org",
              title: "A compact popup fixture article",
              journal: "ACS Catalysis",
              doi: "10.1021/acscatal.6c01167"
            },
            metric: {
              title: "ACS Catalysis",
              xrPartition: "1区",
              casPartition: "化学2区 [379/904]",
              jcrQuartile: "Q1",
              impactFactor: "13.1",
              xrTop: "Top",
              year: "2025/2026"
            },
            metricDisplayFields: ["xr", "sciUp", "sci", "sciif"],
            openAlex: { twoYearMeanCitedness: 5.81 },
            dataset: { rows: 22617 },
            features: { ableSciAssist: true }
          })
        },
        storage: {
          local: {
            get(defaults, callback) { callback(defaults || {}); },
            set(_values, callback) { if (callback) callback(); },
            remove(_keys, callback) { if (callback) callback(); }
          }
        }
      };
    });
    await page.route("https://journal-lens.test/**", (route) => {
      const resource = resources[new URL(route.request().url()).pathname];
      if (!resource) return route.fulfill({ status: 404, body: "not found" });
      return route.fulfill({
        status: 200,
        headers: { "content-type": resource[0] },
        body: resource[1]
      });
    });
    await page.goto("https://journal-lens.test/popup/popup.html");
    await page.waitForFunction(() => document.getElementById("journalName").textContent === "ACS Catalysis");

    const assist = page.locator("#ableSciButton");
    assert.equal(await assist.textContent(), "?");
    assert.equal(await assist.getAttribute("title"), "在科研通发起文献求助");
    assert.equal(await assist.getAttribute("aria-label"), "在科研通发起文献求助");
    assert.equal(await assist.isVisible(), true);
    assert.equal(Math.round((await assist.boundingBox()).width), 40);
    assert.match(await page.locator("#metricChips").textContent(), /OA 2yr 5\.81/);
    assert.match(await page.locator("#metricChips").textContent(), /中科院 化学2区/);
    assert.doesNotMatch(await page.locator("#metricChips").textContent(), /379\/904|2025\/2026|新锐 Top/);
    assert.match(await page.locator("#metricChips .open").getAttribute("title"), /不是 JCR IF/);
    assert.deepEqual(await page.locator(".credits a").allTextContents(), ["ShowJCR", "EasyScholar", "科研通"]);
    assert.equal(await page.locator(".credits .powered").textContent(), "Powered by Codex");
    assert.equal(await page.locator("#exportBibtexButton").isEnabled(), true);
    assert.equal(await page.locator("#exportRisButton").isEnabled(), true);
    await page.waitForFunction(() => document.getElementById("copyCitationButton").disabled === false);
    assert.match(await page.locator("#citationStyleName").textContent(), /American Psychological/);
    assert.match(await page.locator("#citationPreview").textContent(), /Zhang/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `popup has ${overflow}px horizontal overflow`);

    const artifactDir = process.env.JOURNAL_LENS_ARTIFACT_DIR;
    if (artifactDir) {
      fs.mkdirSync(artifactDir, { recursive: true });
      await page.screenshot({ path: path.join(artifactDir, "popup.png"), fullPage: true });
    }

    await assist.click();
    await page.waitForFunction(() => /核对元数据后手动发布/.test(document.getElementById("noteText").textContent));
    const request = await page.evaluate(() => window.__journalLensMessages
      .find((message) => message.type === "JournalLens:openAbleSciRequest"));
    assert.equal(request.record.doi, "10.1021/acscatal.6c01167");
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#exportBibtexButton").click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.bib$/);
    const bibtex = fs.readFileSync(await download.path(), "utf8");
    assert.match(bibtex, /@article\{journalLens_acscatal_6c01167/);
    assert.match(bibtex, /doi = \{10\.1021\/acscatal\.6c01167\}/);
    assert.match(bibtex, /journal = \{ACS Catalysis\}/);
    await page.locator("#copyCitationButton").click();
    await page.waitForFunction(() => /已复制/.test(document.getElementById("citationStatus").textContent));
    const clipboardTypes = await page.evaluate(() => window.__journalLensClipboardTypes);
    assert.ok(clipboardTypes.includes("text/plain"));
    assert.ok(clipboardTypes.includes("text/html"));
    await page.waitForFunction(() => document.getElementById("copyCitationButton").textContent === "复制题录");
    await page.evaluate(() => {
      navigator.clipboard.write = async () => { throw new Error("rich clipboard unsupported"); };
      navigator.clipboard.writeText = async (value) => { window.__journalLensPlainClipboard = value; };
    });
    await page.locator("#copyCitationButton").click();
    await page.waitForFunction(() => /仅复制了纯文本/.test(document.getElementById("citationStatus").textContent));
    assert.match(await page.evaluate(() => window.__journalLensPlainClipboard), /Zhang/);
    console.log("popup smoke tests passed");
    await page.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
