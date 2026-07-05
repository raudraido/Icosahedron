import { app, safeStorage } from "electron";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

// Matches the old app's login_dialog.py + main.py credential handling:
// url/username are non-secret, so they're stored plainly; the password goes
// through the OS's secure secret store instead of plain QSettings — there
// it was Python's `keyring` (libsecret/GNOME-Keyring/KWallet on Linux,
// Windows Credential Manager on Windows). Electron's `safeStorage` is the
// direct equivalent: libsecret on Linux, DPAPI on Windows, Keychain on
// macOS — same OS-backed encryption-at-rest guarantee, just a different
// binding API. `safeStorage` only encrypts/decrypts bytes, though — unlike
// `keyring` it doesn't persist anything itself, so the ciphertext still
// needs a home; it goes in the same on-disk JSON file as url/username,
// base64-encoded, rather than a second storage mechanism.

interface StoredCreds {
  url: string;
  username: string;
  password: string; // base64-encoded ciphertext from safeStorage.encryptString
}

function credsPath(): string {
  return join(app.getPath("userData"), "credentials.json");
}

export async function saveCredentials(url: string, username: string, password: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    // No OS secret store reachable (e.g. no libsecret/keyring daemon running
    // on this Linux session) — refuse to persist rather than silently
    // falling back to writing the password in plain text.
    throw new Error("OS secret storage is unavailable on this system");
  }
  const encrypted = safeStorage.encryptString(password).toString("base64");
  const dir = join(app.getPath("userData"));
  await mkdir(dir, { recursive: true });
  const data: StoredCreds = { url, username, password: encrypted };
  await writeFile(credsPath(), JSON.stringify(data), "utf-8");
}

export async function loadCredentials(): Promise<{ url: string; username: string; password: string } | null> {
  try {
    const raw = JSON.parse(await readFile(credsPath(), "utf-8")) as StoredCreds;
    if (!safeStorage.isEncryptionAvailable()) return null;
    const password = safeStorage.decryptString(Buffer.from(raw.password, "base64"));
    return { url: raw.url, username: raw.username, password };
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  try {
    await unlink(credsPath());
  } catch {
    // already gone
  }
}
