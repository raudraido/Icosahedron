// Tests for the Mix Builder's pure logic. Run: npm run test:src
// (bundles this file with esbuild, which Vite already brings, and runs it with node's test runner).
import test from "node:test";
import assert from "node:assert/strict";
import {
  bpmAvailable, bpmActive, bpmHistogram, binInRange, bpmRangeLabel, buildFlowMix, coveragePercent, curveAt, idsInBpmRange, inBpmRange,
  joinBpm, mixBpmStats, normalizeBpmRange, sanitizeCurve, setBpmRange, targetBpm, isStarted, BPM_MIN_COVERAGE, FLOW_PRESETS,
  addSeed, isLeftOut, isSpoken, toggleSkipGenre, artistCap, autoName, bpmCoverage, buildMix, countMatches, defaultSettings, fmtLength, hiddenCount,
  localSuggestions, matchGenres, mulberry32, parseDecade, passes, poolKey, presetSettings, reasonLine, removeSeed,
  setYears, snapSize, swapCandidate, toggleGenre, topArtists, type MixItem, type PoolItem,
} from "./mixBuilder";
import type { Track } from "./api";

let n = 0;
function track(p: Partial<Track> = {}): Track {
  n++;
  return {
    id: `t${n}`, title: `Song ${n}`, artist: `Artist ${n % 40}`, artist_id: `a${n % 40}`, album: null, album_id: null,
    track_number: 1, disc_number: 1, duration_secs: 200, cover_id: null, stream_url: "", starred: false, genre: "Techno",
    year: 2020, play_count: 0, bitrate: null, bpm: null, created: null, format: null, ...p,
  };
}
const pool = (count: number, f?: (i: number) => Partial<Track>): PoolItem[] => Array.from({ length: count }, (_, i) => ({ track: track(f?.(i)) }));
const NOW = new Date(2026, 10, 19);

test("parseDecade understands the usual spellings", () => {
  assert.deepEqual(parseDecade("90s"), { from: 1990, to: 1999, label: "1990s" });
  assert.deepEqual(parseDecade("1990s"), { from: 1990, to: 1999, label: "1990s" });
  assert.deepEqual(parseDecade("'80s"), { from: 1980, to: 1989, label: "1980s" });
  assert.deepEqual(parseDecade("00s"), { from: 2000, to: 2009, label: "2000s" });
  assert.deepEqual(parseDecade("10s"), { from: 2010, to: 2019, label: "2010s" });
  assert.deepEqual(parseDecade(" 2020S "), { from: 2020, to: 2029, label: "2020s" });
  assert.equal(parseDecade("95s"), null);
  assert.equal(parseDecade("techno"), null);
  assert.equal(parseDecade("90"), null);
});

test("suggestions: a decade and matching genres, nothing for an empty box", () => {
  const genres = [{ name: "Techno" }, { name: "Tech House" }, { name: "Jazz" }];
  assert.deepEqual(localSuggestions("", genres), []);
  assert.deepEqual(localSuggestions("tech", genres).map((s) => s.text), ["Techno", "Tech House"]);
  const d = localSuggestions("90s", genres);
  assert.equal(d[0].seed.kind, "decade");
});

test("seeds: add, no duplicates, decades set and widen the years, removing resets them", () => {
  let s = defaultSettings();
  s = addSeed(s, { kind: "artist", value: "Kuro Static", id: "1" });
  s = addSeed(s, { kind: "artist", value: "kuro static" });
  assert.equal(s.seeds.length, 1);
  s = addSeed(s, { kind: "decade", value: "1990s", from: 1990, to: 1999 });
  assert.deepEqual(s.years, [1990, 1999]);
  s = addSeed(s, { kind: "decade", value: "2000s", from: 2000, to: 2009 });
  assert.deepEqual(s.years, [1990, 2009]);
  s = removeSeed(s, 1);
  assert.deepEqual(s.years, [2000, 2009]);
  s = removeSeed(s, 1);
  assert.equal(s.years, null);
  // moving the years dial by hand drops decade chips
  s = addSeed(s, { kind: "decade", value: "1990s", from: 1990, to: 1999 });
  s = setYears(s, [1985, 1999]);
  assert.equal(s.seeds.some((x) => x.kind === "decade"), false);
});

