const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..", "extension");
const sharedSource = fs.readFileSync(path.join(root, "src", "shared.js"), "utf8");
const contentSource = fs.readFileSync(path.join(root, "content", "content.js"), "utf8");
const contentCss = fs.readFileSync(path.join(root, "content", "content.css"), "utf8");

const rows = [
  { journal: "Frontiers in Immunology", impact_factor: "8.3", jcr_quartile: "Q1", xinrui_partition: "医学2区", cas_partition: "医学3区 [379/904]", xr_top: "Top", year: "2025/2026" },
  { journal: "Veterinary Research", impact_factor: "4.4", jcr_quartile: "Q1" },
  { journal: "ACS Catalysis", impact_factor: "13.1", jcr_quartile: "Q1" },
  { journal: "Journal of the American Chemical Society", impact_factor: "15.6", jcr_quartile: "Q1" },
  { journal: "Journal of Chemical Information and Modeling", impact_factor: "6.4", jcr_quartile: "Q1" },
  { journal: "Chemistry of Materials", impact_factor: "7.2", jcr_quartile: "Q1" },
  { journal: "Cell Chemical Biology", impact_factor: "9.0", jcr_quartile: "Q1" },
  { journal: "Molecular and Cellular Biochemistry", impact_factor: "4.1", jcr_quartile: "Q2" },
  { journal: "Signal Transduction and Targeted Therapy", impact_factor: "81.2", jcr_quartile: "Q1" },
  { journal: "Nature Reviews Drug Discovery", impact_factor: "91.2", jcr_quartile: "Q1" },
  { journal: "Expert Opinion on Drug Discovery", impact_factor: "7.3", jcr_quartile: "Q1" },
  { journal: "Science Bulletin", impact_factor: "20.7", jcr_quartile: "Q1" },
  { journal: "European Journal of Medicinal Chemistry", impact_factor: "6.7", jcr_quartile: "Q1" },
  { journal: "Journal of Medicinal Chemistry", impact_factor: "7.3", jcr_quartile: "Q1" },
  { journal: "Bioorganic Chemistry", impact_factor: "5.1", jcr_quartile: "Q1" },
  { journal: "Cell", impact_factor: "45.1", jcr_quartile: "Q1" },
  { journal: "Trends in Genetics", impact_factor: "12.9", jcr_quartile: "Q1" },
  { journal: "Science", impact_factor: "47.3", jcr_quartile: "Q1" },
  { journal: "Nature", impact_factor: "50.5", jcr_quartile: "Q1" },
  { journal: "Archiv der Pharmazie", impact_factor: "4.1", jcr_quartile: "Q2" },
  { journal: "Angewandte Chemie International Edition", impact_factor: "16.6", jcr_quartile: "Q1" },
  { journal: "Asian Journal of Organic Chemistry", impact_factor: "2.3", jcr_quartile: "Q2" },
  { journal: "Advanced Optical Materials", impact_factor: "8.0", jcr_quartile: "Q1" }
];

