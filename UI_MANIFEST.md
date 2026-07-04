# UI Manifest — Icosahedron (Electron + React)

Authoritative reference for UI patterns learned while porting the app from
Tauri/Rust to Electron/React. Check here before re-solving a problem that's
already been hit once.

## Scrollbar gutter vs. custom scrollbar width

**Plain `scrollbar-gutter: stable` reserves space matching Chromium's own
native scrollbar width, NOT our custom-width `::-webkit-scrollbar` below —
the two are computed independently.** If they don't match (ours is 6px; the
native reservation is typically ~15-17px), you get extra dead space on the
scrollbar side beyond any symmetric padding you apply to children, e.g. a
centered/padded header card looking closer to the left edge than the right.

Simply dropping `scrollbar-gutter` isn't a full fix either — it only
shrinks the mismatch to whatever the *real* scrollbar consumes when content
actually overflows (still asymmetric, just by less). `both-edges` (reserves
matching gutter space on both sides) gets you *consistent* symmetry, but it
still adds its own reserved width on top of whatever padding you set —
fine if you don't care about the exact pixel value, wrong if you do.

**If padding must match an exact value on both sides, don't reserve any
gutter at all — make the scrollbar itself zero-width instead.** There's no
`scrollbar-gutter` value that reserves *zero* extra space, so gutter
reservation and exact symmetric padding are mutually exclusive. Losing the
visible scrollbar track is cheap here since ours was already invisible
except while actively scrolling; wheel/trackpad scrolling is unaffected.

- `src/index.css` defines two scroll-container classes:
  - `.scroll-overlay` — `overflow-y: auto; scrollbar-gutter: stable;` +
    `will-change: transform`. Use where a reflowing layout (column count
    depends on measured width, e.g. the album/artist grids) needs to
    prevent layout shift when a scrollbar appears/disappears, and visual
    symmetry doesn't matter (list fills full width either way).
  - `.scroll-smooth` — `overflow-y: auto; will-change: transform;` +
    `::-webkit-scrollbar { width: 0 }`. Use for anything with symmetric
    padding you care about, e.g. a centered/padded detail-view card.
- The album/artist grids (`react-window`'s `FixedSizeList`) never hit this
  at all — they manage their own native scroll box internally and never
  apply either class to it, which is why they've always looked correct.
- Don't nest two independently-scrolling containers when one continuous
  scroll region is intended (e.g. a detail view's header card + track list
  scrolling together) — only the outermost one needs `overflow-y: auto`;
  giving an inner section its own `overflow-y-auto` on top creates a
  double-scrollbar and doubles up on the gutter-mismatch problem above.

## Clickable inline text tokens (artist names, etc.)

Ported from the old Qt/QML app's convention (see the Sonar repo's
`UI_MANIFEST.md` §5) — split on the same separator regex
(`SEP_RE` in `Albums.tsx`), render non-separator tokens clickable:

- **Grid card context**: gray by default (`--text-secondary`), accent color
  only on hover, underline via a positioned child element (never
  `text-decoration`/`font.underline` — reads as cramped against the glyphs).
- **Detail view context**: accent color unconditionally (not hover-gated) —
  matches the old app's `album_detail.qml` (`color: isSep ? textSecondary :
  accentColor`, no hover condition). `ArtistTokens` takes an `alwaysAccent`
  prop for this — don't reuse the grid's hover-gated coloring in a detail
  header, they're deliberately different treatments.