test("genre toggle adds and removes the chip", () => {
  let s = toggleGenre(defaultSettings(), "Techno");
  assert.equal(s.seeds.length, 1);
  s = toggleGenre(s, "techno");
  assert.equal(s.seeds.length, 0);
});

test("sizes snap to the chips; hidden rows are counted", () => {
  assert.equal(snapSize(30), 30);
  assert.equal(snapSize(480), 500);
  assert.equal(snapSize(5000), 1000);
  assert.equal(snapSize(NaN), 30);
  assert.equal(hiddenCount(500), 470);
  assert.equal(hiddenCount(20), 0);
});

test("filters: years, genre (also inside 'A; B'), favourites, not played yet", () => {
  const s = { ...defaultSettings(), years: [2010, 2020] as [number, number] };
  assert.equal(passes(track({ year: 2015 }), s), true);
  assert.equal(passes(track({ year: 2021 }), s), false);
  assert.equal(passes(track({ year: null }), s), false);
  const g = toggleGenre(defaultSettings(), "House");
  assert.equal(passes(track({ genre: "Techno; House" }), g), true);
  assert.equal(passes(track({ genre: "Deep House" }), g), false);
  assert.equal(passes(track({ genre: null }), g), false);
  assert.equal(passes(track({ starred: false }), { ...defaultSettings(), favOnly: true }), false);
  assert.equal(passes(track({ play_count: 3 }), { ...defaultSettings(), unplayedOnly: true }), false);
  assert.equal(passes(track({ play_count: 0 }), { ...defaultSettings(), unplayedOnly: true }), true);
});

test("buildMix: right size, no repeats, artist cap, every pick passes the filters", () => {
  const items = pool(400, (i) => ({ year: i % 2 ? 2005 : 2020, artist: `Artist ${i % 100}` }));
  const s = { ...defaultSettings(), size: 50, years: [2015, 2025] as [number, number] };
  const { mix, matches } = buildMix(items, s, [], mulberry32(1));
  assert.equal(mix.length, 50);
  assert.equal(matches, 200);
  assert.equal(new Set(mix.map((m) => m.track.id)).size, 50);
  assert.ok(mix.every((m) => m.track.year! >= 2015));
  const per = new Map<string, number>();
  mix.forEach((m) => per.set(m.track.artist, (per.get(m.track.artist) ?? 0) + 1));
  assert.ok(Math.max(...per.values()) <= artistCap(50));
});

test("buildMix: a small pool relaxes the artist cap rather than coming up short", () => {
  const items = pool(30, () => ({ artist: "Same", artist_id: "x" }));
  const { mix } = buildMix(items, { ...defaultSettings(), size: 20 }, [], mulberry32(2));
  assert.equal(mix.length, 20);
});

test("buildMix: kept songs survive a re-roll and are not picked twice", () => {
  const items = pool(200);
  const s = { ...defaultSettings(), size: 30 };
  const first = buildMix(items, s, [], mulberry32(3)).mix;
  const kept: MixItem[] = first.slice(0, 5).map((m) => ({ ...m, locked: true }));
  const again = buildMix(items, s, kept, mulberry32(4)).mix;
  assert.equal(again.length, 30);
  assert.deepEqual(again.slice(0, 5).map((m) => m.track.id), kept.map((m) => m.track.id));
  assert.equal(new Set(again.map((m) => m.track.id)).size, 30);
  assert.ok(again.slice(0, 5).every((m) => m.locked));
});

test("buildMix: seed artists' songs rank first", () => {
  const items: PoolItem[] = [...pool(200), ...Array.from({ length: 10 }, () => ({ track: track({ artist: "Wanted", artist_id: "w" }), by: "Wanted" }))];
  const { mix } = buildMix(items, { ...defaultSettings(), size: 20, discover: 50 }, [], mulberry32(5));
  const wanted = mix.filter((m) => m.track.artist === "Wanted");
  assert.equal(wanted.length, 2); // by + the cap of 2
  assert.equal(wanted[0].why[0], "by Wanted");
});

