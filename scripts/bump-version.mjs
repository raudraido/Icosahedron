#!/usr/bin/env node
// Sets one version for every part of the project (desktop, web engine, web app, iOS app):
//   node scripts/bump-version.mjs 0.15.4
// Updates the root and apps/server package.json + lock files. The iOS app reads the root
// version at build time (.github/workflows/ios.yml). Remember CHANGELOG.md, then tag `vX.Y.Z`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage: node scripts/bump-version.mjs X.Y.Z");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function edit(file, fn) {
  const p = path.join(root, file);
  const data = JSON.parse(readFileSync(p, "utf8"));
  fn(data);
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
  console.log(`updated ${file}`);
}

for (const dir of [".", "apps/server"]) {
  edit(path.join(dir, "package.json"), (d) => { d.version = version; });
  edit(path.join(dir, "package-lock.json"), (d) => {
    d.version = version;
    if (d.packages?.[""]) d.packages[""].version = version;
  });
}
console.log(`\nVersion is now ${version}. Next: add "## ${version}" to CHANGELOG.md, merge, then git tag v${version}.`);
