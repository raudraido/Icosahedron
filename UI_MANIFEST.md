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
  - `.scroll-clean` — `overflow-y: auto; will-change: transform;` +
    `::-webkit-scrollbar { width: 0 }`. Use for anything with symmetric
    padding you care about, e.g. a centered/padded detail-view card. **Not**
    named `.scroll-smooth` — that collides with Tailwind's own built-in
    `scroll-smooth` utility (`scroll-behavior: smooth`), which the build
    auto-generates the moment that literal string appears in any
    className, silently merging onto our same-named rule. The symptom was
    a janky animated scroll where a programmatic `scrollTop = 0` (e.g.
    resetting scroll position on pagination page change) should have been
    instant. **Never name a custom utility class after an existing
    Tailwind utility** — prefix custom classes distinctively enough that
    they can't collide with one.
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

## The "#" column: `track_number` vs. page position (`numColSource`)

The old `TrackListView.qml` always shows `trkNum: model.trackNumber` (the
track's own metadata field, not a row index) — this reads correctly as
per-disc numbering (1, 2, 3... resetting at each new disc) in the **album
detail tracklist**, where the whole album is one continuous natural-order
list. But the **main Tracks screen** is paginated (200/page) across the
*entire library*: showing each track's own `track_number` there would print
essentially random small numbers (whatever position it happened to occupy
within its own album), not a meaningful sequence — confirmed wrong in
testing, screen showed "13, 8, 16, 14, 2..." instead of "1, 2, 3, 4, 5...".
`TrackTable`'s `numColSource` prop picks between the two:
- `"trackNumber"` (default) — the track's own field. Used by `AlbumDetail`.
- `"position"` — the track's index within the given `tracks` array + 1.
  Used by `Tracks.tsx`. Since each page is fetched as its own fresh array
  (`serverDriven` mode), this naturally reads 1-200 per page, not a running
  count across the whole library — no extra math needed, just don't use the
  track's own field for this context.

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

## Tracks screen: server-side pagination via Navidrome's native API

The main Tracks screen has to paginate — a 35k+-track library can't be
fetched in one batch. The standard Subsonic `search3` endpoint has no
arbitrary-sort-field pagination for a flat track list, so real pagination
needs Navidrome's native `/api/song` (same pattern already used for
`getCompilations()`'s `/api/album`): `_start`/`_end`/`_sort`/`_order` query
params, `x-nd-authorization: Bearer <jwt>` header, exact total from the
`X-Total-Count` response header. `SubsonicClient.getTracksNativePage()` in
`electron/main/subsonic.ts`. Column id → Navidrome `_sort` field mapping
lives in `Tracks.tsx`'s `SORT_FIELD` map (`trackno` → `trackNumber`,
`date` → `createdAt`, `fav` → `starred`, etc.) — matches the old app's
`get_sort_string`.

Sort/search state had to move from `TrackTable`'s own internal state up to
`Tracks.tsx`: the parent needs to know the sort/search value *before* the
first fetch (to build the initial query), which an internally-owned state
inside the child can't provide in time. `TrackTable` supports both modes:
- **Uncontrolled** (default, used by `AlbumDetail`): owns its own sort/query
  state, sorts/filters the given `tracks` array client-side.
- **Controlled/`serverDriven`** (used by `Tracks.tsx`): pass `sortState` +
  `onSortChange` + `query` + `onQueryChange` + `pagination`; `TrackTable`
  trusts `tracks` is already the exact current page, pre-sorted/filtered by
  the caller, and does zero client-side sort/filter work on it.
- Sort-state persistence (`localStorage["tracks_sort_state"]`) is exported
  from `TrackTable.tsx` (`loadJSON`/`saveJSON`/`LS_SORT`/`DEFAULT_SORT`) so
  `Tracks.tsx` can load/save the same key itself instead of duplicating the
  format — same shared-namespace principle as the column layout state.

## Artists tab: same grid architecture as Albums, native-sorted

`Artists.tsx` mirrors `Albums.tsx` exactly: virtualized `react-window`
`FixedSizeList` grid (`CARD_MIN`/`GAP`/`META_HEIGHT` constants), collapsible
`SearchBox`, count in the toolbar, sort dropdown with 2-state
ascending/descending toggle per sort key. Sort options/icons/default
directions are ported from `artists_browser.py`'s `_sort_icon_path` /
`toggle_sort_state`:
- **Random** (default ascending, reshuffles client-side every time it's
  reselected — see `randomNonce`), **Most Played** (default descending),
  **Alphabetical** (default ascending), **Albums Count** (default
  descending, always uses the plain `album.png` icon — no directional
  variant, matching `_sort_icon_path`'s special case).
- Data comes from `SubsonicClient.getAllArtistsSorted()` → Navidrome's
  native `/api/artist` (same native-API pattern as `getTracksNativePage`/
  `getCompilations`), which is the only way to get `playCount`/`songCount`
  per artist — the standard `search3`-based `getAllArtists()` doesn't
  include them.
- Card layout (square `rounded-lg` cover, hover play button, hover-dim
  overlay) matches `artist_grid.qml`'s actual delegate — the cards are
  **not** circular despite how they look in product screenshots.

## Skeleton loading placeholders (grid + track rows)

Ported from the old app's `SkeletonCard.qml` / `SkeletonTrackRow.qml` +
`ShimmerSweep.qml`: a translucent light band sweeps left→right across each
placeholder, pauses, repeats (`@keyframes shimmer-sweep` in `index.css`,
1550ms = 1100ms sweep + 450ms pause, same timing as the QML version).
`src/components/Skeleton.tsx` exports `SkeletonCard` (grid cards — cover +
3 pills, used by `AlbumGrid`/`ArtistGrid`) and `SkeletonTrackRow` (used by
`TrackTable`). Themed via the existing `--skeleton` token (`.shimmer-sweep`
class), so it already matches DARK/CREAM automatically.

Both grids compute `showSkeleton = loading && items.length === 0` and, when
true, tile the *exact same* `cols`/`cardWidth`/`rowHeight` the real
`FixedSizeList` would use (reusing the grid's own `ResizeObserver`-driven
layout math) with `SkeletonCard`s instead of real cards — so the skeleton
is a true preview of the coming grid layout, not a generic spinner. This
only fires on a genuine first load; `placeholderData: (prev) => prev` on
the `useQuery` means re-sorting keeps showing the previous (real) list
while the new sort loads in the background, so skeletons never flash
during a resort — only on a tab's true first visit.

Toolbar count text reads `"Loading albums…"` / `"Loading artists…"` while
`loading` is true, replacing what would otherwise be a stale/blank count —
matches the old app's QML `statusText: "Loading artists..."` behavior.

## Tab switching: `display:none`, not `visibility:hidden`, for inactive tabs

`App.tsx` keeps every visited tab mounted (`mounted` Set) and toggles which
one is shown via CSS on absolutely-positioned overlapping wrapper divs.
This **must** use `display: none` for the inactive tabs, not
`visibility: hidden` — a `visibility: hidden` element still participates in
layout/paint every frame even though invisible, so a heavy virtualized grid
(hundreds of `<img>` covers) sitting underneath can visibly lag behind a
tab switch: the newly-active tab's text/toolbar updates instantly, but its
art appears to catch up a frame or two late, or the previous tab's last
painted frame seems to "stick" briefly. `display: none` removes the hidden
tab from the render tree entirely, avoiding this. React state is unaffected
either way since the component itself stays mounted — only its DOM
subtree's participation in layout/paint changes.

## CoverArt: never let a failed cover show the browser's broken-image icon

Rapid scrolling through a grid (e.g. Artists) mounts many `<img>` covers
whose `cover://` request hasn't been cached on disk yet, all at once — a
burst of concurrent fetches to the Navidrome server, some of which can time
out or error under that load. Worse, without cancellation, every row
scrolled *past* during a fast scroll leaves its fetch running to completion
anyway (Chromium aborts the `cover://` request when the `<img>` unmounts,
but that alone doesn't stop our main-process handler's outbound fetch to
the server) — those abandoned requests pile up and can starve the fetches
for covers actually still on screen, so mid-scroll art can fail to appear
at all even after the user stops scrolling. Ported the fix from Feishin's
`useNativeImage`/`BaseImage` (`src/shared/components/image/` in the Feishin
repo), adapted to our simpler custom-protocol setup (we don't need
Feishin's manual fetch+blob — `<img src="cover://…">` already gets
cancelled by Chromium on unmount, and our protocol handler already
disk-caches):

- `CoverArt.tsx` tracks an `errored` boolean; `<img onError>` sets it, which
  swaps in the same "♪" skeleton-colored placeholder box normally shown for
  a missing `coverId` — the raw `<img>` is never left in the DOM pointing
  at a failed `src`. `useEffect(() => setErrored(false), [src])` clears it
  when a virtualized row gets recycled for a different item, so a stale
  error doesn't stick to the wrong card.
- `electron/main/coverProtocol.ts` de-dupes concurrent in-flight fetches
  for the same `coverId+size` (ref-counted `Map<string, Entry>`, `Entry`
  holding the shared promise + an `AbortController` + a requester count) —
  scrolling back over a not-yet-cached row before its first fetch resolves
  reuses the pending request instead of firing a redundant one (same
  intent as Feishin's `loadedImageCacheKeys` cache-key dedup, just in the
  main process since our caching layer already lives there too), **and**
  once every requester for a cover has aborted (all its `<img>`s scrolled
  away and unmounted), the ref count hits zero and the outbound fetch is
  actually cancelled via `SubsonicClient.fetchCoverArt(coverId, size,
  signal)`'s `AbortSignal` — freeing that connection/bandwidth for covers
  genuinely still in the viewport instead of letting stale requests run to
  completion first.
- No automatic retry on failure, matching Feishin — a failed cover just
  shows the placeholder permanently for that request; the next distinct
  render (new `coverId`) gets a fresh attempt.

## Track right-click context menu

Ported from the old app's `ShadowContextMenu` (`player/widgets.py`) — that
widget isn't QML at all, it's a hand-painted `QFrame` popup that every
browser view builds its own item list for via its own
`_show_track_context_menu_at`. We instead built **one** generic primitive
(`src/components/ContextMenu.tsx`, `<MenuItem>`/`<MenuEntry>` — supports
hover-opened submenus and `"separator"` entries) and wired the actual track
menu into `TrackTable.tsx` (`buildTrackMenu`) once, since `TrackTable` is
already the shared component behind both `AlbumDetail` and the main
`Tracks` screen — building it there covers both at once instead of
duplicating per-view like the old app did.

Item order/labels/icons match the album-detail variant exactly (the
minimal 8-item subset — no multi-select "(N)" labels or "Open Album"/filter
extras from the richer Tracks-tab variant in the old app, not built yet):
**Play Now → Play Next → Add to Queue → Go to Artist → Start Radio →
[separator] → Add to Playlist ▸ → [separator] → Get Info → Add/Remove
Favorites**.

Sizing/coloring ported from `ShadowContextMenu._row()`'s exact values, not
guessed: row padding is `5px 20px 5px 12px` (asymmetric — more room on the
right than the left, matching the Qt source's `setContentsMargins(12, 5,
20, 5)`), icon size `14px` tinted `var(--accent)` (`tint_icon(icon_path,
self._accent)` — icons are *always* accent-colored by default, regardless
of row state), row text `var(--text-secondary)` at `var(--fs-primary)`
(`self._fg2`/`self._px`, where `_px` comes from the theme's
`font_size_primary` — already what `--fs-primary` maps to for both
DARK/CREAM). Row gap between items is `1px` (`_lo.setSpacing(1)`).

**Exact icon files** (`albums_browser.py`'s `_show_track_context_menu_at`,
not guessed from the generic `/img/` names that happened to sound right —
the old app deliberately uses the smaller `sub_*` icon variants for a
couple of these, not the same icon another part of the UI uses for a
bigger button): Play Now → `sub_play.png`, Play Next → `sub_next.png`,
Add to Queue → `queue.png`, Go to Artist → `sub_artist.png`, Start Radio →
`radio.png`, Add to Playlist (both the submenu trigger *and* every row
inside it, including existing playlists) → `playlist.png`, New Playlist…
→ `add.png`, Get Info → `info.png`, Favorites → `heart.png`/
`heart_filled.png`.

`MenuItem` has a `color` override (`ContextMenu.tsx`) matching
`add_action(..., color=...)` — used for exactly one row: Favorites is
`FAVORITE_PINK` (`'#E91E63'` in the Python source) on *both* the icon and
the label text, not the universal accent tint every other row gets. This
was the one deliberately-not-accent-colored row in the old menu, not a
oversight to "fix" toward consistency.

**Gotcha**: `html, body, #root` in `index.css` sets a global
`font-weight: 500` — anything that doesn't explicitly override it (menus,
dropdowns, plain body text) renders at that medium weight by default, but
the Qt source never set a font-weight for its menu rows (Qt default is
normal/400), so the two looked visibly mismatched — the new one reading as
noticeably bolder/heavier even at the "right" font size. `ContextMenu.tsx`'s
rows explicitly set `fontWeight: 400` to override the global default and
match. Worth checking for the same gotcha in any other new
menu/dropdown-style component that doesn't explicitly set a weight.

