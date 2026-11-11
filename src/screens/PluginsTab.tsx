import { useCallback, useEffect, useState } from "react";
import { api, type NdPlugin } from "../lib/api";
import { FEATURES, featureState, parseConfig, parseManifest, permissionLines, usedFor, type JsonSchemaProp, type PluginManifest } from "../lib/pluginInfo";
import { Section, ToggleSwitch } from "./SettingsParts";

// Settings → Navidrome plugins: the plugins installed in Navidrome, what needs them, and their settings.
// Navidrome's own native API does the work (administrators only), through the sign-in this app already has.
const input = {
  background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4,
  padding: "6px 8px", fontSize: "var(--fs-secondary)", minWidth: 0,
} as const;
const btn = {
  background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4,
  padding: "4px 10px", cursor: "pointer", fontSize: "var(--fs-secondary)",
} as const;
const small = { color: "var(--text-secondary)", fontSize: "var(--fs-small)", lineHeight: 1.5 } as const;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One setting of a plugin, drawn from its JSON Schema; anything that is not a simple value is edited as JSON. */
function Field({ name, prop, value, onChange }: { name: string; prop: JsonSchemaProp; value: unknown; onChange: (v: unknown) => void }) {
  const label = prop.title || name;
  const secret = /token|secret|password|api.?key/i.test(name);
  let control: React.ReactNode;
  if (prop.type === "boolean") {
    control = <ToggleSwitch checked={value === true} onChange={(v) => onChange(v)} />;
  } else if (Array.isArray(prop.enum) && (prop.type === "string" || prop.type === undefined)) {
    control = (
      <select style={input} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        {prop.enum.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
      </select>
    );
  } else if (prop.type === "number" || prop.type === "integer") {
    control = <input style={{ ...input, width: 120 }} type="number" value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
  } else if (prop.type === "string" || prop.type === undefined) {
    control = <input style={{ ...input, width: "100%" }} type={secret ? "password" : "text"} autoComplete="off" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  } else {
    // arrays and objects: JSON text, kept as text until it parses
    control = <JsonBox value={value} onChange={onChange} />;
  }
  return (
    <div className="flex flex-col" style={{ gap: 3 }}>
      <div className="flex items-center justify-between" style={{ gap: 10 }}>
        <span style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>{label}</span>
        {(prop.type === "boolean") && control}
      </div>
      {prop.description && <span style={small}>{prop.description}</span>}
      {prop.type !== "boolean" && control}
    </div>
  );
}

function JsonBox({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 1));
  const [bad, setBad] = useState(false);
  return (
    <>
      <textarea
        style={{ ...input, width: "100%", minHeight: 60, fontFamily: "monospace" }} value={text}
        onChange={(e) => { setText(e.target.value); try { onChange(JSON.parse(e.target.value)); setBad(false); } catch { setBad(true); } }}
      />
      {bad && <span style={{ ...small, color: "var(--error)" }}>Not valid JSON yet; this is not saved until it is.</span>}
    </>
  );
}

