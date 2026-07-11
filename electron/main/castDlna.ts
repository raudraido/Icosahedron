import { xmlEscape, buildDidlLite, secondsToHms, type CastTrackForDidl } from "./castDidl";
import type { CastStatusEvent, CastTrackMetadata } from "./castChromecast";

const AVTRANSPORT_TYPE = "urn:schemas-upnp-org:service:AVTransport:1";
const RENDERING_CONTROL_TYPE = "urn:schemas-upnp-org:service:RenderingControl:1";

/** Generic AVTransport/RenderingControl SOAP call — one function for every
 *  action (SetAVTransportURI, Play, Pause, Stop, Seek, GetTransportInfo,
 *  GetPositionInfo, SetVolume, GetVolume, ...) rather than a bespoke method
 *  per action, since they all share the exact same envelope/fault shape and
 *  differ only in serviceType/action/args. Returns a flat map of the
 *  response's own parameter tags (e.g. { CurrentTransportState: "PLAYING" })
 *  — response parameter names are never namespace-prefixed per the UPnP
 *  spec, so a plain `<Tag>value</Tag>` regex sweep over the body correctly
 *  skips the namespaced `<u:ActionNameResponse>` wrapper around them. */
async function soapCall(
  controlUrl: string, serviceType: string, action: string, args: Record<string, string | number> = {}, attempt = 1,
): Promise<Record<string, string>> {
  const argXml = Object.entries(args).map(([k, v]) => `<${k}>${xmlEscape(String(v))}</${k}>`).join("");
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${serviceType}">${argXml}</u:${action}></s:Body></s:Envelope>`;

  let resp: Response;
  try {
    resp = await fetch(controlUrl, {
      method: "POST",
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPACTION: `"${serviceType}#${action}"`,
        // Many embedded UPnP HTTP servers (this Denon included) don't
        // tolerate a pooled keep-alive connection sitting idle between
        // requests — they silently close it, and undici doesn't find out
        // until it tries to reuse that exact socket, surfacing as
        // ECONNRESET/"fetch failed" on an otherwise fine device. Forcing a
        // fresh connection every call avoids ever hitting that stale-pool
        // race in the first place.
        Connection: "close",
      },
      body,
    });
  } catch (err) {
    // Belt-and-suspenders for the same race: Connection: close stops *this*
    // request's connection from being pooled for next time, but doesn't
    // retroactively save a request that raced a connection the *previous*
    // call already had pooled before this fix took effect on it. One
    // immediate retry with a guaranteed-fresh connection is enough — this
    // is a stale-socket race, not a sustained fault.
    if (attempt >= 2) throw err;
    await new Promise((r) => setTimeout(r, 200));
    return soapCall(controlUrl, serviceType, action, args, attempt + 1);
  }
  const text = await resp.text();

  // UPnP errors come back as a SOAP Fault (usually HTTP 500) with an
  // embedded errorCode/errorDescription — surface those specifically before
  // falling back to a bare HTTP-status error, since "errorCode 701:
  // Transition not available" is a lot more actionable than "HTTP 500".
  if (/<[\w:]*Fault[ >]/i.test(text)) {
    const code = text.match(/<errorCode>([^<]*)<\/errorCode>/i)?.[1];
    const desc = text.match(/<errorDescription>([^<]*)<\/errorDescription>/i)?.[1];
    throw new Error(desc || code ? `${action} failed: ${desc ?? "UPnP error"}${code ? ` (${code})` : ""}` : `${action} failed`);
  }
  if (!resp.ok) throw new Error(`${action} failed: HTTP ${resp.status}`);

  const out: Record<string, string> = {};
  for (const m of text.matchAll(/<([A-Za-z][\w.]*)>([^<]*)<\/\1>/g)) out[m[1]] = m[2];
  return out;
}

// 4s, not 2s — real-world evidence (a Denon receiver's embedded UPnP stack
// wedging, twice, under normal use) that this app's polling load alone can
// overwhelm a fragile embedded HTTP server. Doubling the interval halves
// the steady-state request rate at essentially no UX cost, since none of
// the polled currentTime/duration is even consumed right now (see poll()'s
// comment below) — the scrubber stays local-engine-authoritative.
const POLL_INTERVAL_MS = 4000;
const MAX_CONSECUTIVE_POLL_ERRORS = 3;
// Some receivers' network stack answers SOAP calls well before their audio
// hardware (amp relays, DAC, input switching) has actually finished waking
// from standby — SetAVTransportURI+Play immediately back-to-back can land
// while the physical audio path isn't connected yet, so the transport
// reports PLAYING with no actual sound. Giving the first load of a session
// this grace period before Play (not every subsequent track change — once
// truly awake, those already work with no delay) fixes it for receivers
// that need it, at the cost of a slower first connect for ones that don't.
const WAKE_GRACE_MS = 2500;

// Hand-rolled AVTransport/RenderingControl client — no GENA event
// subscriptions (SUBSCRIBE/NOTIFY + a callback HTTP server + resubscribe
// timers), polling instead; see castManager.ts's plan notes for why that
// scope cut is fine for this feature. Same onStatus(event)/method shape as
// ChromecastDevice so castManager.ts can treat either uniformly.
export class DlnaDevice {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private hasLoadedMedia = false;
  private stoppedByUs = false;
  private lastState: string | null = null;
  private consecutivePollErrors = 0;

