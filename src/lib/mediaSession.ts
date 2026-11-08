// Media Session API: lock-screen / notification / headset / media-key controls
// and now-playing info for the browser and mobile builds. The <audio> element
// the web platform plays through is what makes the OS treat the page as a
// media player; this tells it what is playing and routes its buttons back to
// the store. (Electron keeps its own handling.)
//
// Open the app with ?debug=1 to get an on-screen diagnostics box (needed on
// phones, where there is no console).
import { platform } from "../platform";
import { useStore } from "../store";

declare const __BUILD_ID__: string | undefined;


const dbg = {
  registered: [] as string[],
  failed: [] as string[],
  metaSets: 0,
  metaTrack: "",
  errors: [] as string[],
  posSets: 0,
  lastPos: "",
  art: "-",
};
const note = (e: unknown, where: string) => dbg.errors.push(`${where}: ${String((e as Error)?.message ?? e)}`.slice(0, 120));

type Art = { src: string; sizes: string; type: string };
const artCache = new Map<string, Art>();

async function loadArtwork(coverId: string): Promise<Art | null> {
  const url = platform.coverUrl(coverId, 512);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cover HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error(`cover is ${blob.type || "not an image"}`);
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  const art = { src, sizes: "512x512", type: blob.type };
  artCache.set(coverId, art);
  if (artCache.size > 20) artCache.delete(artCache.keys().next().value!);
  return art;
}

export function initMediaSession(): void {
  if (new URLSearchParams(location.search).has("debug")) sessionStorage.setItem("ico.debug", "1");
  const supported = "mediaSession" in navigator && platform.kind !== "electron";
  if (sessionStorage.getItem("ico.debug")) showDebug(supported);
  if (!supported) return;

  const ms = navigator.mediaSession;
  const st = () => useStore.getState();

  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ["play", () => { if (!st().playing) st().playPause(); }],
    ["pause", () => { if (st().playing) st().playPause(); }],
    ["stop", () => st().stop()],
    ["previoustrack", () => st().prev()],
    ["nexttrack", () => st().next()],
    ["seekto", (d) => { if (typeof d.seekTime === "number") st().setCurrentTime(d.seekTime); }],
  ];
  for (const [action, fn] of handlers) {
    try { ms.setActionHandler(action, fn); dbg.registered.push(action); } catch { dbg.failed.push(action); }
  }

  let lastTrackId: string | null = null;
  let lastPlaying: boolean | null = null;
  let lastPos = { at: 0, time: 0 };
  let appliedWhilePlayingFor: string | null = null;

  // Title/artist go out immediately, without artwork. The cover is fetched by
  // the page itself (it has the session cookie; the OS fetching an artwork URL
  // on its own would be bounced to the SSO login page) and handed over as a
  // data: URL, then the metadata is set again with it.
  const updateMetadata = () => {
    const s = st();
    const track = s.queue[s.currentIndex];
    try {
      if (!track) { ms.metadata = null; return; }
      const base = { title: track.title, artist: track.artist, album: track.album ?? "" };
      const cached = track.cover_id ? artCache.get(track.cover_id) : undefined;
      ms.metadata = new MediaMetadata({ ...base, artwork: cached ? [cached] : [] });
      dbg.metaSets++;
      dbg.metaTrack = track.title;
      if (track.cover_id && !cached) {
        const trackId = track.id;
        dbg.art = "loading";
        void loadArtwork(track.cover_id).then((art) => {
          dbg.art = art ? `ok ${Math.round(art.src.length / 1024)}KB` : "none";
          const cur = st().queue[st().currentIndex];
          if (art && cur?.id === trackId) {
            ms.metadata = new MediaMetadata({ ...base, artwork: [art] });
            dbg.metaSets++;
          }
        }).catch((e) => { dbg.art = "fail"; note(e, "artwork"); });
      }
    } catch (e) { note(e, "metadata"); }
  };

  const updatePosition = () => {
    const s = st();
    if (!(s.duration > 0)) return;
    try {
      ms.setPositionState({ duration: s.duration, position: Math.min(Math.max(0, s.currentTimeRaw), s.duration), playbackRate: 1 });
      dbg.posSets++;
      dbg.lastPos = `${Math.round(s.currentTimeRaw)}/${Math.round(s.duration)}`;
    } catch (e) { note(e, "position"); }
    lastPos = { at: Date.now(), time: s.currentTime };
  };

  useStore.subscribe((s) => {
    const track = s.queue[s.currentIndex];
    const id = track?.id ?? null;
    if (id !== lastTrackId) {
      lastTrackId = id;
      appliedWhilePlayingFor = null;
      updateMetadata();
      updatePosition();
    }
    if (s.playing !== lastPlaying) {
      lastPlaying = s.playing;
      ms.playbackState = track ? (s.playing ? "playing" : "paused") : "none";
      updatePosition();
    }
    // The OS extrapolates the position while playing; only correct it after a
    // seek (the reported time jumped away from where it should be by now).
    if (s.playing && lastPos.at) {
      const expected = lastPos.time + (Date.now() - lastPos.at) / 1000;
      if (Math.abs(s.currentTime - expected) > 2) updatePosition();
    }
  });

  // Safari only takes metadata/position seriously once the element is really
  // producing audio, which is after the store has already flipped to
  // "playing". So once per track, re-apply everything at the first progress
  // tick that shows time actually advancing.
  platform.onAudioEvent((p) => {
    if (p.kind !== "progress" || !(p.currentTime! > 0.3)) return;
    const s = st();
    const id = s.queue[s.currentIndex]?.id ?? null;
    if (!id || appliedWhilePlayingFor === id) return;
    appliedWhilePlayingFor = id;
    updateMetadata();
    ms.playbackState = "playing";
    updatePosition();
  });
}

function showDebug(supported: boolean): void {
  const box = document.createElement("pre");
  box.style.cssText = "position:fixed;left:4px;bottom:4px;z-index:99999;margin:0;padding:6px 8px;max-width:92vw;max-height:45vh;overflow:auto;font:11px/1.35 monospace;color:#9f9;background:rgba(0,0,0,.85);border-radius:6px;white-space:pre-wrap;";
  box.onclick = () => { sessionStorage.removeItem("ico.debug"); box.remove(); };
  document.body.appendChild(box);
  const render = () => {
    const a = document.querySelector("audio");
    const ms = "mediaSession" in navigator ? navigator.mediaSession : null;
    const md = ms?.metadata;
    box.textContent = [
      `build ${typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "?"}  (tap to hide)`,
      `ua ${navigator.userAgent.replace(/\(.*?\)/, "").slice(0, 70)}`,
      `secure ${isSecureContext}  mediaSession ${!!ms}  active ${supported}  sw ${"serviceWorker" in navigator && !!navigator.serviceWorker.controller}`,
      `handlers ok [${dbg.registered.join(",")}]  failed [${dbg.failed.join(",")}]`,
      `session.state ${ms?.playbackState}  title "${md?.title ?? ""}"  artwork ${md?.artwork?.length ?? 0}`,
      `art ${dbg.art}  metaSets ${dbg.metaSets} (last "${dbg.metaTrack}")  posSets ${dbg.posSets} (${dbg.lastPos})`,
      `audio ${a ? `paused ${a.paused} ready ${a.readyState} t ${a.currentTime.toFixed(1)} dur ${a.duration} src ${a.currentSrc ? new URL(a.currentSrc).pathname : "-"}` : "NO ELEMENT"}`,
      ...dbg.errors.slice(-4).map((e) => `ERR ${e}`),
    ].join("\n");
  };
  render();
  setInterval(render, 1000);
}
