import { app, shell } from "electron";
import { createWriteStream } from "node:fs";
import { rename } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
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

export interface UpdateDownloadProgress {
  receivedBytes: number;
  /** 0 when the server didn't send a Content-Length — UpdateBanner.tsx falls
   *  back to showing bytes-received-so-far instead of a percentage then. */
  totalBytes: number;
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
export async function downloadAndInstallUpdate(
  downloadUrl: string,
  onProgress?: (progress: UpdateDownloadProgress) => void,
): Promise<void> {
  const resp = await fetch(downloadUrl);
  if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
  if (!resp.body) throw new Error("empty response body");
  const totalBytes = Number(resp.headers.get("content-length") ?? 0) || 0;

  const runningAppImage = process.platform === "linux" ? process.env.APPIMAGE : undefined;
  // Write alongside the eventual target rather than to os.tmpdir(), which
  // may be a different filesystem — rename() across filesystems isn't
  // atomic and can fail. Mode 0o755 makes it executable directly; a fresh
  // download otherwise has no exec bit set at all (matters on Linux; a
  // harmless no-op on Windows).
  const targetPath = runningAppImage
    ? `${runningAppImage}.update-tmp`
    : path.join(app.getPath("temp"), path.basename(new URL(downloadUrl).pathname) || "icosahedron-update");

  let receivedBytes = 0;
  // web ReadableStream -> Node stream so it can pipe into a file write
  // stream while still letting us count bytes as they arrive for progress.
  const nodeStream = Readable.fromWeb(resp.body as import("node:stream/web").ReadableStream<Uint8Array>);
  nodeStream.on("data", (chunk: Buffer) => {
    receivedBytes += chunk.length;
    onProgress?.({ receivedBytes, totalBytes });
  });
  await pipeline(nodeStream, createWriteStream(targetPath, { mode: 0o755 }));

  // shell.openPath (not child_process.execFile) — Electron/Chromium puts
  // itself in a Windows Job Object that kills *all* child processes when
  // the parent exits, and Node's `detached: true` isn't enough to escape
  // that on Windows (it only detaches the console, not the job). The
  // installer was getting killed by app.quit() below before it could fully
  // start. shell.openPath launches the file the same way double-clicking
  // it in Explorer would (via the OS shell), which sits entirely outside
  // Electron's process tree and survives the app quitting.
  // shell.openPath resolves to an error message string on failure (not a
  // throw) — surface it as a real rejection so the renderer's error state
  // reflects a launch failure instead of quietly "succeeding".
  let openError: string;
  if (runningAppImage) {
    // AppImage has no separate install step — the file *is* the app, and
    // whatever desktop shortcut/launcher the user has points at a fixed
    // path. Replace it in place so that shortcut picks up the new version
    // too, not just this one relaunch.
    await rename(targetPath, runningAppImage);
    openError = await shell.openPath(runningAppImage);
  } else {
    // Windows: hand off to the installer, which does the actual "replace
    // the app" work itself — NSIS is configured as an assisted wizard (not
    // one-click, see package.json's build.nsis), so the user still walks
    // through the normal install steps from here.
    openError = await shell.openPath(targetPath);
  }
  if (openError) throw new Error(`Failed to launch installer: ${openError}`);
  app.quit();
}
