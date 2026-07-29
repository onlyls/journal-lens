(() => {
  "use strict";

  const shared = window.JournalLensShared;
  const state = {
    activeTab: null,
    page: null
  };

  const nodes = {
    siteStatus: document.getElementById("siteStatus"),
    journalName: document.getElementById("journalName"),
    articleTitle: document.getElementById("articleTitle"),
    metricChips: document.getElementById("metricChips"),
    doiValue: document.getElementById("doiValue"),
    datasetValue: document.getElementById("datasetValue"),
    lookupButton: document.getElementById("lookupButton"),
    ableSciButton: document.getElementById("ableSciButton"),
    copyDoiButton: document.getElementById("copyDoiButton"),
    exportBibtexButton: document.getElementById("exportBibtexButton"),
    exportRisButton: document.getElementById("exportRisButton"),
    noteText: document.getElementById("noteText"),
    openOptions: document.getElementById("openOptions")
  };

  init();

  async function init() {
    nodes.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
    nodes.lookupButton.addEventListener("click", openLookup);
    nodes.ableSciButton.addEventListener("click", openAbleSciAssist);
    nodes.copyDoiButton.addEventListener("click", copyDoi);
    nodes.exportBibtexButton.addEventListener("click", () => exportCitation("bibtex"));
    nodes.exportRisButton.addEventListener("click", () => exportCitation("ris"));

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.activeTab = tab;
    if (!tab || !tab.id) {
      renderUnavailable("没有活动标签页");
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "JournalLens:getPageStatus" });
      if (!response || !response.ok) {
        renderUnavailable("当前页面未启用");
        return;
      }
      state.page = response;
      renderPage(response);
    } catch (_error) {
      renderUnavailable("当前站点不在匹配列表");
    }
  }

  function renderUnavailable(message) {
    nodes.siteStatus.textContent = message;
    nodes.journalName.textContent = "未识别期刊";
    nodes.articleTitle.textContent = "";
    setMetricChips([createChip("无页面数据", "chip warn")]);
    nodes.doiValue.textContent = "-";
    nodes.datasetValue.textContent = "-";
    nodes.lookupButton.disabled = true;
    nodes.ableSciButton.disabled = true;
    nodes.copyDoiButton.disabled = true;
    setExportDisabled(true);
    nodes.noteText.textContent = "可以在设置页导入期刊分区与影响因子数据。";
  }

  function renderPage(page) {
    const record = page.record || {};
    const metric = page.metric;
    nodes.ableSciButton.hidden = !(page.features && page.features.ableSciAssist);
    if (page.pageMode === "list") {
      nodes.siteStatus.textContent = record.host || "当前页面";
      nodes.journalName.textContent = "文献列表页";
      nodes.articleTitle.textContent = `已添加 ${page.relatedCount || 0} 个逐条指标入口`;
      setMetricChips([createChip("逐条识别")]);
      nodes.doiValue.textContent = "-";
      nodes.datasetValue.textContent = `${page.dataset.rows || 0} 条`;
      nodes.lookupButton.disabled = true;
      nodes.ableSciButton.disabled = true;
      nodes.copyDoiButton.disabled = true;
      setExportDisabled(true);
      nodes.noteText.textContent = "每条结果使用自己的题名、期刊和 DOI，不会把第一条结果当作整个页面。";
      return;
    }
    const journal = (metric && metric.title) || record.journal || "未识别期刊";
    const doi = shared.normalizeDoi(record.doi);

    nodes.siteStatus.textContent = record.host || "当前页面";
    nodes.journalName.textContent = journal;
    nodes.articleTitle.textContent = record.title || "";
    nodes.doiValue.textContent = doi || "-";
    nodes.datasetValue.textContent = `${page.dataset.rows || 0} 条`;
    renderMetric(nodes.metricChips, metric, page.openAlex);
    nodes.lookupButton.disabled = !doi && !record.title;
    nodes.ableSciButton.disabled = !doi;
    nodes.copyDoiButton.disabled = !doi;
    setExportDisabled(!doi && !record.title);
    if (page.easyScholar && page.easyScholar.loading) {
      nodes.noteText.textContent = "正在等待 EasyScholar 返回期刊指标。";
    } else if (page.easyScholar && page.easyScholar.error) {
      nodes.noteText.textContent = `EasyScholar 查询失败：${page.easyScholar.error}`;
    } else {
      nodes.noteText.textContent = page.dataset.rows
        ? "页面标题链接不会被改写；检索只从 Journal Lens 按钮触发。"
        : "可在设置页导入本地数据，或配置 EasyScholar API。";
    }
  }

  function renderMetric(container, metric, openAlex) {
    const chips = [];
    if (!metric) {
      chips.push(createChip("待导入数据", "chip warn"));
      if (hasOpenAlexMeanCitedness(openAlex)) chips.push(createOpenAlexChip(openAlex.twoYearMeanCitedness));
      setMetricChips(chips, container);
      return;
    }

    if (metric.xrPartition) chips.push(createChip(`新锐 ${metric.xrPartition}`));
    if (metric.casPartition) chips.push(createChip(`中科院 ${metric.casPartition}`));
    if (metric.jcrQuartile) chips.push(createChip(`JCR ${metric.jcrQuartile}`));
    if (metric.impactFactor) chips.push(createChip(`IF ${metric.impactFactor}`));
    if (metric.warning) chips.push(createChip(`预警 ${metric.warning}`, "chip warn"));
    if (Array.isArray(metric.extraMetrics)) {
      metric.extraMetrics.forEach((entry) => {
        const label = shared.collapseWhitespace(entry && entry.label);
        const value = shared.collapseWhitespace(entry && entry.value);
        if (!label || !value) return;
        chips.push(createChip(`${label} ${value}`, entry.tone === "warning" ? "chip warn" : "chip"));
      });
    }
    if (metric.year) chips.push(createChip(metric.year));
    if (hasOpenAlexMeanCitedness(openAlex)) chips.push(createOpenAlexChip(openAlex.twoYearMeanCitedness));
    setMetricChips(chips.length ? chips : [createChip("已匹配")], container);
  }

  function hasOpenAlexMeanCitedness(openAlex) {
    return Boolean(openAlex)
      && openAlex.twoYearMeanCitedness !== ""
      && openAlex.twoYearMeanCitedness !== null
      && openAlex.twoYearMeanCitedness !== undefined;
  }

  function createOpenAlexChip(value) {
    return createChip(`OA 2yr ${formatNumber(value)}`, "chip open", "OpenAlex 两年平均被引次数；口径类似影响因子，但不是 JCR IF");
  }

  function createChip(text, className = "chip", title = "") {
    const chip = document.createElement("span");
    chip.className = className;
    chip.textContent = text;
    if (title) chip.title = title;
    return chip;
  }

  function setMetricChips(chips, container = nodes.metricChips) {
    container.replaceChildren(...chips);
  }

  async function openLookup() {
    if (!state.page) return;
    await chrome.runtime.sendMessage({
      type: "JournalLens:openLookup",
      record: state.page.record
    });
  }

  async function openAbleSciAssist() {
    if (!state.page || nodes.ableSciButton.disabled) return;
    nodes.ableSciButton.disabled = true;
    nodes.ableSciButton.textContent = "…";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "JournalLens:openAbleSciRequest",
        record: state.page.record
      });
      if (!response || !response.ok) throw new Error(response && response.error || "无法打开科研通");
      nodes.ableSciButton.textContent = "✓";
      nodes.noteText.textContent = "已打开科研通；请核对元数据后手动发布。";
    } catch (error) {
      nodes.ableSciButton.textContent = "!";
      nodes.noteText.textContent = error && error.message ? error.message : "打开科研通失败";
    } finally {
      window.setTimeout(() => {
        nodes.ableSciButton.textContent = "?";
        nodes.ableSciButton.disabled = !shared.normalizeDoi(state.page && state.page.record && state.page.record.doi);
      }, 1400);
    }
  }

  async function copyDoi() {
    const doi = shared.normalizeDoi(state.page && state.page.record && state.page.record.doi);
    if (!doi) return;
    await navigator.clipboard.writeText(doi);
    nodes.copyDoiButton.textContent = "已复制";
    window.setTimeout(() => {
      nodes.copyDoiButton.textContent = "复制 DOI";
    }, 1200);
  }

  function setExportDisabled(disabled) {
    nodes.exportBibtexButton.disabled = disabled;
    nodes.exportRisButton.disabled = disabled;
  }

  function exportCitation(format) {
    const record = state.page && state.page.record;
    if (!record) return;
    const citation = format === "ris" ? createRis(record) : createBibtex(record);
    const extension = format === "ris" ? "ris" : "bib";
    const blob = new Blob([citation], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${citationFileStem(record)}.${extension}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    nodes.noteText.textContent = `已导出 ${format === "ris" ? "RIS" : "BibTeX"} 文件。`;
  }

  function createBibtex(record) {
    const doi = shared.normalizeDoi(record.doi);
    const fields = [
      ["title", record.title],
      ["journal", record.journal],
      ["doi", doi],
      ["url", doi ? `https://doi.org/${doi}` : record.url]
    ].filter((entry) => shared.collapseWhitespace(entry[1]));
    const body = fields.map(([name, value]) => `  ${name} = {${escapeBibtex(value)}}`).join(",\n");
    return `@article{${citationKey(record)},\n${body}\n}\n`;
  }

  function createRis(record) {
    const doi = shared.normalizeDoi(record.doi);
    const lines = ["TY  - JOUR"];
    if (record.title) lines.push(`TI  - ${cleanRisValue(record.title)}`);
    if (record.journal) lines.push(`JO  - ${cleanRisValue(record.journal)}`);
    if (doi) lines.push(`DO  - ${doi}`, `UR  - https://doi.org/${doi}`);
    else if (record.url) lines.push(`UR  - ${cleanRisValue(record.url)}`);
    lines.push("ER  - ");
    return `${lines.join("\r\n")}\r\n`;
  }

  function citationKey(record) {
    const doi = shared.normalizeDoi(record.doi);
    const source = doi ? doi.split("/").pop() : record.title;
    return `journalLens_${String(source || "article").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "article"}`;
  }

  function citationFileStem(record) {
    const doi = shared.normalizeDoi(record.doi);
    const source = doi ? doi.replace(/^10\./, "10-") : record.title;
    return String(source || "journal-lens-citation").replace(/[<>:\"/\\|?*\x00-\x1f]+/g, "-").replace(/\s+/g, "-").slice(0, 80);
  }

  function escapeBibtex(value) {
    return shared.collapseWhitespace(value).replace(/([{}])/g, "\\$1");
  }

  function cleanRisValue(value) {
    return shared.collapseWhitespace(value);
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(2) : escapeHtml(value);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();