test("buildMix: familiar vs new weighting follows the dial", () => {
  const items = pool(300, (i) => ({ play_count: i < 150 ? 80 : 0 }));
  const count = (discover: number) => buildMix(items, { ...defaultSettings(), size: 50, discover }, [], mulberry32(6)).mix.filter((m) => m.track.play_count > 0).length;
  assert.ok(count(0) > 40, "familiar: mostly played songs");
  assert.ok(count(100) < 10, "new: mostly unplayed songs");
});

test("pure random ignores taste and filters; every song is equally likely", () => {
  const items = pool(1000, (i) => ({ play_count: i < 100 ? 500 : 0, starred: i < 100 }));
  const s = { ...defaultSettings(), pure: true, size: 500, years: [1990, 1991] as [number, number] };
  const { mix } = buildMix(items, s, [], mulberry32(7));
  assert.equal(mix.length, 500);
  const popular = mix.filter((m) => m.track.play_count > 0).length;
  assert.ok(popular > 20 && popular < 90, `about 10% popular songs expected, got ${popular}`);
});

test("swapCandidate gives a song that is not in the mix and passes the filters", () => {
  const items = pool(60, (i) => ({ year: i < 30 ? 2000 : 2020 }));
  const s = { ...defaultSettings(), size: 10, years: [2015, 2025] as [number, number] };
  const { mix } = buildMix(items, s, [], mulberry32(8));
  const next = swapCandidate(items, s, mix, mulberry32(9))!;
  assert.ok(next && !mix.some((m) => m.track.id === next.track.id) && next.track.year! >= 2015);
  assert.equal(swapCandidate(items.slice(0, 1), s, [{ track: items[0].track, why: [], locked: false }]), null);
});

test("countMatches counts distinct songs that pass", () => {
  const items = pool(10, (i) => ({ starred: i < 4 }));
  assert.equal(countMatches([...items, ...items], { ...defaultSettings(), favOnly: true }), 4);
});

test("reason line: why, genre, year, not played yet", () => {
  const m: MixItem = { track: track({ genre: "Techno", year: 2021, play_count: 0 }), why: ["like Kuro Static"], locked: false };
  assert.equal(reasonLine(m), "like Kuro Static · Techno · 2021 · not played yet");
  assert.equal(reasonLine({ track: track({ genre: null, year: null, play_count: 4, starred: true }), why: [], locked: false }), "favourite");
});

test("autoName", () => {
  assert.equal(autoName(defaultSettings(), NOW), "Mix · 19 Nov");
  let s = addSeed(defaultSettings(), { kind: "artist", value: "Kuro Static" });
  s = addSeed(s, { kind: "genre", value: "Techno" });
  s = setYears(s, [2014, 2025]);
  assert.equal(autoName(s, NOW), "Kuro Static · Techno · 2014–2025 · 19 Nov");
  assert.equal(autoName({ ...defaultSettings(), pure: true, size: 500 }, NOW), "500 random songs · 19 Nov");
  assert.equal(autoName({ ...defaultSettings(), title: "Lucky mix" }, NOW), "Lucky mix · 19 Nov");
  const long = autoName(addSeed(addSeed(defaultSettings(), { kind: "artist", value: "A".repeat(80) }), { kind: "genre", value: "x" }), NOW);
  assert.ok(long.length < 100);
});

test("length formatting", () => {
  assert.equal(fmtLength(187), "3:07");
  assert.equal(fmtLength(3725), "1:02:05");
});

test("presets work without BPM and fit the library's genres", () => {
  const genres = [{ name: "Hip-Hop", songCount: 50 }, { name: "Techno", songCount: 70 }, { name: "Ambient", songCount: 20 }, { name: "Jazz", songCount: 5 }];
  assert.deepEqual(matchGenres(["techno", "hip"], genres), ["Techno", "Hip-Hop"]);
  const w = presetSettings("workout", genres, 2026);
  assert.deepEqual(w.seeds.map((x) => x.value), ["Techno", "Hip-Hop"]);
  assert.equal(presetSettings("throwback", genres, 2026).years![1], 2011);
  const f = presetSettings("fresh", genres, 2026);
  assert.deepEqual(f.years, [2025, 2026]);
  assert.equal(f.unplayedOnly, true);
  assert.deepEqual(presetSettings("focus", genres, 2026).seeds.map((x) => x.value), ["Ambient", "Jazz"]);
});

