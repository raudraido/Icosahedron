#!/usr/bin/env node
// Each product has its own version (see docs/releasing.md):
//   node scripts/bump-version.mjs <desktop|server|ios|android|android-phone> <X.Y.Z|patch|minor|major> [stable|beta]
// A beta (tag vX.Y.Z-beta.N) puts the coming version X.Y.Z in the version files but leaves the changelog's
// "## Unreleased" alone; the stable release that follows names it. Several betas of one version count N up.
// Normally run by the Release workflow (.github/workflows/release.yml); also renames "## Unreleased" in the changelog.
// desktop  -> root package.json and lock file         tag vX.Y.Z          changelog CHANGELOG.md
// server   -> apps/server package.json and lock file  tag server-vX.Y.Z   changelog apps/server/CHANGELOG.md
//             (the engine and the web app it serves are one product)
// ios      -> apps/ios/VERSION                         tag ios-vX.Y.Z      changelog apps/ios/CHANGELOG.md
// android  -> apps/android-tv/VERSION                  tag android-vX.Y.Z  changelog apps/android-tv/CHANGELOG.md
// android-phone -> apps/android/VERSION            tag android-phone-vX.Y.Z  changelog apps/android/CHANGELOG.md
import { execSync } from "node:child_process";
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

const [product, requested, channel = "stable"] = process.argv.slice(2);
const p = PRODUCTS[product];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEYWORDS = ["patch", "minor", "major"];
if (!p || !(/^\d+\.\d+\.\d+$/.test(requested ?? "") || KEYWORDS.includes(requested)) || !["stable", "beta"].includes(channel)) {
  console.error("usage: node scripts/bump-version.mjs <desktop|server|ios|android|android-phone> <X.Y.Z|patch|minor|major> [stable|beta]");
  process.exit(1);
}

const current = p.file
  ? readFileSync(path.join(root, p.file), "utf8").trim()
  : JSON.parse(readFileSync(path.join(root, p.json[0]), "utf8")).version;
const tags = (pattern) => {
  try {
    return execSync(`git tag -l "${pattern}"`, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
};
// A beta of the version in the files was cut and the stable release is not out yet: that cycle goes on
// (next beta, or the stable release), whatever "patch"/"minor" says.
const pending = tags(`${p.tag(current)}-beta.*`).length > 0 && tags(p.tag(current)).length === 0;
let version = requested;
if (pending && KEYWORDS.includes(requested)) {
  version = current;
} else if (KEYWORDS.includes(requested)) {
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

const beta = channel === "beta";
let full = version;
if (beta) {
  const taken = tags(`${p.tag(version)}-beta.*`).map((t) => Number(t.split("-beta.")[1])).filter(Number.isFinite);
  full = `${version}-beta.${Math.max(0, ...taken) + 1}`;
}

// Changes are written under "## Unreleased" while a PR is open; releasing gives that section its number.
const changelog = path.join(root, p.changelog);
let renamed = false;
if (existsSync(changelog) && beta) {
  // A beta leaves the changelog alone; it only needs something to say.
  renamed = /^## Unreleased\s*$/m.test(readFileSync(changelog, "utf8"));
} else if (existsSync(changelog)) {
  let text = readFileSync(changelog, "utf8");
  // Two PRs can each add an "## Unreleased" heading: join them into the first one, so that nothing is left behind
  // when the first is given its number (the others would stay as a stray section between two releases).
  const lines = text.split("\n");
  const heads = lines.map((l, i) => (/^## Unreleased\s*$/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (heads.length > 1) {
    const bodies = [];
    const kept = [];
    for (let i = 0; i < lines.length; i++) {
      if (heads.includes(i)) {
        let j = i + 1;
        while (j < lines.length && !/^## /.test(lines[j])) j++;
        bodies.push(lines.slice(i + 1, j).join("\n").trim());
        if (i === heads[0]) kept.push("## Unreleased", "", "@@UNRELEASED@@", "");
        i = j - 1;
      } else kept.push(lines[i]);
    }
    text = kept.join("\n").replace("@@UNRELEASED@@", bodies.filter(Boolean).join("\n\n"));
    console.log(`${p.changelog}: joined ${heads.length} "Unreleased" sections`);
  }
  if (/^## Unreleased\s*$/m.test(text)) {
    writeFileSync(changelog, text.replace(/^## Unreleased\s*$/m, `## ${version}`));
    renamed = true;
    console.log(`${p.changelog}: "Unreleased" is now "${version}"`);
  }
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nfull=${full}\nprerelease=${beta}\ntag=${p.tag(full)}\nchangelog=${p.changelog}\nhas_notes=${renamed}\n`);
}
console.log(`\n${product}: ${current} -> ${full}.` + (renamed ? "" : ` Add "## ${version}" to ${p.changelog} by hand (there was no "Unreleased" section).`));
console.log(`Tag: ${p.tag(full)} (the Release workflow does all of this; see docs/releasing.md)`);