async function preparePage(
  browser,
  url,
  html,
  relatedArticleMode = "manual",
  debugMode = false,
  easyScholar = null
) {
  const page = await browser.newPage();
  await page.route(`${url.split("#")[0]}*`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.goto(url);
  await page.evaluate(({ rows: datasetRows, mode, debug, easyScholarConfig }) => {
    window.__journalLensMessages = [];
    const publicSettings = {
      annotateLists: true,
      relatedArticleMode: mode,
      enableOpenAlex: false,
      showUnmatchedArticleBadge: true,
      debugMode: debug,
      enableAbleSciAssist: true,
      ableSciAutoLookup: true,
      metricSourceMode: easyScholarConfig && easyScholarConfig.mode || "local",
      easyScholarConfigured: Boolean(easyScholarConfig && easyScholarConfig.configured),
      easyScholarFields: ["xr", "sciUp", "sci", "sciif", "jci"]
    };
    window.chrome = {
      runtime: {
        getManifest() { return { version: "0.4.5", version_name: "0.4.5" }; },
        onMessage: { addListener(listener) { window.__journalLensListener = listener; } },
        sendMessage(message) {
          window.__journalLensMessages.push(message);
          if (message.type === "JournalLens:getContentSettings") {
            return Promise.resolve({ ok: true, settings: publicSettings });
          }
          if (message.type === "JournalLens:lookupOpenAlex") return Promise.resolve({ ok: true, result: null });
          if (message.type === "JournalLens:resolveArticleMetadata") {
            return Promise.resolve({ ok: true, result: message.record });
          }
          if (message.type === "JournalLens:lookupEasyScholar") {
            const metrics = easyScholarConfig && easyScholarConfig.metrics || {};
            return Promise.resolve({
              ok: true,
              publicationName: message.publicationName,
              metric: metrics[message.publicationName] || null,
              cached: false
            });
          }
          if (message.type === "JournalLens:openAbleSciRequest") {
            return Promise.resolve({ ok: true, url: "https://www.ablesci.com/assist/create" });
          }
          return Promise.resolve({ ok: true });
        }
      },
      storage: { onChanged: { addListener() {} } }
    };
    window.JournalLensStore = {
      getSettings: async () => publicSettings,
      getDataset: async () => ({ rows: datasetRows, importedAt: "", fileName: "fixture.csv" })
    };
  }, { rows, mode: relatedArticleMode, debug: debugMode, easyScholarConfig: easyScholar });
  await page.addStyleTag({ content: contentCss });
  await page.addScriptTag({ content: sharedSource });
  await page.addScriptTag({ content: contentSource });
  return page;
}

async function testEasyScholar(browser) {
  const url = "https://pubs.acs.org/doi/10.1021/example";
  const html = `
    <head>
      <meta name="citation_title" content="EasyScholar integration test">
      <meta name="citation_journal_title" content="Eur. J. Med. Chem.">
      <meta name="citation_doi" content="10.1016/j.ejmech.2026.100001">
    </head>
    <main>
      <h1>EasyScholar integration test</h1>
      <aside><h2>Recommended Articles</h2><div class="recommendation-row">
        <a href="/doi/10.1021/acs.jmedchem.5c00001">A recommended paper</a>
        <div>J. Med. Chem. (2025)</div>
      </div></aside>
    </main>`;
  const metrics = {
    "European Journal of Medicinal Chemistry": {
      title: "European Journal of Medicinal Chemistry",
      source: "EasyScholar API",
      provider: "easyScholar",
      xrPartition: "医学2区",
      casPartition: "医学2区",
      jcrQuartile: "Q4",
      impactFactor: "99.9",
      extraMetrics: [{ key: "jci", label: "JCI", value: "1.32", tone: "" }]
    },
    "Journal of Medicinal Chemistry": {
      title: "Journal of Medicinal Chemistry",
      source: "EasyScholar API",
      provider: "easyScholar",
      xrPartition: "医学1区",
      jcrQuartile: "Q1",
      impactFactor: "8.8",
      extraMetrics: [{ key: "jci", label: "JCI", value: "2.10", tone: "" }]
    }
  };

  const hybridPage = await preparePage(browser, url, html, "manual", false, {
    mode: "hybrid",
    configured: true,
    metrics
  });
  await hybridPage.waitForFunction(() => {
    const host = document.querySelector(".journal-lens-host");
    return host && /新锐 医学2区/.test(host.shadowRoot.textContent) && /JCI 1\.32/.test(host.shadowRoot.textContent);
  });
  const hybridMainText = await hybridPage.locator(".journal-lens-host").evaluate((host) => host.shadowRoot.textContent);
  assert.match(hybridMainText, /IF 6\.7/, "hybrid mode keeps local core metrics");
  assert.doesNotMatch(hybridMainText, /IF 99\.9/);

  await hybridPage.evaluate(() => {
    document.querySelector(".journal-lens-related-host").shadowRoot.querySelector(".reveal").click();
  });
  await hybridPage.waitForFunction(() => {
    const host = document.querySelector(".journal-lens-related-host");
    return host && /JCI 2\.10/.test(host.shadowRoot.textContent);
  });
  const requestedNames = await hybridPage.evaluate(() => window.__journalLensMessages
    .filter((message) => message.type === "JournalLens:lookupEasyScholar")
    .map((message) => message.publicationName));
  assert.ok(requestedNames.includes("European Journal of Medicinal Chemistry"));
  assert.ok(requestedNames.includes("Journal of Medicinal Chemistry"), "related API lookup uses the matched full journal title");
  assert.equal(await hybridPage.evaluate(() => JSON.stringify(window.__journalLensMessages || []).includes("secretKey")), false);
  if (process.env.JOURNAL_LENS_ARTIFACT_DIR) {
    fs.mkdirSync(process.env.JOURNAL_LENS_ARTIFACT_DIR, { recursive: true });
    await hybridPage.screenshot({
      path: path.join(process.env.JOURNAL_LENS_ARTIFACT_DIR, "easyscholar-hybrid.png"),
      fullPage: true
    });
  }
  await hybridPage.close();

  const apiPage = await preparePage(browser, url, html, "manual", false, {
    mode: "easyScholar",
    configured: true,
    metrics
  });
  await apiPage.waitForFunction(() => {
    const host = document.querySelector(".journal-lens-host");
    return host && /IF 99\.9/.test(host.shadowRoot.textContent);
  });
  const apiMainText = await apiPage.locator(".journal-lens-host").evaluate((host) => host.shadowRoot.textContent);
  assert.doesNotMatch(apiMainText, /IF 6\.7/, "API mode does not leak local metrics into the result");
  await apiPage.close();

  const noKeyPage = await preparePage(browser, url, html, "manual", false, {
    mode: "easyScholar",
    configured: false,
    metrics
  });
  await noKeyPage.waitForFunction(() => {
    const host = document.querySelector(".journal-lens-host");
    return host && /未配置 EasyScholar/.test(host.shadowRoot.textContent);
  });
  assert.equal(await noKeyPage.evaluate(() => window.__journalLensMessages
    .some((message) => message.type === "JournalLens:lookupEasyScholar")), false);
  await noKeyPage.close();
}

async function testPubMed(browser) {
  const url = "https://pubmed.ncbi.nlm.nih.gov/?term=PRRSV&sort=date";
  const html = `
    <main class="search-page">
      <article class="full-docsum">
        <a class="docsum-title" href="/42500660/">First paper</a>
        <span class="docsum-authors">Author One</span>
        <span class="docsum-journal-citation full-journal-citation">Front Immunol. 2026 Jul 10;17:1. doi: 10.3389/fimmu.1.</span>
      </article>
      <article class="full-docsum">
        <a class="docsum-title" href="/42498953/">Second paper</a>
        <span class="docsum-authors">Author Two</span>
        <span class="docsum-journal-citation full-journal-citation">Vet Res. 2026 Jul 24;57:138. doi: 10.1186/example.</span>
      </article>
    </main>`;
  const page = await preparePage(browser, url, html);
  await page.waitForFunction(() => document.querySelectorAll(".journal-lens-related-host").length === 2);
  assert.equal(await page.locator(".journal-lens-host").count(), 0, "search page must not get a page-level badge");
  assert.equal(await page.locator(".journal-lens-related-host").count(), 2, "each PubMed result gets one control");

  const result = await page.evaluate(() => {
    const host = document.querySelector(".journal-lens-related-host");
    host.shadowRoot.querySelector(".reveal").click();
    return host.shadowRoot.textContent;
  });
  assert.match(result, /Frontiers in Immunology/);
  assert.match(result, /IF 8\.3/);
  assert.match(result, /新锐 医学2区/);
  assert.match(result, /中科院 医学3区/);
  assert.doesNotMatch(result, /379\/904|2025\/2026|新锐 Top/,
    "rank positions, source years and disabled fields must stay hidden");
  const status = await page.evaluate(() => new Promise((resolve) => {
    window.__journalLensListener({ type: "JournalLens:getPageStatus" }, null, resolve);
  }));
  assert.equal(status.pageMode, "list");
  assert.equal(status.record.journal, "", "the first result must not become the page journal");
  if (process.env.JOURNAL_LENS_ARTIFACT_DIR) {
    fs.mkdirSync(process.env.JOURNAL_LENS_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.JOURNAL_LENS_ARTIFACT_DIR, "pubmed-list.png"),
      fullPage: true
    });
  }
  await page.close();

  const autoPage = await preparePage(browser, url, html, "auto");
  await autoPage.waitForFunction(() => {
    const host = document.querySelector(".journal-lens-related-host");
    return host && host.shadowRoot.querySelector(".panel") && /IF 8\.3/.test(host.shadowRoot.textContent);
  });
  await autoPage.close();
}

