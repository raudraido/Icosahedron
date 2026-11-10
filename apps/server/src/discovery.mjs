// LAN discovery, modelled on Jellyfin's AutoDiscoveryHost: a client broadcasts "who is Icosahedron?"
// to UDP port 7360 and every engine answers {address, id, name} with the address that suits the asker.
//
// It also announces itself with mDNS (DNS-SD, service _icosahedron._tcp): firewalls let mDNS through
// by default and routers can forward it between networks (UniFi: Gateway mDNS Proxy), which a
// broadcast to UDP 7360 cannot do.
//
// A Docker bridge network does not deliver broadcasts or multicast, so run this as its own container
// on the host network (`network_mode: host`, `command: node src/discovery.mjs`); see docs/deploy-server.md.
import dgram from "node:dgram";
import os from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import mdnsFactory from "multicast-dns";

export const DISCOVERY_PORT = 7360;
export const DISCOVERY_QUERY = "who is icosahedron?";

const toInt = (ip) => ip.split(".").reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
const sameSubnet = (a, b, mask) => (toInt(a) & toInt(mask)) === (toInt(b) & toInt(mask));

/** The address of this engine for the asker: the public URL when one is set, else this host's address on the asker's subnet. */
export function addressFor(remote, { publicUrl, enginePort }, interfaces = os.networkInterfaces()) {
  if (publicUrl) return publicUrl.replace(/\/+$/, "");
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal && sameSubnet(i.address, remote, i.netmask)) return `http://${i.address}:${enginePort}`;
    }
  }
  return null;
}

export const MDNS_SERVICE = "_icosahedron._tcp.local";

/** This host's IPv4 address on the asker's subnet, else its first non-loopback one. */
export function localIp(remote, interfaces = os.networkInterfaces()) {
  let first = null;
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if (i.family !== "IPv4" || i.internal) continue;
      if (remote && sameSubnet(i.address, remote, i.netmask)) return i.address;
      first ??= i.address;
    }
  }
  return first;
}

/**
 * The DNS-SD records answering `questions`: PTR (who offers the service), SRV (port, host), TXT (the
 * address the apps should use, id, name) and A (the host's address). `address` is what apps connect to.
 */
export function mdnsAnswers(questions, { name, port, address, host, ip, id }) {
  const instance = `${name}.${MDNS_SERVICE}`;
  const asks = (n, ...types) => questions.some((q) => q.name?.toLowerCase() === n.toLowerCase() && (q.type === "ANY" || types.includes(q.type)));
  const ptr = { name: MDNS_SERVICE, type: "PTR", ttl: 120, data: instance };
  const srv = { name: instance, type: "SRV", ttl: 120, flush: true, data: { port, target: host } };
  const txt = { name: instance, type: "TXT", ttl: 120, flush: true, data: [`address=${address}`, `id=${id}`, `name=${name}`] };
  const a = { name: host, type: "A", ttl: 120, flush: true, data: ip };
  const answers = [], additionals = [];
  if (asks(MDNS_SERVICE, "PTR")) { answers.push(ptr); additionals.push(srv, txt, a); }
  if (asks(instance, "SRV")) { answers.push(srv); additionals.push(a); }
  if (asks(instance, "TXT")) answers.push(txt);
  if (asks(host, "A")) answers.push(a);
  return { answers, additionals };
}

function startMdns({ publicUrl, enginePort, name, id, interfaces }) {
  const host = `${os.hostname().replace(/\./g, "-")}.local`;
  const mdns = mdnsFactory({ reuseAddr: true });
  const info = (remote) => {
    const address = addressFor(remote, { publicUrl, enginePort }, interfaces) ?? null;
    const ip = localIp(remote, interfaces);
    if (!ip) return null;
    return { name, port: enginePort, address: address ?? `http://${ip}:${enginePort}`, host, ip, id };
  };
  // Join the group on every interface, not only the default one.
  for (const list of Object.values(interfaces ?? os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) { try { mdns.socket.addMembership("224.0.0.251", i.address); } catch { /* already a member */ } }
    }
  }
  mdns.on("query", (query, rinfo) => {
    const ctx = info(rinfo?.address);
    if (!ctx) return;
    const r = mdnsAnswers(query.questions ?? [], ctx);
    if (r.answers.length) mdns.respond(r);
  });
  mdns.on("error", (e) => console.error("mdns:", e.message));
  // Announce now and now and then, so listeners (and a router's mDNS proxy) learn about us without asking.
  const announce = () => {
    const ctx = info(null);
    if (!ctx) return;
    const r = mdnsAnswers([{ name: MDNS_SERVICE, type: "PTR" }], ctx);
    mdns.respond(r);
  };
  announce();
  const timer = setInterval(announce, 2 * 60 * 1000);
  timer.unref();
  return { close: () => { clearInterval(timer); mdns.destroy(); } };
}

export function startDiscovery({ port = DISCOVERY_PORT, publicUrl, enginePort = 8080, name = "Icosahedron", id, interfaces, mdns = false } = {}) {
  const mdnsHandle = mdns ? startMdns({ publicUrl, enginePort, name, id, interfaces }) : null;
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  socket.on("message", (msg, rinfo) => {
    if (!msg.toString().toLowerCase().includes(DISCOVERY_QUERY)) return;
    const address = addressFor(rinfo.address, { publicUrl, enginePort }, interfaces);
    if (!address) return;
    socket.send(JSON.stringify({ address, id, name }), rinfo.port, rinfo.address);
  });
  socket.on("error", (e) => console.error("discovery:", e.message));
  return new Promise((resolve) => socket.bind(port, "0.0.0.0", () => resolve({ socket, port: socket.address().port, close: () => { mdnsHandle?.close(); socket.close(); } })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = createHash("sha1").update(os.hostname()).digest("hex").slice(0, 16);
  const d = await startDiscovery({
    publicUrl: process.env.PUBLIC_URL,
    enginePort: Number(process.env.ENGINE_PORT ?? 8080),
    name: process.env.ENGINE_NAME ?? "Icosahedron",
    id,
    mdns: !["0", "false", "no"].includes(String(process.env.DISCOVERY_MDNS ?? "").trim().toLowerCase()),
  });
  console.log(`icosahedron discovery on udp/${d.port} and mDNS (_icosahedron._tcp)`);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { d.close(); process.exit(0); });
}
