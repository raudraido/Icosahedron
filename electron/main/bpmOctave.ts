// Drum & bass tempo correction. The beat tracker (QM-DSP TempoTrackV2) has a prior that favours
// about 120 BPM, so a 174 BPM drum & bass track comes out as half (87) or two thirds (116) of its
// tempo. When the track's genre says drum & bass, the tempo is moved back into the 160-190 range.
// Other genres are left alone. Checked on real tracks, see CHANGELOG 0.16.5.

const DNB_NAMES = [
  "drum and bass", "dnb", "d and b", "liquid funk", "liquid dnb", "neurofunk", "jungle",
  "jump up", "techstep", "darkstep", "drumfunk", "drum funk",
];

/** "Drum & Bass", "Drum'n'Bass", "DnB", "Liquid Funk; Drum and Bass" and so on. */
export function isDrumAndBass(genre: string | null | undefined): boolean {
  if (!genre) return false;
  const g = ` ${genre.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\bn\b/g, "and").replace(/\s+/g, " ").trim()} `;
  return DNB_NAMES.some((n) => g.includes(` ${n} `) || g.includes(` ${n}s `));
}

/** The tempo to use: doubled when the tracker found half (75-100), times 1.5 when it found two thirds (105-127). */
export function resolveDnbBpm(bpm: number, genre: string | null | undefined): number {
  if (!isDrumAndBass(genre) || !(bpm > 0)) return bpm;
  const factor = bpm >= 75 && bpm <= 100 ? 2 : bpm >= 105 && bpm <= 127 ? 1.5 : 1;
  const fixed = bpm * factor;
  return factor !== 1 && fixed >= 160 && fixed <= 190 ? Math.round(fixed * 10) / 10 : bpm;
}
