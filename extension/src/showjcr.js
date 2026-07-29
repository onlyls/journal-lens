(() => {
  "use strict";

  const root = globalThis;
  const shared = root.JournalLensShared;
  const DATA_DIR = "中科院分区表及JCR原始数据文件";
  const RAW_BASE = `https://raw.githubusercontent.com/hitfyd/ShowJCR/master/${DATA_DIR}`;

  const SOURCES = [
    {
      id: "jcr2025",
      fileName: "JCR2025-UTF8.csv",
      label: "JCR2025"
    },
    {
      id: "xr2026",
      fileName: "XR2026-UTF8.csv",
      label: "XR2026"
    },
    {
      id: "fqbjcr2025",
      fileName: "FQBJCR2025-UTF8.csv",
      label: "FQBJCR2025"
    }
  ];

  async function fetchShowJcrDataset(progress = () => {}) {
    const texts = {};

    for (const source of SOURCES) {
      progress(`正在下载 ${source.label}...`);
      const response = await fetch(encodeURI(`${RAW_BASE}/${source.fileName}`), {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`${source.label} 下载失败：HTTP ${response.status}`);
      }
      texts[source.id] = await response.text();
    }

    progress("正在合并数据...");
    return parseShowJcrDataset(texts);
  }

  function parseShowJcrDataset(texts) {
    const aggregator = createAggregator();
    let sourceCount = 0;

    if (texts.jcr2025) {
      parseJcrRows(texts.jcr2025).forEach((row) => aggregator.upsert(row));
      sourceCount += 1;
    }

    if (texts.xr2026) {
      parseXrRows(texts.xr2026).forEach((row) => aggregator.upsert(row));
      sourceCount += 1;
    }

    if (texts.fqbjcr2025) {
      parseFqbRows(texts.fqbjcr2025).forEach((row) => aggregator.upsert(row));
      sourceCount += 1;
    }

    const rows = aggregator.rows().map(shared.normalizeMetricRow).filter(Boolean);
    return {
      rows,
      meta: {
        fileName: `ShowJCR ${SOURCES.map((source) => source.label).join(" + ")}`,
        sourceCount,
        sourceUrl: "https://github.com/hitfyd/ShowJCR"
      }
    };
  }

  function parseJcrRows(text) {
    return shared.parseCsvObjects(text).map((row) => {
      const quartiles = valuesByPrefix(row, "IF Quartile").filter(Boolean);
      return {
        title: row.Journal,
        issn: cleanIssn(row.ISSN),
        eissn: cleanIssn(row.EISSN),
        jcrQuartile: bestQuartile(quartiles),
        impactFactor: cleanMetric(row["IF(2025)"]),
        year: "2025",
        source: "ShowJCR JCR2025"
      };
    }).filter(hasIdentity);
  }

  function parseXrRows(text) {
    return shared.parseCsvObjects(text).map((row) => {
      const largeCategories = [
        {
          name: row["大类中文名"] || row["大类英文名"],
          partition: row["大类新锐分区"]
        },
        {
          name: row["大类2中文名"] || row["大类2英文名"],
          partition: row["大类2新锐分区"]
        }
      ];

      return {
        title: row.Journal || row["刊名"],
        issn: cleanIssn(row.ISSN),
        eissn: cleanIssn(row.EISSN),
        xrPartition: bestCategoryPartition(largeCategories),
        xrWarning: row["预警标记"],
        xrTop: positiveTop(row.Top),
        year: row["年份"] || "2026",
        source: "ShowJCR XR2026"
      };
    }).filter(hasIdentity);
  }

  function parseFqbRows(text) {
    return shared.parseCsvObjects(text).map((row) => {
      const issns = splitIssns(row["ISSN/EISSN"]);
      return {
        title: row.Journal,
        issn: issns[0] || "",
        eissn: issns[1] || "",
        casPartition: formatCategoryPartition(row["大类"], row["大类分区"]),
        casTop: positiveTop(row.Top),
        openAccess: row["Open Access"],
        year: row["年份"] || "2025",
        source: "ShowJCR FQBJCR2025"
      };
    }).filter(hasIdentity);
  }

  function createAggregator() {
    const records = [];
    const byIssn = new Map();
    const byName = new Map();

    return {
      upsert(row) {
        const normalized = normalizeIncomingRow(row);
        const existing = findExisting(normalized);
        const record = existing || createRecord(normalized);

        mergeValue(record, "title", normalized.title);
        mergeValue(record, "issn", normalized.issn);
        mergeValue(record, "eissn", normalized.eissn);
        mergeValue(record, "xrPartition", normalized.xrPartition);
        mergeValue(record, "jcrQuartile", normalized.jcrQuartile);
        mergeValue(record, "impactFactor", normalized.impactFactor);
        mergeValue(record, "casPartition", normalized.casPartition);
        mergeValue(record, "xrWarning", normalized.xrWarning);
        mergeValue(record, "xrTop", normalized.xrTop);
        mergeValue(record, "casTop", normalized.casTop);
        mergeValue(record, "warning", normalized.warning);
        mergeValue(record, "isTop", normalized.isTop);
        mergeValue(record, "openAccess", normalized.openAccess);
        record.year = mergeYears(record.year, normalized.year);
        record.source = mergeSources(record.source, normalized.source);

        indexRecord(record);
      },
      rows() {
        return records;
      }
    };

    function findExisting(row) {
      const issns = splitIssns([row.issn, row.eissn].join("/"));
      for (const issn of issns) {
        if (byIssn.has(issn)) return byIssn.get(issn);
      }
      const nameKey = shared.normalizeJournalName(row.title);
      return nameKey ? byName.get(nameKey) : null;
    }

    function createRecord(row) {
      const record = { title: row.title || "" };
      records.push(record);
      return record;
    }

    function indexRecord(record) {
      splitIssns([record.issn, record.eissn].join("/")).forEach((issn) => {
        byIssn.set(issn, record);
      });
      const nameKey = shared.normalizeJournalName(record.title);
      if (nameKey) byName.set(nameKey, record);
    }
  }

  function normalizeIncomingRow(row) {
    return {
      ...row,
      title: shared.collapseWhitespace(row.title),
      issn: cleanIssn(row.issn),
      eissn: cleanIssn(row.eissn),
      xrPartition: cleanMetric(row.xrPartition),
      jcrQuartile: cleanMetric(row.jcrQuartile),
      impactFactor: cleanMetric(row.impactFactor),
      casPartition: cleanMetric(row.casPartition),
      xrWarning: cleanMetric(row.xrWarning),
      xrTop: cleanMetric(row.xrTop),
      casTop: cleanMetric(row.casTop),
      warning: cleanMetric(row.warning),
      isTop: cleanMetric(row.isTop),
      openAccess: cleanMetric(row.openAccess),
      year: cleanMetric(row.year),
      source: cleanMetric(row.source)
    };
  }

  function valuesByPrefix(row, prefix) {
    return Object.entries(row)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value);
  }

  function bestQuartile(values) {
    const quartiles = values
      .map((value) => String(value || "").match(/Q[1-4]/i))
      .filter(Boolean)
      .map((match) => match[0].toUpperCase());
    if (!quartiles.length) return "";
    return quartiles.sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)))[0];
  }

  function bestCategoryPartition(entries) {
    const candidates = entries
      .map((entry) => ({
        name: cleanMetric(entry && entry.name),
        partition: normalizePartition(entry && entry.partition)
      }))
      .filter((entry) => entry.partition);
    if (!candidates.length) return "";
    candidates.sort((left, right) => partitionRank(left.partition) - partitionRank(right.partition));
    return formatCategoryPartition(candidates[0].name, candidates[0].partition);
  }

  function partitionRank(value) {
    const match = String(value || "").match(/[1-4]/);
    return match ? Number(match[0]) : 99;
  }

  function splitIssns(value) {
    return String(value || "")
      .split(/[\/,;|\s]+/)
      .map(cleanIssn)
      .filter(Boolean);
  }

  function cleanIssn(value) {
    const normalized = shared.normalizeIssn(value);
    return normalized === "N/A" ? "" : normalized;
  }

  function cleanMetric(value) {
    const text = shared.collapseWhitespace(value);
    if (!text || text === "-" || text === "—" || /^n\/?a$/i.test(text)) return "";
    return text.replace(/\s*区$/, "区");
  }

  function normalizePartition(value) {
    const text = shared.cleanPartitionDisplay(cleanMetric(value));
    const match = text.match(/^([1-4])\s*(?:区)?\s*(.*)$/);
    if (!match) return text;
    return `${match[1]}区${match[2] ? ` ${match[2]}` : ""}`;
  }

  function positiveTop(value) {
    const text = cleanMetric(value);
    return /^(?:top|是|yes|true|1)$/i.test(text) ? "Top" : "";
  }

  function formatCategoryPartition(category, partition) {
    const name = cleanMetric(category);
    const value = normalizePartition(partition);
    if (!name) return value;
    if (!value) return name;
    if (value.includes(name)) return value;
    const separator = /[\u3400-\u9fff]$/.test(name) ? "" : " ";
    return `${name}${separator}${value}`;
  }

  function cleanSources(value) {
    return String(value || "")
      .split(/\s*\+\s*|\s*;\s*/)
      .map(shared.collapseWhitespace)
      .filter(Boolean);
  }

  function mergeValue(record, key, value) {
    if (!record[key] && value) record[key] = value;
  }

  function mergeYears(left, right) {
    return shared.unique([...(String(left || "").split(/\s*\/\s*/)), right].map(shared.collapseWhitespace))
      .filter(Boolean)
      .join("/");
  }

  function mergeSources(left, right) {
    return shared.unique([...cleanSources(left), ...cleanSources(right)]).join(" + ");
  }

  function hasIdentity(row) {
    return Boolean(row.title || row.issn || row.eissn);
  }

  root.JournalLensShowJcr = {
    SOURCES,
    fetchShowJcrDataset,
    parseShowJcrDataset
  };
})();
