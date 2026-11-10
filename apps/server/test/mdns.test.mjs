import test from "node:test";
import assert from "node:assert/strict";
import packet from "dns-packet";
import { mdnsAnswers, localIp, MDNS_SERVICE } from "../src/discovery.mjs";

const ctx = { name: "Home", port: 8484, address: "https://music.raud.cloud", host: "nas.local", ip: "10.0.0.18", id: "abc" };
const ifaces = {
  lo: [{ family: "IPv4", address: "127.0.0.1", netmask: "255.0.0.0", internal: true }],
  eth0: [{ family: "IPv4", address: "10.0.0.18", netmask: "255.255.255.0", internal: false }],
  eth1: [{ family: "IPv4", address: "192.168.5.2", netmask: "255.255.255.0", internal: false }],
};

test("a PTR question gets the instance, with SRV, TXT and A in the same answer", () => {
  const r = mdnsAnswers([{ name: MDNS_SERVICE, type: "PTR" }], ctx);
  assert.deepEqual(r.answers.map((x) => x.type), ["PTR"]);
  assert.equal(r.answers[0].data, `Home.${MDNS_SERVICE}`);
  assert.deepEqual(r.additionals.map((x) => x.type), ["SRV", "TXT", "A"]);
  const txt = r.additionals.find((x) => x.type === "TXT").data;
  assert.ok(txt.includes("address=https://music.raud.cloud") && txt.includes("id=abc"));
  assert.deepEqual(r.additionals.find((x) => x.type === "SRV").data, { port: 8484, target: "nas.local" });
});

test("the records survive being put on the wire and read back", () => {
  const r = mdnsAnswers([{ name: MDNS_SERVICE, type: "PTR" }], ctx);
  const back = packet.decode(packet.encode({ type: "response", answers: r.answers, additionals: r.additionals }));
  assert.equal(back.answers[0].data, `Home.${MDNS_SERVICE}`);
  const txt = back.additionals.find((x) => x.type === "TXT").data.map((b) => b.toString());
  assert.ok(txt.includes("address=https://music.raud.cloud"));
  assert.equal(back.additionals.find((x) => x.type === "A").data, "10.0.0.18");
});

test("questions for other services, or other names, get nothing", () => {
  assert.equal(mdnsAnswers([{ name: "_googlecast._tcp.local", type: "PTR" }], ctx).answers.length, 0);
  assert.equal(mdnsAnswers([{ name: "Other." + MDNS_SERVICE, type: "SRV" }], ctx).answers.length, 0);
  assert.equal(mdnsAnswers([], ctx).answers.length, 0);
});

test("direct questions for the instance and the host are answered (case does not matter)", () => {
  assert.deepEqual(mdnsAnswers([{ name: `home.${MDNS_SERVICE.toUpperCase()}`, type: "SRV" }], ctx).answers.map((x) => x.type), ["SRV"]);
  assert.deepEqual(mdnsAnswers([{ name: `Home.${MDNS_SERVICE}`, type: "TXT" }], ctx).answers.map((x) => x.type), ["TXT"]);
  assert.deepEqual(mdnsAnswers([{ name: "NAS.local", type: "A" }], ctx).answers.map((x) => x.type), ["A"]);
});

test("the address given is on the asker's subnet, else the first real one", () => {
  assert.equal(localIp("192.168.5.77", ifaces), "192.168.5.2");
  assert.equal(localIp("10.0.0.1", ifaces), "10.0.0.18");
  assert.equal(localIp("10.10.0.124", ifaces), "10.0.0.18");
  assert.equal(localIp(null, ifaces), "10.0.0.18");
  assert.equal(localIp("10.0.0.1", { lo: ifaces.lo }), null);
});
