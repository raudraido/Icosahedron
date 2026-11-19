// The order of the tabs is a synced preference (nav_tab_order), shared by the desktop app and the web app,
// but the two do not have the same tabs: Downloads exists only on the desktop. Each platform shows the tabs it
// knows, in the saved order, and when it saves a new order it must keep the ids it does not know where they
// were. Dropping them made the desktop and the web app undo each other's change forever ("Settings changed on
// another device" came back after every reload).

/**
 * The order to store: `known` (the tabs this platform shows, in the order the user wants) with the ids that
 * were in the stored order but are not known here left in their places.
 * Slots of known ids are filled with `known` in sequence; tabs not in the stored order yet go to the end.
 */
export function mergeNavOrder(stored: unknown, known: readonly string[]): string[] {
  const knownSet = new Set(known);
  const prev = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string") : [];
  const queue = [...new Set(known)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of prev) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (knownSet.has(id)) {
      const next = queue.shift();
      if (next !== undefined) out.push(next);
    } else {
      out.push(id); // an id of another platform: stays where it was
    }
  }
  return [...out, ...queue];
}
