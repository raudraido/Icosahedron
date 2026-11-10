// The device the playback controls act on (docs/connect.md): null = this device. Kept apart from
// the sync client and the store so both can use it without importing each other.
import { create } from "zustand";
import type { Track } from "./api";

export const useTarget = create<{ targetId: string | null }>(() => ({ targetId: null }));

export const getTargetId = (): string | null => useTarget.getState().targetId;

let bypass = false;
/** Runs `fn` with routing off: commands this device receives act on its own player, whatever it is controlling. */
export function runLocal<T>(fn: () => T): T {
  bypass = true;
  try { return fn(); } finally { bypass = false; }
}

interface TargetRouter {
  play(target: string, tracks: Track[], index: number): void;
  next(target: string, track: Track): void;
  end(target: string, tracks: Track[]): void;
}
let router: TargetRouter | null = null;
export function registerTargetRouter(r: TargetRouter): void { router = r; }

// UI actions (play this, play next, add to queue) call these first: with another device as the
// target they are sent there and return true. The player's own internal steps (auto-advance,
// resume) never go through them.
export function routePlay(tracks: Track[], index: number): boolean {
  const t = getTargetId();
  if (bypass || !t || !router) return false;
  router.play(t, tracks, index);
  return true;
}
export function routeNext(track: Track): boolean {
  const t = getTargetId();
  if (bypass || !t || !router) return false;
  router.next(t, track);
  return true;
}
export function routeEnd(tracks: Track[]): boolean {
  const t = getTargetId();
  if (bypass || !t || !router) return false;
  router.end(t, tracks);
  return true;
}