**Canonical row spec, shared by every dropdown-style popup** (not just
`ContextMenu`): container is `background: var(--main-bg)`, `border: 1px
solid var(--border)`, `border-radius: 8`, `padding: 4`,
`box-shadow: 0 4px 16px color-mix(in srgb, var(--text-primary) 15%,
transparent)`. Each row is `padding: 5px 20px 5px 12px` (asymmetric),
`fontSize: var(--fs-primary)`, `fontWeight: 400`, `color:
var(--text-secondary)`, icon size `14px` tinted `var(--accent)` unless
overridden. This applies to the sort menus in `Albums.tsx`/`Artists.tsx`
and the column-visibility picker in `TrackTable.tsx` as well as
`ContextMenu.tsx` — all four were brought in line with each other so a
fix/tweak to one of these values should be applied to all of them (they're
still separate hand-rolled implementations, not one shared component, so
this has to be done by hand until/unless they get consolidated).

- **Play Next** / **Add to Queue** are new store actions
  (`addTrackNext`/`addTrackToQueue` in `src/store/index.ts`) matching the
  old app's `play_track_next` (insert after `currentIndex`, don't touch
  playback) / `add_track_to_queue` (always just append, never auto-play)
  semantics exactly — distinct from the existing double-click behavior
  (`insertAfterCurrentAndPlay`), which inserts *and* plays immediately.
- **Start Radio** (`startRadio` store action) matches `start_radio`: clears
  the queue, plays the seed track alone, then in the background fetches
  `getSimilarSongs2` (needs a Last.fm/AudioMuse-backed Navidrome — fails
  silently if unavailable) + `getTopSongs`, dedupes against the seed and
  each other, shuffles, and appends via the new `appendToQueue` action.
- **Add to Playlist** submenu: `"New Playlist…"` always first (opens
  `PromptDialog`, a small reusable name-prompt modal → `createPlaylist` +
  `addTracksToPlaylist`), then every existing playlist as
  `"{name}  ({song_count})"` → `addTracksToPlaylist` directly. Both paths
  invalidate the `["playlists"]` query afterward so song counts refresh.
  `addTracksToPlaylist` needed a hand-rolled POST (repeated `songIdToAdd`
  params) since the shared `get()` REST helper only supports one value per
  query param.
- **Get Info** opens `TrackInfoDialog` — see its own section below for the
  full field list (this was later expanded to match the old app's dialog
  field-for-field; only "BPM Detected" isn't ported, since that's live
  on-device DSP analysis, not server data).
- **Add/Remove Favorites** here is a *separate* code path from the `♥`
  column's `FavoriteHeart` component — it calls `api.setFavorite` directly
  and invalidates `album-tracks`/`tracks-native` queries rather than
  optimistically flipping local row state, so there's a brief lag before
  the row's heart icon visually catches up (acceptable trade-off; wiring
  true optimistic sync would mean lifting `tracks` ownership out of
  `TrackTable`).
- Right-click always collapses selection to just the clicked row
  (`setSelected(new Set([track.id]))`) before opening the menu, matching
  the old app's album-detail variant (single-select only) — the Tracks-tab
  variant's multi-select `"(N)"`-style labels aren't ported yet.

## Start Radio: queue-panel loading spinner

The old app's `QueuePanel._SpinnerRing` (`player/panels/right/queue_panel.py`)
is a genuine top-level always-on-top Qt window doing manual `QPainter`
rotation — a Qt-specific workaround for a `createWindowContainer`/QML
stacking quirk that doesn't apply to our plain HTML/CSS stack, so we just
render it as a normal absolutely-positioned overlay instead. Ported the
*visual* spec exactly though (`src/components/SpinnerRing.tsx`): 52px ring,
faint full background circle (`rgba(255,255,255,0.14)`, 3.5px stroke, round
caps), plus a 100°-long `var(--accent)`-colored arc (`strokeOpacity: 0.82`,
matching the source's alpha 210/255) that rotates continuously — one
revolution every 1152ms (the old app stepped 5°/16ms via a timer; 72 steps
× 16ms = 1152ms, reproduced here as a single CSS `@keyframes spinner-rotate`
instead of a JS timer loop).

Toggled by a new `radioLoading` boolean in `src/store/index.ts`, set `true`
right when `startRadio`'s background similar/top-songs fetch begins (after
the seed track already started playing) and `false` in a `finally` block —
mirrors `set_radio_loading(True/False)` bracketing `RadioWorker` in the old
app. Rendered centered over `QueuePanel`'s track list
(`pointerEvents: "none"`, so it never blocks clicking the list underneath,
matching the old spinner's `WA_TransparentForMouseEvents`).

## TrackInfoDialog ("Get Info") field list

Ported field-for-field from `TrackInfoDialog` (`player/components/
shared_widgets.py:410-910` in the old app, opened via `_show_track_info`).
Row order: **Title, Path, Album artist, Artists, Album, Disc, Track,
Release year, Genres, Duration, Is compilation, Codec, BPM ID3Tag, BPM
Detected, Bitrate, Sample rate, Bit depth, Channels, Size, Favorite, Play
count, Modified, Id.**

**No single endpoint has every field** — same problem the old app had. Its
`_fetch_full_data` made two extra per-track calls and merged them (native
wins on non-empty overlap): Navidrome's native `/api/song/{id}` (has the
real filesystem path) + standard Subsonic `getSong` (has extra audio
fields: bitRate, size, suffix/codec). We do the same in
`SubsonicClient.getTrackInfo()` (`electron/main/subsonic.ts`), merging into
a `TrackFullInfo` (`electron/main/models.ts`) — deliberately **not** folded
into the base `Track` type, since (like the old app) no *list* endpoint
returns these reliably; they're fetched on-demand only when the dialog
opens (`useQuery(["track-info", track.id], () => api.getTrackInfo(...))`
in `TrackInfoDialog.tsx`), while the fields already on `Track` (title,
artist, album, disc/track number, year, genre, duration, bpm, bitrate,
starred, play_count, created, id) render immediately without waiting on
that fetch.

- **BPM Detected** is always rendered as `"—"` — in the old app this comes
  from `win.bpm_cache`, a local on-device DSP tempo analysis
  (`audio_engine.analyze_bpm()`) run live during playback, not server data
  at all. Not ported; would need a real audio-analysis feature, out of
  scope for an info dialog.
- **Modified** shows Navidrome's `created`/`createdAt` field verbatim (raw
  ISO string, no reformatting) — this is the DB's library-scan/import
  timestamp, *not* filesystem mtime or tag-write time (confirmed from the
  old app's own field mapping).
- **Is compilation** / **Favorite** use `img/yes.png`/`img/no.png` (green
  `#4caf50` / red `#f44336` tint) — same icons and fallback-color scheme as
  the old app's `_set_bool_icon`.
- **Path** row has a copy-to-clipboard button (`img/copy-path.png`,
  `navigator.clipboard.writeText`) instead of the old app's identical
  copy-icon behavior — not an edit/rename action, despite looking
  pencil-like at a glance.
- **Album artist** / **Artists** / **Album** are clickable, bold +
  `var(--accent)`, matching the old app's link styling. **Artists** reuses
  `ArtistTokens` directly (same component `TrackTable`/`Albums` use
  elsewhere) — its existing multi-artist split/navigate logic (single
  artist → known `artist_id`; multi-artist string → per-token search-by-name
  lookup) is exactly the behavior wanted here, no new logic needed.
  **Album artist** also goes through `ArtistTokens`, but always with
  `artistId={null}` since we only ever get the *name* for it (from
  `TrackFullInfo`, not a proper id) — that falls into `ArtistTokens`'
  existing by-name search fallback regardless of whether the name is a
  single artist or multiple, which is exactly what's needed. **Album** has
  no shared link component to reuse, so it's a small one-off in
  `TrackInfoDialog.tsx` (`AlbumRow`) using the same hover-underline CSS
  technique as `ArtistTokens`' `ArtistToken`, navigating via
  `api.getAlbum(track.album_id)`.
  `ArtistTokens` gained an optional `onNavigate` callback (default no-op)
  so this dialog can close itself right after navigating — a deliberate
  deviation from the old app, whose `TrackInfoDialog` is a modal `exec()`
  call that does *not* close on an artist/album link click (the main
  window's tab switches underneath while the modal stays open, blocking
  interaction with the very screen you just navigated to, until manually
  closed). Closing on navigate is straightforwardly better UX and doesn't
  affect any other `ArtistTokens` call site since the prop defaults to
  a no-op.

## PlayerBar (footer): icon colors, proportions, waveform

Brought in line with the old app's `footer_bar.qml`/`footer_bridge.py`.

- **Icon tinting**: every transport icon (stop, shuffle, prev, play/pause,
  next, repeat) is *unconditionally* `var(--accent)` — the old app's
  `tintedIcon(name, accentColor)` doesn't dim/gray inactive buttons; on/off
  state (shuffle, repeat) is shown only by the small dot indicator, not by
  the icon's own color. Same for settings (always accent) and volume/cast
  (accent when active/connected, a distinct muted `var(--text-secondary)`
  tint — not a dimmed-opacity accent — when muted/disconnected). We have no
  casting feature, so the cast icon always shows the disconnected tint.
- **Icon/button sizes**: stop 16px icon / 36px button, shuffle 18/40,
  prev 16/40, next 16/40, repeat 16/36, play ring 16/58 (already correct
  pre-existing default in `PlayRingButton`), settings 20, volume 29,
  cast 22. Transport row gap is `20px` (was `2px`).
- **Left/right column widths are proportional, not fixed** — `footer_bar.qml`'s
  `leftBlock.width = max(160, root.width * 0.19)` and `rightBlock.width =
  max(260, root.width * 0.19)` (both 19% of the *footer's own* width, just
  different floors), not fixed pixel columns. Our footer already spans the
  full window width like the old app's does, so this ports as plain CSS —
  `width: "max(160px, 19%)"` / `"max(260px, 19%)"` — no JS/ResizeObserver
  needed, since percentage widths on a flex item resolve against the flex
  container's (the footer bar's) width natively. This was previously a
  fixed `297px`/`360px`, which happened to look right at one window size
  but didn't grow the waveform's share of the bar on wider windows or
  shrink it on narrower ones the way the old app does. Album art stays a
  fixed 84px regardless (`artWrap` in the old app is unaffected by
  `leftBlock`'s width changes — only the text column's available space
  before eliding changes).
- **Title spills rightward past the narrow left column** instead of eliding
  immediately at its edge — ended up mattering in practice (with the
  proportional-width fix above, `leftBlock` at typical window widths is
  *narrower* than the old app's old fixed 297px, so titles were truncating
  earlier than before). Ported `footer_bar.qml`'s `titleLbl` behavior: two
  refs (`titleRef`, `controlsRowRef`) + a `ResizeObserver` on the whole bar
  measure `controlsRowRef`'s actual left edge each time it changes, and the
  title's `width` is set to `controlsLeft - titleLeft - 16` (same 16px
  margin the QML uses) instead of being clipped at the column's own
  boundary — `overflow: visible` on `leftBlock` and the text column let the
  title's content paint past their boxes without affecting the reserved
  flex widths (so the transport row's centering is untouched; the title is
  just visually overlaid on the empty space above it, exactly like the old
  app). Artist/album/bpm lines are unaffected — only the title spills.
