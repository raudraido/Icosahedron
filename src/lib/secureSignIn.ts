// Secure sign-in, the app side (docs/secure-sign-in.md): asking the engine to let this device in,
// approving other devices, and managing the trusted ones.
import { createEngine } from "../platform/engineApi";
import { platform } from "../platform";

const engine = createEngine(() => platform.invoke("sync_auth"));

export interface DeviceInfo { name: string; kind: string; app: string; version: string }

/** What the engine is told about this device: a readable name for the prompt on the other device. */
export function describeThisDevice(): DeviceInfo {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const os = /Windows/i.test(ua) ? "Windows" : /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "";
  if (platform.kind === "electron") return { name: `Icosahedron on ${os || "desktop"}`, kind: "desktop", app: "Icosahedron", version: "" };
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return { name: os ? `${browser} on ${os}` : browser, kind: "web", app: "Icosahedron web", version: "" };
}

const json = async (r: Response | null) => { try { return r ? await r.json() : null; } catch { return null; } };

/** Whether `base` is an engine, and whether it asks for approval. A plain Navidrome answers 404 here. */
export async function probeEngine(base: string): Promise<{ engine: boolean; secure: boolean }> {
  try {
    const r = await fetch(base.replace(/\/+$/, "") + "/device/info", { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return { engine: false, secure: false };
    const j = await r.json();
    return typeof j?.secure === "boolean" ? { engine: true, secure: j.secure } : { engine: false, secure: false };
  } catch {
    return { engine: false, secure: false };
  }
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; json: any }> {
  try {
    const r = await fetch(base.replace(/\/+$/, "") + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return { status: r.status, json: await json(r) };
  } catch {
    return { status: 0, json: null };
  }
}

export type RequestResult =
  | { ok: true; id: string; secret: string; number: number; expiresIn: number }
  | { ok: false; reason: "wrong" | "no_trusted_device" | "rate" | "busy" | "offline" | "not_required" | "error" };

export async function requestSignIn(base: string, user: string, password: string): Promise<RequestResult> {
  const r = await post(base, "/device/request", { user, password, device: describeThisDevice() });
  if (r.status === 200) return { ok: true, id: r.json.id, secret: r.json.secret, number: r.json.number, expiresIn: r.json.expiresIn };
  if (r.status === 0) return { ok: false, reason: "offline" };
  if (r.status === 401) return { ok: false, reason: "wrong" };
  if (r.status === 409) return { ok: false, reason: r.json?.error === "no_trusted_device" ? "no_trusted_device" : "not_required" };
  if (r.status === 429) return { ok: false, reason: r.json?.error?.includes("open") ? "busy" : "rate" };
  return { ok: false, reason: "error" };
}

export interface Granted { user: string; secret: string; recoveryCodes?: string[] }

export type PollResult =
  | { state: "pending" | "denied" | "expired" | "gone" }
  | ({ state: "approved" } & Granted);

export async function pollSignIn(base: string, id: string, secret: string): Promise<PollResult> {
  try {
    const r = await fetch(`${base.replace(/\/+$/, "")}/device/poll?id=${encodeURIComponent(id)}&secret=${encodeURIComponent(secret)}`, { signal: AbortSignal.timeout(10000) });
    if (r.status === 404) return { state: "gone" };
    const j = await r.json();
    if (j.state === "approved") return { state: "approved", user: j.cred?.u ?? "", secret: j.secret };
    return { state: j.state === "denied" ? "denied" : j.state === "expired" ? "expired" : "pending" };
  } catch {
    return { state: "pending" }; // a hiccup: keep asking until it expires
  }
}

/** A recovery code, or an invite from the administrator, instead of an approval. */
export async function signInWithCode(base: string, user: string, password: string, code: string): Promise<{ ok: true; granted: Granted } | { ok: false; reason: "wrong" | "rate" | "offline" | "error" }> {
  for (const path of ["/device/recover", "/device/redeem"]) {
    const r = await post(base, path, { user, password, code, device: describeThisDevice() });
    if (r.status === 200) return { ok: true, granted: { user: r.json.cred?.u ?? user, secret: r.json.secret, recoveryCodes: r.json.recoveryCodes } };
    if (r.status === 0) return { ok: false, reason: "offline" };
    if (r.status === 429) return { ok: false, reason: "rate" };
    if (r.status !== 401) return { ok: false, reason: "error" };
  }
  return { ok: false, reason: "wrong" };
}

// --- With a signed-in device (Settings, and the approval prompt) ---

export interface TrustedDevice { id: string; name: string; kind: string; app: string; version: string; createdAt: number; lastSeen: number; lastAddress: string; appPassword: boolean }
export interface HistoryEntry { at: number; device?: string; kind?: string; address?: string; result: string }
export interface PendingApproval { id: string; device: { name: string; kind: string; app: string; version: string }; address: string; at: number; expiresAt: number; choices: number[] }

export async function secureIsOn(): Promise<boolean> {
  const r = await engine("/device/info");
  return !!(await json(r))?.secure;
}

export type TurnOnResult =
  | { ok: true; secret: string; user: string; recoveryCodes: string[] }
  | { ok: false; reason: "not_admin" | "navidrome_does_not_trust_engine" | "already" | "offline" | "error" };

/** Switches it on (an administrator). This device becomes the first trusted one and must sign in again with the secret it gets. */
export async function turnOnSecure(): Promise<TurnOnResult> {
  const r = await engine("/device/secure", { method: "PUT", body: JSON.stringify({ enabled: true, device: describeThisDevice() }) });
  if (!r) return { ok: false, reason: "offline" };
  const j = await json(r);
  if (r.ok) return { ok: true, secret: j.secret, user: j.cred?.u ?? "", recoveryCodes: j.recoveryCodes ?? [] };
  if (r.status === 403) return { ok: false, reason: "not_admin" };
  if (r.status === 412) return { ok: false, reason: "navidrome_does_not_trust_engine" };
  if (r.status === 409) return { ok: false, reason: "already" };
  return { ok: false, reason: "error" };
}

export async function turnOffSecure(): Promise<boolean> {
  const r = await engine("/device/secure", { method: "PUT", body: JSON.stringify({ enabled: false }) });
  return !!r?.ok;
}

export async function listTrustedDevices(): Promise<{ devices: TrustedDevice[]; current: string | null } | null> {
  const r = await engine("/device/list");
  return r?.ok ? ((await json(r)) as { devices: TrustedDevice[]; current: string | null }) : null;
}
export async function removeTrustedDevice(id: string): Promise<boolean> { return !!(await engine(`/device/${encodeURIComponent(id)}`, { method: "DELETE" }))?.ok; }
export async function signInHistory(): Promise<HistoryEntry[]> { const r = await engine("/device/history"); return r?.ok ? ((await json(r)) as HistoryEntry[]) : []; }
export async function createAppPassword(name: string): Promise<{ user: string; secret: string } | null> {
  const r = await engine("/device/app-password", { method: "POST", body: JSON.stringify({ name }) });
  return r?.ok ? ((await json(r)) as { user: string; secret: string }) : null;
}
export async function newRecoveryCodes(): Promise<string[] | null> {
  const r = await engine("/device/recovery-codes", { method: "POST", body: "{}" });
  return r?.ok ? (await json(r)).recoveryCodes : null;
}
export async function inviteUser(user: string): Promise<string | null> {
  const r = await engine("/device/invite", { method: "POST", body: JSON.stringify({ user }) });
  return r?.ok ? (await json(r)).code : null;
}
export async function pendingApprovals(): Promise<PendingApproval[]> {
  const r = await engine("/device/pending");
  return r?.ok ? ((await json(r)) as PendingApproval[]) : [];
}
export async function decideApproval(id: string, approve: boolean, number?: number): Promise<"approved" | "denied" | "wrong" | "expired" | "unknown" | "offline"> {
  const r = await engine("/device/decide", { method: "POST", body: JSON.stringify({ id, approve, number }) });
  if (!r) return "offline";
  const j = await json(r);
  return (j?.result ?? "unknown") as any;
}
