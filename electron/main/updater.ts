import { app, shell } from "electron";
import { createWriteStream } from "node:fs";
import { rename } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
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

// Matches build.yml's three release artifacts (dist/*.exe, dist/*.AppImage,
// dist/*.deb) — no asset means no supported update path on this platform
// (e.g. macOS, which this project doesn't build for at all). Linux ships two
// package formats, so pick the one matching how this instance is actually
// running rather than assuming — $APPIMAGE is only set by the AppImage
// runtime, so its absence on Linux means a .deb install.
function assetSuffixForPlatform(): string | null {
  if (process.platform === "win32") return ".exe";
  if (process.platform === "linux") return process.env.APPIMAGE ? ".AppImage" : ".deb";
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
// .deb used to just hand the download off to whatever the desktop
// associates with .deb files (GNOME Software, App Center, gdebi, ...), on
// the theory that installer/auth UX wasn't this code's business. In
// practice that was a dead end on at least one real desktop (Pop!_OS App
// Center): opening a downloaded .deb that matches an already-installed
// package's id just shows an inert "Installed" label with no button to
// press at all — no way to actually trigger the update from there. `apt
// install <path>` (via pkexec for the auth prompt) installs it directly
// instead, sidestepping whatever a given desktop's package-viewer chooses
// to do with a local file.
//
// AppImage has no separate install step — the file *is* the app, and
// whatever desktop shortcut/launcher the user has points at a fixed path
// (exposed at runtime as $APPIMAGE). So unlike the installer/package cases
// above, downloading to a temp dir and running it there wouldn't update
// anything permanent: the shortcut would still point at the old file next
// launch, leaving the new one orphaned in temp. Instead, replace the
// AppImage in place (same directory, atomic rename) before relaunching.
export async function downloadAndInstallUpdate(
  downloadUrl: string,
  onProgress?: (progress: UpdateDownloadProgress) => void,
  onLaunching?: () => void,
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

  // This process is still alive at this point (it doesn't quit until after
  // the handoff below), and it's holding the single-instance lock (see
  // index.ts's requestSingleInstanceLock). The relaunched AppImage below is
  // a second copy of this same app starting up while that lock is still
  // held — it would lose the lock race, quit itself immediately, and by the
  // time this process's own delayed app.quit() runs a moment later, nothing
  // would be left running at all. Release the lock first so the new process
  // can actually acquire it.
  app.releaseSingleInstanceLock();

  let openError: string;
  if (runningAppImage) {
    // AppImage has no separate install step — the file *is* the app, and
    // whatever desktop shortcut/launcher the user has points at a fixed
    // path. Replace it in place so that shortcut picks up the new version
    // too, not just this one relaunch.
    await rename(targetPath, runningAppImage);
    // NOT shell.openPath here, unlike the Windows/.deb branches below —
    // that launches a file via the desktop's file-*association* mechanism
    // (effectively xdg-open on Linux), which is right for "open this
    // installer with its default app" but wrong for an AppImage: there's
    // usually no "run" association wired up for an arbitrary executable
    // (most file managers deliberately don't do that, for the obvious
    // security reason), so this was failing immediately after a fully
    // successful download — surfacing as a misleading "download failed"
    // when the download itself was fine. AppImages are meant to be
    // executed directly. The Windows Job Object problem shell.openPath was
    // introduced to dodge doesn't apply on Linux, so plain
    // child_process.spawn with `detached: true` + `.unref()` is enough to
    // outlive this process quitting.
    openError = await new Promise<string>((resolve) => {
      const child = spawn(runningAppImage, [], { detached: true, stdio: "ignore" });
      child.once("error", (e) => resolve(e.message));
      child.once("spawn", () => { child.unref(); resolve(""); });
    });
  } else if (process.platform === "linux") {
    // .deb — install directly via `apt install <path>` (not `apt-get`,
    // which doesn't accept local file paths, only repo package names),
    // through pkexec for the native polkit auth prompt. `-y` is required
    // since pkexec runs it with no attached terminal to answer apt's own
    // "Do you want to continue? [Y/n]" — there's nothing to answer it.
    // Absolute path to apt (not just "apt") since pkexec sanitizes the
    // environment it hands to the executed command, including PATH.
    onLaunching?.();
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn("pkexec", ["/usr/bin/apt", "install", "-y", targetPath], { stdio: "ignore" });
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    }).catch((e: Error) => { throw new Error(`Failed to start installer: ${e.message}`); });
    if (exitCode !== 0) {
      // pkexec's own exit codes: 126 = the auth dialog was dismissed/denied,
      // 127 = the target command couldn't be found/executed. Anything else
      // is apt's own exit code, meaning the auth prompt was accepted but
      // the install itself failed (e.g. unmet dependencies, disk full).
      const reason = exitCode === 126 ? "Installation was cancelled" : `apt install failed (exit code ${exitCode})`;
      throw new Error(reason);
    }
    // Install actually completed (unlike the fire-and-forget AppImage/
    // Windows branches, this awaited the whole thing) — safe to relaunch
    // the freshly-installed binary now, same detached-spawn technique as
    // the AppImage branch above.
    openError = await new Promise<string>((resolve) => {
      const child = spawn("icosahedron", [], { detached: true, stdio: "ignore" });
      child.once("error", (e) => resolve(e.message));
      child.once("spawn", () => { child.unref(); resolve(""); });
    });
  } else {
    // Windows: hand off to the installer via the desktop's default file
    // association (same as double-clicking the download in a file
    // manager) — shell.openPath (not child_process.execFile) because
    // Electron/Chromium puts itself in a Windows Job Object that kills
    // *all* child processes when the parent exits, and Node's
    // `detached: true` isn't enough to escape that (it only detaches the
    // console, not the job); the installer was getting killed by
    // app.quit() below before it could fully start. shell.openPath
    // launches the file the same way double-clicking it in Explorer
    // would, which sits entirely outside Electron's process tree and
    // survives the app quitting. NSIS is an assisted wizard (not
    // one-click, see package.json's build.nsis), so the user still walks
    // through the normal install steps from here. shell.openPath resolves
    // to an error message string on failure (not a throw) — surface it as
    // a real rejection so the renderer's error state reflects a launch
    // failure instead of quietly "succeeding".
    openError = await shell.openPath(targetPath);
  }
  if (openError) throw new Error(`Failed to launch installer: ${openError}`);

  // The installer window itself doesn't appear immediately — NSIS
  // self-extracts its embedded (100+MB) payload with no progress UI of its
  // own before showing the wizard, which can take tens of seconds. Quitting
  // this app instantly right after the handoff made that gap look like the
  // installer had failed to launch at all. Tell the renderer so it can show
  // a "still launching" message, and give it a moment to actually render
  // that before tearing the window down.
  onLaunching?.();
  await new Promise((resolve) => setTimeout(resolve, 2000));
  app.quit();
}