test("poolKey ignores the dials that only re-weigh", () => {
  const a = defaultSettings();
  assert.equal(poolKey(a), poolKey({ ...a, discover: 90, size: 100, unplayedOnly: true }));
  assert.notEqual(poolKey(a), poolKey(addSeed(a, { kind: "genre", value: "Jazz" })));
  assert.notEqual(poolKey(a), poolKey({ ...a, years: [2000, 2010] }));
});

test("topArtists: one per artist, in order", () => {
  const albums = [{ artist: "A", artist_id: "1" }, { artist: "A", artist_id: "1" }, { artist: "B", artist_id: null }, { artist: "C", artist_id: "3" }];
  assert.deepEqual(topArtists(albums, 3), [{ name: "A", id: "1" }, { name: "C", id: "3" }]);
});

test("BPM coverage: share of the library, gated at BPM_MIN_COVERAGE, overridable", () => {
  assert.equal(bpmCoverage(0, 36062), 0);
  assert.equal(bpmCoverage(10, null), 0);
  assert.equal(bpmCoverage(10, 0), 0);
  assert.ok(Math.abs(bpmCoverage(4400, 36062) - 0.122) < 0.001);
  assert.equal(bpmCoverage(50000, 36062), 1); // the store can hold songs that left the library
  assert.equal(bpmAvailable(0.12), false);
  assert.equal(bpmAvailable(BPM_MIN_COVERAGE), true);
  assert.equal(bpmAvailable(0.59), false);
  assert.equal(bpmAvailable(0.59, false, 0.5), true);
  assert.equal(bpmAvailable(0.01, true), true);
  assert.equal(coveragePercent(0.122), 12);
  assert.equal(coveragePercent(0.0004), 1);
  assert.equal(coveragePercent(0.998), 99);
  assert.equal(coveragePercent(1), 100);
});

test("BPM range: the whole dial is no filter, the ends are open, songs without BPM drop out only when narrowed", () => {
  assert.equal(normalizeBpmRange([60, 200]), null);
  assert.equal(normalizeBpmRange([20, 300]), null);
  assert.deepEqual(normalizeBpmRange([125.4, 135]), [125, 135]);
  assert.deepEqual(normalizeBpmRange([140, 120]), [140, 140]);
  assert.equal(bpmActive({ bpm: null }), false);
  assert.equal(bpmActive({ bpm: [60, 200] }), false);
  assert.equal(bpmActive({ bpm: [60, 199] }), true);
  assert.equal(inBpmRange(230, [150, 200]), true); // 200 = "200 and faster"
  assert.equal(inBpmRange(50, [60, 100]), true); // 60 = "60 and slower"
  assert.equal(inBpmRange(101, [60, 100]), false);
  const s = defaultSettings();
  const none = track({ bpm: null }), at = track({ bpm: 128 }), off = track({ bpm: 90 });
  assert.equal(passes(none, s), true); // full range: kept
  assert.equal(passes(none, setBpmRange(s, [60, 200])), true);
  const narrow = setBpmRange(s, [125, 135]);
  assert.equal(passes(none, narrow), false);
  assert.equal(passes(off, narrow), false);
  assert.equal(passes(at, narrow), true);
  assert.equal(isStarted(narrow), true);
  assert.equal(countMatches([none, at, off].map((t) => ({ track: t })), narrow), 1);
  assert.notEqual(poolKey(s), poolKey(narrow));
  assert.equal(poolKey(s), poolKey(setBpmRange(s, [60, 200])));
  assert.equal(bpmRangeLabel([125, 135]), "125–135 BPM");
  assert.equal(bpmRangeLabel([60, 112]), "up to 112 BPM");
  assert.equal(bpmRangeLabel([150, 200]), "150+ BPM");
  assert.ok(autoName(narrow, NOW).includes("125–135 BPM"));
});

