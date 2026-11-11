// Sign-in requests waiting for a trusted device to approve them (docs/secure-sign-in.md).
// A request lives in memory for five minutes. The new device is shown a number; the approving
// device is shown three and must pick the one it sees on the other screen, so a prompt that
// somebody else triggered is not approved by reflex.
import { randomBytes, randomInt } from "node:crypto";

export const REQUEST_TTL_MS = 5 * 60 * 1000;
const MAX_OPEN_PER_USER = 3;
const clip = (v, n = 64) => String(v ?? "").slice(0, n);

export function createApprovals({ now = () => Date.now() } = {}) {
  /** id -> request */
  const requests = new Map();

  function expire() {
    for (const [id, r] of requests) {
      if (r.state === "pending" && r.expiresAt <= now()) r.state = "expired";
      // an answered or expired request stays a little while so the waiting device learns the outcome
      if (r.expiresAt + 2 * 60 * 1000 <= now()) requests.delete(id);
    }
  }
  const open = (user) => [...requests.values()].filter((r) => r.user === user && r.state === "pending");

  return {
    /** A new device asks to be let in. {id, pollSecret, number, expiresIn} or {error:"busy"}. */
    request(user, device, address = "") {
      expire();
      if (open(user).length >= MAX_OPEN_PER_USER) return { error: "busy" };
      const number = randomInt(10, 100);
      const decoys = new Set();
      while (decoys.size < 2) { const n = randomInt(10, 100); if (n !== number) decoys.add(n); }
      const choices = [number, ...decoys].sort(() => randomInt(0, 2) - 0.5);
      const r = {
        id: randomBytes(9).toString("hex"), pollSecret: randomBytes(24).toString("hex"), user, number, choices,
        device: { name: clip(device?.name) || "Device", kind: clip(device?.kind, 16) || "web", app: clip(device?.app), version: clip(device?.version) },
        address: clip(address), at: now(), expiresAt: now() + REQUEST_TTL_MS, state: "pending", result: null,
      };
      requests.set(r.id, r);
      return { id: r.id, pollSecret: r.pollSecret, number, expiresIn: REQUEST_TTL_MS / 1000, request: r };
    },
    /** What an approving device sees: no right answer in it. */
    pending(user) {
      expire();
      return open(user).map((r) => ({ id: r.id, device: r.device, address: r.address, at: r.at, expiresAt: r.expiresAt, choices: r.choices }));
    },
    get(id) { expire(); return requests.get(id) ?? null; },
    /** "approved" | "denied" | "wrong" | "unknown" | "expired". The caller makes the device on "approved". */
    decide(user, id, approve, number) {
      expire();
      const r = requests.get(id);
      if (!r || r.user !== user) return "unknown";
      if (r.state === "expired") return "expired";
      if (r.state !== "pending") return "unknown";
      if (!approve) { r.state = "denied"; return "denied"; }
      if (Number(number) !== r.number) { r.state = "denied"; return "wrong"; }
      r.state = "approved";
      return "approved";
    },
    /** Attaches what the new device receives once. */
    complete(id, result) { const r = requests.get(id); if (r) r.result = result; },
    /** What the waiting device sees. The secret is handed over once. */
    poll(id, pollSecret) {
      expire();
      const r = requests.get(id);
      if (!r || r.pollSecret !== pollSecret) return null;
      if (r.state === "approved" && r.result) {
        const result = r.result;
        r.result = null;
        r.state = "done";
        return { state: "approved", ...result };
      }
      if (r.state === "done") return { state: "expired" };
      return { state: r.state, expiresAt: r.expiresAt };
    },
  };
}

/** Counts events in a sliding window: hit(key, limit, windowMs) is false once the limit is used up. */
export function createLimiter({ now = () => Date.now() } = {}) {
  const hits = new Map();
  return {
    hit(key, limit, windowMs) {
      const t = now();
      const arr = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
      if (arr.length >= limit) { hits.set(key, arr); return false; }
      arr.push(t);
      hits.set(key, arr);
      if (hits.size > 5000) hits.delete(hits.keys().next().value);
      return true;
    },
  };
}
