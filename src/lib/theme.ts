import { api } from "./api";

export interface AppTheme {
  name: string;
  accent: string;
  /** Left nav panel's own background (LeftPanel.tsx), also the catch-all
   *  "chrome surface" color for everything that isn't specifically the
   *  right/footer/header panel (tooltips, dialogs, the game-widget overlays,
   *  the login screen, etc.) — this replaced the single `panelBg` field
   *  those all used to share; shipped themes below give it that field's old
   *  value so nothing's appearance changed in the split. */
  leftPanelBg: string;
  /** Right queue panel's own background (QueuePanel.tsx) — same split as
   *  leftPanelBg above, defaulted to the old `panelBg` value it already
   *  rendered. */
  rightPanelBg: string;
  /** Bottom player bar's own background (PlayerBar.tsx) — same split as
   *  leftPanelBg above, defaulted to the old `panelBg` value it already
   *  rendered. */
  footerBg: string;
  /** Top tab-bar header's own background (App.tsx) — previously had no
   *  explicit background of its own and just showed `mainBg` through from
   *  its container, so shipped themes below default it to their `mainBg`
   *  value (not the old `panelBg`) to keep today's actual rendered color
   *  unchanged. */
  headerBg: string;
  mainBg: string;
  cardBg: string;
  /** Background box behind the title/artist/meta text under a grid card's
   *  cover art (Albums/Playlists/Artists/ForYou/Starred's `.grid-card`) —
   *  its own field rather than reusing cardBg so it can be toggled
   *  independently (e.g. transparent) without also affecting other card
   *  surfaces like queue/context-menu popovers. */
  gridCardTextBg: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  hoverBg: string;
  skeleton: string;
  error: string;
  fontSizeSmall: number;
  fontSizeSecondary: number;
  fontSizePrimary: number;
  fontSizeHeading: number;
  fontSizeTitle: number;
  fontSizeHero: number;
  // One weight per size tier (replaces what used to be ~100 individually
  // hardcoded `fontWeight: ...` values scattered across every screen/
  // component), plus a separate `fontWeightEmphasis` for text that's meant
  // to stand out regardless of its size tier — a track title, an active/
  // current-track row, a button label. Without that second value, "Primary"
  // text could never look bolder than other "Primary" text, which the old
  // hardcoded styles very much relied on (e.g. a queue row's title at 700
  // next to a same-size menu item at 400).
  fontWeightSmall: number;
  fontWeightSecondary: number;
  fontWeightPrimary: number;
  fontWeightHeading: number;
  fontWeightTitle: number;
  fontWeightHero: number;
  fontWeightEmphasis: number;
  fontFamily: string;
  /** Native OS window-frame/titlebar dark mode — ports the old app's
   *  enable_dark_title_bar, which independently toggled the *system*
   *  titlebar (Qt's own chrome had no theme awareness) based on whether
   *  the panel background was dark or light. Explicit per-theme rather
   *  than derived from mainBg's luminance, so a custom Theme Builder
   *  preset can pick either regardless of its background color. */
  titleBarDark: boolean;
}

export const DARK: AppTheme = {
  name: "Dark",
  accent:            "#44cfcf",
  leftPanelBg:       "rgb(21,23,29)",
  rightPanelBg:      "rgb(21,23,29)",
  footerBg:          "rgb(21,23,29)",
  headerBg:          "rgb(28,30,39)",
  mainBg:            "rgb(28,30,39)",
  cardBg:            "#232631",
  gridCardTextBg:    "#232631",
  textPrimary:       "#72a1cd",
  textSecondary:     "#a3bdba",
  border:            "#232631",
  hoverBg:           "#2c2f3c",
  skeleton:          "#354b5f",
  error:             "#e06c75",
  fontSizeSmall:     11,
  fontSizeSecondary: 12,
  fontSizePrimary:   14,
  fontSizeHeading:   18,
  fontSizeTitle:     24,
  fontSizeHero:      28,
  fontWeightSmall:     400,
  fontWeightSecondary: 400,
  fontWeightPrimary:   400,
  fontWeightHeading:   400,
  fontWeightTitle:     400,
  fontWeightHero:      400,
  fontWeightEmphasis:  700,
  fontFamily:        "'Inter Variable', 'Noto Sans'",
  titleBarDark:      true,
};

export const CREAM: AppTheme = {
  name: "Cream",
  accent:            "#9b1720",
  leftPanelBg:       "rgb(222,221,218)",
  rightPanelBg:      "rgb(222,221,218)",
  footerBg:          "rgb(222,221,218)",
  headerBg:          "rgb(232,232,232)",
  mainBg:            "rgb(232,232,232)",
  cardBg:            "#deddda",
  gridCardTextBg:    "#deddda",
  textPrimary:       "#63452c",
  textSecondary:     "#525563",
  border:            "#dcd5c5",
  hoverBg:           "#d5d1c6",
  skeleton:          "#deddda",
  error:             "#c0392b",
  fontSizeSmall:     11,
  fontSizeSecondary: 12,
  fontSizePrimary:   14,
  fontSizeHeading:   17,
  fontSizeTitle:     22,
  fontSizeHero:      26,
  fontWeightSmall:     400,
  fontWeightSecondary: 400,
  fontWeightPrimary:   400,
  fontWeightHeading:   400,
  fontWeightTitle:     400,
  fontWeightHero:      400,
  fontWeightEmphasis:  700,
  fontFamily:        "'Inter Variable', 'Noto Sans'",
  titleBarDark:      false,
};

