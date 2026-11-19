import { useEffect, useState } from "react";
import { Laptop, Monitor, Smartphone, Tv } from "lucide-react";
import { useSync, syncActions, setSyncUrl, type RegistryDevice } from "../lib/sync";
import { useSyncOptions, setSyncOption, setPrefGroup, type PrefGroup } from "../lib/syncOptions";
import { platform } from "../platform";
import { quickConnectSettings, setQuickConnectEnabled, authorizeQuickConnect, type AuthorizeResult, type QuickConnectSettings } from "../lib/quickConnect";
import { Section, ToggleRow } from "./SettingsParts";
import { SecureSignInSection } from "./SecureSignIn";
import { QrCode } from "../components/QrCode";
import { jukeboxUrl, JUKEBOX_DOCS } from "../lib/jukebox";
import { bpmAnalysisStatus, startBpmAnalysis, stopBpmAnalysis, setBpmMinConfidence, formatEta, type BpmAnalysisStatus, type BpmAnalysisStart } from "../lib/bpmAnalysis";

// Settings > Sync Server: the connection, this player's name, the players the
// engine knows, what this player keeps in sync and what the engine stores.
// Design: docs/sync-settings.md.
const IS_WEB = platform.kind === "web";
const KIND_ICON: Record<RegistryDevice["kind"], typeof Laptop> = { electron: Monitor, web: Laptop, mobile: Smartphone, tv: Tv };

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

/** How to turn a screen into a jukebox: the address to open (with a copy button and a QR code) and the three steps. */
function JukeboxSection({ base }: { base: string }) {
  const url = jukeboxUrl(base);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the address can still be selected by hand */ }
  }
  const hint = { color: "var(--text-secondary)", fontSize: "var(--fs-small)", lineHeight: 1.5 } as const;
  return (
    <Section title="Jukebox">
      <div style={hint}>
        Turn any screen (a tablet, a spare computer, a browser on a TV) into a player that you control from your other devices.
      </div>
      <ol style={{ ...hint, paddingLeft: 18, margin: 0 }}>
        <li>Open this address on the screen that should play.</li>
        <li>Sign in with your account (a new screen is approved from one of your signed-in devices), then tap once so the browser allows sound.</li>
        <li>On another device choose it in the devices list (it is called <b>Jukebox</b> until you rename it on its screen), or right-click a song → <b>Add to Device Queue</b>.</li>
      </ol>
      <div className="flex items-center" style={{ gap: 14, flexWrap: "wrap" }}>
        <QrCode text={url} size={132} />
        <div className="flex flex-col" style={{ gap: 8, flex: 1, minWidth: 220 }}>
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={{ ...input, width: "100%" }} aria-label="Jukebox address" />
          <div className="flex items-center" style={{ gap: 10 }}>
            <button style={button} onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
            <a href={JUKEBOX_DOCS} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontSize: "var(--fs-small)" }}>How it works</a>
          </div>
        </div>
      </div>
    </Section>
  );
}

const QC_MESSAGES: Record<AuthorizeResult, string> = {
  ok: "Done: the device is signing in.",
  unknown: "That code is not known (it may have expired). Check the code on the device's screen.",
  already: "That code was already used.",
  rate: "Too many wrong codes. Wait a minute.",
  offline: "The sync server is not reachable.",
  error: "Something went wrong.",
};

