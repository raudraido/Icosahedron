// Sync client for the web engine (apps/server): publishes this device's
// playback to the user's other devices and lets them be controlled remotely.
//
// Model: only the device that is playing publishes (otherwise an idle device
// restoring its saved queue would overwrite the state of the one in use).
// Other devices don't mirror — they show the active device's now-playing in
// the picker and can send commands or transfer playback here.
import { addApproval, removeApproval, refreshApprovals } from "./approvals";
import { create } from "zustand";
import { platform } from "../platform";
import { getSyncUrl, saveEngineUrl } from "../platform/syncUrl";
import { api, type Track } from "./api";
import { useStore } from "../store";
import { reconcileSettings, remoteSettingsChanged, remoteSettingsCleared, settingsDisconnected, settingsOptionsChanged, type SettingsBlob } from "./settingsSync";
import { syncOptions, useSyncOptions } from "./syncOptions";
import { useTarget, getTargetId, registerTargetRouter, runLocal } from "./target";

export interface SyncDevice { deviceId: string; name: string; kind: "electron" | "web" | "mobile" | "tv" }
/** A player in the engine's registry: online or not (the picker only lists the online ones). */
export interface RegistryDevice { deviceId: string; name: string; kind: SyncDevice["kind"]; online: boolean; lastSeen: number }
export interface RemoteState {
  queue?: Omit<Track, "stream_url">[]; index: number; positionMs: number; playing: boolean; updatedAt: number;
  shuffle?: boolean; repeat?: boolean; volume?: number;
}

interface SyncStore {
  status: "off" | "connecting" | "online";
  deviceId: string;
  devices: SyncDevice[];
  activeDeviceId: string | null;
  /** The other online players' own states (queue kept from the last time it was sent). */
  states: Record<string, RemoteState>;
  syncUrl: string | null;
  /** This player's name as the engine knows it (renamed in Settings > Sync Server). */
  name: string | null;
  registry: RegistryDevice[];
}

const LS_ID = "ico.deviceId";


function loadDeviceId(): string {
  try {
    let id = localStorage.getItem(LS_ID);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(LS_ID, id); }
    return id;
  } catch { return "dev-" + Math.random().toString(36).slice(2); }
}