  constructor(
    private avTransportUrl: string,
    private renderingControlUrl: string | null,
    private onStatus: (event: CastStatusEvent) => void,
  ) {}

  /** DLNA has no persistent channel to open (SOAP calls are stateless HTTP)
   *  — "connect" instead confirms we can actually talk to this device right
   *  now (a stale/broken control URL fails here, same as a real network
   *  failure would fail Chromecast's connect()), and starts status polling. */
  async connect(): Promise<void> {
    await soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "GetTransportInfo", { InstanceID: 0 });
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    try {
      const info = await soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "GetTransportInfo", { InstanceID: 0 });
      const state = info.CurrentTransportState;

      // A transition we didn't cause, away from playing/transitioning and
      // into STOPPED, only after media was actually loaded, means the
      // receiver ran off the end of the track — there's no explicit
      // "finished" signal in polled AVTransport state otherwise.
      if (this.hasLoadedMedia && !this.stoppedByUs && state === "STOPPED" &&
        (this.lastState === "PLAYING" || this.lastState === "TRANSITIONING")) {
        this.lastState = state;
        this.onStatus({ kind: "ended" });
        return;
      }
      this.lastState = state;
      if (state === "NO_MEDIA_PRESENT") return;

      // No GetPositionInfo call here — currentTime/duration in the "status"
      // event below are never actually read by src/store/index.ts's
      // handleCastEvent (the scrubber stays local-engine-authoritative in
      // the dual-playback design; only castVolume is consumed from cast
      // status). Skipping it cuts a third request out of every poll tick
      // for data nothing uses — a real device (see POLL_INTERVAL_MS above)
      // has already shown this app's polling load matters.
      let volume = 1;
      if (this.renderingControlUrl) {
        try {
          const vol = await soapCall(this.renderingControlUrl, RENDERING_CONTROL_TYPE, "GetVolume", { InstanceID: 0, Channel: "Master" });
          volume = Math.max(0, Math.min(100, Number(vol.CurrentVolume) || 0)) / 100;
        } catch { /* some renderers lack RenderingControl entirely — volume just stays a no-op */ }
      }
      this.consecutivePollErrors = 0;
      this.onStatus({
        kind: "status",
        playing: state === "PLAYING" || state === "TRANSITIONING",
        currentTime: 0,
        duration: 0,
        volume,
      });
    } catch (err) {
      // A single failed poll tick (transient network blip over plain HTTP)
      // shouldn't tear down the session — only a sustained failure should.
      // castManager.ts treats every "error" event as fatal (matches
      // ChromecastDevice, where a socket 'error' really does mean the
      // connection is dead), so the retry-tolerance has to live here
      // instead: swallow isolated failures, only surface one once several
      // in a row suggest the device is actually gone.
      this.consecutivePollErrors++;
      if (this.consecutivePollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        this.onStatus({ kind: "error", message: err instanceof Error ? err.message : "DLNA poll failed" });
      }
    }
  }

  async loadMedia(url: string, contentType: string, metadata: CastTrackMetadata, startPositionSecs: number): Promise<void> {
    const isFirstLoad = !this.hasLoadedMedia;
    const track: CastTrackForDidl = { title: metadata.title, artist: metadata.subtitle, artUrl: metadata.artUrl };
    const didl = buildDidlLite(track, url, contentType);
    await soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "SetAVTransportURI", {
      InstanceID: 0, CurrentURI: url, CurrentURIMetaData: didl,
    });
    this.stoppedByUs = false;
    this.hasLoadedMedia = true;
    if (isFirstLoad) await new Promise((r) => setTimeout(r, WAKE_GRACE_MS));
    await soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "Play", { InstanceID: 0, Speed: "1" });
    if (startPositionSecs > 0) {
      await soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "Seek", {
        InstanceID: 0, Unit: "REL_TIME", Target: secondsToHms(startPositionSecs),
      }).catch(() => { /* seek-on-load isn't universally supported — the track just starts from 0 instead */ });
    }
  }

  pause(): void {
    soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "Pause", { InstanceID: 0 }).catch(() => {});
  }

  resume(): void {
    soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "Play", { InstanceID: 0, Speed: "1" }).catch(() => {});
  }

  stop(): void {
    this.stoppedByUs = true;
    soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "Stop", { InstanceID: 0 }).catch(() => {});
  }

  seek(seconds: number): void {
    soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "Seek", {
      InstanceID: 0, Unit: "REL_TIME", Target: secondsToHms(seconds),
    }).catch(() => {});
  }

  setVolume(volume: number): void {
    if (!this.renderingControlUrl) return;
    const desired = Math.round(Math.max(0, Math.min(1, volume)) * 100);
    soapCall(this.renderingControlUrl, RENDERING_CONTROL_TYPE, "SetVolume", {
      InstanceID: 0, Channel: "Master", DesiredVolume: desired,
    }).catch(() => {});
  }

  disconnect(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}
