import { useCallback, useEffect, useState } from "react";
import { Laptop, Monitor, Smartphone, Tv, KeyRound } from "lucide-react";
import { Section } from "./SettingsParts";
import { api } from "../lib/api";
import { useStore } from "../store";
import {
  secureIsOn, turnOnSecure, turnOffSecure, listTrustedDevices, removeTrustedDevice, signInHistory, createAppPassword,
  newRecoveryCodes, inviteUser, type TrustedDevice, type HistoryEntry,
} from "../lib/secureSignIn";

// Settings > Sync Server > Secure sign-in (docs/secure-sign-in.md): with it on, a new device must be
// approved by one that is already trusted, so a password alone is not enough.
const button = {
  padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent",
  color: "var(--text-primary)", cursor: "pointer", fontSize: "var(--fs-small)",
} as const;
const input = {
  padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card-bg)",
  color: "var(--text-primary)", fontSize: "var(--fs-secondary)", minWidth: 0,
} as const;
const small = { color: "var(--text-secondary)", fontSize: "var(--fs-small)", lineHeight: 1.5 } as const;
const KIND_ICON: Record<string, typeof Laptop> = { desktop: Monitor, web: Laptop, ios: Smartphone, mobile: Smartphone, tv: Tv, app: KeyRound };

const TURN_ON_ERRORS: Record<string, string> = {
  not_admin: "Only a server administrator can switch this on.",
  navidrome_does_not_trust_engine: "Navidrome does not accept this server yet, so nobody could sign in. Add ND_REVERSEPROXYWHITELIST for the sync server to Navidrome first (docs/deploy-server.md, Secure sign-in).",
  already: "It is already on.",
  offline: "Could not reach the server.",
  error: "Something went wrong.",
};

const RESULTS: Record<string, string> = {
  requested: "asked to sign in", approved: "approved", denied: "denied", "wrong-number": "wrong number, denied", "wrong-password": "wrong password",
  "wrong-recovery-code": "wrong recovery code", "wrong-invite-code": "wrong invite code", "recovery-code": "signed in with a recovery code", invite: "signed in with an invite",
  "quick-connect": "signed in with Quick Connect", "secure-on": "secure sign-in switched on", "secure-off": "secure sign-in switched off",
  "app-password": "app password made", "removed-device": "device removed", "new-recovery-codes": "new recovery codes made",
};

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function Armed({ label, onConfirm, danger = true }: { label: string; onConfirm: () => void; danger?: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      style={{ ...button, ...(armed && danger ? { color: "var(--error)", borderColor: "var(--error)" } : {}) }}
      onClick={() => { if (armed) { onConfirm(); setArmed(false); } else { setArmed(true); setTimeout(() => setArmed(false), 4000); } }}
    >{armed ? "Really? Click again" : label}</button>
  );
}

function CodesBox({ codes, title }: { codes: string[]; title: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
      <div style={{ ...small, marginBottom: 6 }}>{title}</div>
      <pre style={{ margin: 0, color: "var(--text-primary)", fontSize: 13, userSelect: "text" }}>{codes.join("\n")}</pre>
      <button style={{ ...button, marginTop: 8 }} onClick={() => void navigator.clipboard?.writeText(codes.join("\n"))}>Copy</button>
    </div>
  );
}

