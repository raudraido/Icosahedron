// LAN discovery, modelled on Jellyfin's AutoDiscoveryHost: a client broadcasts "who is Icosahedron?"
// to UDP port 7360 and every engine answers {address, id, name} with the address that suits the asker.
//
// A Docker bridge network does not deliver broadcasts, so run this as its own container on the host
// network (`network_mode: host`, `command: node src/discovery.mjs`); see docs/deploy-server.md.
import dgram from "node:dgram";
import os from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

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

export function startDiscovery({ port = DISCOVERY_PORT, publicUrl, enginePort = 8080, name = "Icosahedron", id, interfaces } = {}) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  socket.on("message", (msg, rinfo) => {
    if (!msg.toString().toLowerCase().includes(DISCOVERY_QUERY)) return;
    const address = addressFor(rinfo.address, { publicUrl, enginePort }, interfaces);
    if (!address) return;
    socket.send(JSON.stringify({ address, id, name }), rinfo.port, rinfo.address);
  });
  socket.on("error", (e) => console.error("discovery:", e.message));
  return new Promise((resolve) => socket.bind(port, "0.0.0.0", () => resolve({ socket, port: socket.address().port, close: () => socket.close() })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = createHash("sha1").update(os.hostname()).digest("hex").slice(0, 16);
  const d = await startDiscovery({
    publicUrl: process.env.PUBLIC_URL,
    enginePort: Number(process.env.ENGINE_PORT ?? 8080),
    name: process.env.ENGINE_NAME ?? "Icosahedron",
    id,
  });
  console.log(`icosahedron discovery on udp/${d.port}`);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { d.close(); process.exit(0); });
}
