import { useEffect, useRef, useState } from "react";
import { api, UpdateInfo, UpdateDownloadProgress } from "../lib/api";

// Lightweight "a new version is out" notice — checks once per app launch
// (electron/main/updater.ts's checkForUpdate) and, if the user opts in,
// downloads that platform's installer and hands off to it (the main process
// quits the app right after launching it, since an installer can't replace
// files this app currently has open).
const LS_DISMISSED_KEY = "icosahedron_update_dismissed_version";

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [state, setState] = useState<"idle" | "downloading" | "launching" | "error">("idle");
  const [progress, setProgress] = useState<UpdateDownloadProgress | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const unsubLaunchingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    api.checkForUpdate().then((result) => {
      if (!result) return;
      const dismissed = localStorage.getItem(LS_DISMISSED_KEY);
      if (dismissed === result.version) return;
      setInfo(result);
    }).catch(() => { /* best-effort — no update notice beats a boot-time error */ });
    return () => unsubRef.current?.();
  }, []);

  if (!info) return null;

  function dismiss() {
    localStorage.setItem(LS_DISMISSED_KEY, info!.version);
    setInfo(null);
  }

  async function installNow() {
    setState("downloading");
    setProgress(null);
    unsubRef.current = window.electronAPI.onUpdateDownloadProgress((p) => setProgress(p as UpdateDownloadProgress));
    unsubLaunchingRef.current = window.electronAPI.onUpdateInstallerLaunching(() => setState("launching"));
    try {
      await api.downloadAndInstallUpdate(info!.downloadUrl);
      // The main process quits the app a couple seconds after this resolves
      // (or the app has already exited by the time we'd render again) —
      // nothing further to do here on success.
    } catch {
      setState("error");
    } finally {
      unsubRef.current?.();
      unsubRef.current = null;
      unsubLaunchingRef.current?.();
      unsubLaunchingRef.current = null;
    }
  }

  const pct = progress && progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
    : null;

  return (
    <div
      className="flex flex-col"
      style={{
        position: "fixed", left: "50%", bottom: 96, transform: "translateX(-50%)", zIndex: 1500,
        gap: 8, padding: "10px 16px", borderRadius: 8, minWidth: 280,
        background: "var(--left-panel-bg)", border: "1px solid var(--border)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div className="flex items-center" style={{ gap: 12 }}>
        <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", flex: 1 }}>
          {state === "downloading"
            ? progress
              ? pct !== null
                ? `Downloading update… ${pct}%`
                : `Downloading update… ${formatBytes(progress.receivedBytes)}`
              : "Downloading update…"
            : state === "launching"
              // The installer window can take a while to appear — it's
              // self-extracting its payload with no progress UI of its own
              // before then. Say so explicitly instead of the app just
              // vanishing, which reads as a failed launch.
              ? "Installer launching — this app will close now; the setup window may take a moment to appear."
              : state === "error"
                ? "Download failed — try again later."
                : `Version ${info.version} is available.`}
        </span>
        {state !== "downloading" && state !== "launching" && (
          <div className="flex items-center" style={{ gap: 8 }}>
            <button
              onClick={installNow}
              style={{
                padding: "5px 12px", borderRadius: 5, border: "none", cursor: "pointer",
                background: "var(--accent)", color: "#111", fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)",
              }}
            >
              Download &amp; Install
            </button>
            <button
              onClick={dismiss}
              style={{
                padding: "5px 12px", borderRadius: 5, border: "1px solid var(--border)", cursor: "pointer",
                background: "transparent", color: "var(--text-secondary)", fontSize: "var(--fs-secondary)",
              }}
            >
              Later
            </button>
          </div>
        )}
      </div>
      {state === "downloading" && (
        <div style={{ height: 4, borderRadius: 2, background: "var(--hover-bg)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: pct !== null ? `${pct}%` : "35%",
              background: "var(--accent)",
              borderRadius: 2,
              transition: "width 200ms",
              // No known total size (server didn't send Content-Length) —
              // an indeterminate sweep reads better than a bar frozen at a
              // guessed width.
              animation: pct === null ? "update-progress-sweep 1.2s ease-in-out infinite" : undefined,
            }}
          />
        </div>
      )}
      <style>{`
        @keyframes update-progress-sweep {
          0%   { margin-left: 0%; width: 25%; }
          50%  { margin-left: 75%; width: 25%; }
          100% { margin-left: 0%; width: 25%; }
        }
      `}</style>
    </div>
  );
}