function deviceName(): string {
  if (platform.kind === "electron") return "Desktop";
  if (new URLSearchParams(location.search).has("player")) return "Jukebox"; // see components/PlayerOnly.tsx
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

export const useSync = create<SyncStore>(() => ({
  status: "off", deviceId: loadDeviceId(), devices: [], activeDeviceId: null, states: {}, syncUrl: getSyncUrl(), name: null, registry: [],
}));

export function setSyncUrl(url: string): void {
  saveEngineUrl(url);
  useSync.setState({ syncUrl: getSyncUrl() });
  restart();
}

let ws: WebSocket | null = null;
let retry = 0;
let retryTimer: number | undefined;
let wanted = false;

function send(msg: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** A short confirmation ("Added to Jukebox") for actions that otherwise show nothing here. */
export const useSyncNotice = create<{ text: string }>(() => ({ text: "" }));
let noticeTimer: number | undefined;
export function notify(text: string): void {
  useSyncNotice.setState({ text });
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => useSyncNotice.setState({ text: "" }), 2500);
}
const deviceLabel = (id: string) => useSync.getState().devices.find((d) => d.deviceId === id)?.name ?? "device";

export const syncActions = {
  command: (target: string, cmd: string, args?: unknown) => send({ type: "command", target, cmd, args }),
  /** Moves `source`'s playback to `target` (the source pauses, the target continues where it was). */
  transfer: (target: string, source?: string) => send({ type: "transfer", target, ...(source ? { source } : {}) }),
  /** Starts `tracks` on another device (the whole list, or a window of it when it is very long). */
  playOn: (target: string, tracks: Track[], index: number) => {
    const start = Math.max(0, index - 20);
    const window = tracks.slice(start, start + 1000);
    send({ type: "command", target, cmd: "load", args: { state: { queue: window.map(toWire), index: index - start, positionMs: 0, playing: true } } });
  },
  /** Chooses the device the controls act on (null = this device). It only controls; music moves with `transfer`. */
  setTarget: (id: string | null) => useTarget.setState({ targetId: id && id !== useSync.getState().deviceId ? id : null }),
  /** Seek on another device; reports that were already on their way are ignored for a moment. */
  seekOn: (target: string, seconds: number) => {
    send({ type: "command", target, cmd: "seek", args: { positionMs: Math.round(seconds * 1000) } });
    positions[target] = { ms: seconds * 1000, at: Date.now() };
    lastSeek[target] = Date.now();
  },
  /** Jukebox: add tracks to `target`'s queue, right after the current one or at the end. */
  enqueue: (target: string, tracks: Track[], at: "now" | "next" | "end") => {
    send({ type: "command", target, cmd: "enqueue", args: { at, tracks: tracks.map(toWire) } });
    const what = tracks.length === 1 ? `"${tracks[0].title}"` : `${tracks.length} tracks`;
    notify(`${at === "now" ? "Playing now on" : at === "next" ? "Playing next on" : "Added to queue on"} ${deviceLabel(target)}: ${what}`);
  },
  /** Jukebox: play item `index` of `target`'s queue. */
  jump: (target: string, index: number) => send({ type: "command", target, cmd: "jump", args: { index } }),
  /** Rename a registered player (this one or another). */
  rename: (target: string, name: string) => send({ type: "rename", target, name }),
  /** Remove an offline player from the registry (the engine refuses online ones). */
  forget: (target: string) => send({ type: "forget", target }),
  /** Wipe what the engine stores: the playback state and/or the shared preferences. */
  clear: (what: { state?: boolean; settings?: boolean }) => send({ type: "clear", ...what }),
  /** Remote: shuffle / repeat of `target`. Each player applies its own meaning of repeat (desktop repeats the track, iOS loops the queue). */
  shuffle: (target: string, on: boolean) => send({ type: "command", target, cmd: "shuffle", args: { on } }),
  repeat: (target: string, on: boolean) => send({ type: "command", target, cmd: "repeat", args: { on } }),
  /** Remote: move queue item `from` so that it ends up at `to` (array-move semantics). */
  move: (target: string, from: number, to: number) => send({ type: "command", target, cmd: "move", args: { from, to } }),
  /** Jukebox: remove item `index` from `target`'s queue. */
  removeAt: (target: string, index: number) => send({ type: "command", target, cmd: "remove", args: { index } }),
};

// UI play / play next / add to queue actions go to the target device when another one is chosen.
registerTargetRouter({
  play: (target, tracks, index) => syncActions.playOn(target, tracks, index),
  next: (target, track) => syncActions.enqueue(target, [track], "next"),
  end: (target, tracks) => syncActions.enqueue(target, tracks, "end"),
});

async function connect(): Promise<void> {
  const url = getSyncUrl();
  if (!url || !wanted) return;
  useSync.setState({ status: "connecting", syncUrl: url });
  let auth: unknown;
  try { auth = await platform.invoke("sync_auth"); } catch { schedule(); return; }
  if (!wanted) return;
  const sock = (ws = new WebSocket(url));
  sock.onopen = () => {
    retry = 0;
    sock.send(JSON.stringify({ type: "hello", auth, device: { deviceId: useSync.getState().deviceId, name: deviceName(), kind: platform.kind, playback: syncOptions().playback, proto: 2 } }));
  };
  sock.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data)); } catch { /* ignore malformed */ } };
  sock.onclose = (ev) => {
    if (ws === sock) ws = null;
    settingsDisconnected();
    useSync.setState({ status: "off", devices: [], activeDeviceId: null, states: {} });
    if (wanted && ev.code !== 4003) schedule(); // 4003 = bad credentials: don't hammer the server
  };
  sock.onerror = () => sock.close();
}

