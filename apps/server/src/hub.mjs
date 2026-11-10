// Per-user sync hub. Pure logic, no sockets: a "connection" is anything with
// send(obj). Protocol (all JSON):
//   client → server
//     {type:"state", state}                       publish own playback state (queue only when changed)
//     {type:"command", target, cmd, args?}        remote-control another device
//     {type:"transfer", target}                   hand playback to another device
//     {type:"settings", settings}                 replace synced settings blob
//     {type:"rename", target?, name} / {type:"forget", target} / {type:"clear", state?, settings?}
//   server → client
//     {type:"welcome", deviceId, devices, state, activeDeviceId, settings}
//     {type:"devices", devices, activeDeviceId}
//     {type:"state", from, state}
//     {type:"command", from, cmd, args}
//     {type:"settings", from, settings}
//     {type:"registry", devices} / {type:"renamed", name} / {type:"cleared", state, settings}
//
// state = {queue:[trackId], index, positionMs, playing, volume?, updatedAt}
// Every player publishes its own state; the hub keeps them per player (online ones) and forwards each
// to the others. `activeDeviceId` / `state` remain for players that follow a single state: the player
// that last started playing (or was transferred to).

const MAX_QUEUE = 20000;
const MAX_QUEUE_BYTES = 3 * 1024 * 1024;
const COMMANDS = new Set(["play", "pause", "toggle", "seek", "next", "prev", "volume", "load", "enqueue", "jump", "remove", "shuffle", "repeat", "move"]);
const MAX_ENQUEUE = 1000; // tracks per `enqueue` command
const PLAYBACK_MESSAGES = new Set(["state", "devices"]);
const FORGET_AFTER_MS = 90 * 24 * 3600 * 1000; // offline devices are dropped from the registry after this

export class Hub {
  constructor(store) {
    this.store = store; // {load(user)->obj|undefined, save(user,obj)}
    /** @type {Map<string, Map<string, {conn:any, info:any}>>} */
    this.users = new Map();
    /** @type {Map<string, {state:any, activeDeviceId:string|null, settings:any}>} */
    this.data = new Map();
    /** Each online player's own playback state: user -> deviceId -> state. Players play independently. */
    this.states = new Map();
  }

  _data(user) {
    let d = this.data.get(user);
    if (!d) {
      d = this.store.load(user) ?? { state: null, activeDeviceId: null, settings: null };
      d.devices ??= {}; // registry of the user's players (older data files have none)
      this.data.set(user, d);
    }
    return d;
  }

  _states(user) {
    let m = this.states.get(user);
    if (!m) this.states.set(user, (m = new Map()));
    return m;
  }

  /** A player's state to everyone who follows playback. Players that predate per-player states
   *  (`proto` 1) understand one state only, the active player's. */
  _broadcastState(user, from, state) {
    const activeId = this._data(user).activeDeviceId;
    for (const [id, e] of this.users.get(user) ?? []) {
      if (id === from || !e.info.playback) continue;
      if (e.info.proto < 2 && from !== activeId) continue;
      e.conn.send({ type: "state", from, state });
    }
  }

  /** Online players that take part in playback sync (what remote control and "Play here" show). */
  _devices(user) {
    return [...(this.users.get(user)?.values() ?? [])]
      .filter((e) => e.info.playback)
      .map((e) => ({ deviceId: e.info.deviceId, name: e.info.name, kind: e.info.kind }));
  }

  /** Every registered player, online or not, for the "registered players" settings list. */
  _registry(user) {
    const d = this._data(user);
    const room = this.users.get(user);
    const now = Date.now();
    return Object.entries(d.devices).map(([deviceId, r]) => {
      const online = !!room?.has(deviceId);
      return { deviceId, name: r.name, kind: r.kind, online, lastSeen: online ? now : r.lastSeen };
    });
  }

  _sendRegistry(user, exceptId) {
    this._broadcast(user, { type: "registry", devices: this._registry(user) }, exceptId);
  }

  /** Drops players that have been offline for 90 days. */
  _sweep(user) {
    const d = this._data(user);
    const room = this.users.get(user);
    let changed = false;
    for (const [id, r] of Object.entries(d.devices)) {
      if (!room?.has(id) && Date.now() - r.lastSeen > FORGET_AFTER_MS) { delete d.devices[id]; changed = true; }
    }
    if (changed) this.store.save(user, d);
  }

