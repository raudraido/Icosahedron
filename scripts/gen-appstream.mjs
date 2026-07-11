#!/usr/bin/env node
// Generates the AppStream metainfo.xml embedded in the .deb via build.deb.fpm
// (package.json) — electron-builder's deb target has no built-in AppStream
// support, and without one, GNOME-Software-family app stores (Pop!_Shop,
// GNOME Software, etc.) show "Unknown publisher", "License: unknown", and
// "Last updated: Unknown" for the installed package: none of that comes from
// dpkg control fields (which we do set via build.linux.maintainer) — those
// stores only read it from a /usr/share/metainfo/*.metainfo.xml file. Run at
// build time (see the `dist` script) rather than checked in, so the release
// date always matches when the package actually gets built.
//
// Installing this file alone isn't enough, though — Debian/Ubuntu only
// re-scans /usr/share/metainfo into the AppStream cache app stores actually
// read from on `apt update` (see /etc/apt/apt.conf.d/50appstream), which a
// locally-installed .deb like ours never triggers. scripts/deb-after-install
// .tpl (wired up via build.deb.afterInstall) runs `appstreamcli refresh`
// itself so the store picks this up right after install instead.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pkg from "../package.json" with { type: "json" };

function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build", "linux");
mkdirSync(outDir, { recursive: true });

const date = new Date().toISOString().slice(0, 10);
const appId = pkg.build.appId;
const name = pkg.build.productName;

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>
  <name>${escapeXml(name)}</name>
  <summary>Desktop client for Subsonic and Navidrome music servers</summary>
  <description>
    <p>${escapeXml(pkg.description)}</p>
  </description>
  <metadata_license>MIT</metadata_license>
  <project_license>${escapeXml(pkg.license)}</project_license>
  <developer id="cloud.raud">
    <name>raudraido</name>
  </developer>
  <url type="homepage">https://github.com/raudraido/Icosahedron</url>
  <launchable type="desktop-id">${name}.desktop</launchable>
  <content_rating type="oars-1.1"/>
  <releases>
    <release version="${pkg.version}" date="${date}"/>
  </releases>
</component>
`;

writeFileSync(path.join(outDir, `${appId}.metainfo.xml`), xml);
