#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const [stylesRoot, localesRoot, outputRoot] = process.argv.slice(2).map((value) => value && path.resolve(value));
if (!stylesRoot || !localesRoot || !outputRoot) {
  throw new Error("Usage: node tools/generate-csl-style-index.js <styles-v1.0.2> <locales-v1.0.2> <extension-assets-citation>");
}

const STYLE_FILES = ["apa.csl", "elsevier-vancouver.csl", "american-chemical-society.csl"];
const LOCALE_FILES = ["locales-en-US.xml", "locales-zh-CN.xml"];

function decodeXml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, number) => String.fromCodePoint(parseInt(number, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function textOf(xml, name) {
  const match = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) : "";
}

function attributeOf(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeXml(match[2]) : "";
}

function parseStyle(fileName, dependent) {
  const relativePath = dependent ? path.posix.join("dependent", fileName) : fileName;
  const xml = fs.readFileSync(path.join(stylesRoot, relativePath), "utf8");
  const info = xml.match(/<info\b[^>]*>([\s\S]*?)<\/info>/i)?.[1] || "";
  const links = [...info.matchAll(/<link\b[^>]*\/?\s*>/gi)];
  const parent = links.find((match) => attributeOf(match[0], "rel") === "independent-parent");
  const categories = [...info.matchAll(/<category\b[^>]*\/?\s*>/gi)]
    .flatMap((match) => [attributeOf(match[0], "citation-format"), attributeOf(match[0], "field")])
    .filter(Boolean);
  const issns = [...info.matchAll(/<issn\b[^>]*>([\s\S]*?)<\/issn>/gi)]
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean);
  const id = textOf(info, "id");
  return {
    id,
    title: textOf(info, "title"),
    shortTitle: textOf(info, "title-short"),
    fileName,
    path: relativePath,
    dependent,
    parentId: parent ? attributeOf(parent[0], "href") : "",
    updated: textOf(info, "updated"),
    categories: [...new Set(categories)],
    issns: [...new Set(issns)]
  };
}

const entries = [];
for (const dependent of [false, true]) {
  const directory = dependent ? path.join(stylesRoot, "dependent") : stylesRoot;
  for (const fileName of fs.readdirSync(directory).filter((name) => name.endsWith(".csl")).sort()) {
    const entry = parseStyle(fileName, dependent);
    if (entry.id && entry.title) entries.push(entry);
  }
}

fs.mkdirSync(path.join(outputRoot, "styles"), { recursive: true });
fs.mkdirSync(path.join(outputRoot, "locales"), { recursive: true });
fs.writeFileSync(path.join(outputRoot, "csl-style-index.json"), `${JSON.stringify({
  version: 1,
  cslVersion: "1.0.2",
  source: "https://github.com/citation-style-language/styles/tree/v1.0.2",
  generatedAt: new Date().toISOString(),
  entries
})}\n`);

for (const fileName of STYLE_FILES) {
  fs.copyFileSync(path.join(stylesRoot, fileName), path.join(outputRoot, "styles", fileName));
}
for (const fileName of LOCALE_FILES) {
  fs.copyFileSync(path.join(localesRoot, fileName), path.join(outputRoot, "locales", fileName));
}

process.stdout.write(`Generated ${entries.length} CSL index entries, ${STYLE_FILES.length} built-in styles and ${LOCALE_FILES.length} locales.\n`);
