// Run: npm run test:src
import test from "node:test";
import assert from "node:assert/strict";
import { jukeboxUrl, pageIdentity } from "./jukebox";

test("a normal page keeps the browser's one device id", () => {
  assert.deepEqual(pageIdentity(""), { isJukebox: false, jukeboxName: null, storageKey: "ico.deviceId" });
  assert.equal(pageIdentity("?tab=albums").storageKey, "ico.deviceId");
});

test("a jukebox never shares the id of the browser's own web app", () => {
  for (const s of ["?player=1", "?player", "?player="]) {
    const p = pageIdentity(s);
    assert.equal(p.isJukebox, true);
    assert.equal(p.jukeboxName, null);
    assert.equal(p.storageKey, "ico.deviceId.player");
  }
});

test("every name is its own jukebox, the same name is the same one", () => {
  const a = pageIdentity("?player=Kitchen"), b = pageIdentity("?player=Garage"), c = pageIdentity("?player=kitchen");
  assert.equal(a.jukeboxName, "Kitchen");
  assert.notEqual(a.storageKey, b.storageKey);
  assert.equal(a.storageKey, c.storageKey);
  assert.notEqual(a.storageKey, pageIdentity("?player=1").storageKey);
});

test("names with spaces, accents and symbols give a safe key", () => {
  assert.equal(pageIdentity("?player=Living%20room%20TV").storageKey, "ico.deviceId.player.living-room-tv");
  assert.equal(pageIdentity("?player=K%C3%B6%C3%B6k").jukeboxName, "Köök");
  assert.equal(pageIdentity("?player=K%C3%B6%C3%B6k").storageKey, "ico.deviceId.player.köök");
  assert.match(pageIdentity("?player=%21%21%21").storageKey, /^ico\.deviceId\.player\.x$/);
});

test("the address: 1 without a name, the name encoded with one", () => {
  assert.equal(jukeboxUrl("https://hub.example.com/"), "https://hub.example.com/?player=1");
  assert.equal(jukeboxUrl("https://hub.example.com", "  "), "https://hub.example.com/?player=1");
  assert.equal(jukeboxUrl("https://hub.example.com", "Living room"), "https://hub.example.com/?player=Living%20room");
});
