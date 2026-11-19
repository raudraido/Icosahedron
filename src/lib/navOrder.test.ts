// Run: npm run test:src
import test from "node:test";
import assert from "node:assert/strict";
import { mergeNavOrder } from "./navOrder";

const WEB = ["home", "albums", "artists", "tracks", "playlists", "starred", "nowPlaying", "mixBuilder", "visualizer"];

test("the web app keeps the desktop's Downloads tab in the stored order", () => {
  const desktop = [...WEB, "downloads"];
  assert.deepEqual(mergeNavOrder(desktop, WEB), desktop); // saving what it loaded changes nothing: no ping-pong
});

test("a foreign id keeps its place when the user reorders the tabs it knows", () => {
  const stored = ["home", "downloads", "albums", "artists"];
  assert.deepEqual(mergeNavOrder(stored, ["artists", "home", "albums"]), ["artists", "downloads", "home", "albums"]);
});

test("tabs missing from the stored order are added at the end, nothing is dropped or doubled", () => {
  assert.deepEqual(mergeNavOrder(["albums", "home"], ["home", "albums", "mixBuilder"]), ["home", "albums", "mixBuilder"]);
  assert.deepEqual(mergeNavOrder(["home", "home", "albums"], ["home", "albums"]), ["home", "albums"]);
});

test("nothing stored, or something that is not a list", () => {
  assert.deepEqual(mergeNavOrder(null, WEB), WEB);
  assert.deepEqual(mergeNavOrder("oops", ["home"]), ["home"]);
  assert.deepEqual(mergeNavOrder([1, "home", {}], ["home"]), ["home"]);
});

test("the desktop and the web app settle on the same order after each saved once", () => {
  const web = (s: unknown) => mergeNavOrder(s, WEB);
  const desktop = (s: unknown) => mergeNavOrder(s, [...WEB, "downloads"]);
  const a = desktop(web(desktop(web(null))));
  assert.deepEqual(web(a), a);
  assert.deepEqual(desktop(a), a);
});
