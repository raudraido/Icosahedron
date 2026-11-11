// Sign-in requests from other devices waiting for this one to approve them (secure sign-in).
import { create } from "zustand";
import { pendingApprovals, type PendingApproval } from "./secureSignIn";

export const useApprovals = create<{ items: PendingApproval[] }>(() => ({ items: [] }));

const seen = new Set<string>();

/** A system notification the first time a request shows up, so it is noticed when the window is behind others. */
function announce(a: PendingApproval): void {
  if (seen.has(a.id)) return;
  seen.add(a.id);
  try {
    if (typeof Notification === "undefined") return;
    const show = () => new Notification("Sign-in attempt", { body: `${a.device.name}${a.address ? ` · ${a.address}` : ""}. Open Icosahedron to approve or deny.`, tag: a.id });
    if (Notification.permission === "granted") show();
    else if (Notification.permission === "default") void Notification.requestPermission().then((p) => { if (p === "granted") show(); });
  } catch { /* notifications are a courtesy */ }
}

export function addApproval(a: PendingApproval): void {
  if (!a?.id || a.expiresAt <= Date.now()) return;
  if (!useApprovals.getState().items.some((x) => x.id === a.id)) useApprovals.setState((s) => ({ items: [...s.items, a] }));
  announce(a);
}

export function removeApproval(id: string): void {
  useApprovals.setState((s) => ({ items: s.items.filter((x) => x.id !== id) }));
}

/** Asks the engine which requests are open (after connecting, and when the window comes back). A server without secure sign-in answers nothing. */
export async function refreshApprovals(): Promise<void> {
  const list = await pendingApprovals();
  useApprovals.setState({ items: list.filter((a) => a.expiresAt > Date.now()) });
  list.forEach(announce);
}
