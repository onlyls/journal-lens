#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "node_modules", "citeproc");
const destination = path.join(root, "extension", "vendor", "citeproc");

fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(path.join(source, "citeproc_commonjs.js"), path.join(destination, "citeproc.js"));
fs.copyFileSync(path.join(source, "LICENSE"), path.join(destination, "LICENSE"));
process.stdout.write("Vendored citeproc-js 2.4.63.\n");
