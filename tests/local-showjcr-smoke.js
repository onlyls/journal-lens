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

console.log(`local ShowJCR smoke tests passed (${dataset.rows.length} merged rows)`);
