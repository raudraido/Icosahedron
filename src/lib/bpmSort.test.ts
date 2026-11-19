// Run: npm run test:src
import test from "node:test";
import assert from "node:assert/strict";
import { idsByBpm, sortTracksByBpm, orderLike, chunk } from "./bpmSort";
import type { Track } from "./api";

const t = (id: string, bpm: number | null = null): Track => ({
  id, title: id, artist: "A", artist_id: null, album: null, album_id: null, track_number: 1, disc_number: 1, duration_secs: 200,
  cover_id: null, stream_url: "", starred: false, genre: null, year: null, play_count: 0, bitrate: null, bpm, created: null, format: null,
});
const CACHE = { a: 128, b: 90, c: 174, d: 128, e: 0 };

test("ids are ordered by the detected BPM, ties by id, songs without a BPM left out", () => {
  assert.deepEqual(idsByBpm(CACHE, "asc"), ["b", "a", "d", "c"]);
  assert.deepEqual(idsByBpm(CACHE, "desc"), ["c", "a", "d", "b"]);
});

test("tracks follow the detected BPM, not the tag (the tag only fills in where nothing was detected); those without any BPM stay last", () => {
  const tracks = [t("x"), t("a", 60), t("b"), t("c"), t("y", 100)]; // a's tag (60) disagrees with its detected 128; y has only a tag
  const cache = { a: 128, b: 90, c: 174 };
  assert.deepEqual(sortTracksByBpm(tracks, "asc", cache).map((x) => x.id), ["b", "y", "a", "c", "x"]);
  assert.deepEqual(sortTracksByBpm(tracks, "desc", cache).map((x) => x.id), ["c", "a", "y", "b", "x"]);
});

test("orderLike keeps the order of the ids and skips the missing ones", () => {
  assert.deepEqual(orderLike([t("b"), t("a")], ["a", "zz", "b"]).map((x) => x.id), ["a", "b"]);
});

test("chunk splits a list", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});
