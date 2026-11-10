// Profile pictures. The sync server (apps/server) keeps one per user; every signed-in user may look at
// anyone's (GET /avatar/<name>) and change only their own (PUT/DELETE /avatar). An <img> cannot send the
// sign-in header, so pictures are fetched here and shown from object URLs.
import { useEffect } from "react";
import { create } from "zustand";
import { platform } from "../platform";
import { createEngine } from "../platform/engineApi";
import { getEngineBase } from "../platform/syncUrl";
import { useStore } from "../store";

const engine = createEngine(() => platform.invoke("sync_auth"));
const RECHECK_MS = 60_000;

interface Entry { url: string | null; etag: string | null; at: number }
const entries = new Map<string, Entry>();
const loading = new Map<string, Promise<void>>();

/** user name -> object URL of the picture, or null when there is none. */
export const useAvatars = create<{ pics: Record<string, string | null> }>(() => ({ pics: {} }));

const show = (user: string, url: string | null) =>
  useAvatars.setState((s) => (s.pics[user] === url ? s : { pics: { ...s.pics, [user]: url } }));

/** Loads (or re-checks, with the ETag) the picture of `user`. Quiet when there is no sync server. */
export function loadAvatar(user: string, force = false): Promise<void> {
  if (!user || !getEngineBase()) return Promise.resolve();
  const have = entries.get(user);
  if (!force && have && Date.now() - have.at < RECHECK_MS) return Promise.resolve();
  const running = loading.get(user);
  if (running) return running;
  const p = (async () => {
    const r = await engine(`/avatar/${encodeURIComponent(user)}`, { headers: have?.etag ? { "if-none-match": have.etag } : {} });
    if (!r) return; // offline: keep what is shown
    if (r.status === 304 && have) { entries.set(user, { ...have, at: Date.now() }); return; }
    if (r.status === 404) {
      if (have?.url) URL.revokeObjectURL(have.url);
      entries.set(user, { url: null, etag: null, at: Date.now() });
      show(user, null);
      return;
    }
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    if (have?.url) URL.revokeObjectURL(have.url);
    entries.set(user, { url, etag: r.headers.get("etag"), at: Date.now() });
    show(user, url);
  })().finally(() => loading.delete(user));
  loading.set(user, p);
  return p;
}

/** The picture of `user` (null: none, or not known yet); fetched on first use. */
export function useAvatar(user: string): string | null {
  const url = useAvatars((s) => s.pics[user] ?? null);
  useEffect(() => { void loadAvatar(user); }, [user]);
  return url;
}

/** A square crop of `file`, 256 px, as JPEG: pictures stay small (about 30 kB). */
async function shrink(file: Blob, side = 256): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, side, side);
  bmp.close();
  const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  if (!out) throw new Error("That picture could not be used");
  return out;
}

/** Sets the signed-in user's picture. Throws a message for the user when it does not work. */
export async function setMyAvatar(file: Blob): Promise<void> {
  const me = useStore.getState().username;
  const body = await shrink(file).catch(() => { throw new Error("That picture could not be used"); });
  const r = await engine("/avatar", { method: "PUT", headers: { "content-type": "image/jpeg" }, body });
  if (!r) throw new Error("Could not reach the sync server");
  if (r.status === 404) throw new Error("The sync server needs updating (0.16.3 or newer)");
  if (r.status !== 204) throw new Error("The server did not accept the picture");
  await loadAvatar(me, true);
}

export async function removeMyAvatar(): Promise<void> {
  const me = useStore.getState().username;
  await engine("/avatar", { method: "DELETE" });
  await loadAvatar(me, true);
}

/** Pick an image file from the system. Resolves null when the dialog is dismissed. */
export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
