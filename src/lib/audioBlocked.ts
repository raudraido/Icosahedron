import { create } from "zustand";

// Browsers only let a page start sound after the user has touched it (autoplay policy). A page that
// was just reloaded and is then told by another device to play (remote control) is blocked until
// someone clicks in it; this flag lets the UI ask for that click instead of showing "playing" with
// no sound.
export const useAudioBlocked = create<{ blocked: boolean }>(() => ({ blocked: false }));
