// What a Navidrome plugin says about itself (its manifest) in words, and what depends on it.
import type { NdPlugin } from "./api";

export interface JsonSchemaProp { type?: string; title?: string; description?: string; default?: unknown; enum?: unknown[]; items?: unknown }
export interface PluginManifest {
  name?: string; author?: string; description?: string; version?: string; website?: string;
  permissions?: Record<string, any>;
  config?: { schema?: { properties?: Record<string, JsonSchemaProp>; required?: string[] } };
}

export function parseManifest(p: NdPlugin): PluginManifest {
  try { return JSON.parse(p.manifest) as PluginManifest; } catch { return {}; }
}

export function parseConfig(p: NdPlugin): Record<string, unknown> {
  try { const v = p.config ? JSON.parse(p.config) : {}; return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

/** What the plugin is allowed to do, from the permissions its manifest asks for. */
export function permissionLines(m: PluginManifest): string[] {
  const out: string[] = [];
  const perms = m.permissions ?? {};
  if (perms.http) {
    const hosts: string[] = perms.http.requiredHosts ?? [];
    out.push(hosts.includes("*") ? "Reaches any address on the network or the internet" : `Reaches ${hosts.join(", ") || "the internet"}`);
  }
  if (perms.library) out.push(perms.library.filesystem ? "Reads and writes files in your music folders" : "Reads your music library");
  if (perms.users) out.push("Sees your user accounts");
  if (perms.kvstore) out.push(`Keeps its own data (up to ${perms.kvstore.maxSize ?? "a limit"})`);
  if (perms.cache) out.push("Keeps a temporary cache");
  return out;
}

/** Features of Navidrome (and of the apps that use it) that need a plugin to work. */
export interface Feature { id: string; label: string; needs: string; providedBy: string[] }
export const FEATURES: Feature[] = [
  { id: "instant-mix", label: "Instant Mix (similar songs)", needs: "a plugin that suggests similar tracks, such as AudioMuse-AI", providedBy: ["audiomuseai"] },
  { id: "lyrics", label: "Lyrics from plugins", needs: "a lyrics plugin, when Navidrome's lyrics priority lists it", providedBy: ["nd-lyrics"] },
];

/** A plugin known by id: what Navidrome uses it for (the manifest only says what it is). */
const KNOWN: Record<string, string[]> = {
  audiomuseai: ["Instant Mix: the Instant Mix button and similar-song lists use AudioMuse-AI's recommendations"],
  "nd-lyrics": ["Lyrics: songs get their lyrics from here when Navidrome's lyrics priority (ND_LYRICSPRIORITY) lists nd-lyrics"],
};
export function usedFor(p: NdPlugin): string[] {
  return KNOWN[p.id] ?? [];
}

export type FeatureState = "on" | "off" | "missing";
export function featureState(f: Feature, plugins: NdPlugin[]): FeatureState {
  const found = plugins.filter((p) => f.providedBy.includes(p.id));
  if (found.length === 0) return "missing";
  return found.some((p) => p.enabled) ? "on" : "off";
}
