// Authenticates a sync client against the configured Subsonic/Navidrome server.
// The client sends the same salted token it uses for the Subsonic API
// (t = md5(password + s)); we replay it as `ping`, so the server never sees or
// stores a password and accounts are exactly the Navidrome accounts.

import { createHash, randomBytes } from "node:crypto";

const API_VERSION = "1.16.1";

/** Whether the (already verified) account is a Navidrome administrator: Subsonic `getUser` reports `adminRole`. */
export async function isNavidromeAdmin(baseUrl, cred, fetchImpl = fetch) {
  // cred.remoteUser: the engine has already checked the device, Navidrome is asked as that account
  // through its trusted header (secure sign-in) instead of with a token.
  const q = new URLSearchParams({ v: API_VERSION, c: "IcosahedronSync", f: "json", username: cred.u });
  if (!cred.remoteUser) { q.set("u", cred.u); q.set("t", cred.t); q.set("s", cred.s); }
  try {
    const res = await fetchImpl(`${baseUrl}/rest/getUser?${q}`, { headers: cred.remoteUser ? { "Remote-User": cred.u } : {}, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.["subsonic-response"]?.user?.adminRole === true;
  } catch {
    return false;
  }
}

/**
 * @param {string} baseUrl  Navidrome base URL (no trailing slash)
 * @param {{u:string,t:string,s:string}} cred
 * @returns {Promise<boolean>}
 */
export async function verifySubsonic(baseUrl, cred, fetchImpl = fetch) {
  if (!cred || !cred.u || !cred.t || !cred.s) return false;
  const q = new URLSearchParams({
    u: cred.u, t: cred.t, s: cred.s, v: API_VERSION, c: "IcosahedronSync", f: "json",
  });
  try {
    const res = await fetchImpl(`${baseUrl}/rest/ping?${q}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.["subsonic-response"]?.status === "ok";
  } catch {
    return false;
  }
}

/** Whether a user name and password are right (the same salted-token ping the apps use). */
export async function verifyPassword(baseUrl, user, password, fetchImpl = fetch) {
  const salt = randomBytes(6).toString("hex");
  return verifySubsonic(baseUrl, { u: user, t: createHash("md5").update(password + salt, "utf8").digest("hex"), s: salt }, fetchImpl);
}

/**
 * Whether Navidrome takes the account from the Remote-User header when the engine sends it (it does only
 * for an address in ND_REVERSEPROXYWHITELIST). Secure sign-in depends on it, so it is tried before it is switched on.
 */
export async function navidromeTrustsEngine(baseUrl, user, fetchImpl = fetch) {
  const q = new URLSearchParams({ v: API_VERSION, c: "IcosahedronSync", f: "json" });
  try {
    const res = await fetchImpl(`${baseUrl}/rest/ping?${q}`, { headers: { "Remote-User": user }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    return (await res.json())?.["subsonic-response"]?.status === "ok";
  } catch {
    return false;
  }
}
