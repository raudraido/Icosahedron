// The jukebox: a screen that only plays (a tablet, a spare computer, a kiosk browser) and is controlled from
// the other devices. It is the web app opened with ?player=1 (components/PlayerOnly.tsx); docs/jukebox.md.
export const JUKEBOX_DOCS = "https://github.com/raudraido/Icosahedron/blob/master/docs/jukebox.md";

/** The address to open on the screen that should play, from the engine's own address. */
export function jukeboxUrl(engineBase: string): string {
  return `${engineBase.replace(/\/+$/, "")}/?player=1`;
}
