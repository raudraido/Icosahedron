import { xmlEscape, buildDidlLite, secondsToHms, hmsToSeconds, type CastTrackForDidl } from "./castDidl";
import type { CastStatusEvent, CastTrackMetadata } from "./castChromecast";

const AVTRANSPORT_TYPE = "urn:schemas-upnp-org:service:AVTransport:1";
const RENDERING_CONTROL_TYPE = "urn:schemas-upnp-org:service:RenderingControl:1";
// Every UPnP HTTP call here is over LAN and should complete within a couple
// seconds if the device is actually listening. Without an explicit timeout,
// a receiver whose network stack hasn't woken up yet — not actively
// refusing the connection, just never answering the SYN at all — leaves
// fetch() hanging for however long the OS's own TCP retransmission window
// is (which can be tens of seconds to minutes), not a quick rejection.
// That starves connect()'s retry loop below of ever getting a fast failure
// to actually retry after, which is indistinguishable from the app just
// never having sent anything at all.
const SOAP_TIMEOUT_MS = 5000;

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
      signal: AbortSignal.timeout(SOAP_TIMEOUT_MS),
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

// Fallback-only now (see the class doc comment below) — a receiver with no
// eventSubURL at all (no GENA support) still needs *some* way to learn
// playback state, just not the 4s/always-on cadence every device used to
// pay regardless of whether it could do better. Same interval as before;
// it's now the exception, not the rule.
const POLL_INTERVAL_MS = 4000;
const MAX_CONSECUTIVE_POLL_ERRORS = 3;
// How long after Play to check whether the first track actually started
// moving — long enough that a receiver which *did* wake up in time has
// unambiguously made real progress (not just clock/rounding noise on a
// GetPositionInfo call landing a few hundred ms after Play), short enough
// that a receiver which needed the extra nudge gets it early in the track
// rather than most of the way through it.
const WAKE_CHECK_DELAY_MS = 4000;
// GENA subscriptions expire and must be renewed before TIMEOUT elapses —
// 1800s (30 min) matches the old PyQt app's own value, comfortably inside
// what real renderers accept. Renewing at TIMEOUT-60s (not right at the
// wire) leaves margin for the renewal SUBSCRIBE itself to be slow/retried
// without the subscription lapsing in between.
const SUBSCRIBE_TIMEOUT_S = 1800;
const RENEW_MARGIN_S = 60;
// connect()'s initial reachability check can hit a receiver that's still
// booting its network stack from standby — matches the old PyQt app's own
// _ensure() retry schedule (there, waiting up to ~25s total for the device
// description fetch to succeed), same reasoning: a single unforgiving
// attempt here fails the whole connect before loadMedia()'s own wake
// handling ever gets a chance to run, which is exactly the "first cast does
// nothing, closing and immediately retrying works" symptom this fixes.
const CONNECT_RETRY_DELAYS_MS = [0, 2000, 3000, 4000, 5000, 6000, 5000];

function xmlUnescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// GENA's <LastChange> element is itself a string containing an *escaped*
// nested XML document (UPnP's AVT/RCS event schema) — e.g. `&lt;Event
// xmlns="..."&gt;&lt;InstanceID val="0"&gt;&lt;TransportState
// val="PLAYING"/&gt;...`. Unescape that inner document, then pull the
// attribute a plain SOAP response tag-sweep can't reach (these are
// self-closing attribute-value pairs, not `<Tag>value</Tag>` text nodes).
function extractLastChangeAttr(body: string, tag: string, attr = "val"): string | undefined {
  const lastChange = body.match(/<LastChange>([\s\S]*?)<\/LastChange>/)?.[1];
  if (!lastChange) return undefined;
  const inner = xmlUnescape(lastChange);
  return inner.match(new RegExp(`<${tag}[^>]*\\b${attr}="([^"]*)"`))?.[1];
}

