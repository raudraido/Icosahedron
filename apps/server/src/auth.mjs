// Authenticates a sync client against the configured Subsonic/Navidrome server.
// The client sends the same salted token it uses for the Subsonic API
// (t = md5(password + s)); we replay it as `ping`, so the server never sees or
// stores a password and accounts are exactly the Navidrome accounts.

const API_VERSION = "1.16.1";

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