function schedule(): void {
  clearTimeout(retryTimer);
  retryTimer = window.setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
}

/** Stable order: this device first, the rest by name (the server lists them in connection order). */
function orderDevices(list: SyncDevice[]): SyncDevice[] {
  const me = useSync.getState().deviceId;
  return [...list].sort((a, b) =>
    (a.deviceId === me ? 0 : 1) - (b.deviceId === me ? 0 : 1) || a.name.localeCompare(b.name) || a.deviceId.localeCompare(b.deviceId));
}

function orderRegistry(list: RegistryDevice[]): RegistryDevice[] {
  const me = useSync.getState().deviceId;
  return [...list].sort((a, b) =>
    (a.deviceId === me ? 0 : 1) - (b.deviceId === me ? 0 : 1) || Number(b.online) - Number(a.online) ||
    a.name.localeCompare(b.name) || a.deviceId.localeCompare(b.deviceId));
}

// Each player reports its position every few seconds, in fractions of a second but a little late.
// Between reports the bar moves on by itself; a report close to where the bar already is does not
// pull it back, a real jump (seek, new track, pause) is taken as is. Kept outside the store: a
// position tick must not re-render everything that shows the state.
let positions: Record<string, { ms: number; at: number }> = {};
const lastSeek: Record<string, number> = {};

function applyRemoteState(id: string, s: any): void {
  if (!s || id === useSync.getState().deviceId) return;
  const prev = useSync.getState().states[id];
  const next: RemoteState = { ...s, queue: s.queue ?? prev?.queue };
  const same = prev && prev.index === next.index && prev.playing === next.playing && !!prev.shuffle === !!next.shuffle &&
    !!prev.repeat === !!next.repeat && prev.queue === next.queue;
  if (!same) useSync.setState({ states: { ...useSync.getState().states, [id]: next } });
  const now = Date.now();
  if (now - (lastSeek[id] ?? 0) < 2000) return; // a report from before our seek
  const reported = Number(s.positionMs) || 0;
  const old = positions[id];
  if (old && prev?.playing && next.playing && prev.queue?.[prev.index]?.id === next.queue?.[next.index]?.id) {
    const expected = old.ms + (now - old.at);
    if (Math.abs(reported - expected) < 1500) { positions[id] = { ms: Math.max(reported, expected), at: now }; return; }
  }
  positions[id] = { ms: reported, at: now };
}

/** Another player's position in seconds, moving on locally while it plays. */
export function remotePosition(id: string | null | undefined, now = Date.now()): number {
  const p = id ? positions[id] : undefined;
  if (!id || !p) return 0;
  const st = useSync.getState().states[id];
  const pos = (st?.playing ? p.ms + (now - p.at) : p.ms) / 1000;
  const limit = st?.queue?.[st.index]?.duration_secs ?? 0;
  return limit > 0 ? Math.min(pos, limit) : pos;
}

function onMessage(m: any): void {
  switch (m.type) {
    case "welcome":
      useSync.setState({ name: m.name ?? null });
      reconcileSettings(m.settings ?? null, (blob: SettingsBlob) => send({ type: "settings", settings: blob }));
      positions = {};
      useSync.setState({ status: "online", devices: orderDevices(m.devices), activeDeviceId: m.activeDeviceId, states: {} });
      if (m.states && typeof m.states === "object") {
        for (const [id, st] of Object.entries<any>(m.states)) applyRemoteState(id, st);
      } else if (m.state && m.activeDeviceId) {
        applyRemoteState(m.activeDeviceId, m.state); // an engine without per-player states
      }
      lastQueue = null; // an engine we just (re)connected to knows nothing of this device yet
      publishOnConnect();
      void refreshApprovals();
      break;
    case "settings":
      remoteSettingsChanged(m.settings ?? null);
      break;
    case "devices": {
      const devices = orderDevices(m.devices);
      const online = new Set(devices.map((d) => d.deviceId));
      const states = Object.fromEntries(Object.entries(useSync.getState().states).filter(([id]) => online.has(id)));
      useSync.setState({ devices, activeDeviceId: m.activeDeviceId, states });
      const t = getTargetId();
      if (t && !online.has(t)) useTarget.setState({ targetId: null }); // the target left: back to this device
      break;
    }
    case "registry":
      useSync.setState({ registry: orderRegistry(m.devices ?? []) });
      break;
    case "renamed":
      useSync.setState({ name: String(m.name) });
      break;
    case "approval": // secure sign-in: another device asks to be let in
      addApproval(m.request);
      break;
    case "approval_done":
      removeApproval(String(m.id));
      break;
    case "cleared":
      if (m.state) useSync.setState({ states: {}, activeDeviceId: null });
      if (m.settings) remoteSettingsCleared();
      break;
    case "state":
      if (m.from && m.state) applyRemoteState(m.from, m.state);
      break;
    case "command":
      void handleCommand(m.cmd, m.args);
      break;
  }
}

