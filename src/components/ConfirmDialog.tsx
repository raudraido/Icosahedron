import { createPortal } from "react-dom";
import { PLAY_ICON_DARK } from "../lib/theme";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel = "Confirm", danger = false, onConfirm, onCancel }: Props) {
  // Portaled to <body> — some callers (e.g. Settings' Log Out button) live
  // inside a `will-change: transform` scroll container (.scroll-clean),
  // which establishes its own containing block for `position: fixed`
  // descendants. Left un-portaled, the dimmed backdrop below would only
  // cover that scrollable pane instead of the whole window.
  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "color-mix(in srgb, black 40%, transparent)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 10,
          padding: 20, width: 320, boxShadow: "0 12px 32px color-mix(in srgb, black 30%, transparent)",
        }}
      >
        <h3 style={{ color: "var(--text-primary)", fontSize: "var(--fs-heading)", fontWeight: 700, marginBottom: 8 }}>{title}</h3>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", lineHeight: 1.5 }}>{message}</p>
        <div className="flex justify-end" style={{ gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
              background: "var(--hover-bg)", color: "var(--text-primary)", fontSize: "var(--fs-secondary)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
              background: danger ? "#E53935" : "var(--accent)", color: danger ? "#ffffff" : PLAY_ICON_DARK,
              fontSize: "var(--fs-secondary)", fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