async function testAcs(browser) {
  const url = "https://pubs.acs.org/doi/10.1021/acscatal.6c01167";
  const html = `
    <head>
      <meta name="citation_title" content="Main ACS paper">
      <meta name="citation_journal_title" content="ACS Catalysis">
      <meta name="citation_doi" content="10.1021/acscatal.6c01167">
    </head>
    <main>
      <h1>Main ACS paper</h1>
      <div class="journal-title">ACS Catalysis</div>
      <div class="journal-title">ACS Catalysis</div>
      <a class="main-doi" href="https://doi.org/10.1021/acscatal.6c01167">Main DOI</a>
      <section id="references">
        <ol><li class="reference"><span>Author. Reference title. <em>Nature</em> 2025.</span> <a href="https://doi.org/10.1038/example">DOI</a></li></ol>
      </section>
      <aside class="article-sidebar">
        <h2>Recommended Articles</h2>
        <div class="recommendation-list">
          <div class="recommendation-row">
            <a href="/doi/10.1021/acs.jcim.1c00123">Pharmacoprint: A Combination of a Pharmacophore Fingerprint and Artificial Intelligence</a>
            <div>J. Chem. Inf. Model. (September,2021)</div>
          </div>
        </div>
      </aside>
    </main>`;
  const page = await preparePage(browser, url, html);
  await page.waitForFunction(() => document.querySelectorAll(".journal-lens-related-host").length === 2);
  await page.evaluate(() => {
    const row = document.createElement("div");
    row.className = "recommendation-row";
    row.innerHTML = `<a href="/doi/10.1021/cm.example">Magnesium Oxygen Battery Based on the Magnesium Aluminum Chloride Complex Electrolyte</a><div>Chem. Mater. (October,2016)</div>`;
    document.querySelector(".recommendation-list").append(row);
  });
  await page.waitForFunction(() => document.querySelectorAll(".journal-lens-related-host").length === 3);
  assert.equal(await page.locator(".journal-lens-host").count(), 1, "ACS article gets exactly one main badge");
  assert.equal(await page.locator(".journal-lens-related-host").count(), 3, "every ACS recommendation and reference gets one control");
  assert.equal(await page.locator(".recommendation-row + .journal-lens-related-host").count(), 2, "flat ACS recommendations get separate controls");
  assert.equal(await page.locator(".journal-title + .journal-lens-related-host").count(), 0, "journal labels are not annotated as articles");
  assert.equal(await page.evaluate(() => [...document.querySelectorAll(".journal-lens-related-host")]
    .filter((host) => host.shadowRoot.querySelector(".ablesci")).length), 3,
  "DOI-bearing related records expose the icon without expanding metrics");
  assert.equal(await page.evaluate(() => [...document.querySelectorAll(".journal-lens-related-host")]
    .every((host) => host.shadowRoot.querySelector(".reveal").textContent.trim() === "JL")), true,
  "collapsed related controls use the compact JL label");
  const mainAssist = await page.locator(".journal-lens-host").evaluate((host) => {
    const button = host.shadowRoot.querySelector(".ablesci");
    return { text: button && button.textContent, title: button && button.title };
  });
  assert.equal(mainAssist.text, "?", "the literature-help action stays icon-only");
  assert.match(mainAssist.title, /科研通/);
  await page.locator(".journal-lens-host").evaluate((host) => host.shadowRoot.querySelector(".ablesci").click());
  await page.evaluate(() => {
    const host = document.querySelector(".recommendation-row + .journal-lens-related-host");
    host.shadowRoot.querySelector(".ablesci").click();
  });
  const recommendedMetrics = await page.evaluate(() => {
    return [...document.querySelectorAll(".recommendation-row + .journal-lens-related-host")].map((host) => {
      host.shadowRoot.querySelector(".reveal").click();
      return host.shadowRoot.textContent;
    });
  });
  assert.match(recommendedMetrics[0], /Journal of Chemical Information and Modeling/);
  assert.match(recommendedMetrics[0], /IF 6\.4/);
  assert.match(recommendedMetrics[1], /Chemistry of Materials/);
  await page.waitForFunction(() => window.__journalLensMessages
    .filter((message) => message.type === "JournalLens:openAbleSciRequest").length === 2);
  const assistRequests = await page.evaluate(() => window.__journalLensMessages
    .filter((message) => message.type === "JournalLens:openAbleSciRequest")
    .map((message) => message.record.doi));
  assert.deepEqual(assistRequests, [
    "10.1021/acscatal.6c01167",
    "10.1021/acs.jcim.1c00123"
  ]);
  await page.waitForTimeout(1500);
  if (process.env.JOURNAL_LENS_ARTIFACT_DIR) {
    fs.mkdirSync(process.env.JOURNAL_LENS_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.JOURNAL_LENS_ARTIFACT_DIR, "acs-article.png"),
      fullPage: true
    });
  }
  await page.close();
}