export function SecureSignInSection() {
  const serverUrl = useStore((s) => s.serverUrl);
  const username = useStore((s) => s.username);
  const activeServerId = useStore((s) => s.activeServerId);
  const servers = useStore((s) => s.servers);
  const [on, setOn] = useState<boolean | null>(null);
  const [admin, setAdmin] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<{ title: string; codes: string[] } | null>(null);
  const [devices, setDevices] = useState<{ list: TrustedDevice[]; current: string | null } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [appName, setAppName] = useState("");
  const [appSecret, setAppSecret] = useState<{ user: string; secret: string } | null>(null);
  const [inviteUser_, setInviteUser] = useState("");
  const [invite, setInvite] = useState<{ user: string; code: string } | null>(null);

  const load = useCallback(async () => {
    const isOn = await secureIsOn();
    setOn(isOn);
    api.usersIsAdmin().then(setAdmin).catch(() => setAdmin(false));
    if (isOn) {
      const d = await listTrustedDevices();
      if (d) setDevices({ list: d.devices, current: d.current });
      setHistory((await signInHistory()).slice(0, 20));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function turnOn() {
    setBusy(true); setMsg("");
    const r = await turnOnSecure();
    if (!r.ok) { setMsg(TURN_ON_ERRORS[r.reason] ?? TURN_ON_ERRORS.error); setBusy(false); return; }
    // This device now signs in with its own secret instead of the password: the old sign-in no longer works.
    try {
      await api.connect(serverUrl, username, r.secret);
      if (activeServerId) {
        const profile = servers.find((p) => p.id === activeServerId);
        await api.saveServer({ id: activeServerId, name: profile?.name ?? new URL(serverUrl).host, url: serverUrl, username, password: r.secret });
      }
    } catch { setMsg("Switched on, but this device could not sign in again. Sign out and sign in (you will be asked to approve)."); }
    setCodes({ title: "Write these recovery codes down and keep them safe. Each works once if you lose every device.", codes: r.recoveryCodes });
    setBusy(false);
    await load();
  }

  if (on === null) return null;

  return (
    <Section title="Secure sign-in">
      <div style={small}>
        {on
          ? "On. A new device must be approved by a device that is already signed in, so knowing the password is not enough."
          : "Off. A password is all it takes to sign in. When you switch this on, every other device asks for approval from this one the next time it signs in."}
      </div>
      {msg && <div style={{ ...small, color: "var(--error)" }}>{msg}</div>}
      {codes && (
        <>
          <CodesBox title={codes.title} codes={codes.codes} />
          <div><button style={button} onClick={() => setCodes(null)}>I have saved them</button></div>
        </>
      )}

      {!on && (
        <div><button style={{ ...button, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={turnOn}>{busy ? "Switching on…" : "Turn on"}</button></div>
      )}

      {on && devices && (
        <>
          <div style={{ ...small, marginTop: 4 }}>Trusted devices</div>
          <div className="flex flex-col" style={{ gap: 6 }}>
            {devices.list.map((d) => {
              const Icon = KIND_ICON[d.appPassword ? "app" : d.kind] ?? Laptop;
              return (
                <div key={d.id} className="flex items-center" style={{ gap: 10, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
                  <Icon size={18} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>
                      {d.name}{d.id === devices.current ? " (this device)" : ""}{d.appPassword ? " · app password" : ""}
                    </div>
                    <div style={small}>Last seen {ago(d.lastSeen)}{d.lastAddress ? ` · ${d.lastAddress}` : ""}</div>
                  </div>
                  <Armed label="Remove" onConfirm={async () => { await removeTrustedDevice(d.id); await load(); }} />
                </div>
              );
            })}
          </div>

          <div style={{ ...small, marginTop: 6 }}>App password: for an app that cannot ask for approval (Symfonium, DSub …). Use it as the password.</div>
          <form className="flex items-center" style={{ gap: 8 }} onSubmit={async (e) => { e.preventDefault(); const r = await createAppPassword(appName.trim() || "App password"); if (r) { setAppSecret(r); setAppName(""); await load(); } }}>
            <input style={{ ...input, width: 200 }} placeholder="Name, e.g. Symfonium" value={appName} onChange={(e) => setAppName(e.target.value)} />
            <button type="submit" style={button}>Create</button>
          </form>
          {appSecret && <CodesBox title={`User name ${appSecret.user}. Shown only now:`} codes={[appSecret.secret]} />}

          <div className="flex" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            <Armed danger={false} label="New recovery codes" onConfirm={async () => { const c = await newRecoveryCodes(); if (c) setCodes({ title: "The old recovery codes no longer work. Keep these safe.", codes: c }); }} />
            {admin && <Armed label="Turn off" onConfirm={async () => { await turnOffSecure(); await load(); }} />}
          </div>

          {admin && (
            <>
              <div style={{ ...small, marginTop: 6 }}>Invite someone: a one-use code for their first device (valid 24 hours). They enter it with their own Navidrome password.</div>
              <form className="flex items-center" style={{ gap: 8 }} onSubmit={async (e) => { e.preventDefault(); const u = inviteUser_.trim(); if (!u) return; const c = await inviteUser(u); if (c) { setInvite({ user: u, code: c }); setInviteUser(""); } }}>
                <input style={{ ...input, width: 200 }} placeholder="User name" value={inviteUser_} onChange={(e) => setInviteUser(e.target.value)} />
                <button type="submit" style={button}>Invite</button>
              </form>
              {invite && <CodesBox title={`Code for ${invite.user}:`} codes={[invite.code]} />}
            </>
          )}

          {history.length > 0 && (
            <>
              <div style={{ ...small, marginTop: 6 }}>Sign-in history</div>
              <div className="flex flex-col" style={{ gap: 2 }}>
                {history.map((h, i) => (
                  <div key={i} style={small}>
                    {ago(h.at)} · {h.device ?? "device"} · {RESULTS[h.result] ?? h.result}{h.address ? ` · ${h.address}` : ""}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Section>
  );
}
