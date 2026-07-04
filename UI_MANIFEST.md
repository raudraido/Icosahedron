# UI Manifest — Icosahedron (Electron + React)

Authoritative reference for UI patterns learned while porting the app from
Tauri/Rust to Electron/React. Check here before re-solving a problem that's
already been hit once.

## Theme tokens — never hardcode colors, fonts, or sizes

**Every color and font size in a component must reference a CSS custom
property from `src/lib/theme.ts`/`src/index.css`, never a literal hex code
or bare pixel number.** The whole point of the theme system is that
switching `DARK`/`CREAM` (or adding a new theme) reflows every screen
automatically — a hardcoded `"#e91e63"` or `fontSize: 28` silently opts that
one element out and will look wrong (or just not update) the next time
someone tunes the theme. This has already slipped in twice this session
(album title using a bare `28` instead of `var(--fs-hero)`; the sort-arrow
glyph using a bare `10` instead of `var(--fs-small)`) — both fixed, but
worth stating as a hard rule instead of relying on catching it in review.

### Color tokens (set by `applyTheme()`, read as `var(--x)`)

| Token | Purpose |
|---|---|
| `--accent` | Master/brand color. Hover states on clickable text, active icons, sort arrows, play buttons, focus rings. |
| `--panel-bg` | Outermost app background (behind everything). |
| `--main-bg` | Main content area background (dropdown menus, popovers use this too). |
| `--card-bg` | Card/panel surfaces — album art cards, header cards, table rows' base. |
| `--text-primary` | Primary text color (titles, active/current-track text). |
| `--text-secondary` | Secondary/dimmed text (metadata, labels, inactive icons). |
| `--border` | Hairline borders/dividers. |
| `--hover-bg` | Hover background for rows/buttons/menu items. |
| `--skeleton` | Loading-placeholder fill. |
| `--error` | Error states (not yet used much — reserve for real errors, not warnings). |

### Font-size tokens (six-step scale, `var(--fs-x)`)

| Token | DARK / CREAM | Use |
|---|---|---|
| `--fs-small` | 11 / 11px | Fine print: sort-arrow glyphs, tiny labels, column header labels. |
| `--fs-secondary` | 13 / 12px | Body/secondary text: artist names, metadata, table cell text. |
| `--fs-primary` | 15 / 14px | Default body text size (`<html>` sets this as the base). |
| `--fs-heading` | 18 / 17px | Section headings. |
| `--fs-title` | 24 / 22px | Screen/page titles. |
| `--fs-hero` | 28 / 26px | Largest text — album/artist detail-view titles. |

`--font-family` is the single font stack (`'Inter Variable', system-ui, ...`)
— never set `fontFamily` locally.

### Sanctioned exceptions: colors that must NOT vary with theme

A few colors are intentionally fixed regardless of theme, matching the old
app's own hardcoded choices (e.g. `album_detail.qml`'s
`heart_filled_E91E63`, `album_grid.qml`'s Canvas play-triangle `"#111"`).
These are real, deliberate exceptions to the rule above — but they still
must be **named constants**, never repeated bare literals:

- `FAVORITE_PINK` (`#E91E63`) and `PLAY_ICON_DARK` (`#111`), exported from
  `src/lib/theme.ts`. If you need a new theme-independent color, add it
  there the same way — don't inline a fresh hex literal at the call site.

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
(`ARTIST_SEP_RE` in `src/components/ArtistTokens.tsx`), render
non-separator tokens clickable:

- **Grid card context**: gray by default (`--text-secondary`), accent color
  only on hover, underline only on hover.
- **Detail view context**: accent color unconditionally (not hover-gated) —
  matches the old app's `album_detail.qml` (`color: isSep ? textSecondary :
  accentColor`, no hover condition). `ArtistTokens` takes an `alwaysAccent`
  prop for this. The underline itself stays hover-gated even here — the old
  QML's own `Rectangle` underline is `visible: !isSep && parent.hov`
  regardless of the always-accent color, don't make it unconditional too.
- **Underline implementation: use real CSS `text-decoration`, not a
  positioned child element.** The old QML avoids `font.underline` because
  Qt's version draws flush against the glyph baseline with no way to add a
  gap — that limitation doesn't exist in CSS. `text-underline-offset` and
  `text-decoration-thickness` give the same "gap, not cramped" result the
  old app wanted, directly, with no extra DOM node:
  ```css
  text-decoration-line: underline; /* only when hovered/active */
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  text-decoration-color: var(--accent);
  ```
  A manually-positioned child line (`position: absolute` inside a
  `position: relative` token) was tried first and repeatedly broke: a plain
  inline element doesn't give its absolutely-positioned child a reliable
  containing block, so the underline's effective box varied with whatever
  else was on the same line — different results in the album grid vs. the
  tracklist from identical code, and on a multi-artist token (e.g.
  "Disclosure Feat. AlunaGeorge") the underline could bleed into the
  neighboring separator/token instead of staying under just the hovered
  word. `text-decoration` is scoped to its own text run by construction —
  it can't bleed into siblings — and needs no layout workaround at all.

## Track table font sizes (`TrackTable.tsx`, ported from `TrackListView.qml`)

Per-column font treatment, straight from the old QML (`fontSizePrimary` /
`fontSizeSecondary` there map to our `--fs-primary` / `--fs-secondary`):

- **Track title** (both in the combined "TRACK" column and the standalone
  "TITLE" column): `--fs-primary`, **bold**. Every other cell in the row is
  `--fs-secondary`, not bold — title is the one column that's visually
  heavier, don't flatten it to match the rest.
- **Artist line under the title** (inside the combined "TRACK" column):
  `--fs-secondary` — same size as the standalone "ARTIST" column, not a
  smaller "caption" size, even though it visually reads as secondary info
  under the title.
- **Column header labels** ("TRACK", "TITLE", "ARTIST", "#", ...):
  `--fs-small`, bold, `letterSpacing: 0.8` (not `0.5` — that was a rounding
  guess before this was checked against the source).

## The "#" column shows `track_number`, not row position

The leading `#` column is **not** a flat row index — it's each track's own
`track_number` metadata field (`trkNum: model.trackNumber` in the old
`TrackListView.qml`), in both the main Tracks screen and the album detail
tracklist. This matters for multi-disc albums: `track_number` is per-disc in
Subsonic's tagging, so it naturally reads 1, 2, 3... then resets to 1 again
at the start of disc 2 — you get correct per-disc numbering for free just by
showing the track's own field instead of computing a position.

## Disc separators (album detail tracklist only)

`TrackTable`'s `showDiscHeaders` prop (only passed by `AlbumDetail`, never
the main Tracks screen) inserts a 36px "Disc N" row between groups of
differing `disc_number`, matching `TrackListView.qml`'s `isDiscHeader` rows:

- Only shown for albums with more than one disc (`disc_number` values
  aren't all equal) — a single-disc album never shows a redundant "Disc 1".
- Only shown in natural order: any active sort or search term suppresses
  them. Straight from the old app's own comment on this — "Disc headers
  don't make sense once rows are flattened by a search filter or a column
  sort." Implemented as `showDiscHeaders && !sortState && !query.trim()`.
- Interleaved into the virtualized row list as a distinct `DisplayRow`
  variant (`{ kind: "discHeader" }` vs `{ kind: "track", trackIndex }`) —
  `useVirtualizer`'s `estimateSize` returns 36 or 58 per row depending on
  kind. Row click/selection logic keys off `trackIndex` (the track's
  position in the plain sorted/filtered array), not the row's position in
  the header-interleaved display list — don't conflate the two indices.
