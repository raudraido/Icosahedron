import { platform } from "../platform";

/**
 * One click plays a row in the track lists (the player queue, a playlist, an album, the artist's popular songs).
 * It is on in the web app first; the desktop app keeps its double-click until the web version is tested.
 * See docs/web.md.
 */
export const CLICK_TO_PLAY = platform.kind !== "electron";
