const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const extensionRoot = path.join(projectRoot, "extension");
require(path.join(extensionRoot, "src", "shared.js"));
require(path.join(extensionRoot, "src", "showjcr.js"));

const dataDir = path.join(projectRoot, "external-data", "showjcr");
const files = {
  jcr2025: "JCR2025-UTF8.csv",
  xr2026: "XR2026-UTF8.csv",
  fqbjcr2025: "FQBJCR2025-UTF8.csv"
};
const texts = {};

for (const [key, fileName] of Object.entries(files)) {
  const filePath = path.join(dataDir, fileName);
  assert.ok(fs.existsSync(filePath), `missing local ShowJCR file: ${fileName}`);
  texts[key] = fs.readFileSync(filePath, "utf8");
}

const dataset = globalThis.JournalLensShowJcr.parseShowJcrDataset(texts);
const index = globalThis.JournalLensShared.buildMetricIndex(dataset.rows);
const cases = {
  "Eur. J. Med. Chem.": "EUROPEAN JOURNAL OF MEDICINAL CHEMISTRY",
  "J. Med. Chem.": "JOURNAL OF MEDICINAL CHEMISTRY",
  "Bioorg. Chem.": "BIOORGANIC CHEMISTRY",
  Cell: "CELL",
  "Trends Genet.": "TRENDS IN GENETICS",
  Science: "SCIENCE"
};

for (const [abbreviation, expectedTitle] of Object.entries(cases)) {
  const metric = globalThis.JournalLensShared.findMetricForRecord({ journal: abbreviation }, index);
  assert.ok(metric, `no local ShowJCR match for ${abbreviation}`);
  assert.equal(metric.title.toUpperCase(), expectedTitle);
}

const xrLargeCategoryCase = globalThis.JournalLensShared.findMetricForRecord({
  journal: "CURRENT OPINION IN PLANT BIOLOGY"
}, index);
assert.ok(xrLargeCategoryCase);
assert.equal(xrLargeCategoryCase.xrPartition, "生物学2区",
  "XR merge must keep the large category and must not substitute a better-ranked small category");

const casLargeCategoryCase = globalThis.JournalLensShared.findMetricForRecord({
  journal: "JOURNAL OF POULTRY SCIENCE"
}, index);
assert.ok(casLargeCategoryCase);
assert.equal(casLargeCategoryCase.casPartition, "农林科学3区",
  "CAS merge must retain the large category name without exposing journal rank positions");

const synthetic = globalThis.JournalLensShowJcr.parseShowJcrDataset({
  jcr2025: [
    "Journal,ISSN,EISSN,IF(2025),IF Quartile(2025)_1",
    "Example Journal,1234-5678,8765-4321,4.5,Q1"
  ].join("\n"),
  xr2026: [
    "Journal,年份,预警标记,ISSN,EISSN,大类中文名,大类新锐分区,Top,小类1中文名,小类1新锐分区",
    "Example Journal,2026,观察,1234-5678,8765-4321,农林科学,2 区,Top,兽医学,1 区"
  ].join("\n"),
  fqbjcr2025: [
    "Journal,年份,ISSN/EISSN,大类,大类分区,Top",
    "Example Journal,2025,1234-5678/8765-4321,农林科学,3 [379/904],是"
  ].join("\n")
});
assert.equal(synthetic.rows.length, 1);
assert.equal(synthetic.rows[0].xrPartition, "农林科学2区");
assert.equal(synthetic.rows[0].casPartition, "农林科学3区");
assert.equal(synthetic.rows[0].jcrQuartile, "Q1");
assert.equal(synthetic.rows[0].impactFactor, "4.5");
assert.equal(synthetic.rows[0].xrWarning, "观察");
assert.equal(synthetic.rows[0].xrTop, "Top");
assert.equal(synthetic.rows[0].casTop, "Top");
assert.equal(synthetic.rows[0].year, "2025/2026");
assert.doesNotMatch(globalThis.JournalLensShared.metricLabel(synthetic.rows[0]), /2025|2026|379\/904/);

console.log(`local ShowJCR smoke tests passed (${dataset.rows.length} merged rows)`);
