(() => {
  "use strict";

  const root = globalThis;
  const shared = root.JournalLensShared;

  const DATASET_KEY = "journalLens.dataset";
  const SETTINGS_KEY = "journalLens.settings";

  function storageGet(defaults) {
    return new Promise((resolve) => {
      chrome.storage.local.get(defaults, resolve);
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      chrome.storage.local.set(values, resolve);
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, resolve);
    });
  }

  async function getSettings() {
    const values = await storageGet({ [SETTINGS_KEY]: shared.DEFAULT_SETTINGS });
    const stored = values[SETTINGS_KEY] || {};
    const metricDisplayFields = Array.isArray(stored.metricDisplayFields)
      ? stored.metricDisplayFields
      : Array.isArray(stored.easyScholarFields)
        ? stored.easyScholarFields
        : shared.DEFAULT_EASY_SCHOLAR_FIELDS;
    return {
      ...shared.DEFAULT_SETTINGS,
      ...stored,
      metricDisplayFields,
      easyScholarFields: metricDisplayFields
    };
  }

  async function saveSettings(patch) {
    const current = await getSettings();
    const next = { ...current, ...patch };
    const metricDisplayFields = Array.isArray(patch.metricDisplayFields)
      ? patch.metricDisplayFields
      : Array.isArray(patch.easyScholarFields)
        ? patch.easyScholarFields
        : current.metricDisplayFields;
    next.metricDisplayFields = metricDisplayFields;
    next.easyScholarFields = metricDisplayFields;
    await storageSet({ [SETTINGS_KEY]: next });
    return next;
  }

  async function getDataset() {
    const values = await storageGet({
      [DATASET_KEY]: {
        version: 1,
        importedAt: "",
        fileName: "",
        rows: []
      }
    });
    return values[DATASET_KEY] || { version: 1, importedAt: "", fileName: "", rows: [] };
  }

  async function saveDataset(rows, meta = {}) {
    const normalizedRows = rows.map(shared.normalizeMetricRow).filter(Boolean);
    const dataset = {
      version: 1,
      importedAt: new Date().toISOString(),
      fileName: meta.fileName || "",
      rows: normalizedRows
    };
    await storageSet({ [DATASET_KEY]: dataset });
    return dataset;
  }

  async function clearDataset() {
    await storageRemove(DATASET_KEY);
  }

  root.JournalLensStore = {
    clearDataset,
    getDataset,
    getSettings,
    saveDataset,
    saveSettings
  };
})();
