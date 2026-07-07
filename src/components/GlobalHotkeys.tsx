import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { loadHotkeyBindings, matchesBinding, HOTKEYS_CHANGED_EVENT } from "../lib/hotkeys";

// App-wide keyboard shortcut dispatcher — ports the old app's
// mixins/keyboard.py eventFilter (the QApplication-level bouncer that both
// ran registered HotkeyManager shortcuts and caught "start typing to search"
// before any other widget saw the key). Bindings are re-read from
// localStorage whenever the Settings > Hotkeys tab saves a rebind, so a
// change takes effect immediately without needing this listener recreated.
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

export function GlobalHotkeys() {
  const bindingsRef = useRef(loadHotkeyBindings());
  const lastVolumeRef = useRef(50);

  useEffect(() => {
    function reload() { bindingsRef.current = loadHotkeyBindings(); }
    window.addEventListener(HOTKEYS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(HOTKEYS_CHANGED_EVENT, reload);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const store = useStore.getState();
      if (store.spotlightOpen) return; // spotlight's own input owns keys while open

      const b = bindingsRef.current;

      if (matchesBinding(e, b.spotlight)) {
        e.preventDefault();
        store.openSpotlight();
        return;
      }

      // Real text inputs elsewhere in the app (search boxes, dialogs, the
      // filter popup) keep normal typing — none of the playback/nav
      // shortcuts below should fire while the user is typing into one.
      const typing = isTypingTarget(e.target);
      if (typing) return;

      if (matchesBinding(e, b.play_pause)) { e.preventDefault(); store.playPause(); return; }
      if (matchesBinding(e, b.next_track)) { e.preventDefault(); store.next(); return; }
      if (matchesBinding(e, b.prev_track)) { e.preventDefault(); store.prev(); return; }
      if (matchesBinding(e, b.seek_back))  { e.preventDefault(); store.setCurrentTime(Math.max(0, store.currentTime - 5)); return; }
      if (matchesBinding(e, b.seek_fwd))   { e.preventDefault(); store.setCurrentTime(Math.min(store.duration, store.currentTime + 5)); return; }
      if (matchesBinding(e, b.nav_back))   { e.preventDefault(); store.navBack(); return; }
      if (matchesBinding(e, b.nav_fwd))    { e.preventDefault(); store.navFwd(); return; }
      if (matchesBinding(e, b.vol_up))     { e.preventDefault(); store.setVolume(Math.min(100, store.volume + 5)); return; }
      if (matchesBinding(e, b.vol_down))   { e.preventDefault(); store.setVolume(Math.max(0, store.volume - 5)); return; }
      if (matchesBinding(e, b.mute)) {
        e.preventDefault();
        if (store.volume > 0) { lastVolumeRef.current = store.volume; store.setVolume(0); }
        else store.setVolume(lastVolumeRef.current || 50);
        return;
      }
      if (matchesBinding(e, b.shuffle)) { e.preventDefault(); store.toggleShuffle(); return; }
      if (matchesBinding(e, b.repeat))  { e.preventDefault(); store.toggleRepeat(); return; }

      // Type-to-search: any single plain printable character with no
      // modifiers held opens Spotlight pre-seeded with it — matches the old
      // app's "start typing" trigger (mixins/keyboard.py's active_widget
      // check), gated the same way on not already being in a text field.
      if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        store.openSpotlight(e.key);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
