import { app } from "electron";
import { execFile } from "node:child_process";
import { writeFile, rename } from "node:fs/promises";
import path from "node:path";

// Lightweight "a new version is out" check — not a full electron-updater
// integration (that needs code-signing for the download to not get flagged
// harder by Windows than a manual install already is, which this project's
// release pipeline doesn't have set up). Instead: check GitHub Releases for
// something newer than the running build, and if the user opts in, download
// that platform's installer and hand off to it directly — same "download,
// double-click, done" installer UX as doing it manually, just automated up
// to the point the installer itself takes over.
const REPO = "raudraido/Icosahedron";

export interface UpdateInfo {
  version: string;
  downloadUrl: string;
  releaseUrl: string;
}

function parseVersion(v: string): number[] {
  return v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
}

// Bare numeric compare (1.2.3 vs 1.10.0) — not full semver (no
// prerelease/build-metadata handling), which is fine since this repo's own
// tags are always plain `vMAJOR.MINOR.PATCH`.
function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Matches build.yml's two release artifacts (dist/*.exe, dist/*.AppImage) —
// no asset means no supported update path on this platform (e.g. macOS,
// which this project doesn't build for at all).
function assetSuffixForPlatform(): string | null {
  if (process.platform === "win32") return ".exe";
  if (process.platform === "linux") return ".AppImage";
  return null;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const suffix = assetSuffixForPlatform();
  if (!suffix) return null;
  try {
    const resp = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "User-Agent": "Icosahedron-App", Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const tag: string = data.tag_name ?? "";
    if (!tag || !isNewer(tag, app.getVersion())) return null;
    const asset = (data.assets ?? []).find(
      (a: unknown): a is { name: string; browser_download_url: string } =>
        !!a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string" &&
        (a as { name: string }).name.endsWith(suffix),
    );
    if (!asset) return null;
    return { version: tag.replace(/^v/, ""), downloadUrl: asset.browser_download_url, releaseUrl: data.html_url ?? "" };
  } catch {
    return null; // best-effort — no update notice beats a boot-time crash over a flaky network
  }
}

// Downloads the installer to the OS temp dir, launches it, then quits this
// app so the installer can replace the running files (an installer can't
// overwrite files the app currently has open). NSIS is configured as an
// assisted wizard (not one-click, see package.json's build.nsis), so the
// user still walks through the normal install steps — this just gets them
// to that point without manually finding and opening the download.
//
// AppImage has no separate install step — the file *is* the app, and
// whatever desktop shortcut/launcher the user has points at a fixed path
// (exposed at runtime as $APPIMAGE). So unlike the Windows installer,
// downloading to a temp dir and running it there wouldn't update anything
// permanent: the shortcut would still point at the old file next launch,
// leaving the new one orphaned in temp. Instead, replace the AppImage in
// place (same directory, atomic rename) before relaunching.
export async function downloadAndInstallUpdate(downloadUrl: string): Promise<void> {
  const resp = await fetch(downloadUrl);
  if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());

  const runningAppImage = process.platform === "linux" ? process.env.APPIMAGE : undefined;
  if (runningAppImage) {
    // Write alongside the target (not to os.tmpdir(), which may be a
    // different filesystem — rename() across filesystems isn't atomic and
    // can fail) then rename over it. Mode 0o755 makes it executable
    // directly; a fresh download otherwise has no exec bit set at all.
    const tmp = `${runningAppImage}.update-tmp`;
    await writeFile(tmp, buf, { mode: 0o755 });
    await rename(tmp, runningAppImage);
    execFile(runningAppImage, [], { detached: true, stdio: "ignore" }).unref();
    app.quit();
    return;
  }

  // Windows (and any other case without a known running-AppImage path):
  // download to temp and hand off to the installer, which does the actual
  // "replace the app" work itself.
  const filename = path.basename(new URL(downloadUrl).pathname) || "icosahedron-update";
  const dest = path.join(app.getPath("temp"), filename);
  await writeFile(dest, buf, { mode: 0o755 });
  execFile(dest, [], { detached: true, stdio: "ignore" }).unref();
  app.quit();
}