- **Album line was missing entirely** — a second look at `footer_bar.qml`
  found a 4th `Text` (`albumLbl`, between artist and bpm) that an earlier
  pass here missed; the footer's info stack is **Title → Artist → Album →
  BPM/format**, not the 3-line version shipped first. Now uses the new
  shared `AlbumLink` component (`src/components/AlbumLink.tsx` — bare
  clickable album name, extracted from `TrackInfoDialog`'s inline version
  so both share the same hover-underline/navigate logic; `TrackInfoDialog`
  passes `alwaysAccent` for its bold-accent row style, `PlayerBar` doesn't,
  matching the footer's plain `fontColorSecondary`-at-rest look). Artist
  line also switched to `ArtistTokens` (previously plain text) for
  per-token click/hover, matching `footer_bar.qml`'s `Repeater` over
  split artist names.
- **Colors were wrong** — artist/album/bpm lines were dimmed via `opacity:
  0.75`/`0.45` on top of `var(--text-primary)`; the old app just uses
  `fontColorSecondary` (`var(--text-secondary)`) at full opacity for all
  three, no artificial fade. Fixed. The bpm/format line was also on
  `--fs-small`; the old app uses the same `fontSizeSecondary` as artist/
  album, not a smaller size — fixed to `--fs-secondary`.
- **Metadata line** (3rd line under artist) is `"{bpm} BPM · {format}"`
  (`Track.format`, a new field parsed from Subsonic's `suffix` — added to
  both `parseTrack`/`parseNativeTrack` in `subsonic.ts` since it costs
  nothing extra, already present on every song response used to build
  `Track` objects) — **not** the album name, which the old app's footer
  never shows at all. No on-device BPM detection exists in this build (see
  the `TrackInfoDialog` note on "BPM Detected"), so this is always the
  ID3-tag `bpm`, same fallback the old app itself uses when live detection
  is unavailable.
- **Time labels**: left is elapsed (unchanged), right defaults to a
  **remaining-time countdown** (`-M:SS`, counting down) but is clickable
  to toggle back to total duration — matches `footer_bar.qml`'s
  `totalTimeLbl` (`footerBridge.remainingToggled`, persisted setting
  `show_remaining_time`). Ported the same interaction: `showRemaining`
  state persisted to `localStorage` (`footer_show_remaining_time`, via
  `TrackTable.tsx`'s shared `loadJSON`/`saveJSON`) instead of a Qt
  setting. Our default is `true` (remaining shown) rather than the old
  app's `false` (total shown by default) — that was already our existing
  behavior before this toggle existed and nothing asked for the default
  to flip, just for the label to become clickable like the old app's.
  Both labels stay `var(--accent)` bold regardless of which mode is shown.
- **Waveform** (`src/components/Waveform.tsx`) replaces the plain
  `<input type="range">` scrubber. The old app's bar waveform is *real*
  per-track amplitude data from a native decoder
  (`audio_core.cpp`/`generate_waveform`), not decorative/random — so this
  ports the same idea via Web Audio's `decodeAudioData` instead of a native
  module. **Two-stage pipeline, both stages matter** — an earlier pass here
  only ported the second stage and got visibly less dynamic-range contrast
  than the old app as a result:
  1. `generate_waveform()` computes **RMS** (`sqrt(mean(sample²))`) per
     point, deliberately not a plain mean-of-abs (which crushes
     quiet-but-peaky passages toward zero — every sample weighted equally)
     and not pure peak (pegs near-max on any modern loudness-limited
     master). RMS's squaring gives loud transients outsized weight while
     still tracking a bucket's actual energy.
  2. `footer_bar.qml`'s `rebuildBarPath` then blends `0.7×rms + 0.3×peak`
     across whichever of those RMS points land in each *displayed* bar,
     clamped to `[0.04, 1.0]`, no further normalization.
  We don't have a separate high-resolution native buffer to re-bucket like
  the QML does, so `decodePeaks` decodes once per track at a fixed
  generous resolution (`DECODE_RESOLUTION = 800` points, RMS+peak blended
  same as above) and caches that raw array by `trackId` alone; the actual
  *displayed* bar count (which depends on the current width) is produced
  by cheaply resampling that cached array (`resample()`, nearest-neighbor)
  on every render — no re-decode involved. Bars are `1.8px` wide with
  `2px` gaps; unplayed = `rgba(80,80,80,0.6)`, played portion = a vertical gradient
  (white→accent→black), matching the QML canvas exactly. Click-to-seek
  works the same as the old slider did.
  **Cost note**: this downloads the track a second time (the `<audio>`
  element streams it separately for playback) — an unavoidable trade-off
  of decoding client-side without a native module; acceptable for typical
  track lengths but worth knowing if it ever needs revisiting for very
  large lossless files.
- **Waveform row fills the full available width** — was capped at a
  leftover `maxWidth: 580` from before the real waveform existed (felt
  like a reasonable slider width at the time), making the bars render much
  shorter than the old app's, which is `Row { width: parent.width }` (full
  row) with `waveformWrap.width = parent.width - currentTimeLbl.width -
  totalTimeLbl.width - 30`. Cap removed; row gap changed `8px → 15px`
  (matches the QML `Row`'s `spacing: 15`); time-label `minWidth` widened
  `44px → 56px` to reduce reflow risk (the QML measures the literal
  worst-case string `"-00:00:00"` at 14px bold for a truly fixed width —
  not replicated exactly since our `fmtDuration` never shows hours, but
  the wider fixed minimum serves the same "don't shift the waveform's
  start position every second" purpose).
- **Waveform was also just too short vertically** — `waveformWrap.height`
  in `footer_bar.qml` is `60`, but `Waveform.tsx`'s `HEIGHT` constant was
  `36` (canvas height, not a typo elsewhere — just the wrong value picked
  originally). Nearly half the real height, independent of the RMS fix
  above; both needed fixing together to actually match. Also added the
  QML's `Math.max(4.0, val * height * 0.85)` pixel floor on bar height,
  which `rebuildBarPath` has *in addition to* the `0.04` floor on the
  underlying value — at `HEIGHT=60` the value floor alone only produces
  ~2px bars, so the explicit pixel floor is what actually keeps near-silent
  buckets visible.
- **Waveform disappeared while resizing the window** — root cause was
  keying the peaks cache by `trackId:bucketCount` and decoding at the
  exact displayed bucket count. Since bucket count changes on almost any
  width change, every resize tick was a cache miss that kicked off a full
  re-fetch + re-decode of the audio file, blanking the waveform
  (`peaks → null`) until it finished — with a window drag firing many
  resize events per second, this looked like the waveform "wanting to
  disappear". Fixed by decoding once per track at a fixed resolution (see
  above) and resampling synchronously on width change instead — resizing
  no longer touches the network or the decoder at all.

## Expand album art to the left panel

Ports the old app's `_toggle_sidebar_art` (`window.py:1313-1327` +
`footer_bar.qml`'s `expandBtn` + `left_panel.qml`'s `artSection`): the
footer's small 84×84 thumbnail can expand into a big square in the left
panel, driven by one shared boolean (`sidebarArtExpanded` in
`src/store/index.ts`, `toggleSidebarArt()`) instead of separate
footer/window/left-panel signal plumbing — both places just read the same
store field, so they move in lockstep automatically without needing to be
told about each other.

- **Not a cross-fade, a handoff**: the footer thumbnail's width and the
  left panel's art-section height animate on the *same* boolean at the
  *same* `250ms cubic-bezier(0.65, 0, 0.35, 1)` (CSS equivalent of Qt's
  `Easing.InOutCubic`) — one shrinks to 0 while the other grows to full
  size, no opacity blend between them, matching the QML exactly (confirmed
  by reading both `Behavior on width`/`Behavior on height` blocks — same
  duration/easing on both, no separate reverse/"hide back" curve to find).
- **Left panel art section** (`LeftPanel.tsx`): collapses to `height: 0`
  by default (this is a real behavior change from what we shipped
  before — the art there used to always render whenever a track was
  playing; now it's collapsed until expanded, matching the old app). Size
  is `ART_SIZE = 297 - 8*2 = 281` (the old app's `leftPanel.width() - 16`
  margin formula — a constant here since our left panel doesn't resize),
  `border-radius: 5`, `#121212` background, "💿" placeholder at
  `max(20, size*0.3)`px when no track/art.
- **Two different hover-reveal behaviors for the two icon buttons** — not
  a mistake, this is literally how the QML is written for each:
  - Left panel's **close** button only reveals on hovering *itself*
    (`closeHover.containsMouse` where the `MouseArea` is scoped to the
    24×24 button, not the whole art square).
  - Footer's **expand** button reveals on hovering *either* the whole
    84×84 thumbnail *or* the button itself
    (`artHoverArea.containsMouse || expandClick.containsMouse`) — more
    discoverable, since the thumbnail is small.
  Both buttons share one visual recipe either way: 24×24 circle, `2px`
  border, `var(--accent)` at 30%/10% alpha (border/fill) at rest → 100%/40%
  on hover, `expand.png` icon (16px, `#515151` at rest → white on hover),
  `180ms` linear opacity fade — ported directly from the
  `Qt.rgba(accent, ..., hover ? 0.4 : 0.1)`-style bindings in both QML
  files, using the same `expand.png` icon for both (collapse doesn't get
  its own distinct icon in the old app either).
- **Title-spill recompute on toggle**: `PlayerBar.tsx`'s title-overflow
  measurement (see the footer proportions section above) depends on where
  the art thumbnail's right edge currently sits, so toggling
  `sidebarArtExpanded` was added to that effect's dependency array, plus
  an `onTransitionEnd` listener on the thumbnail wrapper for a final
  re-measure once the 250ms width animation actually settles (the
  dependency-triggered recompute alone would snap to the target width
  immediately, slightly ahead of the visual animation).

## Session persistence: queue/current track/position survive a restart

Ports the old app's `save_playlist`/`load_playlist`
(`player/mixins/persistence.py`) — full queue snapshot + current index +
playback position, saved once on close and restored eagerly (but paused,
not auto-played) on next launch.

- **`persistSession`/`restoreSession`** (`src/store/index.ts`), storage key
  `icosahedron_session` in `localStorage` (renderer-only, same mechanism
  already used for saved credentials — no main-process/IPC involvement
  needed). Shape: `{ queue: Track[], currentIndex: number, positionSecs:
  number }` — the *full* track objects, not bare ids, matching the old
  app's `_serializable_track()` snapshot approach (so restoring doesn't
  need a server round-trip to re-fetch metadata for every queued track).
- **Why saved `stream_url`s are safe to reuse as-is**: Subsonic's
  salt/token auth (`SubsonicClient.authParams()`) isn't time-limited — the
  server just verifies `token === md5(password + salt)` using whatever
  salt is embedded in the URL, regardless of when the request happens. A
  `stream_url` cached from a previous session remains valid indefinitely
  as long as the password hasn't changed, so restored tracks just work
  without needing fresh URLs.
- **Save timing**: a single `window.addEventListener("beforeunload", ...)`
  at module scope, matching the old app's single `closeEvent()`-triggered
  save rather than continuously autosaving on every track change/tick.
- **Restore timing**: called from `tryAutoConnect()` right after a
  successful `connect()` (needs `coverUrl()` wired up first for the
  restored queue's art to resolve) — wrapped in its own `try/catch`
  *separate* from the connect-failure handler, so a restore hiccup can't
  get misattributed as bad credentials and wipe the saved login.
- **Restores paused, doesn't auto-play** — same as the old app
  (`set_position_ms(..., hard=True)` with no `play()` call anywhere in
  that path). `restoreSession` builds the `Audio` element, wires the same
  `timeupdate`/`loadedmetadata`/`ended` listeners `playTrack` uses, and
  seeks to the saved position once `loadedmetadata` fires — but never
  calls `.play()`, and sets `playing: false`.
- **Deliberately not persisted, matching the old app's own scope**:
  shuffle, repeat, and volume were never saved/restored there either
  (`is_shuffle` resets to `false` and `last_volume` is hardcoded to `100`
  at every old-app launch) — this wasn't extended in the port since
  nothing asked for it and it'd be new scope beyond "matching the old
  app."
- **Not replicated**: the old app's restore path doesn't revalidate saved
  tracks against the server (a deleted/moved track is silently dropped
  only if it lacks both a `stream_url` and a valid local `path`) — a
  latent inconsistency there, not an intentional design worth copying. We
  don't validate either, but for a different reason: our `stream_url`s are
  always present and remain valid regardless of the underlying song still
  existing, so a genuinely-deleted track would just fail naturally on
  playback attempt rather than being pre-filtered.

## PlayingBars must gate on `playing`, not just "is this the current track"

`PlayingBars` (`src/components/PlayingBars.tsx`) is a pure CSS
`animation: ... infinite` — it always animates once mounted, no
play/pause awareness of its own. `QueuePanel.tsx` already correctly shows
it only on `isCurrent && playing`, but `TrackTable.tsx`'s row loop reused
a single `isPlaying` flag (`t.id === currentId`, current-track-only, no
`playing` check) both for row/title highlighting *and* for whether to
show `PlayingBars` — so the equalizer kept animating through Pause and
Stop, since the row stays "current" in both cases (`stop()` clears
`playing`/`currentTime` but not `currentIndex`, matching the earlier
"Stop pauses+rewinds, doesn't clear the queue" behavior). Fixed by adding
the store's `playing` boolean and gating the `PlayingBars` branch on
`isPlaying && playing` specifically, while leaving every other use of
`isPlaying` (title/row accent color) untouched — a paused current track
should still read as "current," just without the animated bars.

## Expand/collapse art buttons: reset hover state on click, not just mouseleave

Both the footer's expand button and the left panel's close button are
*conditionally rendered* (`{!sidebarArtExpanded && (...)}` /
`{expanded && (...)}`) — clicking one immediately flips the shared
`sidebarArtExpanded` toggle, which unmounts that exact button in the same
tick. The browser's `mouseleave` doesn't reliably fire during an abrupt
unmount like that, so the JS-tracked hover flag (`expandBtnHov`/
`closeHov`) stayed stuck at `true`. Next time that button mounted fresh
(toggled back), it inherited the stale `true` and rendered already-visible
via `opacity: hov ? 1 : 0` — looking like it "wouldn't hide normally,"
until actually hovering it once forced the flag back in sync with reality
and it correctly disappeared. Fixed by resetting the hover flag(s) in the
`onClick` handler itself, before the toggle runs, so nothing stale
survives the unmount — not a CSS bug, a stale-React-state-across-unmount
bug.

## Tracks pagination: left-aligned, fixed-size slots (not centered/content-sized)

Ported from `TrackListView.qml`'s `paginationRow` (the actual pagination
widget — `tracks_browser.py` only exposes the page-state bridge, no
layout of its own):

- **Left-aligned**, not centered: `anchors.left: parent.left;
  anchors.leftMargin: 15`. Our footer row switched from
  `justify-content: center` to the default (left) with `paddingLeft: 15`.
- **Every slot is a fixed 32×32 box** — prev arrow, next arrow, and each of
  exactly **7** page-number/ellipsis slots, always, regardless of how many
  digits a page number has or how many are actually needed near the start/
  end of the range. `pageNumbers()` now pads its result with `null` up to
  `PAGE_SLOTS = 7` (mirrors the QML's `while (items.length < 7)
  items.push(null)`), and `null` slots render as an empty 32×32 spacer —
  same footprint, no button. `PageBtn` changed from content-sized
  (`minWidth: 28`, horizontal padding) to a fixed `32×32` box; the
  ellipsis "…" got its own fixed-size box too instead of a bare `<span>`.
  **This is the actual fix for the reported bug**: previously the row's
  total width (and therefore the "›" arrow's x-position) changed as the
  visible page numbers gained/lost digits while paging forward, moving
  the arrow out from under a mouse that stayed still through repeated
  clicks. With every slot pinned to the same size and count, the arrow
  never moves.
  **Which page numbers get shown** uses the standard adaptive 3-mode
  scheme, not a fixed sliding window (a fixed window of any single size
  can't stay at exactly 7 in every case — e.g. windowSize=5 gives exactly
  7 near the start/end but up to 9 in the middle of a large range, once
  both a leading `1 …` and trailing `… total` are added on top of the
  window; windowSize=3 stays ≤7 everywhere but wrongly undershoots to
  only 3 leading numbers at the start, when the old app actually shows
  5 there):
  - near start (`current <= 4`): `1 2 3 4 5 … total`
  - near end (`current >= total-3`): `1 … total-4 total-3 total-2
    total-1 total`
  - middle: `1 … current-1 current current+1 … total`
  All three branches always total exactly 7 items on their own — the
  `null`-padding described above only ever fires for the `total <= 7`
  case, not as the general mechanism.
- **Sizing/color — read straight from `TrackListView.qml`'s Repeater
  delegate** (`font.pixelSize: root.fontSizePrimary; color:
  isActive ? accentColor : (isEllipsis ? textSecondary : textPrimary);
  opacity: isEllipsis ? 0.6 : 1`), not guessed: `gap: 5` between all items
  (was `gap: 4`). Every number/ellipsis is `var(--fs-primary)` size — an
  earlier pass here wrongly put them on `--fs-secondary`, which is smaller
  and reads as "the wrong size." **Inactive page numbers are
  `var(--text-primary)`** (full-strength, same as ordinary body text) —
  not `--text-secondary`/muted like an earlier pass had it; only the
  active page (`--accent` + bold) and the ellipsis (`--text-secondary` +
  `opacity: 0.6`) are ever different from a plain number. Arrows are a
  size up via `calc(var(--fs-primary) + 2px)` (the QML's
  `fontSizePrimary + 2`) — a derived offset from the existing token rather
  than a new hardcoded size, per the project's no-hardcoded-sizes rule.

## Tracks refresh button: position + spin-until-scan-actually-finishes

Old-app reference is the pre-QML-conversion `tracks_browser.py` (~commit
`d641a25~1`) — the current sonar HEAD's QML port has a known regression
where the button still triggers the scan/poll correctly but the icon
itself never visibly spins (no rotation binding wired to the QML
`Image`). Ported the *intended* behavior, not the currently-broken wiring:

- **Position**: rightmost element in the header, after the search box,
  before the column-picker/burger button — not next to the track-count
  label (which sits far to the left in its own group). `TrackTable.tsx`
  gained a `toolbarRight` prop (rendered between `SearchBox` and the
  burger button) alongside the existing `toolbarLeft`; `Tracks.tsx` now
  puts the track count in `toolbarLeft` alone and the refresh button in
  `toolbarRight`.
- **Spin mechanics**: `IconBtn` gained a `spinning` prop that applies
  `animation: spinner-rotate 1280ms linear infinite` to the icon (reusing
  the same keyframe as the radio-loading `SpinnerRing`) — continuous
  linear rotation, no fixed rotation count, matching the old app's
  `SpinRefreshButton` (`+4.5°` every 16ms ≈ 60fps ≈ 1.28s/rev).
- **Stops when the scan actually finishes, not when the request
  returns**: `startScan` only *starts* a scan; Navidrome keeps indexing
  in the background. `Tracks.tsx`'s `handleRefresh` now polls
  `api.getScanStatus()` every 500ms (up to 30s / 60 iterations) until
  `scanning` goes false, then waits 1.5s and re-checks once more before
  actually stopping — Navidrome can flip the flag slightly before the
  index commit is fully done, and the old app has this exact same
  settle-and-recheck for the same reason. A 600ms minimum spin floor
  (measured from when the button was clicked) keeps the animation
  visible even if the scan turns out to be a instant no-op.
- **Color**: no separate muted/active state — `IconBtn` was already
  unconditionally `var(--accent)`-tinted regardless of state, which
  already matches the old app's "same tint at rest and while spinning."

## Full nav bar: placeholder tabs for not-yet-built sections

`window.py:918-1041`'s `addTab` sequence is the authoritative old-app tab
order: **Home, Now Playing, Albums, Artists, Tracks, Playlists,
Favorites, Mix Builder, Visualizer** — 9 tabs total, all peers in one
continuous tab bar (no divider/pinned-separate treatment for any of
them). We only had 5 built (Albums/Artists/Tracks/Playlists/Favorites);
added the other 4 to `NAV` in `App.tsx` in their correct position, each
rendering a new shared `Placeholder` screen
(`src/screens/Placeholder.tsx`) instead of real content — small, faded,
letter-spaced "{label} — Coming Soon™" text, styled after the old app's
own placeholder for its not-yet-built Visualizer tab
(`window.py`'s `_coming_soon_lbl`: tiny, `opacity: 0.18`, letter-spaced),
adapted to use theme tokens (`var(--text-primary)` + CSS `opacity`
instead of a literal `rgba(255,255,255,0.18)`, which would only ever
look right in a dark theme) and centered in the tab instead of pinned to
the top (the old app's version left room below for the visualizer canvas
that would eventually fill that space; ours has nothing else in the tab,
so centering reads better).

**Settings is not one of the 9 tabs** — confirmed it's a separate modal
in the old app (`footer_bridge.py`'s gear-icon signal → `open_settings()`
→ a frameless `SettingsWindow` dialog, not a routed tab), matching what
our footer's gear icon already implies architecturally even though it's
not wired to anything yet. Nothing changed there; noting it so a future
settings implementation doesn't get bolted on as a tenth nav tab by
mistake.

**Default landing tab stays `"albums"`**, not `"home"` — `Home` in the
nav bar is included for visual/positional parity, but landing on an
actual placeholder with no content on every launch would be a usability
regression versus landing on a real, usable screen. Revisit this once
Home has real content.

**Theme audit**: swept for hardcoded colors/font-sizes introduced since
the original manifest audit. Found and fixed one real regression:
`NavTab`'s icon tinting used a hardcoded CSS `filter: sepia(1) saturate(5)
hue-rotate(-10deg) brightness(0.6)` (active) / `saturate(0)
brightness(0.4)` (inactive) — a filter hack tuned by eye for this app's
specific reddish accent color, which would render *wrong* hues for any
other theme's accent (e.g. DARK's teal). Every other icon in the app
already uses the `Icon` component's CSS-mask + `currentColor` approach
(inherits whatever color the parent element currently has, so it's
correct for any accent color automatically) — `NavTab` was the one
holdout still using a plain `<img>` with a bespoke filter. Switched it to
`<Icon>`; the button's own `color` (already `active ? accent :
text-primary`) now drives the icon tint correctly, and the redundant
per-image `opacity` was removed since the button-level opacity already
handles active/inactive dimming. No other hardcoded hex colors or
raw-pixel font sizes found outside already-documented sanctioned
exceptions (`FAVORITE_PINK`, `PLAY_ICON_DARK`, the expand/collapse
button's icon-tint literals, etc.).

## Nav tab bar: exact sizing/color, not the earlier approximation

The first pass at `NavTab` (`App.tsx`) undersized everything relative to
the old app's `_TabBar` QSS (`mixins/visuals.py:748-756`) + its custom
`paintEvent` active-tab halo (`window.py:143-169`):

- **Icon**: `14px → 16px` (the old app's literal `setIconSize(QSize(16,
  16))`, not a scaled-down native size).
- **Font**: `--fs-secondary → --fs-primary` (the QSS interpolates
  `theme.font_size_primary` directly, default 14px — not a
  QTabBar-specific smaller size).
- **Font weight**: every tab is **bold**, not just the active one — only
  the *color* distinguishes active/inactive/hover; weight never changes.
  Previously nothing set `fontWeight` at all, so it fell through to the
  app's global `500` default.
- **No opacity fade on inactive tabs** — previously `opacity: active ? 1
  : 0.65`, dimming the whole button (icon + text) when not active. The
  old app never fades inactive tabs; it's a plain color swap
  (`--text-primary` vs `--accent`) at full opacity both ways.
- **Padding**: `12px/6px (Tailwind px-3 py-1.5) → 10px 5px` (vertical/
  horizontal), matching the QSS literally. Gap between tabs:
  `2px (gap-0.5) → 4px`, matching `margin-right: 4px` per tab.
- **Active-tab highlight**: was `var(--hover-bg)` (the app's generic
  hover token) — the old app's version is a *specific* hand-painted
  rounded rect, not reusable hover styling: `--accent` at alpha `45/255`
  (~17.6%), radius `6px`, **no border stroke** (a perceived "outline" in
  screenshots is just the alpha-blended fill's edge contrast against the
  panel background, not an actual stroke — confirmed `QPen: NoPen` in the
  paint code). Switched to `color-mix(in srgb, var(--accent) 17.6%,
  transparent)`, `borderRadius: 6`.
- **Not ported**: the old app's icon-only compact mode (drops labels and
  bumps icons to 20px when the header is too narrow to fit all 9 tab
  labels) and the hover background's exact "accent lightened 200%"
  computation (kept the app's existing generic `var(--hover-bg)` token
  for hover instead of building a bespoke color-resolution function for
  one component) — both reasonable simplifications, not require-exact-match
  territory like the active-state visuals above.
- **Icons are always `var(--accent)`, regardless of active state** — only
  the *label* switches between `--accent` (active) and `--text-primary`
  (inactive); an earlier pass here had the icon inherit the button's
  `color` via `currentColor`, so it followed the label and went muted
  when inactive, which doesn't match the reference screenshot (every
  icon reads the same accent color whether its tab is active or not).
  Fixed by giving `Icon` an explicit `style={{ background: "var(--accent)"
  }}` override (bypassing the `currentColor` inheritance) and wrapping the
  label in its own `<span>` with the conditional color, since the button
  no longer needs a top-level `color` for this to work.
- **Equal-width tabs (`minWidth: 110`)** — native `QTabBar` sizes every
  tab to a shared width (roughly the widest label's footprint), not each
  tab hugging its own content. This is invisible on inactive tabs (no
  background to reveal the reserved space) but very visible on whichever
  tab is *active*, since its highlighted pill fills that whole reserved
  width — so a short label like "Home" shows noticeably more padding
  around its icon+text once active than a long one like "Mix Builder"
  does. Added `justify-content: center` alongside the `minWidth` so a
  short label's content centers within the wider box instead of hugging
  its left edge.

## Nav tabs are drag-reorderable, matching the old app

The old app persists a user-dragged tab order to a QSettings key
`tab_order`; ported the same idea to `localStorage` (`nav_tab_order`, via
the shared `loadJSON`/`saveJSON` from `TrackTable.tsx`) rather than
building new persistence machinery.

- **Native HTML5 drag-and-drop** (`draggable` + `onDragStart`/
  `onDragOver`/`onDragEnd`) — no new dependency. `MainApp` owns a
  `navOrder: Tab[]` state (array of tab ids) separate from `NAV`, the
  static id→label/icon lookup table; rendering maps over `navOrder` and
  looks up each entry in `NAV`, so reordering never touches labels/icons,
  only position. Dragging over another tab live-reorders `navOrder`
  immediately (splice-out/splice-in at the hovered tab's index) rather
  than waiting for drop — matches typical drag-reorder UX (VS Code tabs,
  browser tabs, etc.).
- **Persisted on every change** via a `useEffect` on `navOrder` — cheap
  and simple since reorders are infrequent user actions, no need for the
  explicit "save once on drag-end" the naive version might reach for.
- **Migration-safe load** (`loadNavOrder()`): a saved order is filtered
  down to ids that still exist in `NAV`, and any `NAV` id missing from
  the saved order (e.g. a newly-added tab like the placeholders above,
  for a user who saved a custom order before they existed) gets appended
  at the end — so adding a new tab in the future can't make it silently
  vanish for users with a saved custom order, and a saved order can't
  crash on a since-removed id.
- **Dragged tab dims to `opacity: 0.4`** while in flight — the only new
  visual feedback needed; drop targets don't need their own highlight
  since the live-reorder already shows the result immediately.

## Nav tab hover: same halo shape as active, but the theme's actual hover color

An earlier pass added a `box-shadow` glow (`0 0 8px 1px color-mix(accent
25%, transparent)`) on hover, layered on top of the background fill —
not requested by any research, just an embellishment, and it read as
"funky" against the flat, halo-style active state. Removed the shadow
entirely; hover now uses the *same* rounded-rect background-fill
treatment as the active state (no shadow anywhere on this component) —
just `var(--hover-bg)` for the color.

That last part took two wrong turns before landing here, worth recording
so it doesn't happen again: first tried a synthesized accent tint at
`8.8%` alpha, which at that low a percentage reads as washed-out pink
against CREAM's light panel background rather than a recognizable accent
color; "fixed" that by bumping to the *same* `17.6%` as the active
state — still wrong, just a less-diluted pink. The actual answer was
sitting in the theme the whole time: `cream.json`'s
`"menu_hover_color": "#d5d1c6"` is an **explicit, independent hover color
setting**, not something derived from the accent color at all — and our
own `theme.ts` already has `CREAM.hoverBg = "#d5d1c6"`, the exact same
value, already wired to `--hover-bg`. There was never a need to derive a
hover tint from `--accent` — the theme already defines its own literal
hover color, completely decoupled from accent, and `var(--hover-bg)` was
the correct token from the very first version of this component.

## Nav tab bar: icon-only compact mode + no minimum window width

Ported `window.py:757-787`'s `_update_tab_mode`:

- **Trigger**: not a hardcoded pixel breakpoint — compares the tab bar's
  full-label natural width against the *available header width*, live.
  Since every tab already has a fixed `FULL_TAB_WIDTH = 110` (established
  by the earlier equal-width fix), the "natural width" is just
  `count × 110 + (count-1) × 4` — no need to measure a hidden DOM clone
  the way the old app's `bar.sizeHint()` effectively does, since ours
  isn't per-label-content-sized to begin with. Compared against
  `headerRef`'s `clientWidth` (minus the row's own 24px `px-3` padding)
  via a `ResizeObserver`.
- **No hysteresis** — same comparison used to enter and leave compact
  mode, matching the old app exactly (both can flicker right at the
  boundary; not fixed here since the old app has the identical
  characteristic, not a bug being ported over by accident).
- **Compact mode**: icon `16px → 20px`, label hidden, tab width
  `110px → COMPACT_TAB_WIDTH = 44px`, `title={label}` added for a
  native-tooltip fallback so the tab is still identifiable by name on
  hover (a reasonable addition — the old app likely gets an equivalent
  tooltip for free from Qt's native tab widget, not something we
  needed to explicitly research to justify adding here).
- **No minimum window width** — confirmed there's no
  `setMinimumWidth`/`setMinimumSize` anywhere on the old app's main
  window at all; it's unbounded down to whatever Qt's implicit layout
  floor allows. Our `BrowserWindow` config already has no `minWidth`/
  `minHeight` set either, so this already matched — nothing to change.

## Left panel back/forward arrows (NavArrow): color and disabled state were wrong

Ported from `ArrowButton` (`player/widgets.py:1988-2021`). Button size
(30×30) and hover border-radius (12px) were already correct; the actual
bugs:

- **Color was `var(--text-primary)` at `opacity: 0.7`** — the old app
  hardcodes the icon to plain white at instantiation
  (`ArrowButton("left", "#ffffff")`, `mixins/navigation.py:38-39`) but
  immediately re-tints it to the **accent** color via `set_color(mc)`
  (`mixins/visuals.py:821-823`) — and always at full opacity (alpha 255,
  no QSS/opacity fade at all). Switched to `var(--accent)` at full
  opacity.
- **Disabled state was `opacity: 0.25`** — the old app doesn't fade at
  all; `paintEvent` swaps the pen to a fixed `#333333` (dark gray, fully
  opaque) when `!isEnabled()`. Switched to swapping the stroke color to
  `#333333` instead of dimming via opacity — this is a legitimate
  hardcoded-color exception (same category as `FAVORITE_PINK`/
  `PLAY_ICON_DARK`), since the old app's disabled-arrow color is a fixed
  literal, not theme-derived.
- **Chevron was too small** — the old app's `drawLine`-based chevron
  spans 6px wide × 12px tall (`s=6` half-height, `o=3` half-width offset
  from center, `player/widgets.py:2011-2021`) with a 2px stroke; the SVG
  polyline was noticeably smaller/thinner than that. Recomputed the
  polyline points against an `8×14` viewBox (6×12 chevron + 1px clearance
  per side for the round stroke caps) to match.
- **Gap between the two arrows was 0px, row's right margin was 4px** —
  should be `4px` gap between buttons and `8px` from the panel's right
  edge (`_reposition_header_widgets`, `left_panel.py:126-132`: starts at
  `x = width - 8`). Fixed both.

## Queue panel: drag-to-reorder

Ported from `queue_list.qml`'s grip-based `DragHandler` (not the separate
`PlaylistTree`'s native `InternalMove` — that's a different widget, used
by the Now Playing tab, not the Queue panel).

- **Drag confined to the `#`/index column, not the whole row** — the row
  itself already has double-click-to-play; the old app deliberately keeps
  dragging scoped to a small grip so the two interactions never fight
  each other. Same reasoning ported: `QueueRow`'s index-column `div` is
  the only mousedown-draggable element, not the row `<button>`.
  - **Manual `mousedown`/`mousemove`/`mouseup` drag, not native HTML5
    `draggable`** — the first version used native HTML5 drag-and-drop, but
    its `dragover` event only fires at a throttled, low frequency (not on
    every pointer move), which made the ghost row visibly *pop* between
    positions instead of smoothly tracking the cursor. Plain mouse events
    fire at full rate, so the grip's `onMouseDown` attaches `mousemove`/
    `mouseup` listeners on `window` for the drag's duration (removed again
    on `mouseup`), and the ghost/indicator update every one of those
    events — smooth continuous tracking instead of choppy jumps.
    `document.body.style.userSelect` is toggled off/on around the drag to
    stop the mouse movement from selecting row text.
  - Doesn't reorder live either way (native or manual): the array stays in
    its original order for the whole drag; only a preview (ghost +
    insertion indicator, see below) shows where the drop would land, and
    the actual splice happens once, in the `mouseup` handler. Matches the
    old app: `_on_reorder_track` only runs once, on the actual drop, not
    continuously during drag.
  - The latest computed drop position is tracked in a `dropIndexRef`
    (updated alongside the `dropIndex` state on every `mousemove`) so the
    `mouseup` handler can read its *current* value without a stale
    closure — the closures created inside `handleGripMouseDown` at
    `mousedown` time would otherwise only ever see the `dropIndex` that
    existed at drag-start (`null`).
