import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useApprovals, removeApproval, refreshApprovals } from "../lib/approvals";
import { decideApproval } from "../lib/secureSignIn";

// Another device is signing in to this account and asks this one to approve it (secure sign-in,
// docs/secure-sign-in.md). The new device shows a number; three are offered here and the one that
// matches approves. A request nobody recognises is denied.
export function ApprovalPrompt() {
  const items = useApprovals((s) => s.items);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [now, setNow] = useState(Date.now());

  // Ask again when the window comes back (a message may have been missed) and keep the countdown.
  useEffect(() => {
    const onFocus = () => { void refreshApprovals(); };
    window.addEventListener("focus", onFocus);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(t); };
  }, []);
  useEffect(() => { void refreshApprovals(); }, []);
  useEffect(() => {
    for (const a of items) if (a.expiresAt <= now) removeApproval(a.id);
  }, [now, items]);

  const a = items[0];
  if (!a) {
    return note ? createPortal(
      <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", zIndex: 3000, background: "var(--card-bg)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px", fontSize: "var(--fs-secondary)" }}>{note}</div>,
      document.body,
    ) : null;
  }
  const left = Math.max(0, Math.round((a.expiresAt - now) / 1000));
  const when = new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  async function answer(approve: boolean, number?: number) {
    if (busy || !a) return;
    setBusy(true);
    const r = await decideApproval(a.id, approve, number);
    setBusy(false);
    removeApproval(a.id);
    setNote(r === "approved" ? "Signed in." : r === "wrong" ? "That was not the number shown, the request was denied." : r === "denied" ? "Denied." : r === "offline" ? "Could not reach the server." : "That request is no longer open.");
    setTimeout(() => setNote(""), 5000);
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "color-mix(in srgb, black 50%, transparent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "var(--main-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 22, width: 360, boxShadow: "0 12px 32px color-mix(in srgb, black 30%, transparent)" }}>
        <h3 style={{ color: "var(--text-primary)", fontSize: "var(--fs-heading)", fontWeight: "var(--fw-emphasis)", marginBottom: 6 }}>Sign-in attempt</h3>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", lineHeight: 1.5 }}>
          <b style={{ color: "var(--text-primary)" }}>{a.device.name}</b> wants to sign in to your account{a.address ? <> from <b style={{ color: "var(--text-primary)" }}>{a.address}</b></> : null} at {when}.
        </p>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", lineHeight: 1.5, marginTop: 10 }}>
          If that is you, pick the number shown on that device. If you do not know it, deny it.
        </p>
        <div className="flex" style={{ gap: 10, margin: "16px 0 12px", justifyContent: "center" }}>
          {a.choices.map((n) => (
            <button
              key={n} disabled={busy} onClick={() => answer(true, n)}
              style={{ width: 84, height: 56, borderRadius: 8, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-primary)", fontSize: 24, fontWeight: "var(--fw-emphasis)", cursor: "pointer" }}
            >{n}</button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
            {left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left` : ""}{items.length > 1 ? ` · ${items.length - 1} more waiting` : ""}
          </span>
          <button
            disabled={busy} onClick={() => answer(false)}
            style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", background: "#E53935", color: "#ffffff", fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)" }}
          >It was not me</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
