const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..", "extension");
const sharedSource = fs.readFileSync(path.join(root, "src", "shared.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(root, "content", "ablesci.js"), "utf8");
const requestId = "fixture-request";

async function preparePage(browser, {
  html,
  pathname = "/assist/create",
  autoLookup = true,
  debugMode = false,
  doi = "10.1016/j.ejmech.2026.100001"
}) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 780 } });
  await page.route("https://www.ablesci.com/**", (route) => route.fulfill({
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: html
  }));
  await page.goto(`https://www.ablesci.com${pathname}#journal-lens=${requestId}`);
  await page.evaluate(({ fixtureRequestId, fixtureAutoLookup, fixtureDebugMode, fixtureDoi }) => {
    window.__journalLensMessages = [];
    window.__copiedText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copiedText = text;
        }
      }
    });
    window.chrome = {
      runtime: {
        sendMessage(message) {
          window.__journalLensMessages.push(message);
          if (message.type === "JournalLens:getAbleSciPending") {
            return Promise.resolve({
              ok: true,
              autoLookup: fixtureAutoLookup,
              debugMode: fixtureDebugMode,
              request: {
                requestId: fixtureRequestId,
                createdAt: Date.now(),
                status: "opened",
                record: {
                  doi: fixtureDoi,
                  title: "Fixture article",
                  journal: "European Journal of Medicinal Chemistry"
                }
              }
            });
          }
          return Promise.resolve({ ok: true });
        }
      }
    };
  }, {
    fixtureRequestId: requestId,
    fixtureAutoLookup: autoLookup,
    fixtureDebugMode: debugMode,
    fixtureDoi: doi
  });
  await page.addScriptTag({ content: sharedSource });
  await page.addScriptTag({ content: adapterSource });
  return page;
}

function assistForm(inputValue = "") {
  return `<!doctype html>
    <html lang="zh-CN">
      <head><meta charset="utf-8"><title>发布文献求助 - 科研通</title></head>
      <body>
        <main>
          <form class="assist-create" id="assistForm">
            <h1>发布文献求助</h1>
            <div class="alert alert-success">
              <label for="onekey">一键求助</label>
              <button title="查询该doi的论文信息" type="button" id="query" class="layui-btn layui-btn-normal onekey-search"><i class="layui-icon layui-icon-search"></i> 智能提取文献信息</button>
              <input value="${inputValue}" type="text" id="onekey" name="onekey" placeholder="请输入DOI、PMID 或 标题" autocomplete="off" class="layui-input">
            </div>
            <button type="submit" id="publish">一 键 发 布</button>
          </form>
        </main>
        <script>
          window.__queryClicks = 0;
          window.__publishClicks = 0;
          document.getElementById("query").addEventListener("click", () => { window.__queryClicks += 1; });
          document.getElementById("publish").addEventListener("click", (event) => {
            event.preventDefault();
            window.__publishClicks += 1;
          });
        </script>
      </body>
    </html>`;
}

async function testAutomaticLookup(browser) {
  const page = await preparePage(browser, { html: assistForm() });
  try {
    await page.waitForFunction(() => document.getElementById("onekey").value === "10.1016/j.ejmech.2026.100001"
      && window.__queryClicks === 1);
  } catch (error) {
    console.error("AbleSci fixture state", await page.evaluate(() => ({
      href: location.href,
      doi: document.getElementById("onekey") && document.getElementById("onekey").value,
      queryClicks: window.__queryClicks,
      messages: window.__journalLensMessages,
      injected: window.__journalLensAbleSciInjected,
      buttons: [...document.querySelectorAll("button")].map((button) => ({
        id: button.id,
        value: button.value,
        innerText: button.innerText,
        display: getComputedStyle(button).display,
        visibility: getComputedStyle(button).visibility
      })),
      forms: [...document.querySelectorAll("form")].map((form) => ({
        id: form.id,
        className: form.className,
        text: form.innerText
      })),
      banner: document.querySelector(".journal-lens-ablesci-host")
        && document.querySelector(".journal-lens-ablesci-host").shadowRoot.textContent
    })));
    throw error;
  }
  const result = await page.evaluate(() => ({
    queryClicks: window.__queryClicks,
    publishClicks: window.__publishClicks,
    banner: document.querySelector(".journal-lens-ablesci-host").shadowRoot.textContent,
    statuses: window.__journalLensMessages
      .filter((message) => message.type === "JournalLens:updateAbleSciPending")
      .map((message) => message.status),
    hash: location.hash
  }));
  assert.equal(result.queryClicks, 1);
  assert.equal(result.publishClicks, 0, "Journal Lens must never click the final publish button");
  assert.match(result.banner, /核对后手动发布/);
  assert.ok(result.statuses.includes("doi-filled"));
  assert.ok(result.statuses.includes("lookup-triggered"));
  assert.equal(result.hash, "", "the temporary request id is removed from the visible URL");

  await page.waitForFunction(() => !document.querySelector(".journal-lens-ablesci-host"), null, {
    timeout: 6000
  });
  assert.ok(await page.evaluate(() => window.__journalLensMessages.some((message) =>
    message.type === "JournalLens:updateAbleSciPending" && message.status === "auto-dismissed"
  )), "the success notice reports and performs automatic dismissal");

  const artifactDir = process.env.JOURNAL_LENS_ARTIFACT_DIR;
  if (artifactDir) {
    fs.mkdirSync(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, "ablesci-assist.png"), fullPage: true });
  }
  await page.close();
}