// Hand-rolled AVTransport/RenderingControl client. Subscribes via GENA
// (SUBSCRIBE/NOTIFY — the receiver pushes state changes to a small local
// callback endpoint itself, see castProxy.ts's registerNotify()) instead of
// polling GetTransportInfo/GetVolume on a timer, matching the old PyQt
// app's own architecture — ported after real-world evidence (a Denon
// receiver's embedded UPnP stack wedging under this app's polling load,
// repeatedly, something the old app never triggered) that always-on
// polling for the entire session duration is heavy enough to overwhelm a
// fragile embedded HTTP server on its own, independent of anything the
// disconnect path does. Same onStatus(event)/method shape as
// ChromecastDevice so castManager.ts can treat either uniformly. Falls
// back to polling only for a renderer with no eventSubURL/that rejects
// SUBSCRIBE outright — most support GENA; this just keeps the rest working.
export class DlnaDevice {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private avtSid: string | null = null;
  private rcSid: string | null = null;
  private hasLoadedMedia = false;
  private stoppedByUs = false;
  private lastState: string | null = null;
  // AVTransport and RenderingControl events share the one callback URL/
  // handler (see castManager.ts) but never carry each other's properties —
  // an AVT-only NOTIFY (fires on every transport-state change: play,
  // pause, every track change) has no Volume attribute in it at all, only
  // RC's own events do. Remembering the last *known* volume and reusing it
  // whenever a given notify doesn't happen to carry one is what actually
  // makes that work; defaulting to some fixed value instead (100%, or
  // anything else) meant the volume UI snapped to that fake value on
  // literally every track change and on first connect, before any real RC
  // event had arrived yet.
  private lastVolume = 1;
  private consecutivePollErrors = 0;
  // Bumped on every loadMedia() call — lets the delayed wake-check below
  // notice a track change happened in the meantime and bail out instead of
  // seeking/replaying whatever's loaded *now* based on a check that was
  // only ever meant for the track that started this specific wake window.
  private loadGeneration = 0;
  // Current track's identity/reload material, kept so handleStreamStall()
  // (called from castProxy.ts, entirely decoupled from loadMedia()'s own
  // call stack) can redo the exact same load sequence without needing
  // loadMedia() to thread state through some other channel.
  private currentTrackId: string | null = null;
  private currentUrl: string | null = null;
  private currentDidl: string | null = null;
  private currentStartPositionSecs = 0;
  // Caps how many times handleStreamStall() will auto-reload the same
  // track — every reload's own connection dying re-arms another stall
  // check (see castProxy.ts), so an unbounded retry loop is possible if a
  // receiver can genuinely never keep the stream open (wrong network route,
  // track truly unplayable, etc). Given this exact receiver's proven
  // fragility under repeated request load, hammering it forever isn't
  // acceptable just because the failure looks superficially like the one
  // real fix targets. Reset on every fresh loadMedia() call.
  private stallRetryCount = 0;
  private static readonly MAX_STALL_RETRIES = 3;

  constructor(
    private avTransportUrl: string,
    private renderingControlUrl: string | null,
    private avTransportEventUrl: string | undefined,
    private renderingControlEventUrl: string | undefined,
    /** This device's own registerNotify() callback URL — handed to the
     *  renderer as GENA's CALLBACK header so it knows where to NOTIFY us. */
    private callbackUrl: string,
    private onStatus: (event: CastStatusEvent) => void,
  ) {}

  /** DLNA has no persistent channel to open (SOAP calls are stateless HTTP)
   *  — "connect" instead confirms we can actually talk to this device right
   *  now (a stale/broken control URL fails here, same as a real network
   *  failure would fail Chromecast's connect()), then subscribes to GENA
   *  events (falling back to polling if that's not supported). */
  async connect(): Promise<void> {
    let lastErr: unknown;
    for (const delay of CONNECT_RETRY_DELAYS_MS) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        await soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "GetTransportInfo", { InstanceID: 0 });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    if (this.avTransportEventUrl) {
      try {
        await this.subscribe();
        return;
      } catch {
        // Falls through to polling — a renderer that advertises an
        // eventSubURL but then rejects SUBSCRIBE (seen in the wild) isn't
        // worth treating as a fatal connect failure over.
      }
    }
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private async sendSubscribe(eventUrl: string, existingSid?: string): Promise<string> {
    const headers: Record<string, string> = { TIMEOUT: `Second-${SUBSCRIBE_TIMEOUT_S}` };
    // A renewal carries the existing SID and nothing else; a fresh
    // subscription carries CALLBACK+NT and no SID — the two are mutually
    // exclusive per the GENA spec, not just a style choice.
    if (existingSid) headers.SID = existingSid;
    else { headers.CALLBACK = `<${this.callbackUrl}>`; headers.NT = "upnp:event"; }
    const resp = await fetch(eventUrl, { method: "SUBSCRIBE", headers, signal: AbortSignal.timeout(SOAP_TIMEOUT_MS) });
    if (!resp.ok) throw new Error(`SUBSCRIBE failed: HTTP ${resp.status}`);
    const sid = resp.headers.get("sid");
    if (!sid) throw new Error("SUBSCRIBE response missing SID");
    return sid;
  }

  private async subscribe(): Promise<void> {
    // AVTransport eventing is what actually matters (playback state) — a
    // failure there is fatal to the whole subscribe attempt.
    this.avtSid = await this.sendSubscribe(this.avTransportEventUrl!);
    // RenderingControl (volume) eventing is a nice-to-have some renderers
    // omit entirely — its own failure shouldn't take down AVTransport's.
    if (this.renderingControlEventUrl) {
      try { this.rcSid = await this.sendSubscribe(this.renderingControlEventUrl); }
      catch { /* volume just won't push updates; setVolume() calls still work */ }
    }
    this.scheduleRenewal();
  }

