// Quick Connect, modelled on Jellyfin's (QuickConnectController / QuickConnectManager):
//   1. a device with no sign-in asks to connect and gets a `secret` (kept on the device) and a
//      six-digit `code` (shown on its screen);
//   2. a user who is already signed in somewhere enters the code and authorizes it;
//   3. the device, which polls with its secret, then claims the sign-in.
// Requests live in memory for ten minutes. Off until switched on: by an administrator in Settings
// (kept in settings.json) or, taking precedence and locking the switch, by QUICK_CONNECT in the environment.
import { randomBytes, randomInt } from "node:crypto";

export const QC_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_PENDING = 100;
const INITIATE_PER_MINUTE = 10; // per client address
const FAILED_AUTHORIZE_PER_MINUTE = 10; // per user: guessing codes

const clip = (v, n = 64) => String(v ?? "").slice(0, n);

export function createQuickConnect({ enabled = false, locked = false, onChange, now = () => Date.now() } = {}) {
  let on = !!enabled;
  /** code -> request */
  const requests = new Map();
  /** secret -> { at, auth } */
  const authorized = new Map();
  const initiations = new Map(); // address -> timestamps
  const failures = new Map(); // user -> timestamps

  const recent = (map, key, windowMs) => {
    const arr = (map.get(key) ?? []).filter((t) => t > now() - windowMs);
    map.set(key, arr);
    return arr;
  };

  function expire() {
    const min = now() - QC_TIMEOUT_MS;
    for (const [code, r] of requests) if (r.dateAdded < min) requests.delete(code);
    for (const [secret, a] of authorized) if (a.at < min) authorized.delete(secret);
  }

  return {
    get enabled() { return on; },
    /** True when the environment decides (QUICK_CONNECT set): the switch in the settings is then read-only. */
    get locked() { return locked; },

    /** Switches it on or off (an administrator, from Settings). Switching off drops every pending request. */
    setEnabled(value) {
      if (locked) return false;
      on = !!value;
      if (!on) { requests.clear(); authorized.clear(); }
      onChange?.(on);
      return true;
    },

    /** A device asks to connect. Returns {secret, code, expiresIn} or {error}. */
    initiate(device, address = "") {
      if (!on) return { error: "disabled" };
      expire();
      if (requests.size >= MAX_PENDING) return { error: "busy" };
      const hits = recent(initiations, address, 60_000);
      if (hits.length >= INITIATE_PER_MINUTE) return { error: "rate" };
      hits.push(now());
      let code;
      do { code = String(randomInt(100000, 1000000)); } while (requests.has(code));
      const info = { deviceId: clip(device?.deviceId), name: clip(device?.name), app: clip(device?.app), version: clip(device?.version), kind: clip(device?.kind, 16) };
      requests.set(code, { code, secret: randomBytes(32).toString("hex"), dateAdded: now(), authenticated: false, device: info });
      const r = requests.get(code);
      return { secret: r.secret, code, expiresIn: QC_TIMEOUT_MS / 1000, device: info };
    },

    /** What the device polls: has someone authorized it yet. null = unknown or expired. */
    status(secret) {
      if (!on) return null;
      expire();
      for (const r of requests.values()) {
        if (r.secret === secret) return { authenticated: r.authenticated, code: r.code, device: r.device };
      }
      return null;
    },

    /** A signed-in user authorizes a code (`auth` = their verified {u,t,s}). "ok" | "unknown" | "already" | "rate" | "disabled". */
    authorize(code, auth) {
      if (!on) return "disabled";
      expire();
      const fails = recent(failures, auth.u, 60_000);
      if (fails.length >= FAILED_AUTHORIZE_PER_MINUTE) return "rate";
      const r = requests.get(String(code));
      if (!r) { fails.push(now()); return "unknown"; }
      if (r.authenticated) return "already";
      r.authenticated = true;
      r.dateAdded = now() + 60_000; // stays for another minute so the device certainly sees it (as Jellyfin does)
      authorized.set(r.secret, { at: now(), auth: { u: auth.u, t: auth.t, s: auth.s } });
      return "ok";
    },

    /** The device claims its sign-in once; null when nothing was authorized for the secret. */
    claim(secret) {
      if (!on) return null;
      expire();
      const a = authorized.get(secret);
      if (!a) return null;
      authorized.delete(secret);
      for (const [code, r] of requests) if (r.secret === secret) requests.delete(code);
      return a.auth;
    },
  };
}
