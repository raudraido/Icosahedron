#!/usr/bin/env node
// Each product has its own version (see docs/releasing.md):
//   node scripts/bump-version.mjs <desktop|server|ios|android|android-phone> <X.Y.Z|patch|minor|major>
// Normally run by the Release workflow (.github/workflows/release.yml); also renames "## Unreleased" in the changelog.
// desktop  -> root package.json and lock file         tag vX.Y.Z          changelog CHANGELOG.md
// server   -> apps/server package.json and lock file  tag server-vX.Y.Z   changelog apps/server/CHANGELOG.md
//             (the engine and the web app it serves are one product)
// ios      -> apps/ios/VERSION                         tag ios-vX.Y.Z      changelog apps/ios/CHANGELOG.md
// android  -> apps/android-tv/VERSION                  tag android-vX.Y.Z  changelog apps/android-tv/CHANGELOG.md
// android-phone -> apps/android/VERSION            tag android-phone-vX.Y.Z  changelog apps/android/CHANGELOG.md
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PRODUCTS = {
  desktop: { json: ["package.json", "package-lock.json"], tag: (v) => `v${v}`, changelog: "CHANGELOG.md" },
  server: { json: ["apps/server/package.json", "apps/server/package-lock.json"], tag: (v) => `server-v${v}`, changelog: "apps/server/CHANGELOG.md" },
  ios: { file: "apps/ios/VERSION", tag: (v) => `ios-v${v}`, changelog: "apps/ios/CHANGELOG.md" },
  android: { file: "apps/android-tv/VERSION", tag: (v) => `android-v${v}`, changelog: "apps/android-tv/CHANGELOG.md" },
  "android-phone": { file: "apps/android/VERSION", tag: (v) => `android-phone-v${v}`, changelog: "apps/android/CHANGELOG.md" },
};

const [product, requested] = process.argv.slice(2);
const p = PRODUCTS[product];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEYWORDS = ["patch", "minor", "major"];
if (!p || !(/^\d+\.\d+\.\d+$/.test(requested ?? "") || KEYWORDS.includes(requested))) {
  console.error("usage: node scripts/bump-version.mjs <desktop|server|ios|android|android-phone> <X.Y.Z|patch|minor|major>");
  process.exit(1);
}

const current = p.file
  ? readFileSync(path.join(root, p.file), "utf8").trim()
  : JSON.parse(readFileSync(path.join(root, p.json[0]), "utf8")).version;
let version = requested;
if (KEYWORDS.includes(requested)) {
  const [a, b, c] = current.split(".").map(Number);
  version = requested === "major" ? `${a + 1}.0.0` : requested === "minor" ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}

for (const file of p.json ?? []) {
  const full = path.join(root, file);
  const data = JSON.parse(readFileSync(full, "utf8"));
  data.version = version;
  if (data.packages?.[""]) data.packages[""].version = version;
  writeFileSync(full, JSON.stringify(data, null, 2) + "\n");
  console.log(`updated ${file}`);
}
if (p.file) {
  writeFileSync(path.join(root, p.file), version + "\n");
  console.log(`updated ${p.file}`);
}

// Changes are written under "## Unreleased" while a PR is open; releasing gives that section its number.
const changelog = path.join(root, p.changelog);
let renamed = false;
if (existsSync(changelog)) {
  const text = readFileSync(changelog, "utf8");
  if (/^## Unreleased\s*$/m.test(text)) {
    writeFileSync(changelog, text.replace(/^## Unreleased\s*$/m, `## ${version}`));
    renamed = true;
    console.log(`${p.changelog}: "Unreleased" is now "${version}"`);
  }
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${p.tag(version)}\nchangelog=${p.changelog}\nhas_notes=${renamed}\n`);
}
console.log(`\n${product}: ${current} -> ${version}.` + (renamed ? "" : ` Add "## ${version}" to ${p.changelog} by hand (there was no "Unreleased" section).`));
console.log(`Tag: ${p.tag(version)} (the Release workflow does all of this; see docs/releasing.md)`);
