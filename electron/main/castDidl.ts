// Shared helpers for both cast protocols. Chromecast's `media.contentType`
// has to be declared *before* the receiver ever fetches the URL (it's part
// of the LOAD message itself), so unlike castProxy.ts's response headers
// (which can just pass through whatever Navidrome's real stream responds
// with), this needs an upfront guess from the track's already-known format.
const MIME_BY_FORMAT: Record<string, string> = {
  MP3: "audio/mpeg",
  FLAC: "audio/flac",
  OGG: "audio/ogg",
  OPUS: "audio/ogg",
  M4A: "audio/mp4",
  AAC: "audio/aac",
  WAV: "audio/wav",
  WMA: "audio/x-ms-wma",
  APE: "audio/x-ape",
  ALAC: "audio/mp4",
};

/** Falls back to mp3 — Navidrome's default transcoding target, and Subsonic
 *  servers generally transcode to something Chromecast/DLNA can play anyway. */
export function contentTypeForFormat(format: string | null): string {
  if (!format) return "audio/mpeg";
  return MIME_BY_FORMAT[format.toUpperCase()] ?? "audio/mpeg";
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** DLNA's `res` element needs a declared protocolInfo up front, same
 *  reasoning as Chromecast's contentType above — "*" for the DLNA-profile
 *  slot (DLNA.ORG_PN) is the documented wildcard for "just serve the bytes,
 *  no specific media profile asserted", same choice castProxy.ts's
 *  contentFeatures.dlna.org response header already makes. */
export function protocolInfo(contentType: string): string {
  return `http-get:*:${contentType}:*`;
}

export interface CastTrackForDidl {
  title: string;
  artist?: string;
  artUrl?: string;
}

/** DIDL-Lite item XML for AVTransport's CurrentURIMetaData — this string
 *  gets XML-escaped *again* by the SOAP envelope builder in castDlna.ts
 *  when it's embedded inside <CurrentURIMetaData>, since it's XML-inside-
 *  XML at that point. */
export function buildDidlLite(track: CastTrackForDidl, audioUrl: string, contentType: string): string {
  const artist = track.artist ? `<dc:creator>${xmlEscape(track.artist)}</dc:creator><upnp:artist>${xmlEscape(track.artist)}</upnp:artist>` : "";
  const art = track.artUrl ? `<upnp:albumArtURI>${xmlEscape(track.artUrl)}</upnp:albumArtURI>` : "";
  return (
    `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">` +
    `<item id="0" parentID="-1" restricted="1">` +
    `<dc:title>${xmlEscape(track.title)}</dc:title>` +
    artist +
    art +
    `<upnp:class>object.item.audioItem.musicTrack</upnp:class>` +
    `<res protocolInfo="${protocolInfo(contentType)}">${xmlEscape(audioUrl)}</res>` +
    `</item></DIDL-Lite>`
  );
}

/** AVTransport's Seek/GetPositionInfo speak "HH:MM:SS" (or "H+:MM:SS" for
 *  runs past 99h, per the UPnP spec's time-string grammar), not seconds. */
export function secondsToHms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Inverse of secondsToHms — GetPositionInfo's RelTime comes back in the
 *  same "HH:MM:SS" shape. Returns 0 for anything unparseable (e.g. a
 *  renderer that returns "NOT_IMPLEMENTED") rather than throwing, since
 *  callers use this for a best-effort progress check, not a hard fact. */
export function hmsToSeconds(hms: string): number {
  const m = hms.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

