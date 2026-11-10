import { useCallback, useEffect, useState } from "react";
import { api, type NdUser } from "../lib/api";
import { useStore } from "../store";
import { Avatar } from "../components/Avatar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Section } from "./SettingsParts";

// Settings → Users: administrators list, create, promote, reset the password of and delete accounts.
// The accounts are Navidrome's; the sign-in this app already has (the native API's token) does the work.
const input = {
  background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4,
  padding: "6px 8px", fontSize: "var(--fs-secondary)", minWidth: 0,
} as const;
const btn = (danger = false) => ({
  background: "transparent", color: danger ? "var(--error)" : "var(--text-primary)", border: `1px solid ${danger ? "var(--error)" : "var(--border)"}`,
  borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: "var(--fs-secondary)",
}) as const;
const primary = {
  background: "var(--accent)", color: "white", border: "none", borderRadius: 4, padding: "7px 16px", cursor: "pointer",
  fontSize: "var(--fs-secondary)", fontWeight: "var(--fw-emphasis)",
} as const;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function seen(u: NdUser): string {
  const t = u.lastAccessAt || u.lastLoginAt;
  if (!t) return "never signed in";
  const d = new Date(t);
  return Number.isNaN(d.getTime()) || d.getFullYear() < 2000 ? "never signed in" : `last seen ${d.toLocaleDateString()}`;
}

export function UsersTab() {
  const me = useStore((s) => s.username);
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<NdUser[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<NdUser | null>(null);

  const reload = useCallback(async () => {
    try { setUsers(await api.usersList()); setError(""); } catch (e) { setError(msg(e)); }
  }, []);

  useEffect(() => {
    api.usersIsAdmin().then(setAdmin, () => setAdmin(false));
  }, []);
  useEffect(() => { if (admin) void reload(); }, [admin, reload]);

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try { await fn(); await reload(); } catch (e) { setError(msg(e)); }
  }

  if (admin === null) return null;
  if (!admin) {
    return (
      <div style={{ maxWidth: 480, color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
        Only a server administrator can manage users. Ask the administrator of your Navidrome server.
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 24, maxWidth: 560 }}>
      <Section title="Users">
        {error && <div style={{ color: "var(--error)", fontSize: "var(--fs-secondary)" }}>{error}</div>}
        {users.map((u) => {
          const self = u.userName === me;
          return (
            <div key={u.id} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
              <div className="flex items-center" style={{ gap: 12 }}>
                <Avatar user={u.userName} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ color: "var(--text-primary)", fontWeight: "var(--fw-emphasis)", fontSize: "var(--fs-secondary)" }}>
                    {u.name && u.name !== u.userName ? `${u.name} (${u.userName})` : u.userName}
                    {self ? " · you" : ""}
                  </div>
                  <div className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-small)" }}>
                    {u.isAdmin ? "Administrator" : "User"} · {seen(u)}
                  </div>
                </div>
                <button style={btn()} onClick={() => setResetFor(resetFor === u.id ? null : u.id)}>Password</button>
                <button style={btn()} disabled={self} title={self ? "You cannot change your own role" : ""}
                  onClick={() => run(() => api.usersUpdate(u.id, { isAdmin: !u.isAdmin }, u))}>
                  {u.isAdmin ? "Make user" : "Make admin"}
                </button>
                <button style={btn(true)} disabled={self} title={self ? "You cannot delete yourself" : ""} onClick={() => setDeleteFor(u)}>Delete</button>
              </div>
              {resetFor === u.id && (
                <PasswordForm
                  label={`New password for ${u.userName}`}
                  onCancel={() => setResetFor(null)}
                  onSave={(password) => run(async () => { await api.usersUpdate(u.id, { password }, u); setResetFor(null); })}
                />
              )}
            </div>
          );
        })}
        {!adding ? (
          <button style={{ ...primary, alignSelf: "flex-start", marginTop: 6 }} onClick={() => setAdding(true)}>Add user</button>
        ) : (
          <NewUserForm
            onCancel={() => setAdding(false)}
            onCreate={(u) => run(async () => { await api.usersCreate(u); setAdding(false); })}
          />
        )}
      </Section>

      {deleteFor && (
        <ConfirmDialog
          title="Delete user"
          message={`Delete "${deleteFor.userName}"? Their playlists, favorites and play history on this server go with the account.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => { const u = deleteFor; setDeleteFor(null); void run(() => api.usersDelete(u.id)); }}
          onCancel={() => setDeleteFor(null)}
        />
      )}
    </div>
  );
}

function PasswordForm({ label, onSave, onCancel }: { label: string; onSave: (p: string) => void; onCancel: () => void }) {
  const [p, setP] = useState("");
  return (
    <form className="flex items-center" style={{ gap: 8, marginTop: 8, paddingLeft: 48 }} onSubmit={(e) => { e.preventDefault(); if (p) onSave(p); }}>
      <input type="password" autoFocus placeholder={label} value={p} onChange={(e) => setP(e.target.value)} style={{ ...input, flex: 1 }} />
      <button type="submit" style={btn()} disabled={!p}>Save</button>
      <button type="button" style={btn()} onClick={onCancel}>Cancel</button>
    </form>
  );
}

function NewUserForm({ onCreate, onCancel }: {
  onCreate: (u: { userName: string; name: string; email: string; password: string; isAdmin: boolean }) => void;
  onCancel: () => void;
}) {
  const [userName, setUserName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const ok = userName.trim() !== "" && password !== "";
  return (
    <form
      className="flex flex-col"
      style={{ gap: 8, marginTop: 8 }}
      onSubmit={(e) => { e.preventDefault(); if (ok) onCreate({ userName: userName.trim(), name: name.trim() || userName.trim(), email: email.trim(), password, isAdmin }); }}
    >
      <input autoFocus placeholder="User name" value={userName} onChange={(e) => setUserName(e.target.value)} style={input} />
      <input placeholder="Display name (optional)" value={name} onChange={(e) => setName(e.target.value)} style={input} />
      <input placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
      <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} style={input} />
      <label className="flex items-center" style={{ gap: 8, color: "var(--text-primary)", fontSize: "var(--fs-secondary)" }}>
        <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> Administrator
      </label>
      <div className="flex" style={{ gap: 8 }}>
        <button type="submit" style={{ ...primary, opacity: ok ? 1 : 0.5 }} disabled={!ok}>Create</button>
        <button type="button" style={btn()} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
