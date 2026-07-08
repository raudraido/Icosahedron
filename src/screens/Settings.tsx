import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { api, UpdateInfo, UpdateDownloadProgress } from "../lib/api";
import { applyTheme, loadSavedTheme, saveTheme, saveCustomTheme, deleteCustomTheme, isBuiltInThemeName, allThemes, CREAM, AppTheme } from "../lib/theme";
import { PromptDialog } from "../components/PromptDialog";
import { DEFAULT_HOTKEYS, loadHotkeyBindings, saveHotkeyBindings, bindingFromEvent } from "../lib/hotkeys";
import { ScrollThumb } from "../components/ScrollThumb";

// New view (no old-app equivalent — Sonar's SettingsWindow is a single
// two-column dialog with no tabs) opened via the footer bar's gear icon
// rather than the sidebar's own tab list, hence "settings" isn't in
// App.tsx's NAV array. Five sub-tabs: System / Themes / Servers / Users /
// Theme Builder — the latter three are scaffolding for future multi-server/
// multi-account support and a custom theme editor (see the "what happens on
// account switch" discussion this was born from); only System and Themes
// have real functionality today.

type SettingsTab = "system" | "themes" | "servers" | "users" | "themeBuilder" | "hotkeys";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "system",       label: "System" },
  { id: "themes",       label: "Themes" },
  { id: "servers",      label: "Servers" },
  { id: "users",        label: "Users" },
  { id: "themeBuilder", label: "Theme Builder" },
  { id: "hotkeys",      label: "Hotkeys" },
];

function SideTabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="text-left"
      style={{
        padding: "10px 16px", borderRadius: 8, border: "none", cursor: "pointer",
        background: active ? "var(--hover-bg)" : hov ? "color-mix(in srgb, var(--hover-bg) 50%, transparent)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-primary)",
        fontSize: "var(--fs-primary)", fontWeight: active ? 700 : 500,
      }}
    >
      {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      <span style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
        {title}
      </span>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center" style={{ gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ width: 140, flexShrink: 0, color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>{label}</span>
      <span className="truncate" style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", fontWeight: 600 }}>{value || "—"}</span>
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <span style={{ color: "var(--text-primary)", opacity: 0.25, fontSize: "var(--fs-small)", letterSpacing: 1, textTransform: "uppercase" }}>
        {label} — Coming Soon™
      </span>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Same check/download/install flow as UpdateBanner.tsx, surfaced here too so
// a user who dismissed (or never saw, e.g. it fired before this tab existed)
// the boot-time banner still has a way to check for and install an update.
function UpdateRow() {
  const [status, setStatus] = useState<"checking" | "upToDate" | "available" | "downloading" | "launching" | "error">("checking");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateDownloadProgress | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const unsubLaunchingRef = useRef<(() => void) | null>(null);

  function check() {
    setStatus("checking");
    api.checkForUpdate().then((result) => {
      if (result) { setInfo(result); setStatus("available"); }
      else setStatus("upToDate");
    }).catch(() => setStatus("error"));
  }

  useEffect(() => {
    check();
    return () => { unsubRef.current?.(); unsubLaunchingRef.current?.(); };
  }, []);

  async function installNow() {
    setStatus("downloading");
    setProgress(null);
    unsubRef.current = window.electronAPI.onUpdateDownloadProgress((p) => setProgress(p as UpdateDownloadProgress));
    unsubLaunchingRef.current = window.electronAPI.onUpdateInstallerLaunching(() => setStatus("launching"));
    try {
      await api.downloadAndInstallUpdate(info!.downloadUrl);
    } catch {
      setStatus("error");
    } finally {
      unsubRef.current?.(); unsubRef.current = null;
      unsubLaunchingRef.current?.(); unsubLaunchingRef.current = null;
    }
  }

  const pct = progress && progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
    : null;

  return (
    <div className="flex flex-col" style={{ gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="flex items-center" style={{ gap: 12 }}>
        <span style={{ width: 140, flexShrink: 0, color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>Updates</span>
        <span className="flex-1" style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", fontWeight: 600 }}>
          {status === "checking" && "Checking for updates…"}
          {status === "upToDate" && "You're up to date."}
          {status === "available" && `Version ${info!.version} is available.`}
          {status === "downloading" && (
            progress
              ? pct !== null ? `Downloading… ${pct}%` : `Downloading… ${formatBytes(progress.receivedBytes)}`
              : "Downloading…"
          )}
          {status === "launching" && "Installer launching — this app will close now."}
          {status === "error" && "Couldn't check for updates."}
        </span>
        {status === "available" && (
          <button
            onClick={installNow}
            style={{
              padding: "5px 12px", borderRadius: 5, border: "none", cursor: "pointer",
              background: "var(--accent)", color: "#111", fontSize: "var(--fs-secondary)", fontWeight: 700,
            }}
          >
            Update
          </button>
        )}
        {(status === "upToDate" || status === "error") && (
          <button
            onClick={check}
            style={{
              padding: "5px 12px", borderRadius: 5, border: "1px solid var(--border)", cursor: "pointer",
              background: "transparent", color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", fontWeight: 600,
            }}
          >
            Check Again
          </button>
        )}
      </div>
      {status === "downloading" && (
        <div style={{ height: 4, borderRadius: 2, background: "var(--hover-bg)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%", width: pct !== null ? `${pct}%` : "35%", background: "var(--accent)",
              borderRadius: 2, transition: "width 200ms",
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

function SystemTab() {
  const serverUrl = useStore((s) => s.serverUrl);
  const username = useStore((s) => s.username);
  const [version, setVersion] = useState("");

  useEffect(() => { api.getAppVersion().then(setVersion); }, []);

  return (
    <div className="flex flex-col" style={{ gap: 24, maxWidth: 480 }}>
      <Section title="About">
        <Row label="Version" value={version ? `v${version}` : ""} />
        <UpdateRow />
      </Section>
      <Section title="Connection">
        <Row label="Server" value={serverUrl} />
        <Row label="Username" value={username} />
      </Section>
    </div>
  );
}

function ThemesTab() {
  const [current, setCurrent] = useState<AppTheme>(loadSavedTheme);
  // Settings.tsx only renders this component while its sub-tab is active, so
  // remounting (which re-runs this initializer) is what picks up any preset
  // just saved from the Theme Builder tab — deletions update this same state
  // directly instead (see handleDelete) so a card disappears immediately.
  const [themes, setThemes] = useState<AppTheme[]>(allThemes);

  function select(t: AppTheme) {
    setCurrent(t);
    saveTheme(t);
    applyTheme(t);
  }

  // Only ever offered for user-saved presets — isBuiltInThemeName gates the
  // delete button's very existence below, so CREAM/DARK can't reach this at
  // all (they also aren't in the localStorage array deleteCustomTheme edits,
  // so even a direct call here would just no-op against them).
  function handleDelete(t: AppTheme) {
    deleteCustomTheme(t.name);
    setThemes((prev) => prev.filter((x) => x.name !== t.name));
    if (current.name === t.name) select(CREAM);
  }

  return (
    <div className="flex flex-col" style={{ gap: 16, maxWidth: 480 }}>
      <Section title="Theme">
        <div className="flex flex-wrap" style={{ gap: 12 }}>
          {themes.map((t) => {
            const active = t.name === current.name;
            const deletable = !isBuiltInThemeName(t.name);
            return (
              <div key={t.name} style={{ position: "relative" }}>
                <button
                  onClick={() => select(t)}
                  className="flex flex-col items-center"
                  style={{
                    gap: 8, padding: 12, borderRadius: 10, cursor: "pointer",
                    border: `2px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    background: "var(--card-bg)",
                  }}
                >
                  <div
                    aria-hidden
                    style={{
                      width: 96, height: 60, borderRadius: 6, overflow: "hidden",
                      border: `1px solid ${t.border}`, background: t.mainBg,
                      display: "flex", flexDirection: "column",
                    }}
                  >
                    <div style={{ height: "40%", background: t.panelBg }} />
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: t.accent }} />
                    </div>
                  </div>
                  <span style={{ color: active ? "var(--accent)" : "var(--text-primary)", fontSize: "var(--fs-secondary)", fontWeight: 600 }}>
                    {t.name}
                  </span>
                </button>
                {deletable && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(t); }}
                    title={`Delete "${t.name}"`}
                    className="flex items-center justify-center"
                    style={{
                      position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%",
                      background: "var(--main-bg)", border: "1px solid var(--border)", color: "var(--text-secondary)",
                      cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

// ── Theme Builder — ports theme_builder.py's live dial editor. That dialog
// exposed the old app's much more granular per-panel Theme dataclass (five
// separate panel-background colors, dynamic-accent/auto-background/
// auto-border toggles, etc.); this app's AppTheme is a single flatter
// palette, so the dials below cover every field AppTheme actually has
// instead — same "color swatch buttons + live apply, Save as Preset /
// Reset" interaction, just against this app's own theme shape. ──

// <input type="color"> requires strict "#rrggbb" — AppTheme mixes hex
// ("#9b1720") and "rgb(r,g,b)" strings (panelBg/mainBg), so round-trip
// through whichever format the field already used (matches theme_builder.py's
// own _rgb_str_to_hex/_hex_to_rgb_str pair for the same reason).
function toHex(color: string): string {
  if (color.startsWith("#")) return color.length === 7 ? color : "#000000";
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return "#000000";
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}
function fromHex(hex: string, originalFormat: string): string {
  if (!originalFormat.startsWith("rgb(")) return hex;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r},${g},${b})`;
}

function BuilderRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center" style={{ gap: 12, padding: "6px 0" }}>
      <span style={{ width: 180, flexShrink: 0, color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>{label}</span>
      {children}
    </div>
  );
}

function ColorDial({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hex = toHex(value);
  return (
    <div className="flex items-center" style={{ gap: 8 }}>
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(fromHex(e.target.value, value))}
        style={{ width: 36, height: 28, padding: 0, border: "1px solid var(--border)", borderRadius: 4, background: "none", cursor: "pointer" }}
      />
      <span className="tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)", width: 76 }}>{hex.toUpperCase()}</span>
    </div>
  );
}

function NumberDial({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
      style={{ width: 70, background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", fontSize: "var(--fs-secondary)" }}
    />
  );
}

function ThemeBuilderTab() {
  const [draft, setDraft] = useState<AppTheme>(loadSavedTheme);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const baselineRef = useRef<AppTheme>(draft);

  // Live-apply on every dial change — same 80ms-debounced "apply as you
  // drag" feel as theme_builder.py's _apply_live/_live_timer, minus the
  // debounce itself since setting a handful of CSS custom properties is
  // cheap enough to just do synchronously on every change here.
  useEffect(() => { applyTheme(draft); }, [draft]);

  // Leaving this tab without saving reverts the live preview back to
  // whatever's actually persisted — otherwise idle dial-twiddling would
  // leak into the rest of the app until the next explicit theme change.
  useEffect(() => () => { applyTheme(loadSavedTheme()); }, []);

  function set<K extends keyof AppTheme>(key: K, value: AppTheme[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handleReset() {
    setDraft(baselineRef.current);
  }

  function handleSave(name: string) {
    const named: AppTheme = { ...draft, name };
    saveCustomTheme(named);
    saveTheme(named);
    setDraft(named);
    baselineRef.current = named;
    setSavePromptOpen(false);
  }

  return (
    <div className="flex flex-col" style={{ gap: 24, maxWidth: 520 }}>
      <Section title="Accent">
        <BuilderRow label="Accent Color">
          <ColorDial value={draft.accent} onChange={(v) => set("accent", v)} />
        </BuilderRow>
      </Section>

      <Section title="Backgrounds">
        <BuilderRow label="Panel Background"><ColorDial value={draft.panelBg} onChange={(v) => set("panelBg", v)} /></BuilderRow>
        <BuilderRow label="Main Background"><ColorDial value={draft.mainBg} onChange={(v) => set("mainBg", v)} /></BuilderRow>
        <BuilderRow label="Card Background"><ColorDial value={draft.cardBg} onChange={(v) => set("cardBg", v)} /></BuilderRow>
        <BuilderRow label="Skeleton / Placeholders"><ColorDial value={draft.skeleton} onChange={(v) => set("skeleton", v)} /></BuilderRow>
      </Section>

      <Section title="Typography">
        <BuilderRow label="Font Family">
          <input
            value={draft.fontFamily}
            onChange={(e) => set("fontFamily", e.target.value)}
            style={{ flex: 1, background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", fontSize: "var(--fs-secondary)" }}
          />
        </BuilderRow>
        <BuilderRow label="Primary Text Color"><ColorDial value={draft.textPrimary} onChange={(v) => set("textPrimary", v)} /></BuilderRow>
        <BuilderRow label="Secondary Text Color"><ColorDial value={draft.textSecondary} onChange={(v) => set("textSecondary", v)} /></BuilderRow>
        <BuilderRow label="Small Font Size"><NumberDial value={draft.fontSizeSmall} min={8} max={24} onChange={(v) => set("fontSizeSmall", v)} /></BuilderRow>
        <BuilderRow label="Secondary Font Size"><NumberDial value={draft.fontSizeSecondary} min={8} max={24} onChange={(v) => set("fontSizeSecondary", v)} /></BuilderRow>
        <BuilderRow label="Primary Font Size"><NumberDial value={draft.fontSizePrimary} min={8} max={28} onChange={(v) => set("fontSizePrimary", v)} /></BuilderRow>
        <BuilderRow label="Heading Font Size"><NumberDial value={draft.fontSizeHeading} min={10} max={32} onChange={(v) => set("fontSizeHeading", v)} /></BuilderRow>
        <BuilderRow label="Title Font Size"><NumberDial value={draft.fontSizeTitle} min={12} max={40} onChange={(v) => set("fontSizeTitle", v)} /></BuilderRow>
        <BuilderRow label="Hero Font Size"><NumberDial value={draft.fontSizeHero} min={14} max={48} onChange={(v) => set("fontSizeHero", v)} /></BuilderRow>
      </Section>

      <Section title="Border & Hover">
        <BuilderRow label="Border Color"><ColorDial value={draft.border} onChange={(v) => set("border", v)} /></BuilderRow>
        <BuilderRow label="Hover Color"><ColorDial value={draft.hoverBg} onChange={(v) => set("hoverBg", v)} /></BuilderRow>
        <BuilderRow label="Error Color"><ColorDial value={draft.error} onChange={(v) => set("error", v)} /></BuilderRow>
      </Section>

      <Section title="Window">
        <BuilderRow label="System Titlebar">
          <div className="flex" style={{ gap: 6 }}>
            {([["Light", false], ["Dark", true]] as const).map(([label, isDark]) => (
              <button
                key={label}
                onClick={() => set("titleBarDark", isDark)}
                style={{
                  padding: "6px 14px", borderRadius: 4, cursor: "pointer", fontSize: "var(--fs-secondary)", fontWeight: 700,
                  border: `1px solid ${draft.titleBarDark === isDark ? "var(--accent)" : "var(--border)"}`,
                  color: draft.titleBarDark === isDark ? "var(--accent)" : "var(--text-secondary)",
                  background: "transparent",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </BuilderRow>
      </Section>

      <div className="flex items-center" style={{ gap: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
        <button
          onClick={() => setSavePromptOpen(true)}
          style={{ background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "7px 16px", cursor: "pointer", fontSize: "var(--fs-secondary)", fontWeight: 700 }}
        >
          Save as Preset
        </button>
        <button
          onClick={handleReset}
          style={{ background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "7px 16px", cursor: "pointer", fontSize: "var(--fs-secondary)", fontWeight: 700 }}
        >
          Reset
        </button>
      </div>

      {savePromptOpen && (
        <PromptDialog
          title="Save as Preset"
          placeholder="Theme name"
          confirmLabel="Save"
          onSubmit={handleSave}
          onCancel={() => setSavePromptOpen(false)}
          validate={(name) => isBuiltInThemeName(name) ? "That name is reserved for a built-in theme." : null}
        />
      )}
    </div>
  );
}

// Rebindable global shortcuts — ports the old app's SettingsWindow hotkey
// list (backed by components/hotkeys.py's HotkeyManager) to this app's
// GlobalHotkeys.tsx listener. Click "Record", press the new key combo, and
// it's saved + live immediately (HOTKEYS_CHANGED_EVENT); "Reset" restores
// that one row's default, "Reset All" restores everything.
function HotkeyRow({
  label, binding, recording, onStartRecord, onReset, isDefault,
}: {
  label: string; binding: string; recording: boolean; onStartRecord: () => void; onReset: () => void; isDefault: boolean;
}) {
  return (
    <div className="flex items-center" style={{ gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ flex: 1, color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>{label}</span>
      <button
        onClick={onStartRecord}
        style={{
          minWidth: 140, textAlign: "center", padding: "5px 10px", borderRadius: 4, cursor: "pointer",
          background: recording ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "var(--card-bg)",
          border: `1px solid ${recording ? "var(--accent)" : "var(--border)"}`,
          color: recording ? "var(--accent)" : "var(--text-primary)",
          fontSize: "var(--fs-secondary)", fontWeight: 600,
        }}
      >
        {recording ? "Press a key…" : binding}
      </button>
      <button
        onClick={onReset}
        disabled={isDefault}
        title="Reset to default"
        style={{
          background: "transparent", border: "none", cursor: isDefault ? "default" : "pointer",
          color: "var(--text-secondary)", opacity: isDefault ? 0.3 : 1, fontSize: "var(--fs-secondary)",
        }}
      >
        Reset
      </button>
    </div>
  );
}

function HotkeysTab() {
  const [bindings, setBindings] = useState<Record<string, string>>(loadHotkeyBindings);
  const [recordingId, setRecordingId] = useState<string | null>(null);

  useEffect(() => {
    if (!recordingId) return;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      if (e.key === "Escape") { setRecordingId(null); return; }
      const combo = bindingFromEvent(e);
      if (!combo) return; // still just a modifier held down — wait for the real key
      setBindings((prev) => {
        const next = { ...prev, [recordingId!]: combo };
        saveHotkeyBindings(next);
        return next;
      });
      setRecordingId(null);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingId]);

  function resetOne(id: string) {
    const def = DEFAULT_HOTKEYS.find((h) => h.id === id)!.default;
    setBindings((prev) => {
      const next = { ...prev, [id]: def };
      saveHotkeyBindings(next);
      return next;
    });
  }

  function resetAll() {
    const next: Record<string, string> = {};
    for (const h of DEFAULT_HOTKEYS) next[h.id] = h.default;
    setBindings(next);
    saveHotkeyBindings(next);
  }

  return (
    <div className="flex flex-col" style={{ gap: 16, maxWidth: 520 }}>
      <Section title="Global Shortcuts">
        <div>
          {DEFAULT_HOTKEYS.map((h) => (
            <HotkeyRow
              key={h.id}
              label={h.label}
              binding={bindings[h.id] ?? h.default}
              recording={recordingId === h.id}
              onStartRecord={() => setRecordingId(h.id)}
              onReset={() => resetOne(h.id)}
              isDefault={(bindings[h.id] ?? h.default) === h.default}
            />
          ))}
        </div>
        <button
          onClick={resetAll}
          style={{
            alignSelf: "flex-start", marginTop: 8, background: "transparent", color: "var(--text-secondary)",
            border: "1px solid var(--border)", borderRadius: 4, padding: "7px 16px", cursor: "pointer",
            fontSize: "var(--fs-secondary)", fontWeight: 700,
          }}
        >
          Reset All
        </button>
      </Section>
    </div>
  );
}

export function Settings() {
  const [tab, setTab] = useState<SettingsTab>("system");
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="h-full flex flex-col page-fade-in">
      <div className="flex items-center shrink-0 px-6" style={{ height: 58, borderBottom: "1px solid var(--border)" }}>
        <h2 className="font-semibold" style={{ color: "var(--text-primary)", fontSize: "var(--fs-heading)" }}>Settings</h2>
      </div>
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        <div className="flex flex-col shrink-0" style={{ width: 200, padding: 16, gap: 4, borderRight: "1px solid var(--border)" }}>
          {TABS.map((t) => (
            <SideTabButton key={t.id} label={t.label} active={tab === t.id} onClick={() => setTab(t.id)} />
          ))}
        </div>
        <div className="flex-1" style={{ position: "relative", minHeight: 0 }}>
          <div ref={scrollRef} className="h-full overflow-y-auto scroll-clean" style={{ padding: 28 }}>
            {tab === "system" && <SystemTab />}
            {tab === "themes" && <ThemesTab />}
            {tab === "servers" && <ComingSoon label="Servers" />}
            {tab === "users" && <ComingSoon label="Users" />}
            {tab === "themeBuilder" && <ThemeBuilderTab />}
            {tab === "hotkeys" && <HotkeysTab />}
          </div>
          <ScrollThumb scrollRef={scrollRef} />
        </div>
      </div>
    </div>
  );
}
