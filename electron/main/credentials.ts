import { app, safeStorage } from "electron";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Multi-server credential store. Extends the original single-profile design
// (OS-backed safeStorage encryption for the password, plain JSON for
// everything else — libsecret/DPAPI/Keychain, matching the old app's
// `keyring` usage) to a *list* of named server profiles plus which one is
// "active" — used both for auto-connect on next launch and as the default
// selection in Settings > Servers. url/username/name stay non-secret plain
// JSON; only the password ever goes through safeStorage.

export interface ServerProfile {
  id: string;
  name: string;
  url: string;
  username: string;
  /** Selected Subsonic music folders (Navidrome libraries) to browse —
   *  empty means all libraries. Set from Settings > Servers, applied by
   *  SubsonicClient as `musicFolderId`/`library_id` on list endpoints. */
  musicFolderIds: string[];
  /** Display names matching musicFolderIds — stored alongside the ids so
   *  the Servers list can label non-active servers without connecting. */
  musicFolderNames: string[];
}

interface StoredProfile extends ServerProfile {
  password: string; // base64-encoded ciphertext from safeStorage.encryptString
}

interface StoredData {
  servers: StoredProfile[];
  activeServerId: string | null;
}

function dataPath(): string {
  return join(app.getPath("userData"), "servers.json");
}

// Pre-multi-server builds stored a single profile under this filename —
// migrated into the new list format (as the sole, active entry) the first
// time this module loads after upgrading, then removed.
function legacyCredsPath(): string {
  return join(app.getPath("userData"), "credentials.json");
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function migrateLegacy(): Promise<StoredData> {
  try {
    const raw = JSON.parse(await readFile(legacyCredsPath(), "utf-8")) as {
      url: string; username: string; password: string;
    };
    const profile: StoredProfile = {
      id: randomUUID(), name: hostLabel(raw.url), url: raw.url, username: raw.username, password: raw.password,
    };
    const data: StoredData = { servers: [profile], activeServerId: profile.id };
    await writeData(data);
    await unlink(legacyCredsPath()).catch(() => {});
    return data;
  } catch {
    return { servers: [], activeServerId: null };
  }
}

async function readData(): Promise<StoredData> {
  try {
    const raw = JSON.parse(await readFile(dataPath(), "utf-8")) as Partial<StoredData>;
    return { servers: raw.servers ?? [], activeServerId: raw.activeServerId ?? null };
  } catch {
    return migrateLegacy();
  }
}

async function writeData(data: StoredData): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(dataPath(), JSON.stringify(data), "utf-8");
}

// Migration note: one release stored a single `musicFolderId`/`musicFolderName`
// pair; fold that into today's arrays when reading an old profile.
function folderIdsOf(p: StoredProfile): string[] {
  if (Array.isArray(p.musicFolderIds)) return p.musicFolderIds;
  const legacy = (p as unknown as { musicFolderId?: string | null }).musicFolderId;
  return legacy ? [legacy] : [];
}
function folderNamesOf(p: StoredProfile): string[] {
  if (Array.isArray(p.musicFolderNames)) return p.musicFolderNames;
  const legacy = (p as unknown as { musicFolderName?: string | null }).musicFolderName;
  return legacy ? [legacy] : [];
}

function toPublic(p: StoredProfile): ServerProfile {
  return {
    id: p.id, name: p.name, url: p.url, username: p.username,
    musicFolderIds: folderIdsOf(p), musicFolderNames: folderNamesOf(p),
  };
}

export async function listServers(): Promise<ServerProfile[]> {
  return (await readData()).servers.map(toPublic);
}

export async function getActiveServerId(): Promise<string | null> {
  return (await readData()).activeServerId;
}

export async function setActiveServerId(id: string | null): Promise<void> {
  const data = await readData();
  data.activeServerId = id;
  await writeData(data);
}

// Upserts by id (existing profile, e.g. editing credentials) or creates a
// new one when no id is given — same encryption guarantee as the old
// single-slot saveCredentials, just keyed into a list instead.
export async function saveServer(input: {
  id?: string; name: string; url: string; username: string; password: string;
}): Promise<ServerProfile> {
  if (!safeStorage.isEncryptionAvailable()) {
    // No OS secret store reachable (e.g. no libsecret/keyring daemon running
    // on this Linux session) — refuse to persist rather than silently
    // falling back to writing the password in plain text.
    throw new Error("OS secret storage is unavailable on this system");
  }
  const data = await readData();
  const encrypted = safeStorage.encryptString(input.password).toString("base64");
  const id = input.id ?? randomUUID();
  const existing = data.servers.find((s) => s.id === id);
  const profile: StoredProfile = {
    id, name: input.name, url: input.url, username: input.username, password: encrypted,
    musicFolderIds: existing ? folderIdsOf(existing) : [],
    musicFolderNames: existing ? folderNamesOf(existing) : [],
  };
  data.servers = [...data.servers.filter((s) => s.id !== id), profile];
  await writeData(data);
  return toPublic(profile);
}

/** Persist the library (music folder) selection for one saved server —
 *  empty arrays mean "all libraries". */
export async function updateServerLibrary(id: string, folderIds: string[], folderNames: string[]): Promise<void> {
  const data = await readData();
  const profile = data.servers.find((s) => s.id === id);
  if (!profile) throw new Error("unknown server id");
  profile.musicFolderIds = folderIds;
  profile.musicFolderNames = folderNames;
  await writeData(data);
}

export async function deleteServer(id: string): Promise<void> {
  const data = await readData();
  data.servers = data.servers.filter((s) => s.id !== id);
  if (data.activeServerId === id) data.activeServerId = null;
  await writeData(data);
}

export async function loadServerCredentials(id: string): Promise<{ url: string; username: string; password: string; musicFolderIds: string[] } | null> {
  const profile = (await readData()).servers.find((s) => s.id === id);
  if (!profile) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  const password = safeStorage.decryptString(Buffer.from(profile.password, "base64"));
  return { url: profile.url, username: profile.username, password, musicFolderIds: folderIdsOf(profile) };
}
