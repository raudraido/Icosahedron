import { useSettingsSync } from "../lib/settingsSync";
import { useSyncNotice } from "../lib/sync";
import { useAudioBlocked } from "../lib/audioBlocked";
import { useStore } from "../store";

// Shown when another device changed the shared preferences while music is
// playing here: the reload that applies them would cut the music off, so it
// waits for the user.
export function SettingsSyncToast() {
  const pending = useSettingsSync((s) => s.pending);
  const notice = useSyncNotice((s) => s.text);
  const blocked = useAudioBlocked((s) => s.blocked);
  const box = {
    position: "fixed", left: "50%", bottom: 96, transform: "translateX(-50%)", zIndex: 9000,
    display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10,
    background: "var(--left-panel-bg)", color: "var(--text-primary)", border: "1px solid var(--border)",
    boxShadow: "0 4px 16px rgba(0,0,0,.35)", fontSize: 14, maxWidth: "92vw",
  } as const;
  // The browser refused to start sound here (nobody has clicked in this page since it loaded): one click starts it.
  if (blocked) {
    return (
      <div style={box}>
        <span>Your browser blocked playback on this device.</span>
        <button
          onClick={() => { useAudioBlocked.setState({ blocked: false }); useStore.getState().playPause(); }}
          style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "var(--accent)", color: "white", cursor: "pointer" }}
        >Click to play</button>
      </div>
    );
  }
  if (!pending) return notice ? <div style={box}>{notice}</div> : null;
  return (
    <div style={box}>
      <span>Settings changed on another device.</span>
      <button
        onClick={() => location.reload()}
        style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "var(--accent)", color: "white", cursor: "pointer" }}
      >Reload</button>
      <button
        onClick={() => useSettingsSync.setState({ pending: false })}
        style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }}
      >Later</button>
    </div>
  );
}