  _broadcast(user, msg, exceptId) {
    const playbackOnly = PLAYBACK_MESSAGES.has(msg.type); // players with playback sync off do not get these
    for (const [id, e] of this.users.get(user) ?? []) {
      if (id === exceptId || (playbackOnly && !e.info.playback)) continue;
      e.conn.send(msg);
    }
  }

  /** Register a device. Returns an object to feed messages / disconnect into. */
  join(user, info, conn) {
    const deviceId = String(info.deviceId || "").slice(0, 64);
    if (!deviceId) throw new Error("deviceId required");
    let room = this.users.get(user);
    if (!room) this.users.set(user, (room = new Map()));
    const prev = room.get(deviceId);
    if (prev) prev.conn.close?.(); // same device reconnecting replaces old socket
    const d = this._data(user);
    this._sweep(user);
    const kind = ["electron", "web", "mobile"].includes(info.kind) ? info.kind : "web";
    // The first hello names the player; after that the registry decides (it is renamed from the settings).
    const name = d.devices[deviceId]?.name ?? (String(info.name || "Unknown").slice(0, 64) || "Unknown");
    // `playback:false`: the player only takes part in preference sync — not listed, not controlled, publishes nothing.
    const clean = { deviceId, name, kind, playback: info.playback !== false, proto: Number(info.proto) >= 2 ? 2 : 1 };
    d.devices[deviceId] = { name, kind, lastSeen: Date.now() };
    this.store.save(user, d);
    room.set(deviceId, { conn, info: clean });
    const welcome = {
      type: "welcome", deviceId, name, devices: this._devices(user),
      state: clean.playback ? d.state : null, activeDeviceId: clean.playback ? d.activeDeviceId : null, settings: d.settings,
    };
    if (clean.proto >= 2) { // the other players' own states
      welcome.states = {};
      if (clean.playback) for (const [id, st] of this._states(user)) if (id !== deviceId && room.get(id)?.info.playback) welcome.states[id] = st;
    }
    conn.send(welcome);
    conn.send({ type: "registry", devices: this._registry(user) });
    this._sendRegistry(user, deviceId);
    this._broadcast(user, { type: "devices", devices: this._devices(user), activeDeviceId: d.activeDeviceId }, deviceId);

    return {
      message: (msg) => this._handle(user, deviceId, msg, conn),
      leave: () => {
        const cur = room.get(deviceId);
        if (!cur || cur.conn !== conn) return; // already replaced
        room.delete(deviceId);
        this._states(user).delete(deviceId);
        if (d.devices[deviceId]) d.devices[deviceId].lastSeen = Date.now();
        if (d.activeDeviceId === deviceId) d.activeDeviceId = null;
        this.store.save(user, d);
        if (room.size === 0) this.users.delete(user);
        else {
          this._broadcast(user, { type: "devices", devices: this._devices(user), activeDeviceId: d.activeDeviceId });
          this._sendRegistry(user);
        }
      },
    };
  }

