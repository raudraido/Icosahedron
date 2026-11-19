// Tests for the Mix Builder's pure logic. Run: npm run test:src
// (bundles this file with esbuild, which Vite already brings, and runs it with node's test runner).
import test from "node:test";
import assert from "node:assert/strict";
import {
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

test("BPM is off in version 1", () => {
  assert.equal(bpmCoverage(), 0);
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
