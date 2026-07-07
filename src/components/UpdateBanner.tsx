import { useEffect, useState } from "react";
import { api, UpdateInfo } from "../lib/api";

// Lightweight "a new version is out" notice — checks once per app launch
// (electron/main/updater.ts's checkForUpdate) and, if the user opts in,
// downloads that platform's installer and hands off to it (the main process
// quits the app right after launching it, since an installer can't replace
// files this app currently has open).
const LS_DISMISSED_KEY = "icosahedron_update_dismissed_version";

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [state, setState] = useState<"idle" | "downloading" | "error">("idle");

  useEffect(() => {
    api.checkForUpdate().then((result) => {
      if (!result) return;
      const dismissed = localStorage.getItem(LS_DISMISSED_KEY);
      if (dismissed === result.version) return;
      setInfo(result);
    }).catch(() => { /* best-effort — no update notice beats a boot-time error */ });
  }, []);

  if (!info) return null;

  function dismiss() {
    localStorage.setItem(LS_DISMISSED_KEY, info!.version);
    setInfo(null);
  }

  async function installNow() {
    setState("downloading");
    try {
      await api.downloadAndInstallUpdate(info!.downloadUrl);
      // The main process quits the app right after this resolves (or the
      // app has already exited by the time we'd render again) — nothing
      // further to do here on success.
    } catch {
      setState("error");
    }
  }

  return (
    <div
      className="flex items-center"
      style={{
        position: "fixed", left: "50%", bottom: 96, transform: "translateX(-50%)", zIndex: 1500,
        gap: 12, padding: "10px 16px", borderRadius: 8,
        background: "var(--panel-bg)", border: "1px solid var(--border)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>
        {state === "downloading"
          ? "Downloading update…"
          : state === "error"
            ? "Download failed — try again later."
            : `Version ${info.version} is available.`}
      </span>
      {state !== "downloading" && (
        <div className="flex items-center" style={{ gap: 8 }}>
          <button
            onClick={installNow}
            style={{
              padding: "5px 12px", borderRadius: 5, border: "none", cursor: "pointer",
              background: "var(--accent)", color: "#111", fontSize: "var(--fs-secondary)", fontWeight: 700,
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
  );
}
