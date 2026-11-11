import test from "node:test";
import assert from "node:assert/strict";
import { createTour } from "../src/tour.mjs";

const fakeFetch = (calls) => async (url) => {
  calls.push(String(url));
  const body = String(url).includes("/attractions.json")
    ? { _embedded: { attractions: [{ id: "T1", name: "Coldplay Experience - Coldplay Tribute" }, { id: "A1", name: "Coldplay" }] } }
    : { _embedded: { events: [{ url: "https://tm/e1", dates: { start: { dateTime: "2027-01-02T19:00:00Z" } }, _embedded: { venues: [{ name: "Arena", city: { name: "Tallinn" }, country: { name: "Estonia" } }] } }] } };
  return { ok: true, json: async () => body };
};

test("matches the exact artist, ignores tribute acts, caches", async () => {
  const calls = [];
  const t = createTour({ apiKey: "k", fetchImpl: fakeFetch(calls) });
  const ev = await t.events("Coldplay");
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].venue, { name: "Arena", city: "Tallinn", region: "", country: "Estonia" });
  assert.ok(calls[1].includes("attractionId=A1"));
  await t.events("coldplay");
  assert.equal(calls.length, 2);
});

test("unknown artist gives no events", async () => {
  const t = createTour({ apiKey: "k", fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.deepEqual(await t.events("Nobody"), []);
});