async function testManualLookup(browser) {
  const page = await preparePage(browser, { html: assistForm(), autoLookup: false });
  await page.waitForFunction(() => document.getElementById("onekey").value === "10.1016/j.ejmech.2026.100001");
  const result = await page.evaluate(() => ({
    queryClicks: window.__queryClicks,
    publishClicks: window.__publishClicks,
    banner: document.querySelector(".journal-lens-ablesci-host").shadowRoot.textContent
  }));
  assert.equal(result.queryClicks, 0);
  assert.equal(result.publishClicks, 0);
  assert.match(result.banner, /请在科研通页面查询并核对后手动发布/);
  await page.close();
}

async function testExistingValueIsPreserved(browser) {
  const existingDoi = "10.9999/existing.value";
  const page = await preparePage(browser, { html: assistForm(existingDoi) });
  await page.waitForFunction(() => /未进行覆盖/.test(
    document.querySelector(".journal-lens-ablesci-host").shadowRoot.textContent
  ));
  assert.equal(await page.locator("#onekey").inputValue(), existingDoi);
  assert.deepEqual(await page.evaluate(() => [window.__queryClicks, window.__publishClicks]), [0, 0]);
  await page.waitForFunction(() => !document.querySelector(".journal-lens-ablesci-host"), null, {
    timeout: 9500
  });
  await page.close();
}

async function testLoginAndSafeDiagnostic(browser) {
  const html = `<!doctype html>
    <html lang="zh-CN">
      <head><meta charset="utf-8"><title>登录 - 科研通</title></head>
      <body>
        <main>
          <h1>发布文献求助</h1>
          <p>对不起，您的操作需要登录才可以进行。</p>
          <label for="email">邮箱</label><input id="email" name="email" value="researcher@example.test">
          <label for="password">密码</label><input id="password" name="password" type="password" value="do-not-copy-me">
          <button type="submit">登 录</button>
        </main>
      </body>
    </html>`;
  const page = await preparePage(browser, { html, debugMode: true });
  await page.waitForFunction(() => /请先登录科研通/.test(
    document.querySelector(".journal-lens-ablesci-host").shadowRoot.textContent
  ));
  await page.evaluate(() => {
    document.querySelector(".journal-lens-ablesci-host").shadowRoot.querySelector(".debug").click();
  });
  await page.waitForFunction(() => Boolean(window.__copiedText));
  const copied = await page.evaluate(() => window.__copiedText);
  const diagnostic = JSON.parse(copied);
  assert.equal(diagnostic.adapterVersion, "0.4.5");
  assert.equal(diagnostic.request.doi, "10.1016/j.ejmech.2026.100001");
  assert.equal(diagnostic.inputs.some((input) => input.type === "password"), false);
  assert.equal(diagnostic.inputs.find((input) => input.id === "email").hasValue, true);
  assert.equal(copied.includes("researcher@example.test"), false, "diagnostics must not copy field values");
  assert.equal(copied.includes("do-not-copy-me"), false, "diagnostics must not copy passwords");
  assert.equal(await page.locator("#password").inputValue(), "do-not-copy-me");
  await page.close();
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.JOURNAL_LENS_CHROME_PATH || undefined
  });
  try {
    await testAutomaticLookup(browser);
    await testManualLookup(browser);
    await testExistingValueIsPreserved(browser);
    await testLoginAndSafeDiagnostic(browser);
    console.log("AbleSci form-assist smoke tests passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
