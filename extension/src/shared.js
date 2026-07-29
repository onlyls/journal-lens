(() => {
  "use strict";

  const root = globalThis;
  const build = root.JournalLensBuild || {};

  const DEFAULT_EASY_SCHOLAR_FIELDS = ["xr", "sciUp", "sci", "sciif"];
  const DEFAULT_EASY_SCHOLAR_CACHE_TTL_DAYS = 30;

  const DEFAULT_SETTINGS = {
    resolverId: "googleScholar",
    customResolverTemplate: "",
    enableOpenAlex: true,
    annotateLists: true,
    relatedArticleMode: "manual",
    showUnmatchedArticleBadge: true,
    showFloatingButton: false,
    debugMode: false,
    enableAbleSciAssist: true,
    ableSciAutoLookup: true,
    metricSourceMode: "local",
    easyScholarSecretKey: "",
    metricDisplayFields: DEFAULT_EASY_SCHOLAR_FIELDS,
    easyScholarFields: DEFAULT_EASY_SCHOLAR_FIELDS,
    easyScholarCacheTtlDays: DEFAULT_EASY_SCHOLAR_CACHE_TTL_DAYS
  };

  const RESOLVERS = [
    {
      id: "googleScholar",
      label: "Google Scholar",
      template: "https://scholar.google.com/scholar?q={query}"
    },
    {
      id: "doi",
      label: "DOI",
      template: "https://doi.org/{doi}"
    },
    {
      id: "openAlex",
      label: "OpenAlex",
      template: "https://openalex.org/works?search={query}"
    },
    {
      id: "custom",
      label: "Custom",
      template: "{customResolverTemplate}"
    }
  ];

  const EASY_SCHOLAR_FIELDS = [
    { key: "xr", label: "新锐", target: "xrPartition", showJcr: true },
    { key: "xrSmall", label: "新锐小类" },
    { key: "xrTop", label: "新锐 Top", showJcr: true },
    { key: "xrWarn", label: "新锐预警", tone: "warning", showJcr: true },
    { key: "sciUp", label: "中科院升级版", target: "casPartition", showJcr: true },
    { key: "sciUpSmall", label: "中科院小类" },
    { key: "sciUpTop", label: "中科院 Top", showJcr: true },
    { key: "sciBase", label: "中科院基础版" },
    { key: "sciwarn", label: "中科院预警", tone: "warning" },
    { key: "sci", label: "JCR", target: "jcrQuartile", showJcr: true },
    { key: "sciif", label: "IF", target: "impactFactor", showJcr: true },
    { key: "sciif5", label: "5 年 IF" },
    { key: "jci", label: "JCI" },
    { key: "esi", label: "ESI" },
    { key: "custom", label: "自定义等级" }
  ];

  const JOURNAL_NAME_ALIAS_TARGETS = {
    "chem biol": "cell chemical biology",
    "chemistry and biology": "cell chemical biology"
  };

  const JOURNAL_MATCH_STOP_WORDS = new Set(["a", "an", "and", "for", "in", "j", "of", "on", "the"]);

  const HEADER_ALIASES = {
    title: [
      "journal",
      "journal title",
      "journal_title",
      "journal name",
      "journal_name",
      "name",
      "display_name",
      "刊名",
      "期刊名",
      "杂志名",
      "期刊名称"
    ],
    issn: ["issn", "print issn", "print_issn", "pissn", "issn-l", "issn_l"],
    eissn: ["eissn", "e-issn", "electronic issn", "electronic_issn", "online issn", "online_issn"],
    xrPartition: [
      "xinrui",
      "xinrui_partition",
      "xr",
      "xr_partition",
      "新锐",
      "新锐分区",
      "中科院分区",
      "cas",
      "cas_partition"
    ],
    jcrQuartile: ["jcr", "jcr_quartile", "jcr quartile", "jcr分区", "jcr 分区", "quartile", "分区"],
    impactFactor: [
      "impact factor",
      "impact_factor",
      "journal impact factor",
      "journal_impact_factor",
      "jif",
      "if",
      "影响因子"
    ],
    casPartition: [
      "cas_partition",
      "cas partition",
      "fqbjcr",
      "中科院",
      "中科院分区",
      "升级版分区",
      "大类分区"
    ],
    xrWarning: ["xr_warning", "xr warning", "新锐预警", "新锐预警标记"],
    xrTop: ["xr_top", "xr top", "新锐top", "新锐 top"],
    casTop: ["cas_top", "cas top", "中科院top", "中科院 top"],
    warning: ["warning", "warning_flag", "预警", "预警标记"],
    isTop: ["top", "is_top", "top期刊"],
    openAccess: ["open_access", "open access", "oa", "是否oa"],
    year: ["year", "jcr_year", "数据年份", "年份"],
    source: ["source", "来源", "数据来源"],
    updatedAt: ["updated_at", "updated", "last_updated", "更新日期", "导入日期"],
    homepage: ["homepage", "homepage_url", "url", "website", "期刊网址"]
  };

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[()（）]/g, "");
  }

  function normalizeDoi(value) {
    if (!value) return "";
    const text = String(value)
      .trim()
      .replace(/^doi:\s*/i, "")
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
      .replace(/^urn:doi:/i, "");
    const match = text.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
    if (!match) return "";
    return match[0]
      .replace(/[.,;)\]\s]+$/g, "")
      .toLowerCase();
  }

  function normalizeIssn(value) {
    if (!value) return "";
    const raw = String(value).trim().toUpperCase();
    const match = raw.match(/[0-9]{4}[-\s]?[0-9]{3}[0-9X]/);
    if (!match) return "";
    const compact = match[0].replace(/[-\s]/g, "");
    return `${compact.slice(0, 4)}-${compact.slice(4)}`;
  }

  function normalizeJournalName(value) {
    if (!value) return "";
    return String(value)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\b(the|journal of|international journal of)\b/g, " ")
      .replace(/[\u2010-\u2015]/g, "-")
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeJournalLoose(value) {
    const tokens = journalMatchTokens(value);
    if (tokens.length <= 1) return tokens.join(" ");
    return tokens.map((token) => token.length <= 2 ? token : token.slice(0, 2)).join(" ");
  }

  function normalizeJournalStrictLoose(value) {
    return journalMatchTokens(value)
      .map((token) => token.length <= 3 ? token : token.slice(0, 3))
      .join(" ");
  }

  function journalMatchTokens(value) {
    return normalizeJournalName(value)
      .split(" ")
      .filter((token) => token && !JOURNAL_MATCH_STOP_WORDS.has(token));
  }

  function collapseWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
        continue;
      }

      if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(cell);
        cell = "";
      } else if (char === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (char !== "\r") {
        cell += char;
      }
    }

    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }

    return rows.filter((entry) => entry.some((value) => String(value).trim()));
  }

  function parseCsvObjects(text) {
    const table = parseCsv(text);
    if (!table.length) return [];
    const headers = table[0].map(collapseWhitespace);
    return table.slice(1).map((cells) => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] === undefined ? "" : cells[index];
      });
      return row;
    });
  }

  function headerLookup(headers) {
    const normalizedHeaders = headers.map(normalizeHeader);
    const lookup = {};

    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      const normalizedAliases = aliases.map(normalizeHeader);
      const index = normalizedHeaders.findIndex((header) => normalizedAliases.includes(header));
      if (index >= 0) {
        lookup[field] = index;
      }
    }

    return lookup;
  }

  function fromKnownObject(row) {
    const normalized = {};
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      for (const alias of aliases) {
        if (Object.prototype.hasOwnProperty.call(row, alias)) {
          normalized[field] = row[alias];
          break;
        }
      }
      if (normalized[field] !== undefined) continue;
      for (const [key, value] of Object.entries(row)) {
        if (normalizeHeader(key) === normalizeHeader(field)) {
          normalized[field] = value;
          break;
        }
      }
    }
    return normalized;
  }

  function normalizeMetricRow(input) {
    const row = Array.isArray(input) ? {} : fromKnownObject(input || {});
    const title = collapseWhitespace(row.title);
    const issn = normalizeIssn(row.issn);
    const eissn = normalizeIssn(row.eissn);

    if (!title && !issn && !eissn) {
      return null;
    }

    return {
      id: [normalizeJournalName(title), issn, eissn].filter(Boolean).join("|"),
      title,
      titleKey: normalizeJournalName(title),
      issn,
      eissn,
      xrPartition: collapseWhitespace(row.xrPartition),
      jcrQuartile: collapseWhitespace(row.jcrQuartile).toUpperCase(),
      impactFactor: collapseWhitespace(row.impactFactor),
      casPartition: collapseWhitespace(row.casPartition),
      xrWarning: collapseWhitespace(row.xrWarning),
      xrTop: collapseWhitespace(row.xrTop),
      casTop: collapseWhitespace(row.casTop),
      warning: collapseWhitespace(row.warning),
      isTop: collapseWhitespace(row.isTop),
      openAccess: collapseWhitespace(row.openAccess),
      year: collapseWhitespace(row.year),
      source: collapseWhitespace(row.source),
      updatedAt: collapseWhitespace(row.updatedAt),
      homepage: collapseWhitespace(row.homepage)
    };
  }

  function parseMetricTable(text, fileName = "") {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      return { rows: [], errors: ["文件为空"] };
    }

    if (/\.json$/i.test(fileName) || /^[{[]/.test(trimmed)) {
      const parsed = JSON.parse(trimmed);
      const sourceRows = Array.isArray(parsed) ? parsed : parsed.rows;
      if (!Array.isArray(sourceRows)) {
        throw new Error("JSON 需要是数组，或包含 rows 数组。");
      }
      return {
        rows: sourceRows.map(normalizeMetricRow).filter(Boolean),
        errors: []
      };
    }

    const table = parseCsv(trimmed);
    if (table.length < 2) {
      return { rows: [], errors: ["CSV 需要表头和至少一行数据"] };
    }

    const headers = table[0];
    const lookup = headerLookup(headers);
    const dataRows = table.slice(1).map((cells) => {
      const objectRow = {};
      for (const [field, index] of Object.entries(lookup)) {
        objectRow[field] = cells[index];
      }
      return normalizeMetricRow(objectRow);
    });

    return {
      rows: dataRows.filter(Boolean),
      errors: []
    };
  }

  function buildMetricIndex(rows = []) {
    const byName = {};
    const byIssn = {};
    const byLooseName = {};
    const byStrictLooseName = {};
    const byAbbreviationPrefix = {};
    const ambiguousLooseNames = new Set();
    const ambiguousStrictLooseNames = new Set();

    for (const row of rows) {
      if (!row) continue;
      const normalized = normalizeMetricRow(row);
      if (!normalized) continue;

      if (normalized.titleKey) byName[normalized.titleKey] = normalized;
      if (normalized.issn) byIssn[normalized.issn] = normalized;
      if (normalized.eissn) byIssn[normalized.eissn] = normalized;

      const looseKey = normalizeJournalLoose(normalized.title);
      if (looseKey && !ambiguousLooseNames.has(looseKey)) {
        if (byLooseName[looseKey] && byLooseName[looseKey].id !== normalized.id) {
          delete byLooseName[looseKey];
          ambiguousLooseNames.add(looseKey);
        } else {
          byLooseName[looseKey] = normalized;
        }
      }

      const strictLooseKey = normalizeJournalStrictLoose(normalized.title);
      if (strictLooseKey && !ambiguousStrictLooseNames.has(strictLooseKey)) {
        if (byStrictLooseName[strictLooseKey] && byStrictLooseName[strictLooseKey].id !== normalized.id) {
          delete byStrictLooseName[strictLooseKey];
          ambiguousStrictLooseNames.add(strictLooseKey);
        } else {
          byStrictLooseName[strictLooseKey] = normalized;
        }
      }
    }

    const byAliasName = {};
    for (const [alias, target] of Object.entries(JOURNAL_NAME_ALIAS_TARGETS)) {
      const metric = byName[normalizeJournalName(target)];
      if (metric) byAliasName[normalizeJournalName(alias)] = metric;
    }

    for (const metric of Object.values(byName)) {
      const tokens = journalMatchTokens(metric.title);
      if (tokens.length < 2) continue;
      const firstToken = tokens[0];
      for (let length = 1; length <= Math.min(3, firstToken.length); length += 1) {
        const key = firstToken.slice(0, length);
        if (!byAbbreviationPrefix[key]) byAbbreviationPrefix[key] = [];
        byAbbreviationPrefix[key].push({ metric, tokens });
      }
    }

    return {
      rows: Object.values(byName),
      byName,
      byIssn,
      byLooseName,
      byStrictLooseName,
      byAliasName,
      byAbbreviationPrefix
    };
  }

  function findMetricByAbbreviation(value, index) {
    const queryTokens = journalMatchTokens(value);
    if (queryTokens.length < 2 || !index.byAbbreviationPrefix) return null;
    const firstToken = queryTokens[0];
    const key = firstToken.slice(0, Math.min(3, firstToken.length));
    const candidates = index.byAbbreviationPrefix[key] || [];
    const matches = [];

    for (const candidate of candidates) {
      if (candidate.tokens.length !== queryTokens.length) continue;
      let score = 0;
      let matchesAllTokens = true;
      for (let tokenIndex = 0; tokenIndex < queryTokens.length; tokenIndex += 1) {
        const queryToken = queryTokens[tokenIndex];
        const fullToken = candidate.tokens[tokenIndex];
        if (!fullToken.startsWith(queryToken)) {
          matchesAllTokens = false;
          break;
        }
        score += queryToken === fullToken ? queryToken.length + 8 : queryToken.length;
      }
      if (matchesAllTokens) matches.push({ metric: candidate.metric, score });
    }

    if (!matches.length) return null;
    matches.sort((left, right) => right.score - left.score);
    if (matches.length > 1 && matches[0].score === matches[1].score) return null;
    return matches[0].metric;
  }

  function findMetricForRecord(record = {}, index = buildMetricIndex()) {
    const issns = unique([
      ...(Array.isArray(record.issns) ? record.issns : []),
      normalizeIssn(record.issn),
      normalizeIssn(record.eissn)
    ]);

    for (const issn of issns) {
      if (index.byIssn[issn]) return index.byIssn[issn];
    }

    const titleKeys = unique([
      normalizeJournalName(record.journal),
      normalizeJournalName(record.containerTitle),
      normalizeJournalName(record.source)
    ]);

    for (const key of titleKeys) {
      if (index.byName[key]) return index.byName[key];
      if (index.byAliasName && index.byAliasName[key]) return index.byAliasName[key];
    }

    for (const value of [record.journal, record.containerTitle, record.source]) {
      const abbreviationMatch = findMetricByAbbreviation(value, index);
      if (abbreviationMatch) return abbreviationMatch;
    }

    const strictLooseKeys = unique([
      normalizeJournalStrictLoose(record.journal),
      normalizeJournalStrictLoose(record.containerTitle),
      normalizeJournalStrictLoose(record.source)
    ]);

    for (const key of strictLooseKeys) {
      if (index.byStrictLooseName && index.byStrictLooseName[key]) return index.byStrictLooseName[key];
    }

    const looseKeys = unique([
      normalizeJournalLoose(record.journal),
      normalizeJournalLoose(record.containerTitle),
      normalizeJournalLoose(record.source)
    ]);

    for (const key of looseKeys) {
      if (index.byLooseName && index.byLooseName[key]) return index.byLooseName[key];
    }

    return null;
  }

  function findMetricByText(text, index = buildMetricIndex()) {
    const normalized = normalizeJournalName(text);
    if (!normalized) return null;
    if (index.byName[normalized]) return index.byName[normalized];

    const withoutLabel = normalizeJournalName(
      String(text).replace(/^(journal|source|publication|期刊|来源)\s*[:：]\s*/i, "")
    );
    if (index.byName[withoutLabel]) return index.byName[withoutLabel];
    if (index.byAliasName && index.byAliasName[withoutLabel]) return index.byAliasName[withoutLabel];
    const abbreviationMatch = findMetricByAbbreviation(withoutLabel, index);
    if (abbreviationMatch) return abbreviationMatch;
    const strictLooseKey = normalizeJournalStrictLoose(withoutLabel);
    if (index.byStrictLooseName && index.byStrictLooseName[strictLooseKey]) {
      return index.byStrictLooseName[strictLooseKey];
    }
    const looseKey = normalizeJournalLoose(withoutLabel);
    return (index.byLooseName && index.byLooseName[looseKey]) || null;
  }

  function metricLabel(metric) {
    if (!metric) return "未匹配";
    const chunks = [];
    if (metric.xrPartition) chunks.push(`新锐 ${cleanPartitionDisplay(metric.xrPartition)}`);
    if (metric.casPartition) chunks.push(`中科院 ${cleanPartitionDisplay(metric.casPartition)}`);
    if (metric.jcrQuartile) chunks.push(`JCR ${metric.jcrQuartile}`);
    if (metric.impactFactor) chunks.push(`IF ${metric.impactFactor}`);
    if (Array.isArray(metric.extraMetrics)) {
      metric.extraMetrics.forEach((entry) => {
        const label = collapseWhitespace(entry && entry.label);
        const value = collapseWhitespace(entry && entry.value);
        if (label && value) chunks.push(`${label} ${value}`);
      });
    }
    return chunks.length ? chunks.join(" · ") : "已匹配";
  }

  function cleanPartitionDisplay(value) {
    return collapseWhitespace(value)
      .replace(/\s*\[\s*\d+\s*\/\s*\d+\s*\]\s*/g, " ")
      .trim();
  }

  function parseEasyScholarMetric(data, selectedFields = DEFAULT_EASY_SCHOLAR_FIELDS, publicationName = "") {
    const payload = data && typeof data === "object" ? data : {};
    const officialRank = payload.officialRank && typeof payload.officialRank === "object"
      ? payload.officialRank
      : {};
    const official = {
      ...(officialRank.select && typeof officialRank.select === "object" ? officialRank.select : {}),
      ...(officialRank.all && typeof officialRank.all === "object" ? officialRank.all : {})
    };
    const allowed = new Set(EASY_SCHOLAR_FIELDS.map((entry) => entry.key));
    const requested = unique((Array.isArray(selectedFields) ? selectedFields : DEFAULT_EASY_SCHOLAR_FIELDS)
      .filter((key) => allowed.has(key)));
    const metric = {
      title: collapseWhitespace(publicationName),
      source: "EasyScholar API",
      provider: "easyScholar",
      extraMetrics: []
    };

    requested.forEach((key) => {
      if (key === "custom") return;
      const definition = EASY_SCHOLAR_FIELDS.find((entry) => entry.key === key);
      const value = collapseWhitespace(official[key]);
      if (!definition || !value) return;
      if (definition.target) metric[definition.target] = value;
      else metric.extraMetrics.push({ key, label: definition.label, value, tone: definition.tone || "" });
    });

    if (requested.includes("custom")) {
      parseEasyScholarCustomRanks(payload.customRank).forEach((entry) => metric.extraMetrics.push(entry));
    }

    const hasCoreMetric = Boolean(metric.xrPartition || metric.casPartition || metric.jcrQuartile || metric.impactFactor);
    return hasCoreMetric || metric.extraMetrics.length ? metric : null;
  }

  function parseEasyScholarCustomRanks(customRank) {
    if (!customRank || typeof customRank !== "object") return [];
    const rankInfo = Array.isArray(customRank.rankInfo) ? customRank.rankInfo : [];
    const ranks = Array.isArray(customRank.rank) ? customRank.rank : [];
    const infoById = new Map(rankInfo.map((entry) => [String(entry && entry.uuid || ""), entry]));
    const rankFields = ["oneRankText", "twoRankText", "threeRankText", "fourRankText", "fiveRankText"];
    const result = [];
    ranks.forEach((rawRank) => {
      const [uuid, rankValue] = String(rawRank || "").split("&&&");
      const info = infoById.get(uuid);
      const rankIndex = Number(rankValue) - 1;
      const label = collapseWhitespace(info && info.abbName);
      const value = rankIndex >= 0 && rankIndex < rankFields.length
        ? collapseWhitespace(info && info[rankFields[rankIndex]])
        : "";
      if (label && value) result.push({ key: `custom:${uuid}`, label, value, tone: "" });
    });
    return result;
  }

  function safeUrlFromTemplate(template, record = {}, settings = {}) {
    const doi = normalizeDoi(record.doi);
    const journal = collapseWhitespace(record.journal || record.containerTitle || "");
    const title = collapseWhitespace(record.title || "");
    const pageUrl = record.url || "";
    const query = collapseWhitespace([doi, title, journal].filter(Boolean).join(" "));
    const replacements = {
      doi: encodeURIComponent(doi),
      rawDoi: doi,
      title: encodeURIComponent(title),
      journal: encodeURIComponent(journal),
      url: encodeURIComponent(pageUrl),
      query: encodeURIComponent(query),
      customResolverTemplate: settings.customResolverTemplate || ""
    };

    let url = String(template || "").replace(/\{(doi|rawDoi|title|journal|url|query|customResolverTemplate)\}/g, (_, key) => {
      return replacements[key] || "";
    });

    if (!url && doi) {
      url = `https://doi.org/${encodeURIComponent(doi)}`;
    }
    if (!url && query) {
      url = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      return parsed.href;
    } catch (_error) {
      return "";
    }
  }

  function buildResolverUrl(settings = DEFAULT_SETTINGS, record = {}) {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    const resolver = RESOLVERS.find((entry) => entry.id === merged.resolverId) || RESOLVERS[0];
    const hasDoi = Boolean(normalizeDoi(record.doi));
    const template = resolver.id === "doi" && !hasDoi
      ? RESOLVERS[0].template
      : resolver.id === "custom"
        ? merged.customResolverTemplate
        : resolver.template;
    return safeUrlFromTemplate(template, record, merged);
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  root.JournalLensShared = {
    BUILD_CHANNEL: build.channel || "debug",
    DEBUG_FEATURES_AVAILABLE: build.enableDebug !== false,
    DEFAULT_EASY_SCHOLAR_FIELDS,
    DEFAULT_EASY_SCHOLAR_CACHE_TTL_DAYS,
    DEFAULT_SETTINGS,
    EASY_SCHOLAR_FIELDS,
    RESOLVERS,
    buildMetricIndex,
    buildResolverUrl,
    collapseWhitespace,
    findMetricByText,
    findMetricByAbbreviation,
    findMetricForRecord,
    formatDateTime,
    metricLabel,
    cleanPartitionDisplay,
    normalizeDoi,
    normalizeIssn,
    normalizeJournalLoose,
    normalizeJournalStrictLoose,
    normalizeJournalName,
    normalizeMetricRow,
    parseEasyScholarMetric,
    parseMetricTable,
    parseCsv,
    parseCsvObjects,
    safeUrlFromTemplate,
    unique
  };
})();