  _handle(user, from, msg, conn) {
    const d = this._data(user);
    const room = this.users.get(user);
    const sender = room?.get(from)?.info;
    if (sender && !sender.playback && ["state", "command", "transfer"].includes(msg?.type)) return; // sync of playback is off for it
    switch (msg?.type) {
      case "state": {
        const s = msg.state;
        if (!s || typeof s !== "object") return;
        // `queue` is only sent when it changed (items are opaque track
        // objects); otherwise the stored queue is kept, so position updates
        // stay tiny.
        const hasQueue = Array.isArray(s.queue);
        if (hasQueue && (s.queue.length > MAX_QUEUE || JSON.stringify(s.queue).length > MAX_QUEUE_BYTES)) return;
        const states = this._states(user);
        // Players publish their own state, so nobody overwrites anybody else's.
        const queue = hasQueue ? s.queue : (states.get(from)?.queue ?? (d.activeDeviceId === from ? d.state?.queue : undefined));
        if (!queue) return; // nothing to attach a position to yet
        const st = {
          queue, index: Number(s.index) | 0,
          positionMs: Math.max(0, Number(s.positionMs) || 0), playing: !!s.playing,
          volume: typeof s.volume === "number" ? s.volume : undefined,
          shuffle: !!s.shuffle, repeat: !!s.repeat,
          updatedAt: Date.now(),
        };
        const wasPlaying = !!states.get(from)?.playing;
        states.set(from, st);
        // Kept for players that follow one state only: the one of the player that last STARTED playing
        // (a player that keeps playing does not keep taking the role back).
        const becameActive = st.playing && d.activeDeviceId !== from && (!wasPlaying || !d.activeDeviceId);
        if (becameActive) d.activeDeviceId = from;
        if (d.activeDeviceId === from || !d.activeDeviceId) { d.state = st; this.store.save(user, d); }
        else if (becameActive) this.store.save(user, d);
        this._broadcastState(user, from, hasQueue ? st : { ...st, queue: undefined });
        if (becameActive) this._broadcast(user, { type: "devices", devices: this._devices(user), activeDeviceId: from });
        return;
      }
      case "command": {
        if (!COMMANDS.has(msg.cmd)) return;
        if (msg.cmd === "enqueue") {
          const tr = msg.args?.tracks;
          if (!Array.isArray(tr) || !tr.length || tr.length > MAX_ENQUEUE) return;
          if (!["now", "next", "end"].includes(msg.args.at)) return;
        }
        if ((msg.cmd === "jump" || msg.cmd === "remove") && !Number.isInteger(msg.args?.index)) return;
        if ((msg.cmd === "shuffle" || msg.cmd === "repeat") && typeof msg.args?.on !== "boolean") return;
        if (msg.cmd === "move" && !(Number.isInteger(msg.args?.from) && Number.isInteger(msg.args?.to))) return;
        const t = room?.get(String(msg.target));
        if (t?.info.playback) t.conn.send({ type: "command", from, cmd: msg.cmd, args: msg.args });
        return;
      }
      case "transfer": {
        // Moves a player's playback to another: the source pauses, the target loads its state and plays.
        // `source` defaults to the player that last started playing.
        const target = String(msg.target);
        const t = room?.get(target);
        const sourceId = msg.source ? String(msg.source) : d.activeDeviceId;
        const src = (sourceId && this._states(user).get(sourceId)) || (sourceId === d.activeDeviceId ? d.state : null) || d.state;
        if (!t || !t.info.playback || !src) return;
        if (sourceId && sourceId !== target) room.get(sourceId)?.conn.send({ type: "command", from, cmd: "pause" });
        d.activeDeviceId = target;
        d.state = src;
        this.store.save(user, d);
        t.conn.send({ type: "command", from, cmd: "load", args: { state: { ...src, playing: true } } });
        this._broadcast(user, { type: "devices", devices: this._devices(user), activeDeviceId: d.activeDeviceId });
        return;
      }
      case "settings": {
        if (typeof msg.settings !== "object" || msg.settings === null) return;
        if (JSON.stringify(msg.settings).length > 256 * 1024) return;
        d.settings = msg.settings;
        this.store.save(user, d);
        this._broadcast(user, { type: "settings", from, settings: d.settings }, from);
        return;
      }
      case "rename": {
        const id = String(msg.target ?? from);
        const name = String(msg.name ?? "").trim().slice(0, 64);
        if (!name || !d.devices[id]) return;
        d.devices[id].name = name;
        const t = room?.get(id);
        if (t) t.info.name = name;
        this.store.save(user, d);
        t?.conn.send({ type: "renamed", name });
        this._broadcast(user, { type: "devices", devices: this._devices(user), activeDeviceId: d.activeDeviceId });
        this._sendRegistry(user);
        return;
      }
      case "forget": {
        const id = String(msg.target ?? "");
        if (!d.devices[id]) return;
        if (room?.has(id)) { conn.send({ type: "error", message: "device is online" }); return; } // only offline players can be forgotten
        delete d.devices[id];
        this.store.save(user, d);
        this._sendRegistry(user);
        return;
      }
      case "clear": {
        // Wipes what the engine holds for this user: the playback state and/or the shared preferences.
        const state = msg.state === true, settings = msg.settings === true;
        if (state) { d.state = null; d.activeDeviceId = null; this._states(user).clear(); }
        if (settings) d.settings = null;
        if (state || settings) {
          this.store.save(user, d);
          this._broadcast(user, { type: "cleared", state, settings });
          if (state) this._broadcast(user, { type: "devices", devices: this._devices(user), activeDeviceId: null });
        }
        return;
      }
      default:
        conn.send({ type: "error", message: "unknown message type" });
    }
  }
}
