(() => {
  "use strict";

  const shared = window.JournalLensShared;
  const cslEngine = window.JournalLensCslEngine;
  const state = {
    activeTab: null,
    page: null,
    citationPromise: null,
    citationResult: null,
    citationStyle: null
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
    openOptions: document.getElementById("openOptions"),
    citationStyleName: document.getElementById("citationStyleName"),
    citationPreview: document.getElementById("citationPreview"),
    copyCitationButton: document.getElementById("copyCitationButton"),
    refreshCitationButton: document.getElementById("refreshCitationButton"),
    openCitationSettings: document.getElementById("openCitationSettings"),
    citationStatus: document.getElementById("citationStatus")
  };

  init();

  async function init() {
    nodes.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
    nodes.openCitationSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
    nodes.lookupButton.addEventListener("click", openLookup);
    nodes.ableSciButton.addEventListener("click", openAbleSciAssist);
    nodes.copyDoiButton.addEventListener("click", copyDoi);
    nodes.exportBibtexButton.addEventListener("click", () => exportCitation("bibtex"));
    nodes.exportRisButton.addEventListener("click", () => exportCitation("ris"));
    nodes.copyCitationButton.addEventListener("click", copyFormattedCitation);
    nodes.refreshCitationButton.addEventListener("click", () => loadCitation(true));

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
    setCitationUnavailable("当前页面没有可识别文献");
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
      setCitationUnavailable("列表页暂不支持复制题录");
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
    initializeCitation();
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
    const selected = new Set(Array.isArray(state.page && state.page.metricDisplayFields)
      ? state.page.metricDisplayFields
      : shared.DEFAULT_EASY_SCHOLAR_FIELDS);
    if (!metric) {
      chips.push(createChip("待导入数据", "chip warn"));
      if (hasOpenAlexMeanCitedness(openAlex)) chips.push(createOpenAlexChip(openAlex.twoYearMeanCitedness));
      setMetricChips(chips, container);
      return;
    }

    if (selected.has("xr") && metric.xrPartition) chips.push(createChip(`新锐 ${shared.cleanPartitionDisplay(metric.xrPartition)}`));
    if (selected.has("xrTop") && metric.xrTop) chips.push(createChip("新锐 Top"));
    if (selected.has("xrWarn") && (metric.xrWarning || metric.warning)) chips.push(createChip(`新锐预警 ${metric.xrWarning || metric.warning}`, "chip warn"));
    if (selected.has("sciUp") && metric.casPartition) chips.push(createChip(`中科院 ${shared.cleanPartitionDisplay(metric.casPartition)}`));
    if (selected.has("sciUpTop") && metric.casTop) chips.push(createChip("中科院 Top"));
    if (selected.has("sci") && metric.jcrQuartile) chips.push(createChip(`JCR ${metric.jcrQuartile}`));
    if (selected.has("sciif") && metric.impactFactor) chips.push(createChip(`IF ${metric.impactFactor}`));
    if (Array.isArray(metric.extraMetrics)) {
      metric.extraMetrics.forEach((entry) => {
        if (entry && entry.key && !selected.has(entry.key)) return;
        if (entry && ((entry.key === "xrTop" && metric.xrTop)
          || (entry.key === "xrWarn" && (metric.xrWarning || metric.warning))
          || (entry.key === "sciUpTop" && metric.casTop))) return;
        const label = shared.collapseWhitespace(entry && entry.label);
        const value = shared.collapseWhitespace(entry && entry.value);
        if (!label || !value) return;
        chips.push(createChip(`${label} ${value}`, entry.tone === "warning" ? "chip warn" : "chip"));
      });
    }
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

  function citationRecordIsUsable(record) {
    if (shared.normalizeDoi(record && record.doi)) return true;
    return Boolean(record && record.title && record.journal
      && Array.isArray(record.authors) && record.authors.length
      && record.publicationDate);
  }

  function setCitationUnavailable(message) {
    state.citationResult = null;
    nodes.citationStyleName.textContent = "未选择";
    nodes.citationPreview.textContent = message;
    nodes.copyCitationButton.disabled = true;
    nodes.refreshCitationButton.disabled = true;
    nodes.citationStatus.textContent = message;
    nodes.citationStatus.className = "citation-status warning";
  }

  async function initializeCitation() {
    const record = state.page && state.page.record;
    if (!citationRecordIsUsable(record)) {
      setCitationUnavailable("当前页面元数据不足，无法生成题录");
      return;
    }
    nodes.refreshCitationButton.disabled = false;
    await loadCitation(false);
  }

  async function loadCitation(forceRefresh) {
    if (state.citationPromise) return state.citationPromise;
    const record = state.page && state.page.record;
    if (!record || !citationRecordIsUsable(record)) {
      setCitationUnavailable("当前页面没有可识别文献");
      return null;
    }
    state.citationPromise = (async () => {
      nodes.copyCitationButton.disabled = true;
      nodes.refreshCitationButton.disabled = true;
      nodes.citationStatus.className = "citation-status";
      nodes.citationStatus.textContent = "正在获取元数据...";
      nodes.citationPreview.textContent = "正在获取作者、日期、卷期和页码...";
      try {
        const stylesResponse = await chrome.runtime.sendMessage({ type: "JournalLens:listCitationStyles" });
        if (!stylesResponse || !stylesResponse.ok) throw new Error(stylesResponse && stylesResponse.error || "样式加载失败");
        const styles = Array.isArray(stylesResponse.styles) ? stylesResponse.styles : [];
        const style = styles.find((entry) => entry.id === stylesResponse.defaultStyleId);
        if (!style) throw new Error("未选择题录样式");
        state.citationStyle = style;
        nodes.citationStyleName.textContent = style.title;

        const metadataResponse = await chrome.runtime.sendMessage({
          type: forceRefresh ? "JournalLens:refreshCitationMetadata" : "JournalLens:getCitationMetadata",
          record
        });
        if (!metadataResponse || !metadataResponse.ok) {
          throw new Error(metadataResponse && metadataResponse.error || "元数据加载失败");
        }
        nodes.citationStatus.textContent = "正在生成题录...";
        const payloadResponse = await chrome.runtime.sendMessage({
          type: "JournalLens:getCitationStylePayload",
          id: style.id,
          language: metadataResponse.result.item.language || navigator.language || "en-US"
        });
        if (!payloadResponse || !payloadResponse.ok) {
          throw new Error(payloadResponse && payloadResponse.error || "样式加载失败");
        }
        const rendered = cslEngine.renderBibliography({
          item: metadataResponse.result.item,
          ...payloadResponse.result,
          language: payloadResponse.result.language || metadataResponse.result.item.language || navigator.language || "en-US",
          warnings: metadataResponse.result.warnings || []
        });
        state.citationResult = rendered;
        nodes.citationPreview.innerHTML = rendered.html;
        nodes.copyCitationButton.disabled = false;
        nodes.refreshCitationButton.disabled = false;
        if (rendered.warnings.length) {
          nodes.citationStatus.textContent = rendered.warnings[0];
          nodes.citationStatus.className = "citation-status warning";
        } else {
          nodes.citationStatus.textContent = metadataResponse.result.cached ? "已使用本地缓存元数据" : "题录已生成";
        }
        return rendered;
      } catch (error) {
        state.citationResult = null;
        nodes.citationPreview.textContent = error.message || String(error);
        nodes.citationStatus.textContent = /样式/.test(error.message || "")
          ? `样式加载失败：${error.message || String(error)}`
          : error.message || String(error);
        nodes.citationStatus.className = "citation-status warning";
        nodes.copyCitationButton.disabled = true;
        nodes.refreshCitationButton.disabled = false;
        return null;
      } finally {
        state.citationPromise = null;
      }
    })();
    return state.citationPromise;
  }

  async function copyFormattedCitation() {
    if (state.citationPromise) return;
    nodes.copyCitationButton.disabled = true;
    const originalText = nodes.copyCitationButton.textContent;
    try {
      const citation = state.citationResult || await loadCitation(false);
      if (!citation) throw new Error("题录尚未生成");
      let richTextCopied = false;
      if (typeof ClipboardItem === "function" && navigator.clipboard && typeof navigator.clipboard.write === "function") {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": new Blob([citation.plainText], { type: "text/plain" }),
              "text/html": new Blob([citation.html], { type: "text/html" })
            })
          ]);
          richTextCopied = true;
        } catch (_error) {
          await navigator.clipboard.writeText(citation.plainText);
        }
      } else {
        await navigator.clipboard.writeText(citation.plainText);
      }
      nodes.copyCitationButton.textContent = "已复制";
      nodes.citationStatus.textContent = richTextCopied ? "已复制纯文本和富文本题录" : "仅复制了纯文本";
      nodes.citationStatus.className = "citation-status";
    } catch (error) {
      nodes.citationStatus.textContent = `复制失败：${error.message || String(error)}`;
      nodes.citationStatus.className = "citation-status warning";
    } finally {
      window.setTimeout(() => {
        nodes.copyCitationButton.textContent = originalText;
        nodes.copyCitationButton.disabled = !state.citationResult;
      }, 1300);
    }
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

