const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const extensionPath = path.resolve(__dirname, "..", "extension");
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), "journal-lens-extension-"));

function extensionCapableChromium() {
  if (process.env.JOURNAL_LENS_CHROME_PATH) return process.env.JOURNAL_LENS_CHROME_PATH;
  const browserRoot = path.join(os.homedir(), ".cache", "ms-playwright");
  const versions = fs.existsSync(browserRoot)
    ? fs.readdirSync(browserRoot).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()
    : [];
  const candidate = versions.length ? path.join(browserRoot, versions[0], "chrome-linux64", "chrome") : "";
  return candidate && fs.existsSync(candidate) ? candidate : undefined;
}

(async () => {
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: true,
    executablePath: extensionCapableChromium(),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  try {
    let workers = context.serviceWorkers();
    if (!workers.length) workers = [await context.waitForEvent("serviceworker")];
    const worker = workers[0];
    worker.on("console", (message) => process.stderr.write(`[worker] ${message.text()}\n`));
    const extensionId = new URL(worker.url()).host;
    assert.ok(extensionId);

    const page = await context.newPage();
    page.on("console", (message) => process.stderr.write(`[page] ${message.text()}\n`));
    page.on("pageerror", (error) => process.stderr.write(`[page-error] ${error.message}\n`));
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    try {
      await page.waitForFunction(() => /zotero\.org\/styles\/apa/.test(document.getElementById("defaultCitationStyle").textContent));
    } catch (error) {
      const diagnostic = await page.locator("#defaultCitationStyle,#citationStyleStatus").allTextContents();
      throw new Error(`${error.message}; citation UI: ${diagnostic.join(" | ")}`);
    }
    const listed = await page.evaluate(() => chrome.runtime.sendMessage({ type: "JournalLens:listCitationStyles" }));
    assert.equal(listed.ok, true);
    assert.equal(listed.styles.length, 3);
    assert.equal(listed.defaultStyleId, "http://www.zotero.org/styles/apa");

    const search = await page.evaluate(() => chrome.runtime.sendMessage({
      type: "JournalLens:searchCitationStyles",
      query: "Nature Biotechnology",
      limit: 5
    }));
    assert.equal(search.ok, true);
    assert.equal(search.results[0].title, "Nature Biotechnology");
    assert.equal(search.results[0].dependent, true);
    await page.close();
    console.log("real MV3 extension citation initialization and search smoke tests passed");
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