- **Grip visual**: a 2×3 dot grid (`GripDots`), shown in place of the
  track-number text on row hover *or* while dragging — replaces
  `queue_list.qml`'s grip icon; extracted `QueueRow` as its own component
  (was inline `.map()` before) since per-row hover state needs an actual
  component to hold a `useState`, not just direct DOM style mutation like
  the row's existing hover-background handling.
- **The currently-playing track CAN be dragged** — deliberately deviates
  from the old app here (`enabled: !trackRow.isPlayingRow` locks it
  there). Explicitly requested: locking it was treated as a bug in this
  port, not a behavior to preserve. `showGrip` no longer checks
  `isCurrent` — hovering the playing row's index column shows the grip
  (temporarily replacing `PlayingBars`) exactly like every other row, and
  it's draggable like any other track. `reorderQueue`'s identity-based
  `currentIndex` resync already handles this correctly with no extra
  work: moving the currently-playing track just means the id it searches
  for *is* the track that moved, so its new index is found the same way
  regardless of whether the dragged track was current or not.
- **Ghost row** (`GhostRow`) — a floating preview that follows the
  cursor's Y position (computed in `handleRowDragOver` from
  `e.clientY` relative to the scrollable list's own bounding rect +
  `scrollTop`, so it tracks correctly even mid-scroll), showing the
  dragged track's title/artist. Styled to match
  `queue_list.qml:322-341`: `color-mix(in srgb, var(--panel-bg) 95%,
  white)` background (CSS equivalent of `Qt.lighter(panelBgColor, 1.05)`),
  `1px solid var(--accent)` border, `6px` radius, `0.8` opacity,
  `pointer-events: none` so it can't itself become a drop target.
