import { useState } from "react";
import { useStore } from "../store";
import { api } from "../lib/api";
import { PLAY_ICON_DARK } from "../lib/theme";

// Options dialog behind every "Share" action (context menus + album header
// button): pick how long the link lives and whether visitors may download,
// then the share is created and its public URL copied to the clipboard.
// Mounted once in App.tsx, driven by the store's shareTarget.

const DURATIONS: { label: string; days: number | null }[] = [
  { label: "1 day", days: 1 },
  { label: "1 week", days: 7 },
  { label: "1 month", days: 30 },
  { label: "1 year", days: 365 },
  { label: "Forever", days: null },
];

export function ShareDialog() {
  const target = useStore((s) => s.shareTarget);
  const close = useStore((s) => s.closeShareDialog);
  const [expiresDays, setExpiresDays] = useState<number | null>(7);
  const [downloadable, setDownloadable] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">("idle");

  if (!target) return null;

  async function handleCreate() {
    if (!target || state === "busy") return;
    setState("busy");
    try {
      const url = await api.createShare(target.id, target.type, expiresDays, downloadable);
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => { close(); setState("idle"); }, 900);
    } catch {
      setState("error");
    }
  }

  function handleClose() {
    close();
    setState("idle");
  }

  return (
    <div
      onClick={handleClose}
      onKeyDown={(e) => { if (e.key === "Escape") handleClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
        background: "color-mix(in srgb, var(--left-panel-bg) 55%, transparent)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 20, width: 340, boxShadow: "0 12px 32px color-mix(in srgb, black 30%, transparent)" }}
      >
        <h3 style={{ color: "var(--text-primary)", fontSize: "var(--fs-heading)", fontWeight: "var(--fw-emphasis)", marginBottom: 2 }}>Share</h3>
        <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", marginBottom: 14 }}>{target.name}</p>

        <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)", marginBottom: 6 }}>Link expires in</p>
        <div className="flex" style={{ gap: 6, flexWrap: "wrap" }}>
          {DURATIONS.map((d) => (
            <button
              key={d.label}
              onClick={() => setExpiresDays(d.days)}
              style={{
                padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: "var(--fs-secondary)",
                border: "1px solid " + (expiresDays === d.days ? "var(--accent)" : "var(--border)"),
                background: expiresDays === d.days ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent",
                color: expiresDays === d.days ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {d.label}
            </button>
          ))}
        </div>

        <label className="flex items-center" style={{ gap: 8, marginTop: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={downloadable} onChange={(e) => setDownloadable(e.target.checked)} />
          <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>Allow downloads</span>
        </label>

        {state === "error" && (
          <p style={{ color: "#E53935", fontSize: "var(--fs-secondary)", marginTop: 10 }}>
            Could not create share — is sharing enabled on the server?
          </p>
        )}

        <div className="flex justify-end" style={{ gap: 8, marginTop: 16 }}>
          <button onClick={handleClose} style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", background: "var(--hover-bg)", color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>Cancel</button>
          <button
            onClick={handleCreate}
            disabled={state === "busy"}
            style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: state === "busy" ? "default" : "pointer", background: "var(--accent)", color: PLAY_ICON_DARK, fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)", opacity: state === "busy" ? 0.6 : 1 }}
          >
            {state === "copied" ? "Link copied!" : state === "busy" ? "Creating…" : "Create & Copy Link"}
          </button>
        </div>
      </div>
    </div>
  );
}
