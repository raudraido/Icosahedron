import Bonjour from "bonjour-service";
import { Socket } from "node:net";
import { createSocket } from "node:dgram";

export interface DiscoveredCastDevice {
  id: string;
  name: string;
  protocol: "chromecast" | "dlna";
  host: string;
  port: number;
  /** False when a real TCP probe to host:port didn't connect within
   *  PROBE_TIMEOUT_MS — e.g. mDNS discovered a device on an isolated guest/
   *  IoT VLAN that routes multicast but not unicast TCP back to us.
   *  Connecting to one of these fails with EHOSTUNREACH; CastPicker.tsx
   *  greys these out instead of letting the user click through to that
   *  failure. A literal connectivity probe, not a same-subnet/netmask
   *  guess — routers legitimately route between different subnets, so
   *  "different subnet" alone isn't a reliable "unreachable" signal. */
  reachable: boolean;
  /** DLNA only — absolute SOAP control URLs resolved from the device's
   *  description XML (relative to its <URLBase>, or the description URL
   *  itself if that's absent). Chromecast devices never set these. */
  avTransportControlUrl?: string;
  renderingControlControlUrl?: string;
  /** DLNA only — absolute GENA (SUBSCRIBE/NOTIFY) event subscription URLs,
   *  resolved the same way as the control URLs above. AVTransport eventing
   *  is what castDlna.ts actually needs (playback state); RenderingControl
   *  eventing (volume) is a nice-to-have some renderers omit entirely. */
  avTransportEventUrl?: string;
  renderingControlEventUrl?: string;
}

const PROBE_TIMEOUT_MS = 1500;
const CAST_DEBUG_PREFIX = "[cast]";

function probeReachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    function finish(ok: boolean, reason?: string) {
      if (settled) return;
      settled = true;
      socket.destroy();
      console.log(`${CAST_DEBUG_PREFIX} probe ${host}:${port} — ${ok ? "reachable" : `unreachable (${reason})`}`);
      resolve(ok);
    }
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (err) => finish(false, (err as NodeJS.ErrnoException).code ?? err.message));
    socket.connect(port, host);
  });
}

// mDNS can advertise several addresses per device (IPv4 + IPv6, multiple
// interfaces) — trying only the first and giving up if that one isn't
// reachable was marking devices as unreachable when a *different* address
// in the same list would have actually worked (e.g. the first entry being
// an IPv6 link-local or a secondary-interface address, with a perfectly
// reachable IPv4 LAN address sitting right after it). Tries every
// candidate concurrently and uses whichever one actually connects.
async function firstReachableHost(addresses: string[], port: number): Promise<string | null> {
  if (addresses.length === 0) return null;
  const results = await Promise.all(addresses.map(async (addr) => ({ addr, ok: await probeReachable(addr, port) })));
  return results.find((r) => r.ok)?.addr ?? null;
}

// Short-lived Bonjour instance per scan (its own mDNS UDP socket) rather
// than one long-lived browser — discovery is on-demand (picker-open-
// triggered, see castManager.ts's staleness cache), not an always-on
// background process, so there's no session to keep alive between scans.
function scanChromecasts(timeoutMs: number): Promise<DiscoveredCastDevice[]> {
  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    const found = new Map<string, { id: string; name: string; addresses: string[]; port: number }>();
    const browser = bonjour.find({ type: "googlecast", protocol: "tcp" }, (service) => {
      const addresses = service.addresses?.length ? service.addresses : service.host ? [service.host] : [];
      console.log(`${CAST_DEBUG_PREFIX} mDNS found "${service.name}" — addresses=[${addresses.join(", ")}] port=${service.port}`);
      if (!addresses.length) return;
      // fqdn is stable across rescans for the same physical device; a
      // host:port fallback covers the (rare) case a service is missing one.
      const id = service.fqdn || `${addresses[0]}:${service.port}`;
      found.set(id, {
        id,
        name: (service.txt?.fn as string | undefined) || service.name,
        addresses,
        port: service.port,
      });
    });
    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      // Probed concurrently, not sequentially — worst case (every device
      // has every address unreachable) is one PROBE_TIMEOUT_MS wait, not N
      // of them.
      Promise.all(
        [...found.values()].map(async (d) => {
          const reachableHost = await firstReachableHost(d.addresses, d.port);
          return {
            id: d.id, name: d.name, protocol: "chromecast" as const,
            host: reachableHost ?? d.addresses[0], port: d.port,
            reachable: reachableHost !== null,
          };
        }),
      ).then(resolve);
    }, timeoutMs);
  });
}

