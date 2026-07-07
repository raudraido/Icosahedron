import { api } from "./api";

export interface AppTheme {
  name: string;
  accent: string;
  panelBg: string;
  mainBg: string;
  cardBg: string;
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
  panelBg:           "rgb(21,23,29)",
  mainBg:            "rgb(28,30,39)",
  cardBg:            "#232631",
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
  fontFamily:        "'Inter Variable', system-ui, -apple-system, sans-serif",
  titleBarDark:      true,
};

export const CREAM: AppTheme = {
  name: "Cream",
  accent:            "#9b1720",
  panelBg:           "rgb(222,221,218)",
  mainBg:            "rgb(232,232,232)",
  cardBg:            "#deddda",
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
  fontFamily:        "'Inter Variable', system-ui, -apple-system, sans-serif",
  titleBarDark:      false,
};

// All selectable built-in presets, and the persisted "which one is active"
// choice — used by both App.tsx's boot-time applyTheme call and
// Settings.tsx's Themes tab, so a chosen theme survives a relaunch instead
// of always resetting to CREAM.
export const THEMES: AppTheme[] = [CREAM, DARK];
const LS_THEME_KEY = "icosahedron_theme";
const LS_CUSTOM_THEMES_KEY = "icosahedron_custom_themes";

// User-created presets from the Theme Builder tab (ports the old app's
// theme_builder.py's "Save as Preset", which wrote a themes/<name>.json
// file — this app has no per-file theme store, so they're kept as a single
// localStorage array instead) — layered on top of the two built-ins.
export function loadCustomThemes(): AppTheme[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_THEMES_KEY);
    return raw ? (JSON.parse(raw) as AppTheme[]) : [];
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
  r.style.setProperty("--panel-bg",       t.panelBg);
  r.style.setProperty("--main-bg",        t.mainBg);
  r.style.setProperty("--card-bg",        t.cardBg);
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
