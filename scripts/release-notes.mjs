#!/usr/bin/env node
// Prints the "## X.Y.Z" section of a changelog (without the heading): the text of a GitHub Release.
//   node scripts/release-notes.mjs apps/ios/CHANGELOG.md 0.1.0 > release-notes.md
import { readFileSync } from "node:fs";

const [file, version] = process.argv.slice(2);
if (!file || !version) {
  console.error("usage: node scripts/release-notes.mjs <changelog.md> <version | X.Y.Z-beta.N>");
  process.exit(1);
}
const lines = readFileSync(file, "utf8").split("\n");
// A beta (X.Y.Z-beta.N) is cut before the changelog is numbered: its text is the "## X.Y.Z" section if
// there is one, otherwise "## Unreleased".
const base = version.replace(/-beta\.\d+$/, "");
const isBeta = base !== version;
let start = lines.findIndex((l) => l.trim() === `## ${base}`);
if (start < 0 && isBeta) start = lines.findIndex((l) => l.trim() === "## Unreleased");
if (start < 0) {
  console.error(`no "## ${base}"${isBeta ? ' or "## Unreleased"' : ""} section in ${file}`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
if (end < 0) end = lines.length;
process.stdout.write(lines.slice(start + 1, end).join("\n").trim() + "\n");