export const SAND: AppTheme = {
  name: "Sand",
  accent:            "#c17f3e",
  leftPanelBg:       "rgb(230,220,180)",
  rightPanelBg:      "rgb(230,220,180)",
  footerBg:          "rgb(230,220,180)",
  headerBg:          "rgb(238,230,196)",
  mainBg:            "rgb(238,230,196)",
  cardBg:            "#e6dcb4",
  gridCardTextBg:    "#e6dcb4",
  textPrimary:       "#4a3c28",
  textSecondary:     "#7a6a4e",
  border:            "#d8c9a0",
  hoverBg:           "#ddd0a0",
  skeleton:          "#e6dcb4",
  error:             "#b23a2e",
  fontSizeSmall:     11,
  fontSizeSecondary: 12,
  fontSizePrimary:   14,
  fontSizeHeading:   17,
  fontSizeTitle:     22,
  fontSizeHero:      26,
  fontWeightSmall:     400,
  fontWeightSecondary: 400,
  fontWeightPrimary:   400,
  fontWeightHeading:   400,
  fontWeightTitle:     400,
  fontWeightHero:      400,
  fontWeightEmphasis:  700,
  fontFamily:        "'Inter Variable', 'Noto Sans'",
  titleBarDark:      false,
};

export const GREED: AppTheme = {
  name: "Greed",
  accent:            "#1ed760",
  leftPanelBg:       "rgb(10,10,10)",
  rightPanelBg:      "rgb(10,10,10)",
  footerBg:          "rgb(10,10,10)",
  headerBg:          "rgb(20,20,20)",
  mainBg:            "rgb(20,20,20)",
  cardBg:            "#181818",
  gridCardTextBg:    "#181818",
  textPrimary:       "#ffffff",
  textSecondary:     "#707474",
  border:            "#171c18",
  hoverBg:           "#2a2a2a",
  skeleton:          "#4e4b4b",
  error:             "#c0392b",
  fontSizeSmall:     12,
  fontSizeSecondary: 13,
  fontSizePrimary:   15,
  fontSizeHeading:   17,
  fontSizeTitle:     22,
  fontSizeHero:      26,
  fontWeightSmall:     400,
  fontWeightSecondary: 400,
  fontWeightPrimary:   400,
  fontWeightHeading:   400,
  fontWeightTitle:     400,
  fontWeightHero:      400,
  fontWeightEmphasis:  500,
  fontFamily:        "'Inter Variable', 'Noto Sans'",
  titleBarDark:      true,
};

// All selectable built-in presets, and the persisted "which one is active"
// choice — used by both App.tsx's boot-time applyTheme call and
// Settings.tsx's Themes tab, so a chosen theme survives a relaunch instead
// of always resetting to CREAM.
export const THEMES: AppTheme[] = [CREAM, DARK, GREED, SAND];
const LS_THEME_KEY = "icosahedron_theme";
const LS_CUSTOM_THEMES_KEY = "icosahedron_custom_themes";

// User-created presets from the Theme Builder tab (ports the old app's
// theme_builder.py's "Save as Preset", which wrote a themes/<name>.json
// file — this app has no per-file theme store, so they're kept as a single
// localStorage array instead) — layered on top of the two built-ins.
// Backfills leftPanelBg/rightPanelBg/footerBg/headerBg on presets saved
// before those fields existed (and before the single `panelBg` field they
// replaced was removed) — otherwise ColorDial/applyTheme would receive
// `undefined` for a custom theme created pre-split. Matches what each field
// actually rendered as before the split: left/right/footer panels showed the
// old single `panelBg`, while the header (no explicit background of its own)
// showed `mainBg` through from its container. `panelBg` itself is read off
// the raw parsed JSON, not AppTheme, since the field no longer exists on the
// type but may still be sitting in localStorage from before this migration.
function withPanelBgDefaults(raw: AppTheme & { panelBg?: string }): AppTheme {
  const { panelBg, ...t } = raw;
  return {
    ...t,
    leftPanelBg:  t.leftPanelBg  ?? panelBg,
    rightPanelBg: t.rightPanelBg ?? panelBg,
    footerBg:     t.footerBg     ?? panelBg,
    headerBg:     t.headerBg     ?? t.mainBg,
    // Same backfill for a preset saved before gridCardTextBg existed —
    // otherwise ColorDial/applyTheme would receive undefined for it.
    gridCardTextBg: t.gridCardTextBg ?? t.cardBg,
  };
}

export function loadCustomThemes(): AppTheme[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_THEMES_KEY);
    return raw ? (JSON.parse(raw) as (AppTheme & { panelBg?: string })[]).map(withPanelBgDefaults) : [];
  } catch {
    return [];
  }
}