test("idsInBpmRange picks the ids whose BPM fits, ends open", () => {
  const map = { a: 124.9, b: 125, c: 135, d: 135.1, e: 40, f: 230 };
  assert.deepEqual(idsInBpmRange(map, [125, 135]).sort(), ["b", "c"]);
  assert.deepEqual(idsInBpmRange(map, [60, 100]), ["e"]);
  assert.deepEqual(idsInBpmRange(map, [180, 200]), ["f"]);
});

test("BPM histogram: 4-BPM bins from 60 to 200, edges collect the rest", () => {
  const h = bpmHistogram([60, 63.9, 64, 128, 199.9, 200, 250, 30, 0, NaN]);
  assert.equal(h.length, 35);
  assert.equal(h[0], 3); // 60, 63.9 and 30
  assert.equal(h[1], 1); // 64
  assert.equal(h[17], 1); // 128 = (128-60)/4
  assert.equal(h[34], 3); // 199.9, 200, 250
  assert.equal(h.reduce((a, b) => a + b, 0), 8); // 0 and NaN are not BPM
  assert.equal(binInRange(17, null), true);
  assert.equal(binInRange(17, [125, 135]), true); // bin 128-131
  assert.equal(binInRange(10, [125, 135]), false);
  assert.equal(binInRange(0, [60, 100]), true);
  assert.equal(binInRange(34, [150, 200]), true);
});

test("joinBpm puts the map's BPM on the tracks and leaves the rest alone", () => {
  const items = [{ track: track({ id: "x", bpm: null }) }, { track: track({ id: "y", bpm: 100 }) }, { track: track({ id: "z", bpm: 90 }) }];
  const out = joinBpm(items, { x: 120, y: 105 });
  assert.equal(out[0].track.bpm, 120);
  assert.equal(out[1].track.bpm, 105); // the HUB's value (manual or measured) wins over the tag
  assert.equal(out[2], items[2]);
  assert.equal(items[0].track.bpm, null); // not mutated
  assert.equal(joinBpm(items, undefined), items);
});

test("flow curve: points, straight lines between them, target BPM from the dial's range", () => {
  assert.equal(curveAt([0, 1], 0.5), 0.5);
  assert.equal(curveAt([0.2, 0.5, 0.9], 0), 0.2);
  assert.equal(curveAt([0.2, 0.5, 0.9], 1), 0.9);
  assert.ok(Math.abs(curveAt([0.2, 0.5, 0.9], 0.25) - 0.35) < 1e-9);
  assert.equal(targetBpm({ bpm: [100, 140], curve: [0, 1] }, 0), 100);
  assert.equal(targetBpm({ bpm: [100, 140], curve: [0, 1] }, 1), 140);
  assert.equal(targetBpm({ bpm: null, curve: [0.5, 0.5] }, 0.3), 130); // whole dial 60..200
  assert.deepEqual(sanitizeCurve([1, 2]), FLOW_PRESETS.arc.curve);
  assert.deepEqual(sanitizeCurve([-1, 0.5, 2, 0.1, 0.2]), [0, 0.5, 1, 0.1, 0.2]);
  assert.deepEqual(sanitizeCurve("x"), FLOW_PRESETS.arc.curve);
});

const bpmPool = (count: number) => pool(count, (i) => ({ bpm: 70 + (i % 120), artist: `Band ${i}`, artist_id: `b${i}` }));

test("buildFlowMix: each slot gets the song nearest the curve, rising curve gives rising BPM", () => {
  const s = { ...defaultSettings(), size: 20, flow: true, bpm: [80, 180] as [number, number], curve: [0, 0.5, 1] };
  const { mix } = buildFlowMix(bpmPool(240), s, [], mulberry32(1));
  assert.equal(mix.length, 20);
  for (let i = 0; i < 20; i++) {
    const target = targetBpm(s, i / 19);
    assert.ok(Math.abs(mix[i].track.bpm! - target) <= 6, `slot ${i}: ${mix[i].track.bpm} vs ${target}`);
  }
  assert.ok(mix[19].track.bpm! > mix[0].track.bpm! + 60);
  assert.equal(new Set(mix.map((m) => m.track.id)).size, 20);
});

