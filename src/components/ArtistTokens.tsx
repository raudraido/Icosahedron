import React, { useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../store";

// Same separator regex as the old app's album_grid.qml / TrackListView.qml
export const ARTIST_SEP_RE = /( \/\/\/ | • | \/ | feat\. | Feat\. | vs\. )/;

export const ArtistTokens = React.memo(function ArtistTokens({ name, artistId, fontSize = "var(--fs-secondary)", alwaysAccent = false }: { name: string; artistId: string | null; fontSize?: string; alwaysAccent?: boolean }) {
  const navigateTo = useStore((s) => s.navigateTo);
  const tokens = name.split(ARTIST_SEP_RE).filter(Boolean);
  // Single artist → use known artistId; multi-artist → look up each token via search
  const isMulti = ARTIST_SEP_RE.test(name);

  return (
    <div className="flex flex-wrap" style={{ fontSize, lineHeight: 1.4 }}>
      {tokens.map((token, i) => {
        const isSep = ARTIST_SEP_RE.test(token);
        if (isSep) {
          return <span key={i} style={{ color: "var(--text-secondary)", opacity: 0.5, padding: "0 2px" }}>{token.trim()}</span>;
        }
        const handleClick = !isMulti && artistId
          ? (e: React.MouseEvent) => { e.stopPropagation(); navigateTo({ tab: "artists", artistId: artistId! }); }
          : async (e: React.MouseEvent) => {
              e.stopPropagation();
              const q = token.trim();
              const result = await api.search(q, 5, 0, 0);
              const match = result.artists.find((a) => a.name.toLowerCase() === q.toLowerCase());
              navigateTo(match
                ? { tab: "artists", artistId: match.id }
                : { tab: "artists", artistQuery: q });
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