/** Sign another device in with the six-digit code it shows (a TV, for example). A server administrator switches it on and off here. */
function QuickConnectSection() {
  const [cfg, setCfg] = useState<QuickConnectSettings | null>(null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<AuthorizeResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void quickConnectSettings().then(setCfg); }, []);
  if (!cfg || (!cfg.enabled && !cfg.canChange)) return null; // nothing to do for someone who cannot switch it on
  return (
    <Section title="Quick Connect">
      {cfg.canChange && (
        <ToggleRow
          label="Allow devices to sign in with a code"
          description="Server setting for everyone on this server. Off by default."
          checked={cfg.enabled}
          onChange={async (v) => { const now = await setQuickConnectEnabled(v); if (now !== null) setCfg({ ...cfg, enabled: now }); }}
        />
      )}
      {cfg.source === "env" && (
        <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>Switched by the server's environment (QUICK_CONNECT), not from here.</div>
      )}
      {cfg.enabled && (
      <>
      <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
        A TV or another device shows a six-digit code. Enter it here to sign that device in with your account.
      </div>
      <form
        className="flex items-center"
        style={{ gap: 8 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (code.trim().length !== 6 || busy) return;
          setBusy(true);
          setResult(await authorizeQuickConnect(code));
          setBusy(false);
          setCode("");
        }}
      >
        <input
          value={code} inputMode="numeric" maxLength={6} placeholder="123456" aria-label="Quick Connect code"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          style={{ ...input, width: 120, letterSpacing: 3, textAlign: "center" }}
        />
        <button type="submit" disabled={code.length !== 6 || busy} style={{ ...button, opacity: code.length === 6 && !busy ? 1 : 0.5 }}>Authorize</button>
      </form>
      {result && <div style={{ fontSize: "var(--fs-small)", color: result === "ok" ? "var(--accent)" : "var(--error)" }}>{QC_MESSAGES[result]}</div>}
      </>
      )}
    </Section>
  );
}

const START_ERRORS: Partial<Record<BpmAnalysisStart, string>> = {
  running: "An analysis is already running.",
  analyser_missing: "This Icosahedron HUB has no analyser program (it is part of the HUB's Docker image from the version that added this section).",
  refused: "Only a server administrator can do this.",
  offline: "The Icosahedron HUB is not reachable.",
  error: "Something went wrong.",
};

