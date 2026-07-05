import { useState } from "react";
import { useStore } from "../store";
import { api } from "../lib/api";

// Bare clickable album name — hover-underline matches ArtistTokens' ArtistToken
// (same CSS technique), navigates via api.getAlbum(albumId). No label/row
// layout here; callers (TrackInfoDialog, PlayerBar) wrap it themselves since
// they want different surrounding styles (bold info-dialog row vs. plain
// footer metadata line).
export function AlbumLink({ name, albumId, fontSize = "var(--fs-secondary)", alwaysAccent = false, onNavigate }: {
  name: string; albumId: string | null; fontSize?: string; alwaysAccent?: boolean; onNavigate?: () => void;
}) {
  const [hov, setHov] = useState(false);
  const navigateTo = useStore((s) => s.navigateTo);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!albumId) return;
    const album = await api.getAlbum(albumId);
    navigateTo({ tab: "albums", album });
    onNavigate?.();
  }

  return (
    <span
      onClick={handleClick}
      onMouseEnter={() => albumId && setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        color: alwaysAccent || hov ? "var(--accent)" : "var(--text-secondary)", fontSize,
        cursor: albumId ? "pointer" : "default",
        textDecorationLine: hov ? "underline" : "none",
        textUnderlineOffset: "2px", textDecorationThickness: "1px", textDecorationColor: "var(--accent)",
      }}
    >
      {name}
    </span>
  );
}
