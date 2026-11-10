// Sync client for the web engine (apps/server): publishes this device's
// playback to the user's other devices and lets them be controlled remotely.
//
// Model: only the device that is playing publishes (otherwise an idle device
// restoring its saved queue would overwrite the state of the one in use).
// Other devices don't mirror — they show the active device's now-playing in
// the picker and can send commands or transfer playback here.
import { create } from "zustand";
import { platform } from "../platform";
import { getSyncUrl, saveEngineUrl } from "../platform/syncUrl";
import { api, type Track } from "./api";
import { useStore } from "../store";
import { reconcileSettings, remoteSettingsChanged, remoteSettingsCleared, settingsDisconnected, settingsOptionsChanged, type SettingsBlob } from "./settingsSync";
import { syncOptions, useSyncOptions } from "./syncOptions";

export interface SyncDevice { deviceId: string; name: string; kind: "electron" | "web" | "mobile" }
/** A player in the engine's registry: online or not (the picker only lists the online ones). */
export interface RegistryDevice { deviceId: string; name: string; kind: SyncDevice["kind"]; online: boolean; lastSeen: number }
export interface RemoteState {
  queue?: Omit<Track, "stream_url">[]; index: number; positionMs: number; playing: boolean; updatedAt: number;
  shuffle?: boolean; repeat?: boolean;
}

interface SyncStore {
  status: "off" | "connecting" | "online";
  deviceId: string;
  devices: SyncDevice[];
  activeDeviceId: string | null;
  /** Latest state published by whichever device is active (queue kept from the last time it was sent). */
  remote: (RemoteState & { from: string }) | null;
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
  status: "off", deviceId: loadDeviceId(), devices: [], activeDeviceId: null, remote: null, syncUrl: getSyncUrl(), name: null, registry: [],
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
function notify(text: string): void {
  useSyncNotice.setState({ text });
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => useSyncNotice.setState({ text: "" }), 2500);
}
const deviceLabel = (id: string) => useSync.getState().devices.find((d) => d.deviceId === id)?.name ?? "device";

export const syncActions = {
  command: (target: string, cmd: string, args?: unknown) => send({ type: "command", target, cmd, args }),
  transfer: (target: string) => send({ type: "transfer", target }),
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
    sock.send(JSON.stringify({ type: "hello", auth, device: { deviceId: useSync.getState().deviceId, name: deviceName(), kind: platform.kind, playback: syncOptions().playback } }));
  };
  sock.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data)); } catch { /* ignore malformed */ } };
  sock.onclose = (ev) => {
    if (ws === sock) ws = null;
    settingsDisconnected();
    useSync.setState({ status: "off", devices: [], activeDeviceId: null });
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

function onMessage(m: any): void {
  switch (m.type) {
    case "welcome":
      useSync.setState({ name: m.name ?? null });
      reconcileSettings(m.settings ?? null, (blob: SettingsBlob) => send({ type: "settings", settings: blob }));
      useSync.setState({
        status: "online", devices: orderDevices(m.devices), activeDeviceId: m.activeDeviceId,
        remote: m.state && m.activeDeviceId ? { ...m.state, from: m.activeDeviceId } : m.state ? { ...m.state, from: "" } : null,
      });
      break;
    case "settings":
      remoteSettingsChanged(m.settings ?? null);
      break;
    case "devices":
      useSync.setState({ devices: orderDevices(m.devices), activeDeviceId: m.activeDeviceId });
      break;
    case "registry":
      useSync.setState({ registry: orderRegistry(m.devices ?? []) });
      break;
    case "renamed":
      useSync.setState({ name: String(m.name) });
      break;
    case "cleared":
      if (m.state) useSync.setState({ remote: null, activeDeviceId: null });
      if (m.settings) remoteSettingsCleared();
      break;
    case "state": {
      const prev = useSync.getState().remote;
      useSync.setState({ remote: { ...m.state, queue: m.state.queue ?? prev?.queue, from: m.from } });
      break;
    }
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
      if (!cur.queue.length) { cur.playTrack(tracks[0], tracks); break; } // nothing queued: just start
      if (args.at === "end") { cur.appendToQueue(tracks); break; }
      const first = cur.currentIndex + 1; // where the first inserted track lands
      for (const t of [...tracks].reverse()) useStore.getState().addTrackNext(t); // keeps the given order
      if (args.at === "now") {
        const q = useStore.getState().queue;
        if (q[first]) useStore.getState().playTrack(q[first], q);
      }
      break;
    }
    case "jump": {
      const t = s.queue[args?.index];
      if (t) s.playTrack(t, s.queue);
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
  publish(queueChanged || useSync.getState().activeDeviceId !== useSync.getState().deviceId);
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
  useSync.setState({ status: "off", devices: [], activeDeviceId: null, remote: null });
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