test("buildFlowMix: songs without BPM or out of the range never come up, at most 2 per artist", () => {
  const items: PoolItem[] = [
    ...pool(40, () => ({ bpm: null })),
    ...pool(40, (i) => ({ bpm: 200 - i })), // 161..200: outside the range
    ...Array.from({ length: 12 }, (_, i) => ({ track: track({ bpm: 128 + (i % 3), artist: "Same", artist_id: "same" }) })),
    ...pool(30, (i) => ({ bpm: 126 + (i % 8), artist: `Other ${i}`, artist_id: `o${i}` })),
  ];
  const s = { ...defaultSettings(), size: 20, flow: true, bpm: [125, 135] as [number, number], curve: [0.5, 0.5, 0.5, 0.5, 0.5] };
  const { mix, matches } = buildFlowMix(items, s, [], mulberry32(2));
  assert.equal(matches, 42);
  assert.equal(mix.length, 20);
  assert.ok(mix.every((m) => m.track.bpm! >= 125 && m.track.bpm! <= 135));
  assert.ok(mix.filter((m) => m.track.artist === "Same").length <= 2);
});

test("buildFlowMix: kept songs keep their slot; re-rolling again follows the curve", () => {
  const s = { ...defaultSettings(), size: 12, flow: true, bpm: [80, 180] as [number, number], curve: [0.1, 0.9] };
  const items = bpmPool(240);
  const first = buildFlowMix(items, s, [], mulberry32(3)).mix;
  const current = first.map((m, i) => (i === 4 || i === 9 ? { ...m, locked: true } : m));
  const again = buildFlowMix(items, s, current, mulberry32(99)).mix;
  assert.equal(again.length, 12);
  assert.equal(again[4].track.id, first[4].track.id);
  assert.equal(again[9].track.id, first[9].track.id);
  assert.equal(again[4].locked && again[9].locked, true);
  assert.equal(again.filter((m) => m.track.id === first[4].track.id).length, 1);
  for (let i = 0; i < 12; i++) {
    if (i === 4 || i === 9) continue;
    assert.ok(Math.abs(again[i].track.bpm! - targetBpm(s, i / 11)) <= 8, `slot ${i}`);
  }
});

test("buildFlowMix: a small pool gives a shorter mix, an artist cap that cannot be met is relaxed", () => {
  const s = { ...defaultSettings(), size: 10, flow: true, curve: [0.5, 0.5] };
  const few = buildFlowMix(pool(4, (i) => ({ bpm: 100 + i, artist: `A${i}` })), s, [], mulberry32(4)).mix;
  assert.equal(few.length, 4);
  const oneArtist = buildFlowMix(pool(10, (i) => ({ bpm: 100 + i, artist: "Solo" })), s, [], mulberry32(4)).mix;
  assert.equal(oneArtist.length, 10);
});

test("buildFlowMix: the score breaks ties between equally near songs", () => {
  const near = { track: track({ bpm: 120, artist: "Fav", artist_id: "fav" }), by: "Fav" };
  const other = { track: track({ bpm: 120, artist: "Other", artist_id: "other" }) };
  const s = { ...defaultSettings(), size: 1, flow: true, bpm: [100, 140] as [number, number], curve: [0.5, 0.5], seeds: [{ kind: "artist" as const, value: "Fav" }] };
  assert.equal(buildFlowMix([other, near], s, [], mulberry32(7)).mix[0].track.artist, "Fav");
});