const SSDP_MCAST_ADDR = "239.255.255.250";
const SSDP_MCAST_PORT = 1900;
// "ssdp:all" + post-fetch filtering on <deviceType> (below), rather than
// searching a specific MediaRenderer version target — catches renderers
// advertising as :1, :2, or anything else without needing a query per
// version, at the cost of a few more (cheap, discarded) description-XML
// fetches for non-renderer devices that also answered ssdp:all.
function ssdpSearchMessage(): Buffer {
  return Buffer.from(
    "M-SEARCH * HTTP/1.1\r\n" +
    `HOST: ${SSDP_MCAST_ADDR}:${SSDP_MCAST_PORT}\r\n` +
    'MAN: "ssdp:discover"\r\n' +
    "MX: 2\r\n" +
    "ST: ssdp:all\r\n\r\n",
  );
}

// Socket setup mirrors async_upnp_client's get_ssdp_socket() (the library
// the old app's DLNA discovery uses — confirmed still working on this exact
// machine/network) rather than a from-spec guess: SO_REUSEADDR, SO_BROADCAST,
// TTL 2, and — the one this was actually missing — joining the SSDP
// multicast group. M-SEARCH *responses* are unicast back to us in principle,
// so this shouldn't matter, but leaving the group unjoined is apparently the
// difference between finding nothing at all and finding devices in practice
// (driver/stack quirk, not spec-mandated — matching what's proven to work
// beats re-deriving it from the RFC).
// Temporary-but-permanent diagnostic logging — SSDP/UPnP interop is
// famously inconsistent across real hardware, so when a device doesn't show
// up, "here's what actually came back over the wire" is worth a lot more
// than re-guessing at the protocol level a third time. Cheap at the volume
// a manual "open the picker" scan runs.
const DEBUG_PREFIX = "[dlna]";