async function handleCommand(cmd: string, args: any): Promise<void> {
  if (!syncOptions().playback) return; // remote control is switched off on this player
  const s = useStore.getState();
  switch (cmd) {
    case "play": if (!s.playing) s.playPause(); break;
    case "pause": if (s.playing) s.playPause(); break;
    case "toggle": s.playPause(); break;
    case "next": s.next(); break;
    case "prev": s.prev(); break;
    case "seek": if (typeof args?.positionMs === "number") s.setCurrentTime(args.positionMs / 1000); break;
    case "volume": if (typeof args?.volume === "number") s.setVolume(args.volume); break;
    case "load": await loadRemoteState(args?.state); break;
    case "enqueue": {
      const wire = args?.tracks as Omit<Track, "stream_url">[] | undefined;
      if (!Array.isArray(wire) || !wire.length) break;
      const tracks: Track[] = await Promise.all(wire.map(async (t) => ({ ...t, stream_url: await api.streamUrl(t.id) }) as Track));
      const cur = useStore.getState();
      runLocal(() => { // commands from another device act on this device's own player
        if (!cur.queue.length) { cur.playTrack(tracks[0], tracks, { local: true }); return; } // nothing queued: just start
        if (args.at === "end") { cur.appendToQueue(tracks); return; }
        const first = cur.currentIndex + 1; // where the first inserted track lands
        for (const t of [...tracks].reverse()) useStore.getState().addTrackNext(t); // keeps the given order
        if (args.at === "now") {
          const q = useStore.getState().queue;
          if (q[first]) useStore.getState().playTrack(q[first], q, { local: true });
        }
      });
      break;
    }
    case "jump": {
      const t = s.queue[args?.index];
      if (t) s.playTrack(t, s.queue, { local: true });
      break;
    }
    case "remove": {
      const t = s.queue[args?.index];
      if (t) s.removeFromQueue(t.id);
      break;
    }
    case "shuffle": if (typeof args?.on === "boolean" && s.shuffle !== args.on) s.toggleShuffle(); break;
    case "repeat": if (typeof args?.on === "boolean" && s.repeat !== args.on) s.toggleRepeat(); break;
    case "move": {
      const t = s.queue[args?.from];
      const to = args?.to;
      // reorderQueue takes the insertion index in the queue as it is before the item is removed
      if (t && Number.isInteger(to) && to >= 0 && to < s.queue.length) s.reorderQueue(t.id, to > args.from ? to + 1 : to);
      break;
    }
  }
}