- **Insertion-point indicator** (`InsertionIndicator`) — an 8px accent
  dot + a 2px accent horizontal line, matching `queue_list.qml:343-360`,
  rendered at the boundary between rows where the drop would land.
  `dropIndex` (which boundary) is computed per-row in
  `handleRowDragOver`: cursor above a row's own vertical midpoint inserts
  *before* it, below the midpoint inserts *after* — the classic
  half-row-boundary reorder heuristic. Can render past the last row too
  (`dropIndex === queue.length`), for dropping at the very end.
- **`reorderQueue(fromId, toIndex)`** (`store/index.ts`) takes an
  *insertion index* (0..queue.length) now, not a target track id — needed
  since the ghost/indicator pattern must express "insert before/after a
  specific row" *and* "insert at the very end" (which has no anchor
  track). After splicing the source out, indices at or after its old
  position shift down by one, so the insertion index is adjusted
  (`from < toIndex ? toIndex - 1 : toIndex`) before the final splice-in.
  `currentIndex` is still re-synced by **identity search** after the
  move — captures the currently-playing track's id beforehand, finds its
  new index afterward — matching the old app's `next(i for i,t in
  enumerate(...) if t is current_track)` approach exactly, correct
  regardless of drag direction without separate-case index arithmetic.
- **Dragged row dims to `opacity: 0.3`** in place (stays in its original
  list position, doesn't disappear or visually move until drop), matching
  `queue_list.qml:127` exactly.
- **Not ported**: the 6px drag-distance threshold from
  `DragHandler.dragThreshold` — native HTML5 drag already has its own
  inherent click-vs-drag distinction, so there was nothing to add.

## Queue panel header: text/icon styling corrections

Ported from `queue_panel.py:480-525` (layout) + `:698-716`/`:693-696`
(theming) — several assumptions in the first version were wrong:

- **"Queue" is title case, not "QUEUE"** — the old app's label is
  literally `'Queue'`, no `text-transform: uppercase`, no letter-spacing.
  Bold, `--fs-primary` (matches `font_size_primary`, default 14),
  `--text-primary`, **full opacity** — was wrongly uppercased,
  letter-spaced, and faded to `opacity: 0.5`.
- **Position ("3/12") and duration ("3:42") labels are real** — these
  weren't invented; confirmed present in the old app (`refresh()`,
  `queue_panel.py:809-829`). Both were wrongly using `--text-primary` at
  a low opacity (`0.4`/`0.35`) — the old app never fades header text,
  full opacity throughout:
  - Position → `--text-secondary` (matches `font_color_secondary`).
  - **Duration is tinted to the *accent* color**, not gray — set in
    `set_accent_color()` (`queue_panel.py:693-696`), re-applied whenever
    the theme's accent changes. This was the least obvious mismatch:
    duration text is one of the few header elements that reacts to the
    live accent color rather than a fixed text color.
  - Gaps between the three differ (`8px` Queue→position, `6px`
    position→duration) — can't be a single uniform flex `gap`, so
    switched to per-element `marginLeft` instead of the row's `gap-2`.
- **Clear/trash button was 14px icon at `opacity: 0.35`→`0.8` via a CSS
  `filter` hack** — should be a `28×28` button with an `18×18` icon
  (`_HeaderIconButton`, `queue_panel.py:196-231`), and the tint is a
  **flat, non-accent gray** — `#555555` at rest, `#aaaaaa` on hover, full
  opacity always (no fade animation at all, just a hover color swap).
  Switched from a plain `<img>` + `filter` to the `Icon` mask component
  (inherits `currentColor` from the button, so the rest/hover color swap
  just works via the button's own `color` style) and added a
  `title="Clear Queue"` tooltip to match. The `#555555`/`#aaaaaa` values
  are a legitimate hardcoded exception (same category as
  `FAVORITE_PINK`/`PLAY_ICON_DARK`) — the old app's button is
  deliberately *not* theme-tinted, always the same flat gray regardless
  of accent color.
- **Row padding is asymmetric**: `14px` left, `8px` right (was a
  symmetric `px-4`/16px both sides).

## Queue panel: row hover halo shape + scrollbar-gutter symmetry

Two more corrections to the same panel:

- **Hover halo now matches the active-row halo's shape** — hover was
  setting `background` directly on the row `<button>` itself (a
  full-bleed rectangle, no inset, no radius), while the active/current
  row uses a separate absolutely-positioned overlay `div` with
  `inset: "1px 8px"` and `rounded-lg` — visually a different shape
  (pill vs. full-width rectangle) for what should read as the same kind
  of highlight. Fixed by giving hover the identical overlay treatment
  (same inset/radius, `var(--hover-bg)` instead of the accent tint),
  gated so a row only ever shows one or the other (`isCurrent`'s accent
  pill takes priority; hovering the current row doesn't also draw a
  second overlay).
- **Scrollbar-gutter asymmetry — the exact issue documented in "Scrollbar
  gutter vs. custom scrollbar width" above.** The queue list was using
  `.scroll-overlay` (reserves `scrollbar-gutter: stable` space, which
  doesn't match our custom 6px scrollbar width), but its rows have
  symmetric padding they care about (`inset: "1px 8px"` on the halo, `8px`
  right-side header padding) — exactly the case that section says needs
  `.scroll-clean` (zero-width scrollbar, no gutter reservation) instead.
  Switched the list container's class; no new pattern needed, just applying
  the one already established for AlbumDetail/other symmetric-padding
  views to this list too.

## Queue rows: favorite heart + clickable multi-artist tokens

Ported from `queue_list.qml:239-283` — both features are real, not
invented (confirmed via research before implementing, per this file's
own established practice).

- **Favorite heart** (`QueueFavoriteHeart`), 16×16, positioned between the
  title/artist column and duration (`favW = 28`, reserved column width
  matching the QML). Filled = `FAVORITE_PINK` (`#E91E63`, the same
  hardcoded non-themed pink used everywhere else favorites appear in this
  app — `_HEART_COLOR` is identical across `tracks_browser.py`,
  `favorites_view.py`, `TrackListView.qml`, `now_playing.qml`,
  `album_detail.qml`, `artist_detail_page.qml`); outline =
  `var(--text-secondary)`. **Hover cue is a `1.15x` scale-up, not a color
  change** — this is why it's its own small component rather than reusing
  `TrackTable.tsx`'s existing `FavoriteHeart` (which does hover→accent
  instead): that component's behavior was already established/accepted
  elsewhere, and changing it to match the queue's different hover
  treatment would have been an unrelated regression to a working part of
  the app just to satisfy code reuse.
- **Artist line uses `ArtistTokens`** (same shared component as
  everywhere else) instead of plain text — multi-artist separation via
  the identical separator regex, per-token click-to-navigate. Passes
  `alwaysAccent={isCurrent}`, matching the QML's "all tokens become
  accentColor when the row is current/playing" (not just on hover, which
  is the token's own default behavior otherwise).
- **Dropped the artist line's extra `opacity: 0.8` baseline dimming**
  (previously applied even to non-past rows, on top of the already-muted
  `--text-secondary` color `ArtistTokens` uses by default) — consistent
  with the broader pattern found repeatedly across this app's other
  components (nav tabs, footer, pagination): an extra opacity fade
  layered on top of an already-secondary color reads as "too dim," not as
  intentional de-emphasis. `isPast` rows still dim as a whole (title +
  artist together, via the wrapping `div`'s opacity), just without that
  additional always-on fade for the artist specifically.
- **No cover art in queue rows** — confirmed explicitly absent in the old
  app too (a comment at the top of `queue_list.qml` notes this
  deliberately, unlike `TrackListView.qml`), so nothing to add there.

## Queue row bugs: fixed-width columns + hover text-invisibility

Exact column widths pulled directly from `queue_list.qml:28-30` (`numW:
32`, `favW: 28`, `durW: 50`) rather than re-derived — the earlier
implementation guessed `38` for the index/grip column and gave duration
no fixed width at all, both wrong:

- **Heart icon appeared to shift position row-to-row** — root cause was
  the duration `<span>` having no fixed width (just `shrink-0` +
  right-padding, sized to its own text content). Since the title/artist
  column is `flex: 1` (absorbs all remaining space) and duration sits
  right after the heart, a wider duration string (`"11:08"` vs `"9:44"`)
  shrank the flex:1 column by a different amount per row, which shifted
  where the *fixed-width* heart column started — the heart itself wasn't
  literally moving, the column before it was resizing per-row. Fixed by
  giving duration an explicit `width: 50` (matching `durW`) so every
  row's flex:1 boundary — and everything after it — lands at the exact
  same x position regardless of the duration text.
- **Index/grip column width corrected `38px → 32px`** (`numW`), matching
  `x: 6; width: numW` exactly.
- **Track text going nearly invisible on hover** — real bug, not a
  contrast/color issue. The hover halo is a `position: absolute` overlay
  `<div>` with no explicit `z-index`, sitting as an early sibling among
  otherwise-static (non-positioned) row content (grip, title, artist,
  heart, duration). Per CSS stacking rules, a positioned element with
  `z-index: auto` paints in its own stacking level **above** static
  in-flow siblings regardless of DOM order — so the halo was painting
  over the row's text, not under it, no matter where it sat in JSX. The
  *active* row's halo happened to look fine only because its fill is a
  15%-opacity accent tint (`color-mix(..., transparent)`), so text stayed
  legible through it by coincidence; the *hover* halo used a fully solid
  `var(--hover-bg)` fill, which genuinely hid the text underneath. Fixed
  by adding `zIndex: -1` to both halos (active and hover) so they always
  paint below the static content layer — this was a latent bug in the
  active state too, just invisible because of that halo's own
  transparency, not something newly introduced by the hover fix.

## Queue panel: right-click context menu

Reuses the exact same shared components as `TrackTable.tsx`'s menu
(`ContextMenu`/`MenuEntry`, `PromptDialog`, `TrackInfoDialog`) — not a new
menu system, just a queue-specific item list wired into `QueuePanel.tsx`
itself, since the two views' backing data/actions differ enough
(`playTrack(track, queue)` vs. TrackTable's sort/filter-aware variants,
`removeFromQueue` vs. nothing to remove) that a forced shared builder
function wasn't worth the coupling.

- **Exact item list, from `queue_panel.py:892-919`** (confirmed via
  research first — a legacy `PlaylistTree`/`QMenu` context menu exists
  elsewhere in the old app with real separators, but it's never mounted
  in any layout; the actual on-screen `QueuePanel._show_context_menu_at`
  is the source of truth): **Play Now → Play Next → Go to Artist → Open
  Album → Start Radio → Add to Playlist ▸ → Get Info → Add/Remove
  Favorites → Remove from Queue.** No "Add to Queue" (already queued,
  doesn't apply) and, importantly, **no separators at all** —
  `ShadowContextMenu` has no `add_separator` method; the grouped look in
  a casual screenshot is just visual spacing, not real dividers. Icons
  are tinted with the theme accent color at runtime for every item except
  Favorites (`color='#E91E63'`) — matches every other context menu in
  this app already.
- **"Open Album"** (`/img/album.png`) — new to this menu, not present in
  `TrackTable.tsx`'s version. Same `api.getAlbum(track.album_id)` +
  `navigateTo({ tab: "albums", album })` pattern already used for album
  navigation elsewhere; disabled when the track has no `album_id`.
- **"Remove from Queue"** (`/img/remove.png`, default accent tint, *not*
  a warning/red color — confirmed the old app doesn't style this specially)
  → new `removeFromQueue(id)` store action, matching `window.py`'s
  `_queue_remove_at` exactly: captures the currently-playing track's id
  before filtering, then re-finds its new index by identity afterward
  (same pattern as `reorderQueue`) — *unless* the removed track was
  itself the one playing, in which case playback stops outright
  (`currentIndex: -1`, pauses/clears `_audio`) rather than trying to
  adopt a different "current" track.
- **No row selection on right-click** — confirmed the queue panel's
  `queue_list.qml` MouseArea just passes that row's own index directly to
  the bridge with no selection/highlight side effect, unlike
  `TrackTable.tsx`'s context menu (which does select the clicked row
  first). Not replicated here since `QueuePanel` doesn't have a
  "selected" concept at all currently (only `isCurrent`/`isPast`), so
  this was already naturally consistent with the source without any
  extra code.

## Submenus flip to the other side when they'd overflow the window

`ContextMenu.tsx`'s submenu (used by "Add to Playlist" everywhere it
appears) always opened to the right (`left: "100%"`) with no viewport
check — fine near the middle of the window, but for a menu opened near
the *right* edge (e.g. the Queue panel, which sits on the right side of
the app) the submenu could render partly or fully behind the window
border. The old app's `ShadowContextMenu.add_submenu`'s `_show()`
(`player/widgets.py`) has exact logic for this that we just hadn't ported
yet:

- **Default**: opens to the right of the trigger, 4px upward overlap
  (`y = trigger top - 4 - PAD`).
- **Flips to the left** of the trigger (`x = tr_left - sub.width() +
  PAD`) if opening right would extend past the window's right edge
  (`x + sub.width() > wr.right() + buf`).
- **Shifts up** (not flipped, just clamped) if opening at the default
  vertical position would extend past the window's bottom edge.

Ported directly: `MenuRow` now measures the submenu's actual rendered
size via a `useLayoutEffect` (same "render once at a default position,
then correct before paint" technique the top-level `ContextMenu` already
uses to clamp itself to the viewport) and picks `left`/`right: "100%"`
dynamically based on whether the trigger's own bounding rect leaves
enough room, plus a vertical offset if the natural position would run
past the bottom. `visibility: hidden` until that first measurement
settles, so there's no flash of the wrong position before the correction
applies — mirrors the parent menu's own `ready` flag exactly.

**Follow-up fix**: the first pass above still didn't flip — the submenu
kept rendering off the right edge regardless of the overflow check. Root
cause was a naming collision between the *semantic* side and the *CSS
property*: the state stored `side: "left" | "right"` meaning "which
visual side the submenu should appear on," but was then used directly as
`[side]: "100%"`. For an absolutely-positioned child, `left: 100%`
anchors off the wrapper's *left* edge and opens the submenu to the
right; `right: 100%` anchors off the right edge and opens it to the
left — the opposite of what the property name suggests. So the
"flip to left" branch was setting `left: "100%"`, which opens rightward —
identical to the default, hence no visible change. Renamed the state
field to `anchor` (the CSS property to set, not the visual side) and
inverted the mapping: overflow-right now sets `anchor: "right"` (CSS
`right: 100%`, opens left), default is `anchor: "left"` (CSS
`left: 100%`, opens right).

## Multi-artist rows: single line everywhere, but the footer spills unclipped

`ArtistTokens` (the shared multi-artist token row used by the Queue panel,
`TrackTable`, `Albums`, `TrackInfoDialog`, and the footer) used
`flex flex-wrap`, so a long artist string (e.g. "Farley Jackmaster Funk &
Jesse Saunders feat. Darryl Pandy") wrapped onto extra lines inside fixed-
height rows. Checked every old-app call site and none of them wrap:

- **Queue rows** (`queue_list.qml:239-263`) and **album grid cards**
  (`album_grid.qml`) render the artist Row inside a `clip: true` Item —
  single line, hard-clipped at the edge, no ellipsis (unlike the title
  above it, which does elide).
- **Footer** (`footer_bar.qml:345-374`) is the one exception: its artist
  Row has *no* `width` and *no* `clip: true` at all — Qt Quick doesn't
  clip children by default, so it's left to spill rightward past the
  narrow `leftBlock` column (`max(160, width*0.19)`) into `centerBlock`'s
  otherwise-empty space above the transport buttons — the same idea as
  `titleLbl`'s spill just above it, only unbounded (the title separately
  clamps its max width to `controlsRow`'s left edge so it can never
  overlap Stop/Shuffle; the artist row has no such clamp).

Ported as: `ArtistTokens` defaults to `overflow: hidden` (single line,
hard-clipped, matching every row/grid call site), plus a new `clip={false}`
prop that switches it to `overflow: visible` for the one call site that
needs to spill — `PlayerBar.tsx`'s artist line, which already sits in a
`min-w-0` column with `overflow: visible` set on both it and its fixed-width
`max(160px, 19%)` parent, so passing `clip={false}` there is enough to let
long artist names spill into the same empty space the title already spills
into, instead of being cut off at the column edge.

**Follow-up fix**: with just `overflow:visible`, the spilled artist name
rendered but the token *after* "feat." wasn't clickable. Root cause: the
row's parent (`min-w-0 flex flex-col`) is a flex column, and its default
`align-items: stretch` forces the artist row's own box to the narrow
left-column width regardless of `overflow`. `overflow:visible` only lets
the *paint* spill past that box — the row's inner flex children (the
token spans) still get flex-shrunk to fit inside that artificially narrow
stretched box, so later tokens end up with a near-zero-width hit box even
though their text visually overflows past it; clicks on the visible text
were landing outside any element's actual box. Fixed by giving the row
`width: "max-content"` and `alignSelf: "flex-start"` (only when
`clip={false}`), which opts it out of stretch entirely so both the row and
its token children size to their natural content width instead of being
squeezed and then overflowing.

**Second follow-up fix**: even with correct sizing, the token after "feat."
still wasn't clickable. Real cause was a stacking/hit-test issue, not
sizing: the center block (`PlayerBar.tsx`'s transport+waveform column,
`flex-1 flex flex-col items-center justify-center`) spans the footer's
full height and starts exactly where the left column's box ends. It has
no background, but a transparent `<div>` still captures pointer events
over its entire box — and being a later DOM sibling of the left column, it
paints (and hit-tests) on top of any artist text spilling in from the left.
Clicks on the spilled "Darryl Pandy" token were landing on this empty
center-block div, not the token underneath it. Fixed with the standard
"hole punch" pattern: `pointerEvents: "none"` on the center block's own
wrapper, `pointerEvents: "auto"` restored on its two actual content rows
(`controlsRow` and the waveform row) so buttons/seeking/the time-toggle
label stay clickable while the empty space around them passes clicks
through to whatever renders underneath.

## Queue panel: Lyrics + Info tabs

The old app's right panel isn't just the queue — `queue_panel.py` has a
52px bottom tab bar (`_TabButton` × 3: Queue/Lyrics/Info) that swaps the
content area between the queue list, `LyricsPanel` (`lyrics_panel.py`), and
`ArtistInfoPanel` (`artist_info_panel.py`), while the header ("Queue" +
position/duration + clear button) stays put across all three tabs. Ported
as `QueueBottomTabs.tsx` (icon 18px + 10px bold label, colors are the old
app's own hardcoded `#555555`/`#aaaaaa`/accent — not theme tokens, matching
the header's existing trash-icon button) plus two new content components,
switched in `QueuePanel.tsx`: all three stay mounted (`display:none` when
inactive, never unmounted) so switching tabs and back doesn't lose
in-flight drag state, the lyrics offset/scroll position, or the artist
bio's expanded state — first tried mounting Lyrics/Info only while active
(to get the old app's "defer fetch until the tab is opened" for free), but
that meant every bit of that panel's own state (offset, scroll, bio
expanded) reset on every tab switch. Settled on both always mounted *and*
deferred fetching: both `LyricsPanel`/`ArtistInfoPanel` take an `active`
prop (`activeTab === "lyrics"/"info"`) and track a `pendingRef` of what's
owed a fetch — a track/artist change while inactive just records the
pending target (and, for Info, still updates the free/no-network artist
page split immediately), and a `useEffect` keyed on `active` flushes it the
moment the tab opens. Matches `queue_lyrics_load`/`_do_load_lyrics` and
`load_track`'s `_pending_load` exactly: LRCLib/NetEase/SimpMusic/
Bandsintown/local-cache calls only ever fire once the user actually opens
that tab, not on every track change.

**Lyrics tab** (`LyricsPanel.tsx`): auto-fetch priority matches
`_LyricsFetcher.run()` exactly — local `.lrc` cache → server (Subsonic
`getLyrics`) → LRCLib direct → LRCLib/NetEase/SimpMusic search (first hit
wins, sequential, not aggregated). The manual "Search" button
(`LyricsSearchDialog.tsx`) is different on purpose: it aggregates *all*
three sources at once so the user can browse/pick, matching
`LyricsSearchDialog` in the old app. LRC parsing (`src/lib/lrc.ts`) ported
from `parse_lrc`: `[mm:ss.xx]` lines → synced line list, anything else →
plain text. Synced highlight is driven by the store's existing `currentTime`
(no separate position-tracking plumbing needed) plus a user-adjustable
±50ms offset; clicking a line seeks via the store's `setCurrentTime` (same
as the old app's `seek_requested`). Save/Remove Local is tracked as its own
`isLocalSaved` flag, deliberately *not* derived from `activeSource` —
matches the old app's `_toolbar.set_save_mode(bool)` being an independent
flag from `_active_source` (removing a local save leaves `_active_source`
as `'Local'` in the old app too; only the save-mode flag flips the button
back to "Save"). Hover-fade toolbar (offset controls + Search/Save/Refresh)
matches `_LyricsToolbar`'s opacity animation.

**Deliberate improvement over the old app**: the manual offset is now
persisted alongside a locally-saved lyrics file instead of always resetting
to 0 per track (the old app's `_offset_ms` was pure session state — there
was nothing to port here, this is new). Stored as an `[offset:±ms]` line
prepended to the saved `.lrc` text (`src/lib/lrc.ts`'s `withOffset`/
`extractOffset`) — a real, if uncommonly-supported, LRC metadata tag, so it
round-trips through `parseLrc` as an ignored line rather than corrupting
sync (`LRC_RE` only matches digit-led time tags). Written on "Save", and
kept in sync on every ±50ms nudge *after* a save exists (`changeOffset`
re-writes the file if `isLocalSaved`) so the persisted copy never drifts
from what's currently on screen.

**Info tab** (`ArtistInfoPanel.tsx`): artist bio + prev/next paging across a
multi-artist string (reuses `ArtistTokens`' `ARTIST_SEP_RE` for the split,
not `artist_info_panel.py`'s own slightly different regex — the old app's
version doesn't handle a bare `" / "` separator, which looks like a mismatch
between its own info panel and every other multi-artist split elsewhere in
that codebase rather than deliberate; standardizing on `ARTIST_SEP_RE`
everywhere in this app is more consistent than reproducing that one
discrepancy). Only the first page carries the track's own known
`artist_id`; later pages resolve by name via `search3`, matching
`_ArtistLookupWorker`. Bio truncates to 240 chars with a "Read more"
toggle. Bandsintown tour dates are opt-in (persisted `bandsintown_enabled`
in localStorage, default off, matching the old app's `QSettings` default),
gated behind an "Enable" card until the user opts in; event rows open their
URL externally via `shell.openExternal` (new `setWindowOpenHandler` in
`electron/main/index.ts` — `window.open`/target=_blank now routes to the OS
browser instead of a new Electron window, the same way the old app's
`webbrowser.open(url)` did).

**Backend** (`electron/main/lyrics.ts`, new): LRCLib/NetEase/SimpMusic/
Bandsintown fetchers run in the main process, not the renderer — none of
those APIs send permissive-enough CORS headers for a renderer-side
`fetch()`, so (like every other network call in this app) they're proxied
through IPC the same way `SubsonicClient` already is. Local lyrics cache
lives under `app.getPath('userData')/lyrics/<trackId>.lrc` (Node `fs`, main
process only) instead of the old app's `app_data/lyrics/` folder next to
the executable. `SubsonicClient.getArtist` now also returns `image_url`
(from `getArtistInfo2`'s image fields) and gained `getServerLyrics` (plain
Subsonic `getLyrics`).

Not ported: a settings screen to toggle which lyrics sources are enabled
(the old app's `lyrics_sources` QSettings) — this app has no Settings
screen yet at all, so all three sources are always enabled; add a toggle
UI if/when one exists.

## Tracks tab and album-detail tracklists shouldn't share column settings

`TrackTable` is one shared component reused by both the main Tracks screen
and the album-detail tracklist, and its column order/widths/visibility/sort
were persisted under flat, unscoped localStorage keys (`tracks_col_order`,
`tracks_col_visibility`, etc.) — a comment even claimed this matched "the
old app's single QSettings namespace." That claim was wrong: the old app
actually keeps a separate namespace *per screen* —
`tracks/col_visibility` (`tracks_browser.py:1976`), `album_detail/col_visibility`
(`albums_browser.py:637`), plus `playlist_detail/col_visibility` and
`favorites/col_visibility` for those screens' own track lists — so toggling
BPM off in one view never touched another's settings.

Fixed by adding a required `viewKey` prop to `TrackTable` that namespaces
all four localStorage keys (`` `${viewKey}_col_order/_widths/_visibility` ``,
plus the already-exported `LS_SORT`, now a `(viewKey) => key` function
instead of a constant). Tracks screen passes `viewKey="tracks"`, album
detail passes `viewKey="album_detail"` — matching the old app's own
grouping. `Tracks.tsx`'s own `sortState` (kept outside `TrackTable` since
that screen is `serverDriven`) uses the same `LS_SORT("tracks")` key.

## Saved login credentials now use OS-backed secret storage

Server URL/username/password were persisted in the renderer's
`localStorage` (`icosahedron_creds`) as **plain JSON** — readable by
anything with filesystem access to the user's profile. The old app never
did this: `login_dialog.py`/`main.py` store url/username in plain
`QSettings` (non-secret), but the password specifically goes through
Python's `keyring` library under service name `"Icosahedron"` — libsecret/
GNOME-Keyring/KWallet on Linux, Windows Credential Manager on Windows,
Keychain on macOS — and only at all if the "Remember my credentials"
checkbox is checked; unchecking it explicitly deletes any previously
saved password (`keyring.delete_password`).

Ported using Electron's `safeStorage` (`electron/main/credentials.ts`,
new) — the built-in equivalent of `keyring`: libsecret on Linux, DPAPI on
Windows, Keychain on macOS, no extra dependency needed. One difference
from `keyring`: `safeStorage` only encrypts/decrypts bytes, it doesn't
persist anything itself, so the ciphertext (base64) lives next to the
plaintext url/username in one JSON file under `app.getPath('userData')/
credentials.json`, rather than two separate stores. `saveCredentials`
refuses to write anything if `safeStorage.isEncryptionAvailable()` is
false (e.g. no secret-service daemon reachable) rather than silently
falling back to plaintext.

`Login.tsx` gained the matching "Remember my credentials" checkbox
(unchecked by default, same as the old app's fresh-install `QCheckBox`
default) — `connect(url, user, pass, remember)` now takes that as a 4th
arg, saving via IPC if checked, explicitly clearing any previously-saved
credentials if not. Auto-connect on launch (`tryAutoConnect` in
`store/index.ts`) changed from reading `localStorage` and re-sending the
plaintext password through the existing `connect` IPC call, to a single
new `try_auto_connect` IPC handler that does the whole thing — decrypt,
construct `SubsonicClient`, ping — entirely inside the main process; the
plaintext password now never crosses back over IPC to the renderer at all
on auto-connect, only a `{url, username}` success result.

One-time migration in `store/index.ts`: earlier builds' plaintext
`localStorage["icosahedron_creds"]` is read once, forwarded into
`saveCredentials` (so an existing "remembered" login keeps working without
forcing a re-login), then deleted — either way, whether or not anything
was there to migrate.

## Tracks tab: Excel-style column filters (Artist/Album/Genre/Year)

Ports `tracks_browser.py`'s `ColumnFilterPopup` + `FilterValuesWorker` +
`_build_server_filters` system — the only four columns that get a funnel
icon are Artist, Album, Genre, Year (`tracks_list.qml`'s
`filterableCols: ["artist","album","year","genre"]`; every other column
sorts via its header but has no value-filter). Full parity, chosen over
simpler alternatives after confirming scope: the popup includes sort-
ascending/descending rows, a clear-filter row, a search box, a "(Select
All)" checklist, cascading values, and the "(Add current selection to
filter)" incremental-merge trick.

**`ColumnFilterPopup.tsx`** (new) — reproduces the old app's slightly
unusual but deliberate search semantics faithfully:
- No active filter → every value starts checked (nothing filtered yet).
- Reopening with an active filter → only the previously-selected values
  start checked *and visible*; unchecked ones stay hidden until searched
  for (classic Excel "here's what's currently selected").
- Typing a search auto-checks every match — narrowing *is* selecting, not
  just hiding. Clicking OK with live search text replaces the filter with
  exactly what's visible, ignoring any manual per-item unchecks made
  while a search is active — this reproduces the old app's `_apply()`
  `elif q:` branch, which doesn't consult individual checkbox state at
  all once there's search text (a real, slightly surprising quirk of the
  original, kept for parity rather than "fixed").