async function testScienceDirect(browser) {
  const url = "https://www.sciencedirect.com/science/article/pii/S0045206826007935#bib0002";
  const html = `
    <head>
      <meta name="citation_title" content="Main Elsevier paper">
      <meta name="citation_journal_title" content="Environmental Research">
      <meta name="citation_doi" content="10.1016/j.envres.2026.100001">
    </head>
    <main>
      <h1>Main Elsevier paper</h1>
      <section class="references-section">
        <h2>References</h2>
        <dl>
          <dt><span id="bib0001">[1]</span></dt>
          <dd><div>C.M. Crews</div><div>Targeting the undruggable proteome: the small molecules of my dreams</div><div>Chem. Biol., 17 (2010), pp. 551-555</div><div><a href="/science/article/pii/S1074552110002000">View article</a> <a href="https://scholar.google.com/one">Google Scholar</a></div></dd>
          <dt><span id="bib0002">[2]</span></dt>
          <dd><div>X. Xie, T. Yu, X. Li</div><div>Recent advances in targeting the undruggable proteins: from drug discovery to clinical trials</div><div>Signal Transduct. Target. Ther., 8 (2023), p. 335</div><div><a href="#crossref-two">Crossref</a> <a href="/science/article/pii/S2059363623001000">View article</a></div></dd>
          <dt><span id="bib0003">[3]</span></dt>
          <dd><div>M.J. Henley, A.N. Koehler</div><div>Advances in targeting undruggable transcription factors with small molecules</div><div>Nat. Rev. Drug Discov., 20 (2021), pp. 669-688</div><div><a href="https://doi.org/10.1038/example-three">View at publisher</a></div></dd>
          <dt><span id="bib0004">[4]</span></dt>
          <dd><div>G. Zhang, J. Zhang, Y. Gao</div><div>Strategies for targeting undruggable targets</div><div>Expert Opin. Drug Discovery, 17 (2022), pp. 55-69</div><div><a href="https://scholar.google.com/four">Google Scholar</a></div></dd>
          <dt><span id="bib0005">[5]</span></dt>
          <dd><div>C. Zhang, Y. Liu, G. Li</div><div>Targeting the undruggables-the power of protein degraders</div><div>Sci. Bull., 69 (2024), pp. 1776-1797</div><div><a href="/science/article/pii/S2095927324003000">View article</a></div></dd>
          <dt><span id="bib0020">[20]</span></dt>
          <dd><div class="reference-title-wrapper"><div>Q. Huang, Y. Zhong, H. Dong</div><div>Revisiting signal transducer and activator of transcription 3 as an anticancer target</div><div class="host"><span class="source-title">Eur. J. Med. Chem.</span>, 187 (2020), Article 111922</div></div></dd>
          <dt><span id="bib0021">[21]</span></dt>
          <dd><div>J. Dong, X.D. Cheng, W.D. Zhang</div><div>Recent update on development of small-molecule STAT3 inhibitors</div><div>J. Med. Chem., 64 (2021), pp. 8884-8915</div></dd>
          <dt><span id="bib0022">[22]</span></dt>
          <dd><div>X. Deng, Y. Li, L. Chen</div><div>Discovery of a novel napabucasin derivative B16</div><div>Eur. J. Med. Chem., 302 (2026), Article 118329</div></dd>
          <dt><span id="bib0050">[50]</span></dt>
          <dd><div class="reference-title-wrapper"><div>G. He, Z. Li, M. Zhang</div><div>Discovery of selective HDAC6 inhibitors</div><div class="host"><span class="source-title">Bioorg. Chem.</span>, 129 (2022), Article 106146</div></div></dd>
        </dl>
      </section>
    </main>`;
  const page = await preparePage(browser, url, html);
  await page.waitForFunction(() => document.querySelectorAll(".journal-lens-related-host").length === 9);
  await page.waitForTimeout(700);
  assert.equal(await page.locator(".journal-lens-related-host").count(), 9, "every ScienceDirect reference gets one control");
  await page.evaluate(() => {
    [...document.querySelectorAll(".journal-lens-related-host")].forEach((host) => {
      host.shadowRoot.querySelector(".reveal").click();
    });
  });
  await page.waitForFunction(() => {
    return [...document.querySelectorAll(".journal-lens-related-host")].every((host) => {
      return host.shadowRoot && !host.shadowRoot.querySelector(".chip.loading");
    });
  });
  const metricTexts = await page.evaluate(() => {
    return [...document.querySelectorAll(".journal-lens-related-host")].map((host) => host.shadowRoot.textContent);
  });
  assert.match(metricTexts[0], /Cell Chemical Biology/);
  assert.match(metricTexts[1], /Signal Transduction and Targeted Therapy/);
  assert.match(metricTexts[1], /IF 81\.2/);
  assert.match(metricTexts[2], /Nature Reviews Drug Discovery/);
  assert.match(metricTexts[3], /Expert Opinion on Drug Discovery/);
  assert.match(metricTexts[4], /Science Bulletin/);
  assert.match(metricTexts[4], /IF 20\.7/);
  assert.match(metricTexts[5], /European Journal of Medicinal Chemistry/i);
  assert.match(metricTexts[5], /IF 6\.7/);
  assert.match(metricTexts[6], /Journal of Medicinal Chemistry/i);
  assert.match(metricTexts[7], /European Journal of Medicinal Chemistry/i);
  assert.match(metricTexts[8], /Bioorganic Chemistry/i);
  assert.match(metricTexts[8], /IF 5\.1/);
  await page.evaluate(() => {
    const current = document.getElementById("bib0002").closest("dt").nextElementSibling;
    const replacement = current.cloneNode(true);
    replacement.querySelectorAll(".journal-lens-related-host").forEach((node) => node.remove());
    current.replaceWith(replacement);
  });
  await page.waitForFunction(() => document.querySelectorAll(".journal-lens-related-host").length === 9);
  assert.equal(await page.locator(".journal-lens-related-host").count(), 9, "dynamic rerender keeps one control per reference");
  await page.evaluate(() => {
    const references = ["bib0020", "bib0021", "bib0022", "bib0050"];
    references.forEach((id, referenceIndex) => {
      const container = document.getElementById(id).closest("dt").nextElementSibling;
      if (id === "bib0021") {
        for (let duplicateIndex = 0; duplicateIndex < 7; duplicateIndex += 1) {
          const duplicate = document.createElement("span");
          duplicate.className = "journal-lens-related-host";
          container.append(duplicate);
        }
      }
      ["View article", "Crossref", "View in Scopus", "Google Scholar"].forEach((label, linkIndex) => {
        setTimeout(() => {
          const wrapper = document.createElement("span");
          wrapper.className = `reference-link-item delayed-${linkIndex}`;
          const link = document.createElement("a");
          link.href = `/science/article/pii/S000000000000${referenceIndex}${linkIndex}`;
          link.textContent = label;
          wrapper.append(link);
          container.append(wrapper);
        }, 80 * (referenceIndex + linkIndex + 1));
      });
    });
  });
  await page.waitForFunction(() => {
    const containers = ["bib0020", "bib0021", "bib0022", "bib0050"].map((id) => {
      return document.getElementById(id).closest("dt").nextElementSibling;
    });
    return document.querySelectorAll(".journal-lens-related-host").length === 9
      && containers.every((container) => container.querySelectorAll(".journal-lens-related-host").length === 1)
      && containers.every((container) => container.querySelectorAll("a").length === 4);
  });
  assert.equal(await page.locator(".journal-lens-related-host").count(), 9, "delayed action links never create duplicate controls");
  if (process.env.JOURNAL_LENS_ARTIFACT_DIR) {
    fs.mkdirSync(process.env.JOURNAL_LENS_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.JOURNAL_LENS_ARTIFACT_DIR, "sciencedirect-references.png"),
      fullPage: true
    });
  }
  await page.close();
}

