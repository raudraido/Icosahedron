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
}

export const DARK: AppTheme = {
  name: "Dark",
  accent:            "#44cfcf",
  panelBg:           "rgb(21,23,29)",
  mainBg:            "rgb(28,30,39)",
  cardBg:            "#232631",
  textPrimary:       "#72a1cd",
  textSecondary:     "#d8f0ee",
  border:            "#232631",
  hoverBg:           "#2c2f3c",
  skeleton:          "#354b5f",
  error:             "#e06c75",
  fontSizeSmall:     11,
  fontSizeSecondary: 13,
  fontSizePrimary:   15,
  fontSizeHeading:   18,
  fontSizeTitle:     24,
  fontSizeHero:      28,
  fontFamily:        "'Inter Variable', system-ui, -apple-system, sans-serif",
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
};

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
}
