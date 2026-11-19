// What a Subsonic call gets when the engine turns it away (secure sign-in on). Navidrome itself answers a
// call it does not accept with HTTP 200 and a Subsonic error in the body; clients read that to tell "this is a
// Subsonic server" (a probe with no credentials) from "wrong password" from "no network". A bare 401 looks
// like a dead end to them (JellyBox did not even recognise the server), so the engine speaks the same way.
// Media (stream, cover art, …) keeps the plain 401: a 200 with a JSON body could be taken for audio.

const MEDIA = /^\/rest\/(stream|download|getCoverArt|getAvatar|hls)(\.view)?$/;

/** Whether a rejected call should get a Subsonic error (true) or a plain 401. */
export function wantsSubsonicError(pathname) {
  return /^\/rest\/[A-Za-z0-9]+(\.view)?$/.test(pathname) && !MEDIA.test(pathname);
}

/** Which Subsonic error fits a rejected call: 10 nothing to check, 42 an old or unsupported way, 40 wrong. */
export function subsonicErrorFor(params) {
  const has = (k) => params.get(k) !== null && params.get(k) !== "";
  if (has("u") && has("t") && has("s")) return { code: 40, message: "Wrong username or password" };
  if (has("p") || has("apiKey")) {
    return { code: 42, message: "Provided authentication mechanism not supported: sign in with a token (u, t and s) or an app password" };
  }
  return { code: 10, message: "Required parameter is missing" };
}

const esc = (s) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

/** The status, headers and body of the answer, in the format the call asked for (f=json, jsonp or XML). */
export function subsonicErrorResponse(params) {
  const { code, message } = subsonicErrorFor(params);
  const f = (params.get("f") ?? "xml").toLowerCase();
  const version = "1.16.1";
  if (f === "json" || f === "jsonp") {
    const body = JSON.stringify({ "subsonic-response": { status: "failed", version, type: "navidrome", openSubsonic: true, error: { code, message } } });
    const cb = params.get("callback") ?? "";
    if (f === "jsonp" && /^[A-Za-z_$][\w$.]{0,63}$/.test(cb)) {
      return { status: 200, headers: { "content-type": "application/javascript; charset=utf-8" }, body: `${cb}(${body})` };
    }
    return { status: 200, headers: { "content-type": "application/json; charset=utf-8" }, body };
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<subsonic-response xmlns="http://subsonic.org/restapi" status="failed" version="${version}" type="navidrome" openSubsonic="true"><error code="${code}" message="${esc(message)}"></error></subsonic-response>`;
  return { status: 200, headers: { "content-type": "application/xml; charset=utf-8" }, body };
}
