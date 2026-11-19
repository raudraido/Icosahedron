// The jukebox: a screen that only plays (a tablet, a spare computer, a kiosk browser) and is controlled from
// the other devices. It is the web app opened with ?player=1 (components/PlayerOnly.tsx); docs/jukebox.md.
export const JUKEBOX_DOCS = "https://github.com/raudraido/Icosahedron/blob/master/docs/jukebox.md";

/** The address to open on the screen that should play, from the engine's own address. A name makes it its own jukebox. */
export function jukeboxUrl(engineBase: string, name = ""): string {
  const n = name.trim().slice(0, 64);
  return `${engineBase.replace(/\/+$/, "")}/?player=${n ? encodeURIComponent(n) : "1"}`;
}

/**
 * Who a page of the web app is, as far as the sync server is concerned. A normal page is one device per browser
 * (its id lives in localStorage, which every tab of the browser shares). A jukebox page must not share that id:
 * it would take over the browser's own web app, and a second jukebox in the same browser would push out the
 * first. So a jukebox has an id of its own, and `?player=<name>` gives every name its own: two names are two
 * jukeboxes, the same name in two tabs is one (the newer tab takes over).
 */
export interface PageIdentity {
  isJukebox: boolean;
  /** The name from the address ("Kitchen"), or null for `?player=1` / `?player`. */
  jukeboxName: string | null;
  /** The localStorage key that holds this page's device id. */
  storageKey: string;
}

export function pageIdentity(search: string, baseKey = "ico.deviceId"): PageIdentity {
  const params = new URLSearchParams(search);
  if (!params.has("player")) return { isJukebox: false, jukeboxName: null, storageKey: baseKey };
  const raw = (params.get("player") ?? "").trim().slice(0, 64);
  const named = raw !== "" && raw !== "1";
  const slug = named ? raw.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "x" : "";
  return { isJukebox: true, jukeboxName: named ? raw : null, storageKey: named ? `${baseKey}.player.${slug}` : `${baseKey}.player` };
}
