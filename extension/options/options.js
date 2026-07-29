(() => {
  "use strict";

  const shared = window.JournalLensShared;
  const showJcr = window.JournalLensShowJcr;
  const store = window.JournalLensStore;
  const build = window.JournalLensBuild || {};
  const cslEngine = window.JournalLensCslEngine;
  const citationState = {
    styles: [],
    defaultStyleId: "",
    searchResults: []
  };

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
    metricDisplayFields: document.getElementById("metricDisplayFields"),
    easyScholarCacheTtlDays: document.getElementById("easyScholarCacheTtlDays"),
    easyScholarCacheForever: document.getElementById("easyScholarCacheForever"),
    clearEasyScholarCacheButton: document.getElementById("clearEasyScholarCacheButton"),
    clearOtherCachesButton: document.getElementById("clearOtherCachesButton"),
    cacheStatus: document.getElementById("cacheStatus"),
    easyScholarTestJournal: document.getElementById("easyScholarTestJournal"),
    testEasyScholarButton: document.getElementById("testEasyScholarButton"),
    easyScholarStatus: document.getElementById("easyScholarStatus"),
    defaultCitationStyle: document.getElementById("defaultCitationStyle"),
    citationStyleQuery: document.getElementById("citationStyleQuery"),
    searchCitationStylesButton: document.getElementById("searchCitationStylesButton"),
    refreshStyleIndexButton: document.getElementById("refreshStyleIndexButton"),
    citationSearchResults: document.getElementById("citationSearchResults"),
    installedCitationStyles: document.getElementById("installedCitationStyles"),
    citationStyleFile: document.getElementById("citationStyleFile"),
    citationStyleStatus: document.getElementById("citationStyleStatus"),
    citationStylePreview: document.getElementById("citationStylePreview")
  };

  init();

  async function init() {
    syncBuildFeatures();
    renderResolverOptions();
    renderMetricDisplayFields();
    await Promise.all([renderState(), renderCitationStyles(), renderCacheSummary()]);
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

  function renderMetricDisplayFields() {
    nodes.metricDisplayFields.replaceChildren(...shared.EASY_SCHOLAR_FIELDS.map((field) => {
      const label = document.createElement("label");
      label.className = "field-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = field.key;
      const copy = document.createElement("span");
      copy.className = "field-option-copy";
      const text = document.createElement("span");
      text.textContent = field.label;
      const availability = document.createElement("small");
      availability.textContent = field.showJcr ? "ShowJCR + EasyScholar" : "仅 EasyScholar";
      copy.append(text, availability);
      label.append(input, copy);
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
    const selectedFields = new Set(Array.isArray(settings.metricDisplayFields)
      ? settings.metricDisplayFields
      : shared.DEFAULT_EASY_SCHOLAR_FIELDS);
    nodes.metricDisplayFields.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.checked = selectedFields.has(input.value);
    });
    const cacheDays = Number(settings.easyScholarCacheTtlDays);
    nodes.easyScholarCacheForever.checked = cacheDays === 0;
    nodes.easyScholarCacheTtlDays.value = cacheDays >= 1
      ? String(Math.min(Math.floor(cacheDays), 3650))
      : String(shared.DEFAULT_EASY_SCHOLAR_CACHE_TTL_DAYS);
    syncCacheDurationControls();
  }

  function bindEvents() {
    nodes.metricFile.addEventListener("change", importFile);
    nodes.loadShowJcrButton.addEventListener("click", importShowJcr);
    nodes.exportButton.addEventListener("click", exportDataset);
    nodes.clearButton.addEventListener("click", clearDataset);
    nodes.testEasyScholarButton.addEventListener("click", testEasyScholar);
    nodes.clearEasyScholarCacheButton.addEventListener("click", clearEasyScholarCache);
    nodes.clearOtherCachesButton.addEventListener("click", clearOtherCaches);

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
    nodes.metricDisplayFields.addEventListener("change", () => saveSettings(nodes.easyScholarStatus));
    nodes.easyScholarCacheTtlDays.addEventListener("change", () => saveSettings(nodes.cacheStatus));
    nodes.easyScholarCacheForever.addEventListener("change", () => {
      syncCacheDurationControls();
      saveSettings(nodes.cacheStatus);
    });
    nodes.searchCitationStylesButton.addEventListener("click", searchCitationStyles);
    nodes.citationStyleQuery.addEventListener("keydown", (event) => {
      if (event.key === "Enter") searchCitationStyles();
    });
    nodes.refreshStyleIndexButton.addEventListener("click", refreshCitationStyleIndex);
    nodes.citationStyleFile.addEventListener("change", importCitationStyle);
    nodes.citationSearchResults.addEventListener("click", handleCitationSearchAction);
    nodes.installedCitationStyles.addEventListener("click", handleInstalledCitationAction);
  }

  function syncAbleSciControls() {
    nodes.ableSciAutoLookup.disabled = !nodes.enableAbleSciAssist.checked;
  }

  function syncCacheDurationControls() {
    nodes.easyScholarCacheTtlDays.disabled = nodes.easyScholarCacheForever.checked;
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
      metricDisplayFields: [...nodes.metricDisplayFields.querySelectorAll("input[type='checkbox']:checked")]
        .map((input) => input.value),
      easyScholarCacheTtlDays: nodes.easyScholarCacheForever.checked
        ? 0
        : Math.max(1, Math.min(3650, Math.floor(Number(nodes.easyScholarCacheTtlDays.value) || shared.DEFAULT_EASY_SCHOLAR_CACHE_TTL_DAYS)))
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

  async function renderCacheSummary() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "JournalLens:getCacheSummary" });
      if (!response || !response.ok) throw new Error(response && response.error || "扩展后台无响应");
      const easyScholarEntries = Number(response.easyScholarEntries || 0);
      const otherEntries = Number(response.otherEntries || 0);
      nodes.cacheStatus.textContent = `EasyScholar ${easyScholarEntries} 条 · 其他临时缓存 ${otherEntries} 条`;
    } catch (error) {
      nodes.cacheStatus.textContent = `缓存状态读取失败：${error.message || String(error)}`;
    }
  }

  async function clearEasyScholarCache() {
    if (!window.confirm("清除全部 EasyScholar 查询缓存？该操作不会影响其他缓存和设置。")) return;
    await clearCacheWithMessage(
      nodes.clearEasyScholarCacheButton,
      { type: "JournalLens:clearEasyScholarCache" },
      "EasyScholar 查询缓存"
    );
  }

  async function clearOtherCaches() {
    if (!window.confirm("清除 DOI、OpenAlex、PubMed 和 CSL 搜索索引等临时缓存？EasyScholar 缓存会保留。")) return;
    await clearCacheWithMessage(
      nodes.clearOtherCachesButton,
      { type: "JournalLens:clearOtherCaches" },
      "其他临时缓存"
    );
  }

  async function clearCacheWithMessage(button, message, label) {
    button.disabled = true;
    nodes.cacheStatus.textContent = `正在清除${label}...`;
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (!response || !response.ok) throw new Error(response && response.error || "扩展后台无响应");
      nodes.cacheStatus.textContent = `已清除${label}（${Number(response.removedEntries || 0)} 条）`;
    } catch (error) {
      nodes.cacheStatus.textContent = `${label}清除失败：${error.message || String(error)}`;
    } finally {
      button.disabled = false;
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

  async function citationMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response || !response.ok) throw new Error(response && response.error || "扩展后台无响应");
    return response;
  }

  async function renderCitationStyles() {
    try {
      const response = await citationMessage({ type: "JournalLens:listCitationStyles" });
      citationState.styles = Array.isArray(response.styles) ? response.styles : [];
      citationState.defaultStyleId = response.defaultStyleId || "";
      renderDefaultCitationStyle();
      nodes.installedCitationStyles.replaceChildren(...citationState.styles.map(createInstalledStyleCard));
    } catch (error) {
      nodes.defaultCitationStyle.replaceChildren(createTextNode("strong", "样式加载失败"), createTextNode("small", error.message || String(error)));
      nodes.citationStyleStatus.textContent = `样式加载失败：${error.message || String(error)}`;
    }
  }

  function renderDefaultCitationStyle() {
    const style = citationState.styles.find((entry) => entry.id === citationState.defaultStyleId);
    if (!style) {
      nodes.defaultCitationStyle.replaceChildren(createTextNode("strong", "未选择题录样式"));
      return;
    }
    nodes.defaultCitationStyle.replaceChildren(
      createTextNode("strong", `默认：${style.title}`),
      createTextNode("small", style.id),
      createTextNode("small", `更新：${style.updated || "未知"} · 来源：${style.source || "未知"}`)
    );
  }

  function createTextNode(tagName, value, className = "") {
    const node = document.createElement(tagName);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  }

  function createStyleCard(entry, actions, installed = false) {
    const card = document.createElement("article");
    card.className = "citation-card";
    card.dataset.styleId = entry.id;
    const copy = document.createElement("div");
    copy.className = "citation-card-copy";
    const title = createTextNode("div", entry.title, "citation-card-title");
    if (entry.dependent) title.append(createTextNode("span", "dependent", "citation-badge"));
    if (installed && entry.id === citationState.defaultStyleId) title.append(createTextNode("span", "默认", "citation-badge default"));
    copy.append(
      title,
      createTextNode("small", entry.id),
      createTextNode("small", [
        entry.dependent ? `父样式：${entry.parentTitle || entry.parentId || "待解析"}` : "independent style",
        `更新：${entry.updated || "未知"}`,
        installed ? `来源：${entry.source || "未知"}` : ""
      ].filter(Boolean).join(" · "))
    );
    const actionBox = document.createElement("div");
    actionBox.className = "citation-card-actions";
    actions.forEach(({ action, label, className = "" }) => {
      const button = createTextNode("button", label);
      button.type = "button";
      button.dataset.action = action;
      if (className) button.className = className;
      actionBox.append(button);
    });
    card.append(copy, actionBox);
    return card;
  }

  function createInstalledStyleCard(style) {
    const actions = [{ action: "preview", label: "预览" }];
    if (style.id !== citationState.defaultStyleId) actions.push({ action: "default", label: "设为默认" });
    if (style.source === "csl-project") actions.push({ action: "refresh", label: "刷新" });
    if (!style.builtIn) actions.push({ action: "remove", label: "删除", className: "danger" });
    return createStyleCard(style, actions, true);
  }

  async function searchCitationStyles() {
    const query = nodes.citationStyleQuery.value.trim();
    if (query.length < 2) {
      nodes.citationStyleStatus.textContent = "请输入至少两个字符";
      return;
    }
    nodes.searchCitationStylesButton.disabled = true;
    nodes.citationStyleStatus.textContent = "正在搜索官方 CSL 样式索引...";
    try {
      const response = await citationMessage({ type: "JournalLens:searchCitationStyles", query, limit: 15 });
      citationState.searchResults = Array.isArray(response.results) ? response.results : [];
      nodes.citationSearchResults.replaceChildren(...citationState.searchResults.map((entry) => createStyleCard(entry, [
        { action: "install", label: entry.installed ? "已安装" : "安装" }
      ])));
      nodes.citationSearchResults.querySelectorAll("button").forEach((button, index) => {
        button.disabled = Boolean(citationState.searchResults[index] && citationState.searchResults[index].installed);
      });
      nodes.citationStyleStatus.textContent = citationState.searchResults.length
        ? `找到 ${citationState.searchResults.length} 个相关候选，请确认后安装。`
        : "没有匹配结果，可以从本地导入 .csl 文件。";
    } catch (error) {
      nodes.citationStyleStatus.textContent = `搜索失败：${error.message || String(error)}`;
    } finally {
      nodes.searchCitationStylesButton.disabled = false;
    }
  }

  async function handleCitationSearchAction(event) {
    const button = event.target.closest("button[data-action='install']");
    const card = event.target.closest("[data-style-id]");
    if (!button || !card) return;
    const entry = citationState.searchResults.find((candidate) => candidate.id === card.dataset.styleId);
    if (!entry) return;
    button.disabled = true;
    button.textContent = "安装中...";
    nodes.citationStyleStatus.textContent = entry.dependent ? "正在安装样式并下载 independent-parent..." : "正在安装样式...";
    try {
      const response = await citationMessage({ type: "JournalLens:installCitationStyle", entry });
      nodes.citationStyleStatus.textContent = response.alreadyInstalled ? "该样式已安装" : `已安装：${response.style.title}`;
      await renderCitationStyles();
      await searchCitationStyles();
    } catch (error) {
      button.disabled = false;
      button.textContent = "安装";
      nodes.citationStyleStatus.textContent = `安装失败：${error.message || String(error)}`;
    }
  }

  async function handleInstalledCitationAction(event) {
    const button = event.target.closest("button[data-action]");
    const card = event.target.closest("[data-style-id]");
    if (!button || !card) return;
    const id = card.dataset.styleId;
    const style = citationState.styles.find((entry) => entry.id === id);
    if (!style) return;
    const action = button.dataset.action;
    button.disabled = true;
    try {
      if (action === "default") {
        await citationMessage({ type: "JournalLens:setDefaultCitationStyle", id });
        nodes.citationStyleStatus.textContent = `默认样式已设为：${style.title}`;
        await renderCitationStyles();
      } else if (action === "refresh") {
        await citationMessage({ type: "JournalLens:installCitationStyle", id, refresh: true });
        nodes.citationStyleStatus.textContent = `已刷新：${style.title}`;
        await renderCitationStyles();
      } else if (action === "remove") {
        if (!window.confirm(`删除样式“${style.title}”？`)) return;
        await citationMessage({ type: "JournalLens:removeCitationStyle", id });
        nodes.citationStyleStatus.textContent = `已删除：${style.title}`;
        nodes.citationStylePreview.hidden = true;
        await renderCitationStyles();
      } else if (action === "preview") {
        await previewCitationStyle(style);
      }
    } catch (error) {
      nodes.citationStyleStatus.textContent = `${action === "preview" ? "预览" : "操作"}失败：${error.message || String(error)}`;
    } finally {
      button.disabled = false;
    }
  }

  async function previewCitationStyle(style) {
    nodes.citationStyleStatus.textContent = "正在生成样式预览...";
    const response = await citationMessage({
      type: "JournalLens:getCitationStylePayload",
      id: style.id,
      language: "en-US"
    });
    const result = cslEngine.renderBibliography({
      item: {
        id: "journal-lens-preview",
        type: "article-journal",
        title: "A reproducible example with structured citation metadata",
        author: [
          { family: "Zhang", given: "Wei" },
          { family: "Smith", given: "Jane A." },
          { family: "Garcia", given: "Luis" },
          { family: "Müller", given: "Anna" }
        ],
        "container-title": "Journal of Reproducible Research",
        issued: { "date-parts": [[2026, 1, 15]] },
        volume: "42",
        issue: "3",
        page: "101-112",
        DOI: "10.5555/journal-lens.preview",
        URL: "https://doi.org/10.5555/journal-lens.preview"
      },
      ...response.result,
      language: "en-US"
    });
    nodes.citationStylePreview.innerHTML = result.html;
    nodes.citationStylePreview.hidden = false;
    nodes.citationStyleStatus.textContent = `预览：${style.title}`;
  }

  async function importCitationStyle(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    nodes.citationStyleStatus.textContent = "正在校验并导入 CSL 文件...";
    try {
      if (!/\.csl$/i.test(file.name)) throw new Error("只能导入扩展名为 .csl 的文件");
      if (file.size > 2 * 1024 * 1024) throw new Error("CSL 文件不能超过 2 MB");
      const response = await citationMessage({
        type: "JournalLens:importCitationStyle",
        fileName: file.name,
        xml: await file.text()
      });
      nodes.citationStyleStatus.textContent = response.alreadyInstalled
        ? `样式已存在：${response.style.title}`
        : `已导入：${response.style.title}${response.style.dependent ? `（父样式：${response.style.parentTitle || response.style.parentId}）` : ""}`;
      await renderCitationStyles();
    } catch (error) {
      nodes.citationStyleStatus.textContent = `导入失败：${error.message || String(error)}`;
    } finally {
      nodes.citationStyleFile.value = "";
    }
  }

  async function refreshCitationStyleIndex() {
    nodes.refreshStyleIndexButton.disabled = true;
    nodes.citationStyleStatus.textContent = "正在更新样式搜索索引...";
    try {
      const response = await citationMessage({ type: "JournalLens:refreshCitationStyleIndex" });
      nodes.citationStyleStatus.textContent = `索引已更新：${response.count} 个样式`;
    } catch (error) {
      nodes.citationStyleStatus.textContent = `索引更新失败：${error.message || String(error)}`;
    } finally {
      nodes.refreshStyleIndexButton.disabled = false;
    }
  }
})();