async function testNature(browser) {
  const url = "https://www.nature.com/articles/s41573-021-00199-0";
  const html = `
    <head>
      <meta name="citation_title" content="Advances in targeting undruggable transcription factors with small molecules">
      <meta name="citation_journal_title" content="Nature Reviews Drug Discovery">
      <meta name="citation_doi" content="10.1038/s41573-021-00199-0">
    </head>
    <main>
      <style>
        .c-article-references__item { display:grid; grid-template-columns:minmax(0,1fr) auto; width:900px; }
        .c-article-references__text { grid-column:1 / -1; }
        .reference-actions { grid-column:1 / -1; }
      </style>
      <h1>Advances in targeting undruggable transcription factors with small molecules</h1>
      <section class="c-article-references" data-container-type="reference-list">
        <h2>References</h2>
        <ol>
          <li id="ref-CR1" class="c-article-references__item"><p class="c-article-references__text"><span>1.</span> Lambert, S. A. et al. The human transcription factors. <i>Cell</i> <b>172</b>, 650-665 (2018).</p><div class="reference-actions"><a href="https://doi.org/10.1016/j.cell.2018.01.029">Article</a> <a href="https://pubmed.ncbi.nlm.nih.gov/29425488/">PubMed</a></div></li>
          <li id="ref-CR2" class="c-article-references__item"><p class="c-article-references__text"><span>2.</span> Vernimmen, D. &amp; Bickmore, W. A. The hierarchy of transcriptional activation. <i>Trends Genet.</i> <b>31</b>, 696-708 (2015).</p><div class="reference-actions"><a href="https://doi.org/10.1016/j.tig.2015.10.004">Article</a></div></li>
          <li id="ref-CR3" class="c-article-references__item"><p class="c-article-references__text"><span>3.</span> Lee, T. I. &amp; Young, R. A. Transcriptional regulation and its misregulation in disease. <i>Cell</i> <b>152</b>, 1237-1251 (2013).</p><div class="reference-actions"><a href="https://doi.org/10.1016/j.cell.2013.02.014">Article</a></div></li>
          <li id="ref-CR4" class="c-article-references__item"><p class="c-article-references__text"><span>4.</span> Brivanlou, A. H. &amp; Darnell, J. E. Signal transduction and the control of gene expression. <i>Science</i> <b>295</b>, 813-818 (2002).</p><div class="reference-actions"><a href="https://doi.org/10.1126/science.1066355">Article</a></div></li>
        </ol>
      </section>
    </main>`;
  const page = await preparePage(browser, url, html);
  await page.waitForFunction(() => document.querySelectorAll(".journal-lens-related-host").length === 4);
  assert.equal(await page.locator(".journal-lens-related-host").count(), 4, "each Nature reference gets one control");
  await page.evaluate(() => {
    [...document.querySelectorAll(".journal-lens-related-host")].forEach((host) => {
      host.shadowRoot.querySelector(".reveal").click();
    });
  });
  await page.waitForFunction(() => {
    return [...document.querySelectorAll(".journal-lens-related-host")].every((host) => {
      return host.shadowRoot && !host.shadowRoot.querySelector(".chip.loading");
    });
  });
  const metricTexts = await page.evaluate(() => {
    return [...document.querySelectorAll(".journal-lens-related-host")].map((host) => host.shadowRoot.textContent);
  });
  assert.match(metricTexts[0], /Cell/);
  assert.match(metricTexts[0], /IF 45\.1/);
  assert.match(metricTexts[1], /Trends in Genetics/);
  assert.match(metricTexts[1], /IF 12\.9/);
  assert.match(metricTexts[2], /Cell/);
  assert.match(metricTexts[3], /Science/);
  assert.match(metricTexts[3], /IF 47\.3/);
  assert.equal(await page.locator("#ref-CR1 .journal-lens-related-host").count(), 1);
  assert.equal(await page.locator("#ref-CR2 .journal-lens-related-host").count(), 1);
  assert.equal(await page.locator("#ref-CR1 > .journal-lens-related-host").count(), 0, "Nature control must not become a grid column");
  assert.equal(await page.locator("#ref-CR1 .c-article-references__text > .journal-lens-related-slot > .journal-lens-related-host").count(), 1, "Nature control stays inside the citation block");
  if (process.env.JOURNAL_LENS_ARTIFACT_DIR) {
    fs.mkdirSync(process.env.JOURNAL_LENS_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.JOURNAL_LENS_ARTIFACT_DIR, "nature-references.png"),
      fullPage: true
    });
  }
  await page.close();
}

