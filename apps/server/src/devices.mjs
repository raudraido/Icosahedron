// Trusted devices ("secure sign-in", docs/secure-sign-in.md). A device holds a random secret that it
// uses where it used the account password: Subsonic style, t = md5(secret + salt). The engine finds
// the device by trying the account's few device secrets. Kept in devices.json (mode 600): Subsonic
// token auth needs the secret itself, so a leaked file leaks devices (each can be removed), not passwords.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";

export const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");
export const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const HISTORY_MAX = 200;
const MAX_DEVICES = 50;
const RECOVERY_CODES = 10;
const clip = (v, n = 64) => String(v ?? "").slice(0, n);
const key = (user) => String(user ?? "").toLowerCase();

/** A readable one-use code: XXXX-XXXX-XXXX without characters that look alike. */
export function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += alphabet[bytes[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
export const normalizeCode = (c) => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function createDevices({ dir, now = () => Date.now() } = {}) {
  const file = dir ? join(dir, "devices.json") : null;
  let data = { users: {}, history: [] };
  if (file) {
    mkdirSync(dir, { recursive: true });
    try { data = { users: {}, history: [], ...JSON.parse(readFileSync(file, "utf8")) }; } catch { /* first run */ }
  }
  let dirty = false;
  const save = () => {
    dirty = false;
    if (!file) return;
    writeFileSync(file + ".tmp", JSON.stringify(data), { mode: 0o600 });
    renameSync(file + ".tmp", file);
    try { chmodSync(file, 0o600); } catch { /* best effort */ }
  };
  const rec = (user, create = false) => {
    const k = key(user);
    if (!data.users[k] && create) data.users[k] = { name: clip(user), devices: {}, recovery: [] };
    return data.users[k];
  };
  const view = (d) => ({
    id: d.id, name: d.name, kind: d.kind, app: d.app, version: d.version,
    createdAt: d.createdAt, lastSeen: d.lastSeen, lastAddress: d.lastAddress, appPassword: d.appPassword === true,
  });

  return {
    /** The account and device whose secret makes this {u,t,s}, or null. */
    resolve(cred) {
      if (!cred?.u || !cred.t || !cred.s) return null;
      const r = rec(cred.u);
      if (!r) return null;
      const t = Buffer.from(String(cred.t).toLowerCase());
      for (const d of Object.values(r.devices)) {
        const want = Buffer.from(md5(d.secret + cred.s));
        if (want.length === t.length && timingSafeEqual(want, t)) return { user: r.name, device: d };
      }
      return null;
    },
    /** Notes that a device was seen (saved at most once a minute). */
    touch(device, address = "") {
      const t = now();
      if (t - (device.lastSeen ?? 0) < 60_000) return;
      device.lastSeen = t;
      if (address) device.lastAddress = clip(address, 64);
      dirty = true;
      if (file) save();
    },
    /** Makes a device for an account. Returns {device, secret, cred} (the secret is shown only now). */
    create(user, info = {}, { appPassword = false, address = "" } = {}) {
      const r = rec(user, true);
      if (Object.keys(r.devices).length >= MAX_DEVICES) throw Object.assign(new Error("too many devices"), { code: 409 });
      const id = randomBytes(8).toString("hex");
      const secret = randomBytes(24).toString("base64url");
      const d = {
        id, secret, name: clip(info.name) || "Device", kind: clip(info.kind, 16) || "web", app: clip(info.app), version: clip(info.version),
        createdAt: now(), lastSeen: now(), lastAddress: clip(address, 64), appPassword,
      };
      r.devices[id] = d;
      save();
      const salt = randomBytes(6).toString("hex");
      return { device: view(d), secret, cred: { u: r.name, t: md5(secret + salt), s: salt } };
    },
    /** The account name as the first device spelled it (Navidrome ignores case, the registry keeps one spelling). */
    canonical(user) { return rec(user)?.name ?? String(user); },
    list(user) { return Object.values(rec(user)?.devices ?? {}).map(view).sort((a, b) => b.lastSeen - a.lastSeen); },
    has(user) { return Object.keys(rec(user)?.devices ?? {}).length > 0; },
    remove(user, id) {
      const r = rec(user);
      if (!r?.devices[id]) return false;
      delete r.devices[id];
      save();
      return true;
    },
    /** Replaces the account's recovery codes; the plain codes are returned once. */
    newRecoveryCodes(user) {
      const r = rec(user, true);
      const codes = Array.from({ length: RECOVERY_CODES }, makeCode);
      r.recovery = codes.map((c) => sha256(normalizeCode(c)));
      save();
      return codes;
    },
    hasRecoveryCodes(user) { return (rec(user)?.recovery ?? []).length > 0; },
    /** Uses a recovery code (it works once). */
    useRecovery(user, code) {
      const r = rec(user);
      const h = sha256(normalizeCode(code));
      if (!r || !r.recovery.includes(h)) return false;
      r.recovery = r.recovery.filter((x) => x !== h);
      save();
      return true;
    },
    log(entry) {
      data.history.push({ at: now(), ...entry });
      if (data.history.length > HISTORY_MAX) data.history.splice(0, data.history.length - HISTORY_MAX);
      save();
    },
    history(user) { return data.history.filter((h) => key(h.user) === key(user)).slice(-100).reverse(); },
  };
}
