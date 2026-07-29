const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "extension");
require(path.join(root, "src", "shared.js"));

const shared = globalThis.JournalLensShared;
const responseData = {
  customRank: {
    rankInfo: [
      {
        uuid: "1614986460329492480",
        abbName: "DUFE",
        oneRankText: "TOP",
        twoRankText: "A",
        threeRankText: "B",
        fourRankText: "C",
        fiveRankText: "D"
      }
    ],
    rank: ["1614986460329492480&&&3"]
  },
  officialRank: {
    all: {
      sciif: "6.7",
      sci: "Q1",
      sciUp: "医学2区",
      sciif5: "6.6",
      jci: "1.32",
      xr: "医学2区",
      xrSmall: "药物化学2区",
      xrTop: "医学TOP"
    },
    select: {
      sciif: "6.7",
      sci: "Q1"
    }
  }
};

const core = shared.parseEasyScholarMetric(
  responseData,
  shared.DEFAULT_EASY_SCHOLAR_FIELDS,
  "European Journal of Medicinal Chemistry"
);
assert.equal(core.title, "European Journal of Medicinal Chemistry");
assert.equal(core.xrPartition, "医学2区");
assert.equal(core.casPartition, "医学2区");
assert.equal(core.jcrQuartile, "Q1");
assert.equal(core.impactFactor, "6.7");
assert.deepEqual(core.extraMetrics, []);

const expanded = shared.parseEasyScholarMetric(
  responseData,
  ["sciif5", "jci", "xrSmall", "xrTop", "custom"],
  "European Journal of Medicinal Chemistry"
);
assert.deepEqual(expanded.extraMetrics, [
  { key: "sciif5", label: "5 年 IF", value: "6.6", tone: "" },
  { key: "jci", label: "JCI", value: "1.32", tone: "" },
  { key: "xrSmall", label: "新锐小类", value: "药物化学2区", tone: "" },
  { key: "xrTop", label: "新锐 Top", value: "医学TOP", tone: "" },
  { key: "custom:1614986460329492480", label: "DUFE", value: "B", tone: "" }
]);

assert.equal(shared.parseEasyScholarMetric(responseData, ["esi"], "Example"), null);
console.log("EasyScholar response parsing smoke tests passed");