// The two shipped presets are plain hardcoded constants, never read back
// from or written to localStorage — there is no code path that can rename,
// restyle, or delete them. This check exists only to stop a custom preset
// from being *saved under the same name* (which would otherwise sit
// alongside — not replace — the real one, showing two confusingly identical
// "Cream"/"Dark" cards in the Themes tab).
export function isBuiltInThemeName(name: string): boolean {
  return THEMES.some((t) => t.name.toLowerCase() === name.trim().toLowerCase());
}

export function saveCustomTheme(t: AppTheme) {
  if (isBuiltInThemeName(t.name)) return; // see isBuiltInThemeName — refuse the collision instead of shadowing a built-in
  const next = [...loadCustomThemes().filter((c) => c.name !== t.name), t];
  localStorage.setItem(LS_CUSTOM_THEMES_KEY, JSON.stringify(next));
}

export function deleteCustomTheme(name: string) {
  const next = loadCustomThemes().filter((c) => c.name !== name);
  localStorage.setItem(LS_CUSTOM_THEMES_KEY, JSON.stringify(next));
}

export function allThemes(): AppTheme[] {
  return [...THEMES, ...loadCustomThemes()];
}

export function loadSavedTheme(): AppTheme {
  const saved = localStorage.getItem(LS_THEME_KEY);
  return allThemes().find((t) => t.name === saved) ?? CREAM;
}

export function saveTheme(t: AppTheme) {
  localStorage.setItem(LS_THEME_KEY, t.name);
}

// Fixed colors that intentionally do NOT vary with the theme — matches the
// old app's own hardcoded choices (e.g. album_detail.qml's
// "heart_filled_E91E63", album_grid.qml's Canvas play-triangle "#111").
// Use these named constants instead of repeating the literal.
export const FAVORITE_PINK = "#E91E63";
export const PLAY_ICON_DARK = "#111";

export function applyTheme(t: AppTheme) {
  const r = document.documentElement;
  r.style.setProperty("--accent",         t.accent);
  r.style.setProperty("--left-panel-bg",  t.leftPanelBg);
  r.style.setProperty("--right-panel-bg", t.rightPanelBg);
  r.style.setProperty("--footer-bg",      t.footerBg);
  r.style.setProperty("--header-bg",      t.headerBg);
  r.style.setProperty("--main-bg",        t.mainBg);
  r.style.setProperty("--card-bg",        t.cardBg);
  r.style.setProperty("--grid-card-text-bg", t.gridCardTextBg);
  r.style.setProperty("--text-primary",   t.textPrimary);
  r.style.setProperty("--text-secondary", t.textSecondary);
  r.style.setProperty("--border",         t.border);
  r.style.setProperty("--hover-bg",       t.hoverBg);
  r.style.setProperty("--skeleton",       t.skeleton);
  r.style.setProperty("--error",          t.error);
  r.style.setProperty("--font-family",    t.fontFamily);
  // Size scale
  r.style.setProperty("--fs-small",       t.fontSizeSmall     + "px");
  r.style.setProperty("--fs-secondary",   t.fontSizeSecondary + "px");
  r.style.setProperty("--fs-primary",     t.fontSizePrimary   + "px");
  r.style.setProperty("--fs-heading",     t.fontSizeHeading   + "px");
  r.style.setProperty("--fs-title",       t.fontSizeTitle     + "px");
  r.style.setProperty("--fs-hero",        t.fontSizeHero      + "px");
  // Weight scale
  r.style.setProperty("--fw-small",       String(t.fontWeightSmall));
  r.style.setProperty("--fw-secondary",   String(t.fontWeightSecondary));
  r.style.setProperty("--fw-primary",     String(t.fontWeightPrimary));
  r.style.setProperty("--fw-heading",     String(t.fontWeightHeading));
  r.style.setProperty("--fw-title",       String(t.fontWeightTitle));
  r.style.setProperty("--fw-hero",        String(t.fontWeightHero));
  r.style.setProperty("--fw-emphasis",    String(t.fontWeightEmphasis));
  // Wire Tailwind text-* utilities to the live theme scale
  r.style.setProperty("--text-xs",        t.fontSizeSmall     + "px");
  r.style.setProperty("--text-sm",        t.fontSizeSecondary + "px");
  r.style.setProperty("--text-base",      t.fontSizePrimary   + "px");
  r.style.setProperty("--text-lg",        t.fontSizeHeading   + "px");
  r.style.setProperty("--text-xl",        t.fontSizeHeading   + "px");
  r.style.setProperty("--text-2xl",       t.fontSizeTitle     + "px");
  r.style.setProperty("--text-3xl",       t.fontSizeHero      + "px");

  // Guarded like the old app's _last_title_bar_dark — applyTheme() can fire
  // on every single Theme Builder dial tweak, but the native titlebar only
  // needs touching when the dark/light flag itself actually changes.
  if (lastTitleBarDark !== t.titleBarDark) {
    lastTitleBarDark = t.titleBarDark;
    api.setWindowTheme(t.titleBarDark);
  }
}
let lastTitleBarDark: boolean | null = null;