function ssdpSearch(timeoutMs: number): Promise<string[]> {
  return new Promise((resolve) => {
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    const locations = new Set<string>();
    let responseCount = 0;
    socket.on("message", (msg, rinfo) => {
      responseCount++;
      const text = msg.toString("utf8");
      const statusLine = text.split("\r\n")[0];
      const location = text.match(/^location:\s*(.+)$/im)?.[1]?.trim();
      const st = text.match(/^st:\s*(.+)$/im)?.[1]?.trim();
      console.log(`${DEBUG_PREFIX} response from ${rinfo.address}:${rinfo.port} — "${statusLine}" ST=${st ?? "<none>"} LOCATION=${location ?? "<none>"}`);
      if (location) locations.add(location);
    });
    // A bind/send failure (e.g. no IPv4 interface at all) just means an
    // empty result — same best-effort posture as scanChromecasts' bonjour
    // instance, not a reason to reject the whole scanCastDevices() call.
    socket.on("error", (err) => console.log(`${DEBUG_PREFIX} socket error: ${err.message}`));
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(2);
        socket.addMembership(SSDP_MCAST_ADDR);
      } catch (err) {
        console.log(`${DEBUG_PREFIX} multicast membership join failed: ${err instanceof Error ? err.message : err} (sends still go out without it)`);
      }
      const message = ssdpSearchMessage();
      function sendSearch() {
        try {
          socket.send(message, SSDP_MCAST_PORT, SSDP_MCAST_ADDR);
          console.log(`${DEBUG_PREFIX} sent M-SEARCH to ${SSDP_MCAST_ADDR}:${SSDP_MCAST_PORT}`);
        } catch (err) {
          console.log(`${DEBUG_PREFIX} M-SEARCH send failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      sendSearch();
      setTimeout(sendSearch, 1000); // sent twice — SSDP is fire-and-forget UDP, a single burst can just get lost
    });
    setTimeout(() => {
      socket.close();
      console.log(`${DEBUG_PREFIX} search window closed — ${responseCount} response(s), ${locations.size} distinct LOCATION(s)`);
      resolve([...locations]);
    }, timeoutMs);
  });
}

function extractTag(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`))?.[1];
}

// UPnP description XML can be a *multi-device* root: one outer <device>
// (often a vendor-specific wrapper — Denon's own "AiosDevice" root type is
// exactly this) wrapping further <device> entries in a nested <deviceList>
// for each standard profile it actually implements (MediaRenderer,
// MediaServer, etc.), all sharing one description.xml. extractTag's
// first-match semantics only ever sees the *outer* device's own
// <deviceType> — this checks every <deviceType> tag in the document instead,
// since the one we care about ("is a MediaRenderer in here somewhere?") is
// very possibly not the first/outermost one.
function hasDeviceType(xml: string, needle: string): boolean {
  for (const m of xml.matchAll(/<deviceType>([^<]*)<\/deviceType>/g)) {
    if (m[1].includes(needle)) return true;
  }
  return false;
}

// Service blocks are a flat, non-nested <serviceList><service>...</service>
// <service>...</service></serviceList> — matching each <service>...</service>
// block whole and pulling serviceType/controlURL back out of each is simpler
// and less fragile than trying to correlate two separate flat tag sweeps.
interface ServiceUrls {
  avTransport?: string;
  avTransportEvent?: string;
  renderingControl?: string;
  renderingControlEvent?: string;
}
function extractServiceControlUrls(xml: string): ServiceUrls {
  const result: ServiceUrls = {};
  for (const block of xml.match(/<service>[\s\S]*?<\/service>/g) ?? []) {
    const serviceType = extractTag(block, "serviceType");
    const controlURL = extractTag(block, "controlURL");
    const eventSubURL = extractTag(block, "eventSubURL");
    if (!serviceType || !controlURL) continue;
    if (serviceType.includes(":service:AVTransport:")) {
      result.avTransport = controlURL;
      result.avTransportEvent = eventSubURL;
    } else if (serviceType.includes(":service:RenderingControl:")) {
      result.renderingControl = controlURL;
      result.renderingControlEvent = eventSubURL;
    }
  }
  return result;
}

interface DlnaDescription {
  udn: string;
  friendlyName: string;
  host: string;
  port: number;
  avTransportControlUrl: string;
  renderingControlControlUrl?: string;
  avTransportEventUrl?: string;
  renderingControlEventUrl?: string;
}

// Fetches and parses one SSDP LOCATION's device-description XML — returns
// null for anything that isn't a controllable MediaRenderer (wrong device
// type, or missing the one service AVTransport that's actually required),
// so a mixed ssdp:all response set (routers, printers, other UPnP chatter)
// silently narrows down to just the renderers worth showing.
async function fetchDlnaDescription(location: string): Promise<DlnaDescription | null> {
  try {
    // Connection: close — same reasoning as castDlna.ts's soapCall(): don't
    // leave a pooled keep-alive connection to an embedded device's HTTP
    // server that it might silently close on us before it's ever reused.
    const resp = await fetch(location, { headers: { Connection: "close" } });
    if (!resp.ok) {
      console.log(`${DEBUG_PREFIX} ${location} — HTTP ${resp.status}, skipped`);
      return null;
    }
    const xml = await resp.text();
    if (!hasDeviceType(xml, ":device:MediaRenderer:")) {
      const allTypes = [...xml.matchAll(/<deviceType>([^<]*)<\/deviceType>/g)].map((m) => m[1]);
      console.log(`${DEBUG_PREFIX} ${location} — deviceType(s) found: [${allTypes.join(", ") || "none"}], no MediaRenderer among them, skipped`);
      return null;
    }
    const friendlyName = extractTag(xml, "friendlyName");
    const udn = extractTag(xml, "UDN");
    if (!friendlyName || !udn) {
      console.log(`${DEBUG_PREFIX} ${location} — missing friendlyName or UDN, skipped`);
      return null;
    }
    const { avTransport, avTransportEvent, renderingControl, renderingControlEvent } = extractServiceControlUrls(xml);
    if (!avTransport) {
      console.log(`${DEBUG_PREFIX} ${location} — "${friendlyName}" has no AVTransport service, skipped`);
      return null;
    }
    // <URLBase>, if present, is what relative service URLs resolve against
    // — not just the description URL's origin, but its own (possibly
    // different) path too, so this can't be shortcut to new URL(location).origin.
    const baseUrl = extractTag(xml, "URLBase") || location;
    const avTransportControlUrl = new URL(avTransport, baseUrl).toString();
    const renderingControlControlUrl = renderingControl ? new URL(renderingControl, baseUrl).toString() : undefined;
    const avTransportEventUrl = avTransportEvent ? new URL(avTransportEvent, baseUrl).toString() : undefined;
    const renderingControlEventUrl = renderingControlEvent ? new URL(renderingControlEvent, baseUrl).toString() : undefined;
    // host/port for the reachability probe below come from the actual SOAP
    // endpoint we're going to call, not the description URL — usually the
    // same, but a device that puts <URLBase> on a different port would
    // otherwise get probed against the wrong one.
    const controlUrl = new URL(avTransportControlUrl);
    console.log(`${DEBUG_PREFIX} ${location} — accepted "${friendlyName}", AVTransport=${avTransportControlUrl}, RenderingControl=${renderingControlControlUrl ?? "<none>"}, AVTransportEvent=${avTransportEventUrl ?? "<none>"}`);
    return {
      udn, friendlyName,
      host: controlUrl.hostname,
      port: Number(controlUrl.port) || (controlUrl.protocol === "https:" ? 443 : 80),
      avTransportControlUrl, renderingControlControlUrl,
      avTransportEventUrl, renderingControlEventUrl,
    };
  } catch (err) {
    console.log(`${DEBUG_PREFIX} ${location} — fetch/parse failed: ${err instanceof Error ? err.message : err}, skipped`);
    return null; // unreachable/malformed description — just not a candidate device
  }
}

async function scanDlna(timeoutMs: number): Promise<DiscoveredCastDevice[]> {
  const locations = await ssdpSearch(timeoutMs);
  const descriptions = (await Promise.all(locations.map(fetchDlnaDescription)))
    .filter((d): d is DlnaDescription => d != null);
  const devices = await Promise.all(descriptions.map(async (d) => ({
    id: d.udn,
    name: d.friendlyName,
    protocol: "dlna" as const,
    host: d.host,
    port: d.port,
    avTransportControlUrl: d.avTransportControlUrl,
    renderingControlControlUrl: d.renderingControlControlUrl,
    avTransportEventUrl: d.avTransportEventUrl,
    renderingControlEventUrl: d.renderingControlEventUrl,
    reachable: await probeReachable(d.host, d.port),
  })));
  console.log(`${DEBUG_PREFIX} scan complete — ${devices.length} MediaRenderer(s): ${devices.map((d) => `${d.name} (reachable=${d.reachable})`).join(", ") || "none"}`);
  return devices;
}

export async function scanCastDevices(timeoutMs = 5000): Promise<DiscoveredCastDevice[]> {
  const [chromecasts, dlna] = await Promise.all([scanChromecasts(timeoutMs), scanDlna(timeoutMs)]);
  return [...chromecasts, ...dlna];
}
