(() => {
  "use strict";

  const shared = window.JournalLensShared;
  const showJcr = window.JournalLensShowJcr;
  const store = window.JournalLensStore;
  const build = window.JournalLensBuild || {};

  const nodes = {
    datasetSummary: document.getElementById("datasetSummary"),
    metricFile: document.getElementById("metricFile"),
    importStatus: document.getElementById("importStatus"),
    loadShowJcrButton: document.getElementById("loadShowJcrButton"),
    exportButton: document.getElementById("exportButton"),
    clearButton: document.getElementById("clearButton"),
    resolverId: document.getElementById("resolverId"),
    customResolverTemplate: document.getElementById("customResolverTemplate"),
    enableOpenAlex: document.getElementById("enableOpenAlex"),
    relatedArticleMode: document.getElementById("relatedArticleMode"),
    showUnmatchedArticleBadge: document.getElementById("showUnmatchedArticleBadge"),
    debugMode: document.getElementById("debugMode"),
    enableAbleSciAssist: document.getElementById("enableAbleSciAssist"),
    ableSciAutoLookup: document.getElementById("ableSciAutoLookup"),
    ableSciStatus: document.getElementById("ableSciStatus"),
    metricSourceMode: document.getElementById("metricSourceMode"),
    easyScholarSecretKey: document.getElementById("easyScholarSecretKey"),
    easyScholarFields: document.getElementById("easyScholarFields"),
    easyScholarTestJournal: document.getElementById("easyScholarTestJournal"),
    testEasyScholarButton: document.getElementById("testEasyScholarButton"),
    easyScholarStatus: document.getElementById("easyScholarStatus")
  };

  init();

  async function init() {
    syncBuildFeatures();
    renderResolverOptions();
    renderEasyScholarFields();
    await renderState();
    bindEvents();
  }

  function debugFeaturesAvailable() {
    return build.enableDebug !== false;
  }

  function syncBuildFeatures() {
    if (!debugFeaturesAvailable() && nodes.debugMode) {
      nodes.debugMode.closest(".switch").hidden = true;
    }
  }

  function renderResolverOptions() {
    nodes.resolverId.replaceChildren(...shared.RESOLVERS.map((resolver) => {
      const option = document.createElement("option");
      option.value = resolver.id;
      option.textContent = resolver.label;
      return option;
    }));
  }

  function renderEasyScholarFields() {
    nodes.easyScholarFields.replaceChildren(...shared.EASY_SCHOLAR_FIELDS.map((field) => {
      const label = document.createElement("label");
      label.className = "field-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = field.key;
      const text = document.createElement("span");
      text.textContent = field.label;
      label.append(input, text);
      return label;
    }));
  }

  async function renderState() {
    const [dataset, settings] = await Promise.all([store.getDataset(), store.getSettings()]);
    nodes.datasetSummary.textContent = dataset.rows.length
      ? `${dataset.rows.length} 条期刊记录 · ${dataset.fileName || "未命名文件"} · ${shared.formatDateTime(dataset.importedAt)}`
      : "尚未导入期刊数据";
    nodes.resolverId.value = settings.resolverId;
    nodes.customResolverTemplate.value = settings.customResolverTemplate || "";
    nodes.enableOpenAlex.checked = Boolean(settings.enableOpenAlex);
    nodes.relatedArticleMode.value = settings.annotateLists === false
      ? "off"
      : settings.relatedArticleMode || "manual";
    nodes.showUnmatchedArticleBadge.checked = Boolean(settings.showUnmatchedArticleBadge);
    if (nodes.debugMode) nodes.debugMode.checked = debugFeaturesAvailable() && Boolean(settings.debugMode);
    nodes.enableAbleSciAssist.checked = settings.enableAbleSciAssist !== false;
    nodes.ableSciAutoLookup.checked = settings.ableSciAutoLookup !== false;
    syncAbleSciControls();
    nodes.metricSourceMode.value = ["local", "hybrid", "easyScholar"].includes(settings.metricSourceMode)
      ? settings.metricSourceMode
      : "local";
    nodes.easyScholarSecretKey.value = settings.easyScholarSecretKey || "";
    const selectedFields = new Set(Array.isArray(settings.easyScholarFields)
      ? settings.easyScholarFields
      : shared.DEFAULT_EASY_SCHOLAR_FIELDS);
    nodes.easyScholarFields.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.checked = selectedFields.has(input.value);
    });
  }

  function bindEvents() {
    nodes.metricFile.addEventListener("change", importFile);
    nodes.loadShowJcrButton.addEventListener("click", importShowJcr);
    nodes.exportButton.addEventListener("click", exportDataset);
    nodes.clearButton.addEventListener("click", clearDataset);
    nodes.testEasyScholarButton.addEventListener("click", testEasyScholar);

    [
      nodes.resolverId,
      nodes.customResolverTemplate,
      nodes.enableOpenAlex,
      nodes.relatedArticleMode,
      nodes.showUnmatchedArticleBadge,
      nodes.debugMode
    ].filter(Boolean).forEach((node) => node.addEventListener("change", () => saveSettings()));
    nodes.enableAbleSciAssist.addEventListener("change", () => {
      syncAbleSciControls();
      saveSettings(nodes.ableSciStatus);
    });
    nodes.ableSciAutoLookup.addEventListener("change", () => saveSettings(nodes.ableSciStatus));
    [nodes.metricSourceMode, nodes.easyScholarSecretKey]
      .forEach((node) => node.addEventListener("change", () => saveSettings(nodes.easyScholarStatus)));
    nodes.easyScholarFields.addEventListener("change", () => saveSettings(nodes.easyScholarStatus));
  }

  function syncAbleSciControls() {
    nodes.ableSciAutoLookup.disabled = !nodes.enableAbleSciAssist.checked;
  }

  function collectSettingsPatch() {
    return {
      resolverId: nodes.resolverId.value,
      customResolverTemplate: nodes.customResolverTemplate.value.trim(),
      enableOpenAlex: nodes.enableOpenAlex.checked,
      annotateLists: nodes.relatedArticleMode.value !== "off",
      relatedArticleMode: nodes.relatedArticleMode.value,
      showUnmatchedArticleBadge: nodes.showUnmatchedArticleBadge.checked,
      debugMode: debugFeaturesAvailable() && Boolean(nodes.debugMode && nodes.debugMode.checked),
      enableAbleSciAssist: nodes.enableAbleSciAssist.checked,
      ableSciAutoLookup: nodes.ableSciAutoLookup.checked,
      metricSourceMode: nodes.metricSourceMode.value,
      easyScholarSecretKey: nodes.easyScholarSecretKey.value.trim(),
      easyScholarFields: [...nodes.easyScholarFields.querySelectorAll("input[type='checkbox']:checked")]
        .map((input) => input.value)
    };
  }

  async function saveSettings(statusNode = nodes.importStatus) {
    await store.saveSettings(collectSettingsPatch());
    statusNode.textContent = "设置已保存";
  }

  async function testEasyScholar() {
    const publicationName = nodes.easyScholarTestJournal.value.trim();
    if (!nodes.easyScholarSecretKey.value.trim()) {
      nodes.easyScholarStatus.textContent = "请先填写 SecretKey";
      return;
    }
    if (!publicationName) {
      nodes.easyScholarStatus.textContent = "请填写测试期刊名称";
      return;
    }

    nodes.testEasyScholarButton.disabled = true;
    nodes.easyScholarStatus.textContent = "正在查询...";
    try {
      await store.saveSettings(collectSettingsPatch());
      const response = await chrome.runtime.sendMessage({
        type: "JournalLens:testEasyScholar",
        publicationName
      });
      if (!response || !response.ok) throw new Error(response && response.error || "接口无响应");
      nodes.easyScholarStatus.textContent = response.metric
        ? `查询成功：${shared.metricLabel(response.metric)}`
        : "查询成功，但所选字段没有返回数据";
    } catch (error) {
      nodes.easyScholarStatus.textContent = `查询失败：${error.message || String(error)}`;
    } finally {
      nodes.testEasyScholarButton.disabled = false;
    }
  }

  async function importFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    nodes.importStatus.textContent = "正在导入...";

    try {
      const text = await file.text();
      const parsed = shared.parseMetricTable(text, file.name);
      const dataset = await store.saveDataset(parsed.rows, { fileName: file.name });
      nodes.importStatus.textContent = `已导入 ${dataset.rows.length} 条记录`;
      await renderState();
    } catch (error) {
      nodes.importStatus.textContent = `导入失败：${error.message || String(error)}`;
    } finally {
      nodes.metricFile.value = "";
    }
  }

  async function importShowJcr() {
    nodes.loadShowJcrButton.disabled = true;
    nodes.importStatus.textContent = "准备连接 ShowJCR...";

    try {
      const imported = await showJcr.fetchShowJcrDataset((message) => {
        nodes.importStatus.textContent = message;
      });
      const dataset = await store.saveDataset(imported.rows, imported.meta);
      nodes.importStatus.textContent = `已从 ShowJCR 导入 ${dataset.rows.length} 条记录`;
      await renderState();
    } catch (error) {
      nodes.importStatus.textContent = `ShowJCR 导入失败：${error.message || String(error)}`;
    } finally {
      nodes.loadShowJcrButton.disabled = false;
    }
  }

  async function exportDataset() {
    const dataset = await store.getDataset();
    const blob = new Blob([JSON.stringify(dataset, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "journal-lens-dataset.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function clearDataset() {
    const confirmed = window.confirm("清空已导入的期刊数据？");
    if (!confirmed) return;
    await store.clearDataset();
    nodes.importStatus.textContent = "数据已清空";
    await renderState();
  }
})();


