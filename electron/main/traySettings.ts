import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Settings > System > Application's "Minimize to tray" / "Exit to tray"
// toggles — persisted the same lightweight way as windowState.ts (a plain
// JSON file in userData, no encryption needed since neither flag is
// sensitive), so the main process still knows their last value on the very
// first 'minimize'/'close' event of a fresh launch, before the renderer has
// had a chance to push anything over IPC.

export interface TraySettings {
  minimizeToTray: boolean;
  exitToTray: boolean;
}

const DEFAULTS: TraySettings = { minimizeToTray: false, exitToTray: false };

function settingsPath(): string {
  return join(app.getPath("userData"), "tray-settings.json");
}

export function loadTraySettings(): TraySettings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf-8")) as Partial<TraySettings>;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveTraySettings(settings: TraySettings): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(settings));
  } catch {
    // best-effort — worst case the toggles reset to off next launch
  }
}