  private scheduleRenewal(): void {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = setTimeout(() => this.renew(), (SUBSCRIBE_TIMEOUT_S - RENEW_MARGIN_S) * 1000);
  }

  private async renew(): Promise<void> {
    try {
      if (this.avtSid) this.avtSid = await this.sendSubscribe(this.avTransportEventUrl!, this.avtSid);
      if (this.rcSid && this.renderingControlEventUrl) {
        this.rcSid = await this.sendSubscribe(this.renderingControlEventUrl, this.rcSid).catch(() => this.rcSid);
      }
      this.scheduleRenewal();
    } catch (err) {
      // The subscription is now dead and nothing will renew it — this has
      // to surface as a real error rather than silently going quiet, same
      // as a sustained poll failure does below.
      this.onStatus({ kind: "error", message: err instanceof Error ? err.message : "DLNA subscription renewal failed" });
    }
  }

  /** Routed here by castProxy.ts's NOTIFY handling — a renderer pushing its
   *  own state change, the GENA counterpart to poll() below. */
  handleNotify(body: string): void {
    const state = extractLastChangeAttr(body, "TransportState");
    if (state) {
      // Same "ran off the end of the track" inference as poll() used to
      // make from polled state — GENA has no more explicit a "finished"
      // signal than polling did.
      if (this.hasLoadedMedia && !this.stoppedByUs && state === "STOPPED" &&
        (this.lastState === "PLAYING" || this.lastState === "TRANSITIONING")) {
        this.lastState = state;
        this.onStatus({ kind: "ended" });
        return;
      }
      this.lastState = state;
    }
    const volumeRaw = extractLastChangeAttr(body, "Volume", "val");
    if (volumeRaw !== undefined) this.lastVolume = Math.max(0, Math.min(100, Number(volumeRaw) || 0)) / 100;
    const playing = (state ?? this.lastState) === "PLAYING" || (state ?? this.lastState) === "TRANSITIONING";
    this.onStatus({ kind: "status", playing, currentTime: 0, duration: 0, volume: this.lastVolume });
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
      // for data nothing uses.
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
    const generation = ++this.loadGeneration;
    if (this.wakeCheckTimer) { clearTimeout(this.wakeCheckTimer); this.wakeCheckTimer = null; }
    const track: CastTrackForDidl = { title: metadata.title, artist: metadata.subtitle, artUrl: metadata.artUrl };
    const didl = buildDidlLite(track, url, contentType);
    // Stored so handleStreamStall() below — invoked from castProxy.ts,
    // entirely outside this call — can redo this exact load without needing
    // its own copy threaded through some other channel. The URL's last path
    // segment is always the trackId (see castProxy.ts's audioUrlFor()).
    this.currentTrackId = decodeURIComponent(url.split("/").pop() ?? "");
    this.currentUrl = url;
    this.currentDidl = didl;
    this.currentStartPositionSecs = startPositionSecs;
    this.stallRetryCount = 0;
    // No artificial delay before Play — proven via packet-level tracing
    // against a Denon receiver that a fixed delay here is actively harmful:
    // this receiver opens its own short-lived (~250-260ms) validation fetch
    // of the audio URL immediately upon SetAVTransportURI, on a timer
    // entirely of its own. If Play (and Seek, when resuming mid-track) land
    // while that connection is still alive, the receiver's own reaction to
    // Seek is to cleanly reopen the stream at the correct byte offset via
    // Range — and that's what actually plays. A prior fixed 2.5s delay here
    // meant Play/Seek always arrived long after that window had already
    // expired, with nothing telling the receiver to retry.
    await this.sendLoadSequence(url, didl, startPositionSecs);
    this.stoppedByUs = false;
    this.hasLoadedMedia = true;
    // Belt-and-suspenders beyond the immediate sequence above and beyond
    // handleStreamStall() below: GetTransportInfo's RelTime is *not* a
    // reliable signal on its own (real-world tracing showed it can keep
    // reporting normal advancing playback even while the receiver's audio
    // connection is dead and never reopened) — but it's a harmless, cheap
    // extra check for whatever fraction of failures that IS a real signal
    // for, so it stays as a secondary net alongside the primary
    // stall-detection mechanism.
    if (isFirstLoad) {
      this.wakeCheckTimer = setTimeout(() => {
        this.wakeCheckTimer = null;
        this.verifyWoke(generation);
      }, WAKE_CHECK_DELAY_MS);
    }
  }

