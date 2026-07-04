import { app, BrowserWindow, screen } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const DEFAULTS: Bounds = { width: 1280, height: 800, maximized: false };

function statePath(): string {
  return join(app.getPath("userData"), "window-state.json");
}

function loadState(): Bounds {
  try {
    const raw = JSON.parse(readFileSync(statePath(), "utf8"));
    const display = screen.getPrimaryDisplay().workAreaSize;
    if (raw.width > 0 && raw.height > 0 && raw.width <= display.width * 2 && raw.height <= display.height * 2) {
      return { ...DEFAULTS, ...raw };
    }
  } catch {
    // no saved state yet
  }
  return DEFAULTS;
}

export function applyWindowState(win: BrowserWindow, initial: Bounds): void {
  const save = () => {
    const bounds = win.getBounds();
    const maximized = win.isMaximized();
    try {
      writeFileSync(statePath(), JSON.stringify({ ...bounds, maximized }));
    } catch {
      // best-effort persistence
    }
  };
  if (initial.maximized) win.maximize();
  win.on("close", save);
  win.on("resize", save);
  win.on("move", save);
}

export function loadWindowState(): Bounds {
  return loadState();
}