/** Measures the BPM of every song that has none, on the Icosahedron HUB (docs/sync-settings.md). Administrators only. */
function BpmAnalysisSection() {
  const [st, setSt] = useState<BpmAnalysisStatus | null>(null);
  const [workers, setWorkers] = useState(4);
  const [msg, setMsg] = useState<string | null>(null);
  const [includeSkipped, setIncludeSkipped] = useState(false);
  const [armedRecheck, setArmedRecheck] = useState(false);
  const [minPct, setMinPct] = useState<number | null>(null); // the slider while it is dragged
  const active = st?.state === "running" || st?.state === "stopping";
  useEffect(() => { void bpmAnalysisStatus().then(setSt); }, []);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { void bpmAnalysisStatus().then((n) => n && setSt(n)); }, 2000);
    return () => clearInterval(t);
  }, [active]);
  if (!st) return null; // not an administrator, or an older HUB
  const fmt = (n: number) => n.toLocaleString();
  const start = async (o: { retryFailed?: boolean; recheck?: boolean } = {}) => {
    setMsg(null);
    const r = await startBpmAnalysis({ workers, includeSkipped, ...o });
    if (r !== "ok") setMsg(START_ERRORS[r] ?? "Something went wrong.");
    const n = await bpmAnalysisStatus();
    if (n) setSt(n);
  };
  const done = st.analysed + st.failed + st.skipped;
  return (
    <Section title="BPM analysis">
      <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
        {st.libraryTotal ? `${fmt(st.withBpm)} of ${fmt(st.libraryTotal)} songs have a BPM.` : `${fmt(st.withBpm)} songs have a BPM.`}
        {" "}The Icosahedron HUB can measure the rest in the background, with the same detection the desktop app uses, so every player shows it.
        Songs that already have a BPM, measured or set by hand, are never measured again or changed.
      </div>
      {st.minConfidence !== undefined && (
        <>
          <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
            {fmt(st.withConfidence ?? 0)} with a confidence, {fmt(st.unscored ?? 0)} without (measured earlier), {fmt(st.unreliable ?? 0)} unreliable (below {Math.round(st.minConfidence * 100)}%), {fmt(st.skippedTotal ?? 0)} skipped.
          </div>
          <div className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}>
            <label htmlFor="bpm-minconf" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>Hide measured BPM below</label>
            <input
              id="bpm-minconf" type="range" min={0} max={100} step={1} value={minPct ?? Math.round(st.minConfidence * 100)}
              onChange={(e) => setMinPct(Number(e.target.value))}
              onPointerUp={async () => { if (minPct === null) return; const v = await setBpmMinConfidence(minPct / 100); setMinPct(null); const n = await bpmAnalysisStatus(); if (n) setSt(n); else if (v === null) setMsg("Could not save."); }}
              onKeyUp={async () => { if (minPct === null) return; await setBpmMinConfidence(minPct / 100); setMinPct(null); const n = await bpmAnalysisStatus(); if (n) setSt(n); }}
              style={{ width: 160 }}
            />
            <span style={{ fontSize: "var(--fs-small)", minWidth: 36 }}>{minPct ?? Math.round(st.minConfidence * 100)}%</span>
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
            Each measured BPM has a confidence: how steadily and clearly a beat runs through the song. Intros and ambient tracks score low, and their BPM is a guess. Values below this line stay stored but are left out of BPM sorting, the Mix Builder and Flow. 0% hides nothing. BPM you set by hand is always shown.
          </div>
        </>
      )}
      {!active ? (
        <>
          <div className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}>
            <label style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }} htmlFor="bpm-workers">Songs at a time</label>
            <select id="bpm-workers" value={workers} onChange={(e) => setWorkers(Number(e.target.value))} style={input}>
              {[1, 2, 4, 6, 8].map((n) => <option key={n} value={n}>{n}{n === 4 ? " (default)" : ""}</option>)}
            </select>
            <button style={button} onClick={() => void start()}>Start analysis</button>
            {st.failedTotal > 0 && <button style={button} onClick={() => void start({ retryFailed: true })}>Try the {fmt(st.failedTotal)} failed again</button>}
          </div>
          {(st.skippedTotal ?? 0) > 0 && (
            <label className="flex items-center" style={{ gap: 6, color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
              <input type="checkbox" checked={includeSkipped} onChange={(e) => setIncludeSkipped(e.target.checked)} />
              Include the {fmt(st.skippedTotal ?? 0)} skipped songs (shorter than a minute, or ambient, drone, soundtrack and similar)
            </label>
          )}
          {(st.unscored ?? 0) > 0 && (
            <div className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                style={{ ...button, ...(armedRecheck ? { color: "var(--error)", borderColor: "var(--error)" } : {}) }}
                onClick={() => { if (armedRecheck) { setArmedRecheck(false); void start({ recheck: true }); } else { setArmedRecheck(true); setTimeout(() => setArmedRecheck(false), 6000); } }}
              >{armedRecheck ? "Really? Click again" : `Re-check ${fmt(st.unscored ?? 0)} songs analysed before confidence existed`}</button>
              <span style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
                Takes as long as the first analysis and replaces those BPM values (hand-set ones are never touched).
              </span>
            </div>
          )}
          {st.finishedAt && st.startedAt && (
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
              Last run {ago(st.finishedAt)}: {fmt(st.analysed)} measured, {fmt(st.failed)} failed{st.skipped ? `, ${fmt(st.skipped)} got a value meanwhile` : ""}.
              {st.lastError ? ` ${st.lastError}` : ""}
            </div>
          )}
          {st.failedTotal > 0 && (
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
              {fmt(st.failedTotal)} songs could not be measured (no clear tempo, or a file that cannot be read). They are not tried again unless you ask.
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>
            {st.state === "stopping" ? "Stopping…" : st.phase === "listing" ? "Reading the library…" : `${fmt(Math.min(done, st.total))} of ${fmt(st.total)} songs done`}
            {st.state === "running" && st.etaSeconds !== null ? `, ${formatEta(st.etaSeconds)} left` : ""}
          </div>
          {st.total > 0 && (
            <div style={{ height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, (done / st.total) * 100)}%`, height: "100%", background: "var(--accent)" }} />
            </div>
          )}
          <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
            {fmt(st.analysed)} measured{st.failed ? `, ${fmt(st.failed)} failed` : ""}. Running with {st.workers} at a time, at low priority.
          </div>
          <div><button style={button} disabled={st.state === "stopping"} onClick={async () => { await stopBpmAnalysis(); const n = await bpmAnalysisStatus(); if (n) setSt(n); }}>Stop</button></div>
        </>
      )}
      {msg && <div style={{ fontSize: "var(--fs-small)", color: "var(--error)" }}>{msg}</div>}
    </Section>
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
              Address of your Icosahedron HUB, for example https://music.example.com. It keeps your players in step.
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

          <JukeboxSection base={IS_WEB ? location.origin : (syncUrl ?? "").replace(/^ws/, "http").replace(/\/sync\/?$/, "")} />

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

          <BpmAnalysisSection />

          <QuickConnectSection />

          <SecureSignInSection />

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