async function testScienceDirectModernMarkup(browser) {
  const url = "https://www.sciencedirect.com/science/article/pii/S0045206826007790#bi0005";
  const html = `
    <head>
      <meta name="citation_title" content="Discovery of SH-17">
      <meta name="citation_journal_title" content="Bioorganic Chemistry">
    </head>
    <main>
      <h1>Discovery of SH-17</h1>
      <section id="bi0005" class="bibliography u-font-serif text-s">
        <h2>References</h2>
        <ol>
          <li>
            <span class="label u-font-sans"><a id="ref-id-bb0225" href="#bbb0225">[47]</a></span>
            <span class="reference" id="rf0225">
              <div class="contribution"><div class="authors u-font-sans">G. Cai, W. Yu, D. Song</div><div id="ref-id-rf0225" class="title text-m">Discovery of fluorescent coumarin-benzo[b]thiophene conjugates</div></div>
              <div class="host u-font-sans">Eur. J. Med. Chem., 174 (2019), pp. 236-251</div>
              <div class="ReferenceLinks u-font-sans" data-aa-region="reference-links"></div>
            </span>
          </li>
          <li>
            <span class="label u-font-sans"><a id="ref-id-bb0245" href="#bbb0245">[49]</a></span>
            <span class="reference" id="rf0235">
              <div class="contribution"><div class="authors u-font-sans">L. Yang, H. Zuo, M. Sha</div><div id="ref-id-rf0235" class="title text-m">Benzofuranyl-pyrazole as a novel scaffold for potent anticancer therapeutics</div></div>
              <div class="host u-font-sans">J. Med. Chem., 68 (2025), pp. 19184-19204</div>
              <div class="ReferenceLinks u-font-sans" data-aa-region="reference-links"><a href="https://doi.org/10.1021/acs.jmedchem.5c01307">View at publisher</a><a href="https://doi.org/10.1021/acs.jmedchem.5c01307">Crossref</a></div>
            </span>
          </li>
        </ol>
      </section>
    </main>`;
  const page = await preparePage(browser, url, html);
  await page.waitForFunction(() => document.querySelectorAll(".journal-lens-related-host").length === 2);
  assert.deepEqual(await page.evaluate(() => {
    return [...document.querySelectorAll(".journal-lens-related-host")].map((host) => host.dataset.journalLensKey);
  }), ["sciencedirect:rf0225", "sciencedirect:rf0235"]);
  await page.evaluate(() => {
    [...document.querySelectorAll(".journal-lens-related-host")].forEach((host) => {
      host.shadowRoot.querySelector(".reveal").click();
    });
  });
  const metricTexts = await page.evaluate(() => {
    return [...document.querySelectorAll(".journal-lens-related-host")].map((host) => host.shadowRoot.textContent);
  });
  assert.match(metricTexts[0], /European Journal of Medicinal Chemistry/i);
  assert.match(metricTexts[0], /IF 6\.7/);
  assert.match(metricTexts[1], /Journal of Medicinal Chemistry/i);
  await page.evaluate(() => {
    const links = document.querySelector("#rf0225 .ReferenceLinks");
    links.innerHTML = `
      <a href="/science/article/pii/S0223523419303307/pdfft">View PDF</a>
      <a href="/science/article/pii/S0223523419303307">View article</a>
      <a href="https://www.scopus.com/inward/record.url?eid=2-s2.0-85064854801">View in Scopus</a>
      <a href="https://scholar.google.com/scholar_lookup?title=Discovery">Google Scholar</a>`;
  });
  await page.waitForTimeout(900);
  assert.equal(await page.locator(".journal-lens-related-host").count(), 2);
  assert.equal(await page.locator("#rf0225 .journal-lens-related-host").count(), 1);
  assert.equal(await page.locator("#rf0235 .journal-lens-related-host").count(), 1);
  assert.equal(await page.locator(".journal-lens-related-slot:empty").count(), 0);
  if (process.env.JOURNAL_LENS_ARTIFACT_DIR) {
    fs.mkdirSync(process.env.JOURNAL_LENS_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.JOURNAL_LENS_ARTIFACT_DIR, "sciencedirect-modern-markup.png"),
      fullPage: true
    });
  }
  await page.close();
}

