// Quick Connect from the approving side (docs/quick-connect.md): a device with no sign-in shows a
// six-digit code; a signed-in app enters it here and the engine signs that device in.
import { createEngine } from "../platform/engineApi";
import { platform } from "../platform";

const engine = createEngine(() => platform.invoke("sync_auth"));

/** Whether the engine has Quick Connect switched on (QUICK_CONNECT=true). */
export async function quickConnectEnabled(): Promise<boolean> {
  const r = await engine("/quickconnect/enabled");
  if (!r?.ok) return false;
  try { return (await r.json()) === true; } catch { return false; }
}

export interface QuickConnectSettings {
  enabled: boolean;
  /** Only a server administrator can switch it, and not when the server's environment decides (QUICK_CONNECT). */
  canChange: boolean;
  source: "env" | "setting";
}

export async function quickConnectSettings(): Promise<QuickConnectSettings | null> {
  const r = await engine("/quickconnect/settings");
  if (!r?.ok) return null;
  try { return (await r.json()) as QuickConnectSettings; } catch { return null; }
}

/** Switches Quick Connect on the server (administrators only). Returns the new state, or null when refused. */
export async function setQuickConnectEnabled(enabled: boolean): Promise<boolean | null> {
  const r = await engine("/quickconnect/settings", { method: "PUT", body: JSON.stringify({ enabled }) });
  if (!r?.ok) return null;
  try { return ((await r.json()) as { enabled: boolean }).enabled; } catch { return null; }
}

export type AuthorizeResult = "ok" | "unknown" | "already" | "rate" | "offline" | "error";

export async function authorizeQuickConnect(code: string): Promise<AuthorizeResult> {
  const r = await engine("/quickconnect/authorize", { method: "POST", body: JSON.stringify({ code: code.trim() }) });
  if (!r) return "offline";
  if (r.ok) return "ok";
  if (r.status === 404) return "unknown";
  if (r.status === 409) return "already";
  if (r.status === 429) return "rate";
  return "error";
}