test("swapCandidate with Flow prefers a similar BPM; without Flow it ignores BPM", () => {
  const items: PoolItem[] = [
    { track: track({ id: "far", bpm: 180 }) }, { track: track({ id: "near", bpm: 126 }) }, { track: track({ id: "no", bpm: null }) },
  ];
  const mix: MixItem[] = [{ track: track({ id: "cur", bpm: 125 }), why: [], locked: false }];
  const flow = { ...defaultSettings(), flow: true, discover: 50 };
  const picks = Array.from({ length: 20 }, (_, k) => swapCandidate(items, flow, mix, mulberry32(k), 125)!.track.id);
  assert.ok(picks.every((id) => id === "near"));
  const plain = new Set(Array.from({ length: 40 }, (_, k) => swapCandidate(items, { ...defaultSettings(), discover: 50 }, mix, mulberry32(k), 125)!.track.id));
  assert.ok(plain.size > 1);
});

test("mix BPM stats and the reason line", () => {
  const mix = [{ track: track({ bpm: 100 }) }, { track: track({ bpm: null }) }, { track: track({ bpm: 120 }) }];
  assert.deepEqual(mixBpmStats(mix), { avg: 110, series: [100, 120] });
  assert.deepEqual(mixBpmStats([{ track: track({ bpm: null }) }]), { avg: null, series: [] });
  assert.equal(reasonLine({ track: track({ genre: "Techno", year: 2021, bpm: 127.6 }), why: ["like X"], locked: false }), "like X · Techno · 128 BPM · 2021 · not played yet");
});

test("presets use BPM ranges only when BPM is available", () => {
  const genres = [{ name: "Hip-Hop", songCount: 50 }, { name: "Techno", songCount: 70 }, { name: "Ambient", songCount: 20 }];
  const plain = presetSettings("workout", genres, 2026);
  assert.equal(plain.bpm ?? null, null);
  assert.equal(!!plain.flow, false);
  const w = presetSettings("workout", genres, 2026, true);
  assert.deepEqual(w.bpm, [125, 160]);
  assert.equal(w.flow, true);
  assert.equal(w.curve!.length, 5);
  assert.deepEqual(w.seeds.map((x) => x.value), ["Techno", "Hip-Hop"]);
  assert.deepEqual(presetSettings("party", genres, 2026, true).bpm, [112, 130]);
  const f = presetSettings("focus", genres, 2026, true);
  assert.deepEqual(f.bpm, [60, 112]);
  assert.equal(!!f.flow, false);
  assert.equal(presetSettings("focus", genres, 2026).bpm ?? null, null);
  assert.equal(presetSettings("throwback", genres, 2026, true).bpm ?? null, null);
  assert.equal(presetSettings("fresh", genres, 2026, true).flow ?? false, false);
});

test("leave out: spoken word by genre name or length, skipped genres, also in random", () => {
  assert.equal(isSpoken(track({ genre: "Audiobook" })), true);
  assert.equal(isSpoken(track({ genre: "Spoken Word" })), true);
  assert.equal(isSpoken(track({ genre: "Hörspiel" })), true);
  assert.equal(isSpoken(track({ genre: "Raamat" })), true);
  assert.equal(isSpoken(track({ genre: "Techno", duration_secs: 1500 })), true);
  assert.equal(isSpoken(track({ genre: "Techno", duration_secs: 900 })), false);
  const s = { ...defaultSettings(), skipSpoken: true, skipGenres: ["Rock"] };
  assert.equal(isLeftOut(track({ genre: "Rock" }), s), true);
  assert.equal(isLeftOut(track({ genre: "Pop; rock" }), s), true);
  assert.equal(isLeftOut(track({ genre: "Hard Rock" }), s), false);
  assert.equal(isLeftOut(track({ genre: "Audiobook" }), { ...s, skipSpoken: false }), false);
  const items = pool(300, (i) => ({ genre: i % 3 === 0 ? "Rock" : i % 3 === 1 ? "Audiobook" : "Pop" }));
  const { mix } = buildMix(items, { ...s, pure: true, size: 50 }, [], mulberry32(10));
  assert.ok(mix.length === 50 && mix.every((m) => m.track.genre === "Pop"));
  assert.notEqual(poolKey(defaultSettings()), poolKey(s));
  assert.deepEqual(toggleSkipGenre(["Rock"], "rock"), []);
  assert.deepEqual(toggleSkipGenre([], "Jazz"), ["Jazz"]);
});