function PluginCard({ p, onChanged }: { p: NdPlugin; onChanged: () => void }) {
  const m: PluginManifest = parseManifest(p);
  const props = m.config?.schema?.properties ?? {};
  const keys = Object.keys(props);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...Object.fromEntries(keys.filter((k) => props[k].default !== undefined).map((k) => [k, props[k].default])), ...parseConfig(p) }));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const perms = permissionLines(m);
  const uses = usedFor(p);

  async function toggle(enabled: boolean) {
    setBusy(true); setNote("");
    try { await api.pluginsUpdate(p.id, { enabled }); onChanged(); }
    catch (e) { setNote(msg(e)); }
    setBusy(false);
  }
  async function save() {
    setBusy(true); setNote("");
    try { await api.pluginsUpdate(p.id, { config: JSON.stringify(values) }); setNote("Saved."); onChanged(); }
    catch (e) { setNote(msg(e)); }
    setBusy(false);
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }} className="flex flex-col">
      <div className="flex items-center justify-between" style={{ gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--text-primary)", fontSize: "var(--fs-primary)", fontWeight: "var(--fw-emphasis)" }}>
            {m.name || p.id} <span style={{ ...small, fontWeight: "normal" }}>{m.version ? `v${m.version}` : ""}{m.author ? ` · ${m.author}` : ""}</span>
          </div>
          {m.description && <div style={small}>{m.description}</div>}
        </div>
        <ToggleSwitch checked={p.enabled} disabled={busy} onChange={toggle} />
      </div>
      {p.lastError && <div style={{ ...small, color: "var(--error)", marginTop: 6 }}>Navidrome says: {p.lastError}</div>}
      {uses.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={small}>What uses it</div>
          {uses.map((u) => <div key={u} style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>• {u}</div>)}
        </div>
      )}
      {perms.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={small}>What it may do</div>
          {perms.map((u) => <div key={u} style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>• {u}</div>)}
        </div>
      )}
      <div className="flex items-center" style={{ gap: 10, marginTop: 10 }}>
        {keys.length > 0 && <button style={btn} onClick={() => setOpen(!open)}>{open ? "Hide settings" : "Settings"}</button>}
        {m.website && <a href={m.website} target="_blank" rel="noreferrer" style={{ ...small, color: "var(--accent)" }}>Website</a>}
        <span style={small}>{p.id}</span>
      </div>
      {open && (
        <div className="flex flex-col" style={{ gap: 12, marginTop: 12 }}>
          {keys.map((k) => <Field key={k} name={k} prop={props[k]} value={values[k]} onChange={(v) => setValues((s) => ({ ...s, [k]: v }))} />)}
          <div className="flex items-center" style={{ gap: 10 }}>
            <button style={{ ...btn, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={save}>Save settings</button>
            {note && <span style={{ ...small, color: note === "Saved." ? "var(--accent)" : "var(--error)" }}>{note}</span>}
          </div>
        </div>
      )}
      {!open && note && <div style={{ ...small, color: "var(--error)", marginTop: 6 }}>{note}</div>}
    </div>
  );
}

export function PluginsTab() {
  const [plugins, setPlugins] = useState<NdPlugin[] | null>(null);
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const isAdmin = await api.usersIsAdmin();
      setAdmin(isAdmin);
      if (isAdmin) setPlugins(await api.pluginsList());
    } catch (e) { setError(msg(e)); setPlugins([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function rescan() {
    setBusy(true);
    try { await api.pluginsRescan(); await load(); } catch (e) { setError(msg(e)); }
    setBusy(false);
  }

  if (admin === false) return <div style={small}>Only a server administrator can see and change the plugins of Navidrome.</div>;
  if (plugins === null) return <div style={small}>Loading…</div>;

  return (
    <div className="flex flex-col" style={{ gap: 18 }}>
      {error && <div style={{ ...small, color: "var(--error)" }}>{error}</div>}

      <Section title="What needs a plugin">
        {FEATURES.map((f) => {
          const st = featureState(f, plugins);
          return (
            <div key={f.id} className="flex items-center justify-between" style={{ gap: 10, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
              <div>
                <div style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>{f.label}</div>
                <div style={small}>Needs {f.needs}.</div>
              </div>
              <span style={{ fontSize: "var(--fs-small)", color: st === "on" ? "var(--accent)" : "var(--text-secondary)" }}>
                {st === "on" ? "Working" : st === "off" ? "Plugin is switched off" : "Plugin not installed"}
              </span>
            </div>
          );
        })}
      </Section>

      <Section title="Installed plugins">
        {plugins.length === 0 && <div style={small}>No plugins are installed in Navidrome (or plugins are switched off in its settings, Plugins.Enabled).</div>}
        {plugins.map((p) => <PluginCard key={p.id + (p.updatedAt ?? "")} p={p} onChanged={() => void load()} />)}
      </Section>

      <Section title="Add a plugin">
        <div style={small}>
          A plugin is a <code>.ndp</code> file from its page (usually the Releases of its GitHub project). Copy it into Navidrome's plugins folder
          (<code>Plugins.Folder</code>, by default <code>plugins</code> in Navidrome's data folder), then press Rescan. Read what it may do first: a plugin runs inside your server.
          Adding one from here, through the sync server, is planned.
        </div>
        <div><button style={{ ...btn, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={rescan}>{busy ? "Looking…" : "Rescan"}</button></div>
      </Section>
    </div>
  );
}