/** Takes over playback from a transferred state: queue, track and position. */
async function loadRemoteState(st: RemoteState | undefined): Promise<void> {
  const rawQueue = st?.queue;
  if (!st || !rawQueue?.length) return;
  const queue: Track[] = await Promise.all(
    rawQueue.map(async (t) => ({ ...t, stream_url: await api.streamUrl(t.id) }) as Track),
  );
  const index = st.index >= 0 && st.index < queue.length ? st.index : 0;
  const track = queue[index];
  const { volume } = useStore.getState();
  useStore.setState({
    queue, currentIndex: index, playing: false, _stopped: false, duration: track.duration_secs || 0,
    _committedNext: null, _committedNextIndex: null, _chainedForTrackId: null,
  });
  await api.audioPlay(track.stream_url, volume / 100, track.duration_secs, true, true).catch(() => {});
  useStore.getState().setCurrentTime(st.positionMs / 1000);
  if (st.playing) useStore.getState().playPause();
}

// ── Publishing this device's state ──────────────────────────────────────────
function toWire(t: Track): Omit<Track, "stream_url"> {
  const { stream_url: _omit, ...rest } = t;
  return rest;
}

let lastQueue: Track[] | null = null;
let wasPlaying = false;
let lastPublishedKey = "";
let positionTimer: number | undefined;

function publish(forceQueue: boolean): void {
  if (!syncOptions().playback) return;
  const s = useStore.getState();
  if (!s.queue.length) return;
  send({
    type: "state",
    state: {
      ...(forceQueue ? { queue: s.queue.map(toWire) } : {}),
      index: s.currentIndex, positionMs: Math.round((s.currentTimeRaw ?? s.currentTime) * 1000), playing: s.playing, volume: s.volume,
      shuffle: s.shuffle, repeat: s.repeat,
    },
  });
}

function onStoreChange(): void {
  const s = useStore.getState();
  if (useSync.getState().status !== "online") { lastQueue = s.queue; return; }
  const queueChanged = s.queue !== lastQueue;
  lastQueue = s.queue;
  // Idle devices stay silent; a pause/stop is still published once.
  if (!s.playing && !wasPlaying) return;
  const key = `${s.currentIndex}|${s.playing}|${s.queue.length}|${s.queue[s.currentIndex]?.id}|${s.shuffle}|${s.repeat}`;
  if (!queueChanged && key === lastPublishedKey && s.playing === wasPlaying) return;
  wasPlaying = s.playing;
  lastPublishedKey = key;
  publish(queueChanged);
}

/** On (re)connect an app that holds a queue publishes its state once, so the other players can show it even when it is paused. */
function publishOnConnect(): void {
  if (useStore.getState().queue.length) publish(true);
}

let unsubStore: (() => void) | null = null;
let unsubConn: (() => void) | null = null;

function start(): void {
  wanted = true;
  retry = 0;
  void connect();
  unsubStore ??= useStore.subscribe(onStoreChange);
  clearInterval(positionTimer);
  // While playing, refresh the position every 3 s so other devices stay close.
  positionTimer = window.setInterval(() => {
    if (useSync.getState().status === "online" && useStore.getState().playing) publish(false);
  }, 3000);
  // A seek or a first connect while already playing should be sent right away.
  unsubConn ??= useSync.subscribe((st, prev) => {
    if (st.status === "online" && prev.status !== "online" && useStore.getState().playing) {
      wasPlaying = true; lastPublishedKey = ""; publish(true);
    }
  });
}

function stop(): void {
  wanted = false;
  clearTimeout(retryTimer);
  clearInterval(positionTimer);
  ws?.close();
  ws = null;
  useSync.setState({ status: "off", devices: [], activeDeviceId: null, states: {} });
}

function restart(): void {
  if (!wanted) return;
  stop();
  start();
}

/** Call once at startup: syncs whenever a server connection is active. */
export function initSync(): void {
  // Playback sync is part of the hello, so switching it reconnects; a preference group switched on takes over the shared values.
  useSyncOptions.subscribe((o, prev) => {
    if (o.playback !== prev.playback) restart();
    if (o.prefs !== prev.prefs) settingsOptionsChanged();
  });
  const update = (username: string) => (username ? start() : stop());
  update(useStore.getState().username);
  let prevUser = useStore.getState().username;
  useStore.subscribe((s) => {
    if (s.username !== prevUser) { prevUser = s.username; update(s.username); }
  });
}