- "(Add current selection to filter)" appears only once there's an
  active filter, live search text, and at least one visible match not
  already in that filter; checking it merges into the existing filter
  instead of replacing it on Apply.
- ">10 selected" warning only for the three ID-based columns (Navidrome's
  native id-list filters have a practical limit the old app warns about);
  Year never shows it.

Implemented declaratively rather than the old app's imperative
show/hide-per-QListWidgetItem approach: `visible` (which values are
shown) and the auto-check-on-search effect are both derived straight from
`search`/`checked`/`hasActiveFilter` on every render, instead of mutating
each list item's hidden/checked flags by hand.

**Cascading values** (`TrackTable.tsx`'s `deriveFilterValues`): once some
*other* column already has an active filter, opening a column's popup
derives its value list from the currently-loaded (already server-
filtered) `tracks` prop instead of the full library-wide list — matches
`_values_from_tree`. Artist splitting reuses `ArtistTokens`' `ARTIST_SEP_RE`
rather than the old app's own separately-defined (and slightly different)
separator list used just for this one case — standardizing on one
separator set beat reproducing that inconsistency, same call made for
`ArtistInfoPanel`'s multi-artist paging split earlier. Genre splitting
reuses this file's own `fmtGenre` separator (`/[;/|,]+/`) rather than
importing yet another separator list for one cascading edge case.

**Server-side filtering** (`electron/main/subsonic.ts`): `getArtistIdMap`/
`getAlbumIdMap`/`getGenreIdMap` (new — `/api/artist`, `/api/album`,
`/api/genre`, matching `get_all_artists_native`/`get_all_albums_native`/
`get_genres_native`) resolve checked display names back to Navidrome's
internal ids; `getTracksNativePage` gained a `filters` param appending
`artist_id`/`album_id`/`genre_id` as repeated query params (Navidrome
treats these as IN-lists) plus a single `year` value. Deliberately did
**not** "fix" year to support multiple values server-side even though the
UI lets you check several — the old app's `_build_server_filters` also
only ever sends one arbitrary year (`next(iter(allowed))`), and unlike
artist/album/genre (confirmed many-valued relations, already sent as
repeated params elsewhere in the old app), there's no evidence Navidrome's
REST filter treats the plain scalar `year` column as an IN-list; guessing
wrong there means silently-broken filtering instead of an honest
limitation.

**`Tracks.tsx`** owns all the state the popup needs but doesn't have
itself (matches the old app keeping filtering server-side-driven, owned by
the *browser*, with the popup as a dumb view): `colFilters` (plain
component state, not persisted — the old app doesn't persist
`_col_filters` across restarts either), the three id-map queries (fetched
eagerly on mount with a long `staleTime`, matching
`_start_filter_values_worker` firing right after the first page loads
rather than lazily on first click), a year-value sample query (up to 500
tracks matching the current search, re-sampled only when the query
changes — matches `invalidate_filter_cache`'s query-only trigger, not
firing on every filter apply), and `serverFilters`/`filterKey` (a
JSON-serialized, sorted representation of `colFilters` for the
`tracks-native` query key — a `Set`-valued object would otherwise just
stringify to `"{}"` and never bust React Query's cache on change). The
refresh button now also invalidates the id-map/year-sample queries
alongside the track list itself.

**Toolbar-level filter controls** (`Tracks.tsx`, added as a follow-up after
initially scoping them out of the popup work): matches `TrackListView.qml`'s
`playFilteredBtn`/`clearFiltersBtn`, visible only while `filtersActive`
(any column filter set) — leftmost, before the track-count text.
- **Play/Shuffle filtered** (`PlayFilteredButton`) is one button with two
  gestures, matching the QML `MouseArea` exactly: click plays the filtered
  set in its current sort order; press-and-hold 600ms shuffles it instead.
  Both fetch the *entire* filtered result set in one request
  (`fetchAllFiltered`, `getTracksNativePage` with `end=total`) — not just
  the current page — matching `_fetch_all_filtered_tracks`, then replace
  the queue and start playing via the store's existing `playTrack(track,
  queue)`, the same mechanism `play_whole_album` uses for a plain list
  (`playlist_data.clear()` + play index 0).
- **Clear filters** (`ToolbarIconButton`) resets `colFilters` to `{}` in
  one click, separate from each popup's own per-column "Clear filter" row.

Both icons are unconditionally accent-tinted (not gray-until-hover like
the popup's own action rows) — matches the QML's
`"image://albumicons/play-button_" + accentColor` /
`"filter_off-2_" + accentColor`, just a 4px hover-highlight background,
no icon color change.

## Favorite/Duration/Plays/No./Year/BPM: centered, not left-aligned

Header label+sort-arrow+filter-icon and the cell content below it were
both left-aligned for every column. `TrackListView.qml`'s header Row has
a `_mid` flag (`dur`/`plays`/`fav`/`trackno`/`year`/`bpm`) that centers
the header group instead, and each of those columns' data-cell `Text`
elements sets `horizontalAlignment: Text.AlignHCenter` — every other
column (Track/Title/Artist/Album/Genre/Date Added) stays left-aligned.
Fixed via a `MID_COLS` set in `TrackTable.tsx`: the header cell's
`justifyContent` switches to `"center"` for these columns, and the body
cell wrapper gets `display:"flex", justifyContent:"center"` added
conditionally (left as a plain block div otherwise, so truncation on the
long text columns isn't affected by turning them into flex containers).

## Album/Genre/Year track-cell values are clickable

Album's cell was already click-to-navigate (`openAlbum`), but had no
hover feedback at all (no color/underline change) unlike every other
clickable text in this app — `TrackListView.qml`'s `albText` does
`color: parent.hov ? accentColor : textSecondary` + an underline
`Rectangle` on hover. Genre and Year weren't clickable at all: the QML's
per-genre-token `MouseArea` calls `trackGenreClicked(genre)` →
`_apply_col_filter(6, {genre})`, and the year cell's `MouseArea` calls
`trackYearClicked(year)` → `_apply_col_filter(5, {year})` — clicking
either applies (replaces) that column's Excel-style filter to just the
clicked value.

Added a shared `HoverToken` (`TrackTable.tsx`) — textSecondary normally,
accent + underline on hover, matching `ArtistToken`/`AlbumLink`'s existing
hover styling — used for all three:
- **Album**: same `openAlbum`/`prefetchAlbum` behavior as before, now with
  the missing hover feedback.
- **Genre**: split into independent tokens, each its own `HoverToken`;
  non-clickable ` • ` separators between them.
- **Year**: the whole cell is one `HoverToken`.

Both genre and year's click-to-filter are gated on `filterableCols`/
`onFilterChange` actually being provided — true only for the Tracks
screen's own `TrackTable`, not the album-detail one, since that host has
no Excel-filter system wired up (matches the old app: `albums_browser.py`'s
bridge implements these same click slots completely differently — they
emit `genre_clicked`/`year_clicked` signals rather than applying a column
filter — a distinct, unrelated behavior this change doesn't attempt to
replicate).

**Follow-up fix**: multi-genre tracks still rendered as one single
clickable blob instead of separate tokens. Root cause — the split regex
(inherited from the now-removed `fmtGenre` formatter) only matched
semicolon/slash/pipe/comma, but Navidrome's native `/api/song` path (what
the Tracks screen actually uses) joins a track's multiple genres with
`" • "` itself (`subsonic.ts`'s `parseNativeTrack`, matching the old app's
own `genreStr.split(/( • )/)`) — a bullet the regex's character class
never included, so "Rock • Pop" never actually split. Standard-API tracks
(album detail) can still carry raw ID3-style delimited genre strings
though, so both shapes need handling. Fixed via one shared `GENRE_SEP_RE`
(`/[;/|,•]+/`, surrounding whitespace stripped by the existing
`.trim()` per part) used by both the render-cell split and
`deriveFilterValues`'s cascading split.

## Settings `ToggleRow`: description text must fit on one line

`ToggleRow`/`ToggleSwitch` (`Settings.tsx`) vertically center the switch
against the whole label+description text block via plain flexbox
`align-items: center` — this looks fine and consistent row-to-row **only**
as long as every row's description wraps to the same number of lines. Two
toggles were added with long descriptions that wrapped to 2 lines (the
Last.fm section's "Show Recently Played", and earlier the Playback tab's
"Scrobble") while every other row in the same section stayed at 1 line —
centering against a taller 2-line block puts the switch at a visibly
different vertical spot relative to the label than the 1-line rows above/
below it, reported twice as the toggle looking "funky"/inconsistent even
though `ToggleSwitch` itself was byte-for-byte identical every time.

**Not a component bug — a copy-length constraint.** Fixed both times by
shortening the description to fit one line at the Settings panel's
`maxWidth: 480` column width, not by changing `ToggleRow`'s layout. When
writing a new toggle description, keep it to roughly the same length as
the shortest existing row in that section (e.g. "Minimize to tray"'s ~74
characters) and sanity-check it doesn't wrap before shipping — a longer
description that genuinely needs two lines would need `ToggleRow` itself
changed (e.g. `align-items: flex-start` with the switch pinned to the
label's own line), which hasn't been done since every row so far has fit
comfortably once trimmed.
