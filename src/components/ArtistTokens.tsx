import React, { useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../store";

// Same separator regex as the old app's album_grid.qml / TrackListView.qml —
// case-insensitive so "Vs."/"VS."/"Feat."/"FEAT." split the same as their
// lowercase forms (Navidrome doesn't normalize tag casing).
export const ARTIST_SEP_RE = /( \/\/\/ | • | \/ | feat\. | vs\. )/i;

// Exact (not substring) match against one of a track/album's possibly
// multiple credited artists — a track's `artist` field can be a combined
// string like "A feat. B", so a plain `.includes()` on the raw string would
// both false-positive (an unrelated artist whose name happens to be a
// substring of another) and miss real matches buried mid-string. Shared by
// ArtistDetail's "Appears On" and Spotlight's artist-row fallback, both of
// which need "does this artist actually have a credited track here" rather
// than "does this text contain that word".
export function matchesArtistCredit(creditField: string, artistName: string): boolean {
  const nameLower = artistName.trim().toLowerCase();
  const names = creditField.split(ARTIST_SEP_RE)
    .filter((part) => part.trim() && !ARTIST_SEP_RE.test(part))
    .map((s) => s.trim().toLowerCase());
  return names.includes(nameLower);
}

export const ArtistTokens = React.memo(function ArtistTokens({ name, artistId, fontSize = "var(--fs-secondary)", alwaysAccent = false, onNavigate, clip = true }: { name: string; artistId: string | null; fontSize?: string; alwaysAccent?: boolean; onNavigate?: () => void; clip?: boolean }) {
  const navigateTo = useStore((s) => s.navigateTo);
  const tokens = name.split(ARTIST_SEP_RE).filter(Boolean);
  // Single artist → use known artistId; multi-artist → look up each token via search
  const isMulti = ARTIST_SEP_RE.test(name);

  return (
    // Old app renders this as a Qt Row, single line (never wraps). Most call
    // sites (queue_list.qml:239-263, album_grid.qml) put it in a clip:true
    // Item — always a single line, hard-clipped at the edge (no ellipsis,
    // unlike the title above it). The footer is the one exception:
    // footer_bar.qml's artist Row has no width/clip at all, deliberately
    // spilling past the narrow left column into centerBlock's empty space
    // (same idea as its title's spill, just unbounded) — pass clip={false}
    // there instead of hard-cutting it at the column edge.
    <div
      className="flex"
      style={{
        fontSize, lineHeight: 1.4, flexWrap: "nowrap", whiteSpace: "nowrap",
        // clip: hard-cut at the container's own (stretched-to-parent) width.
        // !clip (footer): the parent flex-column's default align-items:stretch
        // would otherwise force this row's box to the narrow left-column width,
        // and overflow:visible only lets the *paint* spill past that box — each
        // token span's actual hit-testable box still gets flex-shrunk to fit
        // inside it, so later tokens (e.g. the name after "feat.") end up with
        // a near-zero click box even though their text visually overflows past
        // it. width:max-content + alignSelf:flex-start opts the row out of
        // stretch entirely so its own (and its tokens') boxes size to content.
        overflow: clip ? "hidden" : "visible",
        width: clip ? undefined : "max-content",
        alignSelf: clip ? undefined : "flex-start",
      }}
    >
      {tokens.map((token, i) => {
        const isSep = ARTIST_SEP_RE.test(token);
        if (isSep) {
          return <span key={i} style={{ color: "var(--text-secondary)", opacity: 0.5, padding: "0 2px" }}>{token.trim()}</span>;
        }
        const handleClick = !isMulti && artistId
          ? (e: React.MouseEvent) => { e.stopPropagation(); navigateTo({ tab: "artists", artistId: artistId! }); onNavigate?.(); }
          : async (e: React.MouseEvent) => {
              e.stopPropagation();
              const q = token.trim();
              const result = await api.search(q, 5, 0, 0);
              const match = result.artists.find((a) => a.name.toLowerCase() === q.toLowerCase());
              navigateTo(match
                ? { tab: "artists", artistId: match.id }
                : { tab: "artists", artistQuery: q });
              onNavigate?.();
            };
        return <ArtistToken key={i} text={token} onClick={handleClick} alwaysAccent={alwaysAccent} />;
      })}
    </div>
  );
});

function ArtistToken({ text, onClick, alwaysAccent = false }: { text: string; onClick: ((e: React.MouseEvent) => void) | null; alwaysAccent?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <span
      onClick={onClick ?? undefined}
      onMouseEnter={() => onClick && setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        color: alwaysAccent || hov ? "var(--accent)" : "var(--text-secondary)",
        cursor: onClick ? "pointer" : "default",
        textDecorationLine: hov ? "underline" : "none",
        textUnderlineOffset: "2px",
        textDecorationThickness: "1px",
        textDecorationColor: "var(--accent)",
      }}
    >
      {text}
    </span>
  );
}
