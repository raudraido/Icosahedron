import { createHash } from "node:crypto";

// One Last.fm API application ("icosahedron-linux", registered at
// last.fm/api/account/create), shared by every install (the "consumer key"
// model used by most desktop scrobblers — foobar2000, Rockbox, etc.). Each
// user still connects their own separate Last.fm account via the
// auth.getToken -> browser approval -> auth.getSession handshake below;
// this pair only identifies "this is Icosahedron talking to the API", it
// never grants access to any particular account by itself.
const API_KEY = "3d13d2d35c9c3951d5a953c6e37c2553";
const API_SECRET = "0993b49dc2d80c65166811e43ba3e4a4";

const BASE_URL = "https://ws.audioscrobbler.com/2.0/";

export class LastFmApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export interface LastFmTrackMeta {
  title: string;
  artist: string;
  album: string;
  duration: number;
}

export function lastfmConfigured(): boolean {
  return Boolean(API_KEY && API_SECRET);
}

// Safe to expose to the renderer — unlike API_SECRET, the API key isn't a
// secret (it's sent in the clear on every single Last.fm request, including
// the auth URL a user's browser navigates to). Used renderer-side for the
// unsigned, unauthenticated user.getrecenttracks call that powers the left
// panel's "Recently Played" list, alongside whichever username is connected.
export function getApiKey(): string {
  return API_KEY;
}

// Last.fm's write-API signature: sort every param (excluding format, which
// is never part of the signed set per their spec), concatenate key+value
// pairs, append the shared secret, MD5 the result.
function sign(params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  const base = keys.map((k) => `${k}${params[k]}`).join("");
  return createHash("md5").update(base + API_SECRET, "utf8").digest("hex");
}

async function call(
  method: string,
  params: Record<string, string>,
  opts: { signed: boolean; post: boolean },
): Promise<any> {
  const all: Record<string, string> = { method, api_key: API_KEY, ...params };
  if (opts.signed) all["api_sig"] = sign(all);
  all["format"] = "json";

  const resp = opts.post
    ? await fetch(BASE_URL, { method: "POST", body: new URLSearchParams(all) })
    : await fetch(`${BASE_URL}?${new URLSearchParams(all)}`);
  const data = await resp.json();
  if (data.error) throw new LastFmApiError(data.error, data.message ?? `Last.fm error ${data.error}`);
  return data;
}

export async function getToken(): Promise<string> {
  const data = await call("auth.getToken", {}, { signed: false, post: false });
  return data.token as string;
}

export function authUrl(token: string): string {
  return `https://www.last.fm/api/auth/?api_key=${API_KEY}&token=${token}`;
}

export async function getSession(token: string): Promise<{ key: string; username: string }> {
  const data = await call("auth.getSession", { token }, { signed: true, post: false });
  return { key: data.session.key as string, username: data.session.name as string };
}

export async function updateNowPlaying(track: LastFmTrackMeta, sessionKey: string): Promise<void> {
  await call("track.updateNowPlaying", {
    track: track.title, artist: track.artist, album: track.album,
    duration: String(Math.round(track.duration)), sk: sessionKey,
  }, { signed: true, post: true });
}

export async function scrobble(track: LastFmTrackMeta, timestampSecs: number, sessionKey: string): Promise<void> {
  await call("track.scrobble", {
    track: track.title, artist: track.artist, album: track.album,
    duration: String(Math.round(track.duration)), timestamp: String(timestampSecs), sk: sessionKey,
  }, { signed: true, post: true });
}