async function testWiley(browser) {
  const url = "https://onlinelibrary.wiley.com/doi/10.1002/ardp.70306";
  const html = `
    <head>
      <meta name="citation_title" content="Total Synthesis of Marine Natural Product Sunshinamide via Macrolactonization">
      <meta name="citation_journal_title" content="Archiv der Pharmazie">
      <meta name="citation_doi" content="10.1002/ardp.70306">
    </head>
    <main>
      <h1>Total Synthesis of Marine Natural Product Sunshinamide via Macrolactonization</h1>
      <section class="pane-pcw-related tab__pane article-row-right__panes active">
        <h2>Recommended</h2>
        <ul>
          <li class="grid-item">
            <div class="creative-work">
              <p class="creative-work__title"><a href="/doi/full/10.1002/anie.2110292">Asymmetric Total Synthesis of (+)-Ineleganolide</a></p>
              <div class="loa comma"><a class="publication_contrib_author">Changhong Han</a></div>
              <div class="parent-item"><span><a href="/journal/15213773">Angewandte Chemie International Edition</a></span></div>
            </div>
          </li>
          <li class="grid-item">
            <div class="creative-work">
              <p class="creative-work__title"><a href="/doi/full/10.1002/ajoc.201600208">Total Synthesis of Marine Natural Products: Cephalosporolides</a></p>
              <div class="loa comma"><a class="publication_contrib_author">Mahesh B. Halle</a></div>
              <div class="parent-item"><span><a href="/journal/21935815">Asian Journal of Organic Chemistry</a></span></div>
            </div>
          </li>
        </ul>
      </section>
      <section class="article-section references-section">
        <button id="referenceToggle" aria-controls="referencePanel" aria-expanded="false">References</button>
        <div id="referencePanel" hidden>
          <ol class="references">
            <li class="references__item">
              <span class="references__note"><span class="label">1. </span>A. Author, <span class="references__article-title">A reference without a DOI link</span>, <i>J. Am. Chem. Soc.</i> <span class="references__year">2024</span>, 146, 100-110.<span class="references__suffix"><a class="google-scholar" href="https://scholar.google.com/scholar?q=reference">Google Scholar</a></span></span>
            </li>
          </ol>
        </div>
      </section>
    </main>`;
  const page = await preparePage(browser, url, html);
  await page.waitForFunction(() => document.querySelectorAll(".journal-lens-related-host").length === 3);
  assert.equal(await page.locator("[data-journal-lens-key^='wiley-recommended:']").count(), 2);
  assert.equal(await page.locator("[data-journal-lens-key^='wiley-reference:']").count(), 1);

  await page.evaluate(() => {
    const panel = document.getElementById("referencePanel");
    panel.hidden = false;
    document.getElementById("referenceToggle").setAttribute("aria-expanded", "true");
    panel.querySelector("ol").insertAdjacentHTML("beforeend", `
      <li class="references__item">
        <span class="references__note"><span class="label">2. </span>B. Author, <span class="references__article-title">A dynamically loaded reference</span>, <i>Adv. Opt. Mater.</i> <span class="references__year">2022</span>, 10, 2200008.<span class="references__suffix"><a class="google-scholar" href="https://scholar.google.com/scholar?q=dynamic">Google Scholar</a></span></span>
      </li>`);
  });
  await page.waitForFunction(() => document.querySelectorAll(".journal-lens-related-host").length === 4);
  await page.evaluate(() => {
    [...document.querySelectorAll(".journal-lens-related-host")].forEach((host) => {
      host.shadowRoot.querySelector(".reveal").click();
    });
  });
  const entries = await page.evaluate(() => {
    return [...document.querySelectorAll(".journal-lens-related-host")].map((host) => ({
      key: host.dataset.journalLensKey,
      text: host.shadowRoot.textContent,
      hasDebug: Boolean(host.shadowRoot.querySelector(".debug-dialog"))
    }));
  });
  const ange = entries.find((entry) => entry.key.includes("10.1002/anie.2110292"));
  const asian = entries.find((entry) => entry.key.includes("10.1002/ajoc.201600208"));
  assert.match(ange.text, /Angewandte Chemie International Edition/);
  assert.match(ange.text, /IF 16\.6/);
  assert.doesNotMatch(ange.text, /Archiv der Pharmazie/);
  assert.match(asian.text, /Asian Journal of Organic Chemistry/);
  assert.match(entries.find((entry) => entry.key.includes("ref-1")).text, /Journal of the American Chemical Society/);
  assert.match(entries.find((entry) => entry.key.includes("ref-2")).text, /Advanced Optical Materials/);
  assert.equal(entries.some((entry) => entry.hasDebug), false, "debug UI is disabled by default");
  assert.equal(await page.locator(".references__item .journal-lens-related-host").count(), 2);
  await page.evaluate(() => document.getElementById("referenceToggle").classList.add("is-open"));
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".journal-lens-related-host").count(), 4, "attribute changes must not duplicate controls");
  await page.close();
}

