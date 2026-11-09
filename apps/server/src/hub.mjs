// Per-user sync hub. Pure logic, no sockets: a "connection" is anything with
// send(obj). Protocol (all JSON):
//   client → server
//     {type:"state", state}                       publish own playback state (queue only when changed)
//     {type:"command", target, cmd, args?}        remote-control another device
//     {type:"transfer", target}                   hand playback to another device
//     {type:"settings", settings}                 replace synced settings blob
//   server → client
//     {type:"welcome", deviceId, devices, state, activeDeviceId, settings}
//     {type:"devices", devices, activeDeviceId}
//     {type:"state", from, state}
//     {type:"command", from, cmd, args}
//     {type:"settings", from, settings}
//
// state = {queue:[trackId], index, positionMs, playing, volume?, updatedAt}
// The device that last published `playing:true` (or was transferred to) is the
// "active" one; it is the source of truth for position.

const MAX_QUEUE = 20000;
const MAX_QUEUE_BYTES = 3 * 1024 * 1024;
const COMMANDS = new Set(["play", "pause", "toggle", "seek", "next", "prev", "volume", "load", "enqueue", "jump", "remove"]);
const MAX_ENQUEUE = 1000; // tracks per `enqueue` command

export class Hub {
  constructor(store) {
    this.store = store; // {load(user)->obj|undefined, save(user,obj)}
    /** @type {Map<string, Map<string, {conn:any, info:any}>>} */
    this.users = new Map();
    /** @type {Map<string, {state:any, activeDeviceId:string|null, settings:any}>} */
    this.data = new Map();
  }

  _data(user) {
    let d = this.data.get(user);
    if (!d) {
      d = this.store.load(user) ?? { state: null, activeDeviceId: null, settings: null };
      this.data.set(user, d);
    }
    return d;
  }

  _devices(user) {
    return [...(this.users.get(user)?.values() ?? [])].map((e) => e.info);
  }

  _broadcast(user, msg, exceptId) {
    for (const [id, e] of this.users.get(user) ?? []) if (id !== exceptId) e.conn.send(msg);
  }

  /** Register a device. Returns an object to feed messages / disconnect into. */
  join(user, info, conn) {
    const deviceId = String(info.deviceId || "").slice(0, 64);
    if (!deviceId) throw new Error("deviceId required");
    let room = this.users.get(user);
    if (!room) this.users.set(user, (room = new Map()));
    const prev = room.get(deviceId);
    if (prev) prev.conn.close?.(); // same device reconnecting replaces old socket
    const clean = {
      deviceId,
      name: String(info.name || "Unknown").slice(0, 64),
      kind: ["electron", "web", "mobile"].includes(info.kind) ? info.kind : "web",
    };
    room.set(deviceId, { conn, info: clean });
    const d = this._data(user);
    conn.send({
      type: "welcome", deviceId, devices: this._devices(user),
      state: d.state, activeDeviceId: d.activeDeviceId, settings: d.settings,
    });
    this._broadcast(user, { type: "devices", devices: this._devices(user), activeDeviceId: d.activeDeviceId }, deviceId);

    return {
      message: (msg) => this._handle(user, deviceId, msg, conn),
      leave: () => {
        const cur = room.get(deviceId);
        if (!cur || cur.conn !== conn) return; // already replaced
        room.delete(deviceId);
        if (d.activeDeviceId === deviceId) { d.activeDeviceId = null; this.store.save(user, d); }
        if (room.size === 0) this.users.delete(user);
        else this._broadcast(user, { type: "devices", devices: this._devices(user), activeDeviceId: d.activeDeviceId });
      },
    };
  }

  _handle(user, from, msg, conn) {
    const d = this._data(user);
    const room = this.users.get(user);
    switch (msg?.type) {
      case "state": {
        const s = msg.state;
        if (!s || typeof s !== "object") return;
        // `queue` is only sent when it changed (items are opaque track
        // objects); otherwise the stored queue is kept, so position updates
        // stay tiny.
        const hasQueue = Array.isArray(s.queue);
        if (hasQueue && (s.queue.length > MAX_QUEUE || JSON.stringify(s.queue).length > MAX_QUEUE_BYTES)) return;
        const queue = hasQueue ? s.queue : d.state?.queue;
        if (!queue) return; // nothing to attach a position to yet
        d.state = {
          queue, index: Number(s.index) | 0,
          positionMs: Math.max(0, Number(s.positionMs) || 0), playing: !!s.playing,
          volume: typeof s.volume === "number" ? s.volume : undefined,
          updatedAt: Date.now(),
        };
        const becameActive = d.state.playing && d.activeDeviceId !== from;
        if (becameActive) d.activeDeviceId = from;
        this.store.save(user, d);
        this._broadcast(user, { type: "state", from, state: hasQueue ? d.state : { ...d.state, queue: undefined } }, from);
        if (becameActive) this._broadcast(user, { type: "devices", devices: this._devices(user), activeDeviceId: from });
        return;
      }
      case "command": {
        if (!COMMANDS.has(msg.cmd)) return;
        if (msg.cmd === "enqueue") {
          const tr = msg.args?.tracks;
          if (!Array.isArray(tr) || !tr.length || tr.length > MAX_ENQUEUE) return;
          if (msg.args.at !== "next" && msg.args.at !== "end") return;
        }
        if ((msg.cmd === "jump" || msg.cmd === "remove") && !Number.isInteger(msg.args?.index)) return;
        const t = room?.get(String(msg.target));
        if (t) t.conn.send({ type: "command", from, cmd: msg.cmd, args: msg.args });
        return;
      }
      case "transfer": {
        const t = room?.get(String(msg.target));
        if (!t || !d.state) return;
        // Previous owner pauses; target loads the stored state and plays.
        const prev = d.activeDeviceId && d.activeDeviceId !== msg.target ? room.get(d.activeDeviceId) : null;
        prev?.conn.send({ type: "command", from, cmd: "pause" });
        d.activeDeviceId = String(msg.target);
        this.store.save(user, d);
        t.conn.send({ type: "command", from, cmd: "load", args: { state: { ...d.state, playing: true } } });
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
      default:
        conn.send({ type: "error", message: "unknown message type" });
    }
  }
}
