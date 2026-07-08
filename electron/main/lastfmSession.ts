import { app, safeStorage } from "electron";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

// Per-server-profile store for the connected Last.fm account — same
// safeStorage (OS keychain-backed) encryption tier as a Navidrome server
// password in credentials.ts, since this key grants write access (scrobble,
// love track, ...) to the user's Last.fm account indefinitely until it's
// revoked. Keyed by the same server profile id credentials.ts's
// ServerProfile uses (falling back to DEFAULT_KEY when there's no saved
// profile at all, e.g. a "connect without remembering" session) — a
// household sharing one Icosahedron install across several Navidrome logins
// gets one independent Last.fm account per server profile instead of a
// single one shared by the whole app. Deliberately its own file rather than
// folded into credentials.ts: this isn't a server profile itself, and the
// two "which account" axes (Navidrome server, Last.fm account) are
// independent concepts that just happen to be keyed the same way here.
//
// The two Settings > Integrations toggles (history/scrobble) live here too,
// not in renderer localStorage — they're meaningless without a connected
// account, so keeping them in the same per-profile record avoids a
// split-brain where the account is scoped per-server but the toggles aren't.

export const DEFAULT_KEY = "default";

interface StoredSession {
  sessionKey: string; // base64-encoded ciphertext from safeStorage.encryptString
  username: string;
  historyEnabled: boolean;
  scrobbleEnabled: boolean;
}

interface StoredData {
  sessions: Record<string, StoredSession>;
}

function dataPath(): string {
  return join(app.getPath("userData"), "lastfm-sessions.json");
}

// Pre-per-profile builds stored a single session under this filename —
// migrated the first time this module loads after upgrading, then removed,
// same pattern as credentials.ts's own migrateLegacy for server profiles.
// Migrated into whichever serverId the *first* post-upgrade call happens to
// be for (falling back to DEFAULT_KEY only if that caller has none) rather
// than always DEFAULT_KEY — in practice that first call is
// tryAutoConnect()'s boot-time hydration for the actual active profile, so
// an already-connected account survives the upgrade under the right key
// instead of silently landing somewhere the UI never looks.
function legacySessionPath(): string {
  return join(app.getPath("userData"), "lastfm-session.json");
}

async function migrateLegacy(migrateIntoKey: string): Promise<StoredData> {
  try {
    const raw = JSON.parse(await readFile(legacySessionPath(), "utf-8")) as { sessionKey: string; username: string };
    const data: StoredData = {
      sessions: { [migrateIntoKey]: { ...raw, historyEnabled: false, scrobbleEnabled: false } },
    };
    await writeData(data);
    await unlink(legacySessionPath()).catch(() => {});
    return data;
  } catch {
    return { sessions: {} };
  }
}

async function readData(migrateIntoKey: string = DEFAULT_KEY): Promise<StoredData> {
  try {
    const raw = JSON.parse(await readFile(dataPath(), "utf-8")) as Partial<StoredData>;
    return { sessions: raw.sessions ?? {} };
  } catch {
    return migrateLegacy(migrateIntoKey);
  }
}

async function writeData(data: StoredData): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(dataPath(), JSON.stringify(data), "utf-8");
}

export async function saveSession(serverId: string, sessionKey: string, username: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS secret storage is unavailable on this system");
  }
  const data = await readData(serverId);
  const encrypted = safeStorage.encryptString(sessionKey).toString("base64");
  data.sessions[serverId] = { sessionKey: encrypted, username, historyEnabled: false, scrobbleEnabled: false };
  await writeData(data);
}

// Reports connection state + toggle prefs for the UI without ever
// decrypting the key.
export async function loadSessionForDisplay(
  serverId: string,
): Promise<{ username: string; historyEnabled: boolean; scrobbleEnabled: boolean } | null> {
  const session = (await readData(serverId)).sessions[serverId];
  if (!session) return null;
  return { username: session.username, historyEnabled: session.historyEnabled, scrobbleEnabled: session.scrobbleEnabled };
}

export async function setToggle(serverId: string, key: "historyEnabled" | "scrobbleEnabled", value: boolean): Promise<void> {
  const data = await readData(serverId);
  const session = data.sessions[serverId];
  if (!session) return; // no-op if not connected — nothing to gate
  session[key] = value;
  await writeData(data);
}

// Internal-only — never exposed directly over IPC, only used by lastfm.ts's
// own scrobble/updateNowPlaying calls inside the main process.
export async function getSessionKey(serverId: string): Promise<string | null> {
  const session = (await readData(serverId)).sessions[serverId];
  if (!session || !safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.decryptString(Buffer.from(session.sessionKey, "base64"));
}

export async function clearSession(serverId: string): Promise<void> {
  const data = await readData(serverId);
  delete data.sessions[serverId];
  await writeData(data);
}