async function testDebugPanel(browser) {
  const url = "https://www.sciencedirect.com/science/article/pii/S0045206826007935#bib0047";
  const html = `
    <head>
      <meta name="citation_title" content="Main Elsevier paper">
      <meta name="citation_journal_title" content="Bioorganic Chemistry">
    </head>
    <main>
      <h1>Main Elsevier paper</h1>
      <section id="bi0005" class="bibliography u-font-serif text-s">
        <h2>References</h2>
        <ol><li>
          <span class="label u-font-sans"><a id="ref-id-bb0225" href="#bbb0225">[47]</a></span>
          <span class="reference" id="rf0225">
            <div class="contribution"><div class="authors u-font-sans">G. Cai, W. Yu, D. Song</div><div id="ref-id-rf0225" class="title text-m">Discovery of fluorescent coumarin-benzo[b]thiophene conjugates</div></div>
            <div class="host u-font-sans"><span class="source-title">Eur. J. Med. Chem.</span>, 174 (2019), pp. 236-251</div>
            <div class="ReferenceLinks u-font-sans" data-aa-region="reference-links"><a href="/science/article/pii/S0223523419303307/pdfft">View PDF</a></div>
          </span>
        </li></ol>
      </section>
    </main>`;
  const page = await preparePage(browser, url, html, "manual", true);
  await page.waitForFunction(() => document.querySelectorAll(".journal-lens-related-host").length === 1);
  await page.evaluate(() => {
    document.querySelector(".journal-lens-related-host").shadowRoot.querySelector(".reveal").click();
  });
  await page.waitForFunction(() => {
    const host = document.querySelector(".journal-lens-related-host");
    return Boolean(host && host.shadowRoot.querySelector(".debug-dialog"));
  });
  const debug = await page.evaluate(() => {
    const shadow = document.querySelector(".journal-lens-related-host").shadowRoot;
    return {
      payload: JSON.parse(shadow.querySelector(".debug-dialog pre").textContent),
      hasJsonCopy: Boolean(shadow.querySelector(".debug-copy-json")),
      hasHtmlCopy: Boolean(shadow.querySelector(".debug-copy-html"))
    };
  });
  assert.equal(debug.payload.item.adapter, "sciencedirect-reference");
  assert.equal(debug.payload.inputRecord.journal, "Eur. J. Med. Chem.");
  assert.equal(debug.payload.extractedNow.scienceDirectJournal, "Eur. J. Med. Chem.");
  assert.match(debug.payload.matching.finalMetric.title, /European Journal of Medicinal Chemistry/i);
  assert.match(debug.payload.dom.containerHtmlPreview, /source-title/);
  assert.equal(debug.hasJsonCopy, true);
  assert.equal(debug.hasHtmlCopy, true);
  if (process.env.JOURNAL_LENS_ARTIFACT_DIR) {
    fs.mkdirSync(process.env.JOURNAL_LENS_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.JOURNAL_LENS_ARTIFACT_DIR, "debug-panel.png"),
      fullPage: true
    });
  }
  await page.close();
}

async function testSiteModalConflictGuard(browser) {
  const url = "https://pubmed.ncbi.nlm.nih.gov/12345678/";
  const html = `
    <head>
      <meta name="citation_title" content="PubMed modal conflict test">
      <meta name="citation_journal_title" content="Frontiers in Immunology">
      <meta name="citation_doi" content="10.1000/modal-test">
    </head>
    <main>
      <h1>PubMed modal conflict test</h1>
      <button id="cite-button" type="button">Cite</button>
      <section id="hidden-template" class="modal" hidden>Unused modal template</section>
      <section id="cite-dialog" role="dialog" aria-modal="true" hidden
        style="position:fixed;inset:30px;width:420px;height:240px;background:white">Citation dialog</section>
    </main>`;
  const page = await preparePage(browser, url, html, "off");
  await page.waitForFunction(() => Boolean(document.querySelector(".journal-lens-host")));

  const initial = await page.locator(".journal-lens-host").evaluate((host) => ({
    suppressed: host.classList.contains("journal-lens-site-modal-open"),
    visibility: getComputedStyle(host).visibility,
    lensZIndex: getComputedStyle(host.shadowRoot.querySelector(".lens")).zIndex
  }));
  assert.equal(initial.suppressed, false, "hidden modal templates must not suppress Journal Lens");
  assert.equal(initial.visibility, "visible");
  assert.equal(initial.lensZIndex, "auto", "article badge must not force itself above site dialogs");

  await page.evaluate(() => { document.getElementById("cite-dialog").hidden = false; });
  await page.waitForFunction(() => document.querySelector(".journal-lens-host")
    .classList.contains("journal-lens-site-modal-open"));
  const openState = await page.locator(".journal-lens-host").evaluate((host) => ({
    visibility: getComputedStyle(host).visibility,
    pointerEvents: getComputedStyle(host).pointerEvents
  }));
  assert.equal(openState.visibility, "hidden", "site dialog should temporarily hide Journal Lens");
  assert.equal(openState.pointerEvents, "none");

  await page.evaluate(() => { document.getElementById("cite-dialog").hidden = true; });
  await page.waitForFunction(() => !document.querySelector(".journal-lens-host")
    .classList.contains("journal-lens-site-modal-open"));
  assert.equal(await page.locator(".journal-lens-host").evaluate((host) => getComputedStyle(host).visibility),
    "visible", "Journal Lens should return after the site dialog closes");
  await page.close();
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.JOURNAL_LENS_CHROME_PATH || undefined
  });
  try {
    await testPubMed(browser);
    await testAcs(browser);
    await testScienceDirect(browser);
    await testScienceDirectModernMarkup(browser);
    await testNature(browser);
    await testWiley(browser);
    await testDebugPanel(browser);
    await testSiteModalConflictGuard(browser);
    await testEasyScholar(browser);
    console.log("content smoke tests passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
