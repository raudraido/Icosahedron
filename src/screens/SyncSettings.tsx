import { useState } from "react";
import { Laptop, Monitor, Smartphone } from "lucide-react";
import { useSync, syncActions, setSyncUrl, type RegistryDevice } from "../lib/sync";
import { useSyncOptions, setSyncOption, setPrefGroup, type PrefGroup } from "../lib/syncOptions";
import { platform } from "../platform";
import { Section, ToggleRow } from "./SettingsParts";

// Settings > Sync Server: the connection, this player's name, the players the
// engine knows, what this player keeps in sync and what the engine stores.
// Design: docs/sync-settings.md.
const IS_WEB = platform.kind === "web";
const KIND_ICON: Record<RegistryDevice["kind"], typeof Laptop> = { electron: Monitor, web: Laptop, mobile: Smartphone };

const PREF_LABELS: Record<PrefGroup, { label: string; description: string }> = {
  appearance: { label: "Appearance", description: "Theme and custom themes." },
  equalizer: { label: "Equalizer", description: "Bands, preamp and presets." },
  layout: { label: "Library layout", description: "Tab and home row order, left panel switches, sort choices, remaining time." },
  scrobbling: { label: "Scrobbling and lyrics", description: "Scrobble, BPM detection and lyrics source switches, Bandsintown." },
};

const button = {
  padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent",
  color: "var(--text-primary)", cursor: "pointer", fontSize: "var(--fs-small)",
} as const;
const input = {
  padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card-bg)",
  color: "var(--text-primary)", fontSize: "var(--fs-secondary)", minWidth: 0,
} as const;

function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function NameEditor({ initial, onSave }: { initial: string; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState(initial);
  const dirty = draft.trim() !== "" && draft.trim() !== initial;
  return (
    <form className="flex items-center" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (dirty) onSave(draft.trim()); }}>
      <input value={draft} maxLength={64} onChange={(e) => setDraft(e.target.value)} style={{ ...input, flex: 1 }} aria-label="Player name" />
      <button type="submit" disabled={!dirty} style={{ ...button, opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "default" }}>Save</button>
    </form>
  );
}

function PlayerRow({ d, me }: { d: RegistryDevice; me: boolean }) {
  const [editing, setEditing] = useState(false);
  const Ic = KIND_ICON[d.kind] ?? Laptop;
  return (
    <div className="flex flex-col" style={{ gap: 6, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="flex items-center" style={{ gap: 10 }}>
        <Ic size={18} style={{ color: d.online ? "var(--accent)" : "var(--text-secondary)", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="truncate" style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)" }}>
            {d.name}{me ? " (this player)" : ""}
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>{d.online ? "Online" : `Last seen ${ago(d.lastSeen)}`}</div>
        </div>
        {!editing && <button style={button} onClick={() => setEditing(true)}>Rename</button>}
        {!d.online && <button style={button} onClick={() => syncActions.forget(d.deviceId)} title="Remove from the list. It shows up again if it connects.">Forget</button>}
      </div>
      {editing && <NameEditor initial={d.name} onSave={(n) => { syncActions.rename(d.deviceId, n); setEditing(false); }} />}
    </div>
  );
}

function ClearButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      style={{ ...button, ...(armed ? { color: "var(--error)", borderColor: "var(--error)" } : {}) }}
      onClick={() => { if (armed) { onConfirm(); setArmed(false); } else { setArmed(true); setTimeout(() => setArmed(false), 4000); } }}
    >{armed ? "Really? Click again" : label}</button>
  );
}

export function SyncServerTab() {
  const { status, syncUrl, name, registry, deviceId } = useSync();
  const opts = useSyncOptions();
  const [urlDraft, setUrlDraft] = useState("");
  const connected = IS_WEB || !!syncUrl;
  const stateText = status === "online" ? "Connected" : status === "connecting" ? "Connecting…" : "Offline";

  return (
    <div className="flex flex-col" style={{ gap: 24, maxWidth: 480 }}>
      <Section title="Connection">
        {IS_WEB ? (
          <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
            This web app is served by your sync server, so it is already connected. {stateText}.
          </div>
        ) : !syncUrl ? (
          <form className="flex flex-col" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (urlDraft.trim()) setSyncUrl(urlDraft.trim()); }}>
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
              Address of your Icosahedron web engine, for example https://music.example.com. It keeps your players in step.
            </div>
            <div className="flex" style={{ gap: 8 }}>
              <input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://…" style={{ ...input, flex: 1 }} aria-label="Sync server address" />
              <button type="submit" style={button}>Join</button>
            </div>
          </form>
        ) : (
          <div className="flex items-center" style={{ gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="truncate" style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)" }}>{syncUrl.replace(/^ws/, "http").replace(/\/sync\/?$/, "")}</div>
              <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>{stateText}</div>
            </div>
            <button style={button} onClick={() => setSyncUrl("")} title="Disconnect and forget the address on this player. Nothing local is deleted.">Leave</button>
          </div>
        )}
      </Section>

      {connected && status === "online" && (
        <>
          <Section title="This player">
            <NameEditor key={name ?? ""} initial={name ?? ""} onSave={(n) => syncActions.rename(deviceId, n)} />
          </Section>

          <Section title="Registered players">
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
              Every player signed in with your account. Players that stay offline for 90 days are removed automatically. Forgetting is housekeeping, not a lock-out: a player that is still signed in comes back when it connects.
            </div>
            {registry.map((d) => <PlayerRow key={d.deviceId} d={d} me={d.deviceId === deviceId} />)}
          </Section>

          <Section title="What this player keeps in sync">
            <ToggleRow
              label="Playback and remote control"
              description="Shares the queue and position, shows in the device list and can be controlled from other players. Off: invisible to them."
              checked={opts.playback}
              onChange={(v) => setSyncOption("playback", v)}
            />
            {(Object.keys(PREF_LABELS) as PrefGroup[]).map((g) => (
              <ToggleRow
                key={g}
                label={`Preferences: ${PREF_LABELS[g].label}`}
                description={PREF_LABELS[g].description}
                checked={opts.prefs[g]}
                onChange={(v) => setPrefGroup(g, v)}
              />
            ))}
            <ToggleRow
              label="BPM"
              description="Reads and uploads BPM through the sync server."
              checked={opts.bpm}
              onChange={(v) => setSyncOption("bpm", v)}
              divider={IS_WEB ? false : true}
            />
            {!IS_WEB && (
              <ToggleRow
                label="Last.fm through the sync server"
                description="Uses the server's Last.fm connection. Off: this player keeps its own."
                checked={opts.lastfm}
                onChange={(v) => setSyncOption("lastfm", v)}
                divider={false}
              />
            )}
          </Section>

          <Section title="Server data">
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
              What the sync server stores for your account. Clearing does not touch anything on your players.
            </div>
            <div className="flex" style={{ gap: 8, flexWrap: "wrap" }}>
              <ClearButton label="Clear stored queue" onConfirm={() => syncActions.clear({ state: true })} />
              <ClearButton label="Clear shared preferences" onConfirm={() => syncActions.clear({ settings: true })} />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
