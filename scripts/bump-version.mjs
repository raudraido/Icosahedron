#!/usr/bin/env node
// Each product has its own version (see docs/releasing.md):
//   node scripts/bump-version.mjs <desktop|server|ios|android> X.Y.Z
// desktop  -> root package.json and lock file         tag vX.Y.Z          changelog CHANGELOG.md
// server   -> apps/server package.json and lock file  tag server-vX.Y.Z   changelog apps/server/CHANGELOG.md
//             (the engine and the web app it serves are one product)
// ios      -> apps/ios/VERSION                         tag ios-vX.Y.Z      changelog apps/ios/CHANGELOG.md
// android  -> apps/android-tv/VERSION                  tag android-vX.Y.Z  changelog apps/android-tv/CHANGELOG.md
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PRODUCTS = {
  desktop: { json: ["package.json", "package-lock.json"], tag: (v) => `v${v}`, changelog: "CHANGELOG.md" },
  server: { json: ["apps/server/package.json", "apps/server/package-lock.json"], tag: (v) => `server-v${v}`, changelog: "apps/server/CHANGELOG.md" },
  ios: { file: "apps/ios/VERSION", tag: (v) => `ios-v${v}`, changelog: "apps/ios/CHANGELOG.md" },
  android: { file: "apps/android-tv/VERSION", tag: (v) => `android-v${v}`, changelog: "apps/android-tv/CHANGELOG.md" },
};

const [product, version] = process.argv.slice(2);
const p = PRODUCTS[product];
if (!p || !/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage: node scripts/bump-version.mjs <desktop|server|ios|android> X.Y.Z");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

console.log(`\n${product} is now ${version}. Next: add "## ${version}" to ${p.changelog}, merge, then`);
console.log(`  git tag ${p.tag(version)} && git push origin ${p.tag(version)}`);
