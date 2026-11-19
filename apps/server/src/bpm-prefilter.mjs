import { genreParts, hasName } from "./bpm-octave.mjs";

// Songs the library analysis does not even download, because there is no tempo to find in them: intros
// and ambient pieces print a number all the same, and a wrong number pollutes BPM sorting, the Mix
// Builder's BPM dial and Flow. Decided before the download, from what Navidrome lists.

export const MIN_SECONDS = 60;

/** Genres that mean "no beat to speak of" (BPM_SKIP_GENRES in the environment, comma separated, replaces this list). */
export const DEFAULT_SKIP_GENRES = [
  "ambient", "drone", "soundtrack", "score", "intro", "spoken word", "audiobook", "podcast", "field recording", "sound effects",
];

/**
 * Genres with a clear beat. A song tagged with one of these next to a skip genre ("Ambient; Techno",
 * "Ambient House", "Soundtrack / Hip-Hop") is analysed after all: skipping is the conservative-in-the-other-direction
 * choice, wrongly leaving out a dance track costs more than measuring an ambient one (whose low confidence
 * the minimum-confidence setting can hide later).
 */
export const RHYTHMIC_GENRES = [
  "house", "techno", "trance", "drum and bass", "dnb", "jungle", "dubstep", "breakbeat", "breaks", "hardstyle", "hardcore", "garage", "grime",
  "edm", "dance", "electro", "disco", "funk", "hip hop", "hiphop", "rap", "trap", "reggae", "reggaeton", "dancehall", "dub", "ska",
  "rock", "metal", "punk", "pop", "latin", "salsa", "afrobeat", "synthwave", "synthpop", "idm", "industrial", "ebm", "jazz",
];

export function skipGenresFromEnv(value = process.env.BPM_SKIP_GENRES) {
  const list = String(value ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_SKIP_GENRES;
}

const normalise = (names) => names.map((n) => genreParts(n)[0].trim());

/**
 * @param {{duration?: number, genre?: string}} song  duration in seconds as Navidrome lists it (0 or missing: unknown, not a reason)
 * @returns {string|null} why the song is left out, or null to analyse it
 */
export function skipReason(song, skipGenres = DEFAULT_SKIP_GENRES) {
  if (song.duration > 0 && song.duration < MIN_SECONDS) return `shorter than ${MIN_SECONDS} s`;
  if (!song.genre) return null;
  const parts = genreParts(song.genre);
  const names = normalise(skipGenres);
  const hit = names.find((n) => hasName(parts, [n]));
  if (!hit) return null;
  if (hasName(parts, normalise(RHYTHMIC_GENRES))) return null;
  return `genre: ${hit}`;
}
