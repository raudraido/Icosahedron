// Central registry of rebindable global keyboard shortcuts — ports the old
// app's components/hotkeys.py HotkeyManager (a QShortcut-backed registry
// loaded from QSettings) to this app's localStorage + native `keydown`
// listening (GlobalHotkeys.tsx) instead of Qt's own shortcut system.

export interface HotkeyDef {
  id: string;
  label: string;
  default: string;
}

export const DEFAULT_HOTKEYS: HotkeyDef[] = [
  { id: "play_pause", label: "Play / Pause",     default: "Space" },
  { id: "seek_back",  label: "Seek Back 5s",      default: "Shift+Left" },
  { id: "seek_fwd",   label: "Seek Forward 5s",   default: "Shift+Right" },
  { id: "prev_track", label: "Previous Track",    default: "Ctrl+Left" },
  { id: "next_track", label: "Next Track",        default: "Ctrl+Right" },
  { id: "nav_back",   label: "Navigate Back",     default: "Alt+Left" },
  { id: "nav_fwd",    label: "Navigate Forward",  default: "Alt+Right" },
  { id: "vol_up",     label: "Volume Up",         default: "Ctrl+Up" },
  { id: "vol_down",   label: "Volume Down",       default: "Ctrl+Down" },
  { id: "mute",       label: "Toggle Mute",       default: "Ctrl+M" },
  { id: "shuffle",    label: "Toggle Shuffle",    default: "Ctrl+S" },
  { id: "repeat",     label: "Toggle Repeat",     default: "Ctrl+R" },
  { id: "spotlight",  label: "Spotlight Search",  default: "Ctrl+F" },
];

const LS_KEY = "icosahedron_hotkeys";
// Fired after a rebind is saved so GlobalHotkeys' already-mounted listener
// picks it up immediately, the same way a Qt QShortcut's setKey() takes
// effect live without recreating the shortcut object.
export const HOTKEYS_CHANGED_EVENT = "icosahedron-hotkeys-changed";

export function loadHotkeyBindings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of DEFAULT_HOTKEYS) out[h.id] = h.default;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) Object.assign(out, JSON.parse(raw));
  } catch { /* best-effort — falls back to defaults */ }
  return out;
}

export function saveHotkeyBindings(bindings: Record<string, string>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(bindings));
  } catch { /* best-effort persistence */ }
  window.dispatchEvent(new Event(HOTKEYS_CHANGED_EVENT));
}

const KEY_ALIASES: Record<string, string> = {
  left: "arrowleft", right: "arrowright", up: "arrowup", down: "arrowdown",
  space: " ", esc: "escape", escape: "escape",
};

function normalizeKeyPart(part: string): string {
  const lower = part.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

function parseBinding(binding: string): { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string } {
  let ctrl = false, shift = false, alt = false, meta = false, key = "";
  for (const part of binding.split("+").map((p) => p.trim()).filter(Boolean)) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") ctrl = true;
    else if (lower === "shift") shift = true;
    else if (lower === "alt") alt = true;
    else if (lower === "meta" || lower === "cmd") meta = true;
    else key = normalizeKeyPart(part);
  }
  return { ctrl, shift, alt, meta, key };
}

// Exact modifier match (not just "at least these") — so e.g. "Ctrl+Left"
// doesn't also fire on Ctrl+Shift+Left, matching QShortcut's own behavior.
export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
  const b = parseBinding(binding);
  if (!b.key) return false;
  return (
    e.key.toLowerCase() === b.key &&
    e.ctrlKey === b.ctrl && e.shiftKey === b.shift && e.altKey === b.alt && e.metaKey === b.meta
  );
}

const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta"]);

// Builds a display binding string ("Ctrl+Shift+F") from a live keydown event
// — backs the Hotkeys settings tab's "press a key" rebind capture. Returns
// null while only a modifier key itself is held (waits for the real key).
export function bindingFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key.toLowerCase())) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push("Meta");
  let label = e.key;
  if (label === " ") label = "Space";
  else if (label === "ArrowLeft") label = "Left";
  else if (label === "ArrowRight") label = "Right";
  else if (label === "ArrowUp") label = "Up";
  else if (label === "ArrowDown") label = "Down";
  else if (label.length === 1) label = label.toUpperCase();
  parts.push(label);
  return parts.join("+");
}
