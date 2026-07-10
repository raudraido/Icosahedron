import { useState } from "react";
import { createPortal } from "react-dom";
import { PLAY_ICON_DARK } from "../lib/theme";

interface Props {
  title: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  /** Optional validator — return an error message to block submission and
   *  show it inline, or null/undefined if the trimmed value is fine. */
  validate?: (value: string) => string | null | undefined;
}

export function PromptDialog({ title, placeholder, confirmLabel = "Create", onSubmit, onCancel, validate }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    const err = validate?.(trimmed);
    if (err) { setError(err); return; }
    onSubmit(trimmed);
  }

  // Portaled to <body> — some callers (e.g. Settings' Theme Builder "Save as
  // Preset") live inside a `will-change: transform` scroll container
  // (.scroll-clean), which establishes its own containing block for
  // `position: fixed` descendants. Left un-portaled, the dimmed backdrop
  // below would only cover that scrollable pane instead of the whole window.
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
        <h3 style={{ color: "var(--text-primary)", fontSize: "var(--fs-heading)", fontWeight: "var(--fw-emphasis)", marginBottom: 12 }}>{title}</h3>
        <input
          autoFocus
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
          placeholder={placeholder}
          className="w-full outline-none"
          style={{
            background: "var(--card-bg)", color: "var(--text-primary)", fontSize: "var(--fs-primary)",
            border: `1px solid ${error ? "var(--error)" : "var(--border)"}`, borderRadius: 6, padding: "8px 10px",
          }}
        />
        {error && <p style={{ color: "var(--error)", fontSize: "var(--fs-small)", marginTop: 6 }}>{error}</p>}
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
            onClick={submit}
            disabled={!value.trim()}
            style={{
              padding: "6px 14px", borderRadius: 6, border: "none", cursor: value.trim() ? "pointer" : "default",
              background: "var(--accent)", color: PLAY_ICON_DARK, fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)",
              opacity: value.trim() ? 1 : 0.5,
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