  /** Invoked from castProxy.ts (via castManager.ts's wiring) when a
   *  receiver's audio connection for `trackId` died mid-stream and nothing
   *  reopened it within STREAM_STALL_GRACE_MS — the reliable signal real-
   *  world testing found, unlike GetPositionInfo's RelTime (see loadMedia()
   *  above). Redoes the full load sequence from a fresh SetAVTransportURI,
   *  exactly matching what a manual close-and-reconnect retry does (proven
   *  100% reliable in testing) — but automatically, in-session. */
  handleStreamStall(trackId: string): void {
    // Explicit stop already in progress/done, or this stall is for a track
    // that isn't current anymore (superseded by a track change before the
    // stall grace period elapsed) — nothing to recover.
    if (this.stoppedByUs || trackId !== this.currentTrackId) return;
    if (!this.currentUrl || !this.currentDidl) return;
    if (this.stallRetryCount >= DlnaDevice.MAX_STALL_RETRIES) return;
    this.stallRetryCount++;
    // Supersedes any pending RelTime-based check for this same load — it's
    // about to get its own fresh answer from a real reload, no need for a
    // second, differently-timed opinion on the same now-stale attempt.
    if (this.wakeCheckTimer) { clearTimeout(this.wakeCheckTimer); this.wakeCheckTimer = null; }
    this.sendLoadSequence(this.currentUrl, this.currentDidl, this.currentStartPositionSecs).catch(() => {
      /* best-effort recovery — a failure here just means it doesn't get the reload */
    });
  }

  /** SetAVTransportURI + Play + optional Seek — the core sequence shared by
   *  loadMedia()'s first attempt and verifyWoke()'s full-reload retry below. */
  private async sendLoadSequence(url: string, didl: string, startPositionSecs: number): Promise<void> {
    await soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "SetAVTransportURI", {
      InstanceID: 0, CurrentURI: url, CurrentURIMetaData: didl,
    });
    await soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "Play", { InstanceID: 0, Speed: "1" });
    if (startPositionSecs > 0) {
      await soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "Seek", {
        InstanceID: 0, Unit: "REL_TIME", Target: secondsToHms(startPositionSecs),
      }).catch(() => { /* seek-on-load isn't universally supported — the track just starts from 0 instead */ });
    }
  }

  private async verifyWoke(generation: number): Promise<void> {
    try {
      const info = await soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "GetPositionInfo", { InstanceID: 0 });
      // A track change (or disconnect) happened while this check was in
      // flight — whatever's loaded now has nothing to do with the wake
      // window this check was scheduled for.
      if (generation !== this.loadGeneration) return;
      if (!this.currentUrl || !this.currentDidl) return;
      const relTime = hmsToSeconds(info.RelTime ?? "");
      if (relTime > this.currentStartPositionSecs + 1) return; // real progress happened — this receiver didn't need the nudge
      await this.sendLoadSequence(this.currentUrl, this.currentDidl, this.currentStartPositionSecs);
    } catch { /* best-effort recovery nudge — a failure here just means it doesn't get the extra kick */ }
  }

  pause(): void {
    soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "Pause", { InstanceID: 0 }).catch(() => {});
  }

  resume(): void {
    soapCall(this.avTransportUrl, AVTRANSPORT_TYPE, "Play", { InstanceID: 0, Speed: "1" }).catch(() => {});
  }

  stop(): void {
    this.stoppedByUs = true;
    // A pending wake-check would otherwise seek back to the start and
    // re-issue Play a few seconds after an explicit stop, undoing it.
    if (this.wakeCheckTimer) { clearTimeout(this.wakeCheckTimer); this.wakeCheckTimer = null; }
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
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = null;
    if (this.wakeCheckTimer) clearTimeout(this.wakeCheckTimer);
    this.wakeCheckTimer = null;
    // Fire-and-forget, same as the old app's own disconnect path — nothing
    // meaningful to do if UNSUBSCRIBE fails (the subscription will just
    // expire on its own at TIMEOUT), and the caller (castManager.ts) needs
    // this to return synchronously.
    if (this.avtSid) {
      fetch(this.avTransportEventUrl!, { method: "UNSUBSCRIBE", headers: { SID: this.avtSid }, signal: AbortSignal.timeout(SOAP_TIMEOUT_MS) }).catch(() => {});
      this.avtSid = null;
    }
    if (this.rcSid) {
      fetch(this.renderingControlEventUrl!, { method: "UNSUBSCRIBE", headers: { SID: this.rcSid }, signal: AbortSignal.timeout(SOAP_TIMEOUT_MS) }).catch(() => {});
      this.rcSid = null;
    }
  }
}
