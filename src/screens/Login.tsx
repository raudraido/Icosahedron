import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { platform } from "../platform";
import { getEngineBase, saveEngineUrl } from "../platform/syncUrl";
import { probeEngine, requestSignIn, pollSignIn, signInWithCode, type Granted } from "../lib/secureSignIn";

// In the browser the server is the site itself (the web engine proxies
// Navidrome), so there is no URL to ask for and staying signed in is the
// normal expectation rather than an opt-in.
const IS_WEB = platform.kind === "web";

const PROTOCOL_RE = /^(https?):\/\//i;

// Quick-reconnect list for servers saved via a prior "Remember my
// credentials" login or Settings > Servers' "Add Server" — lets logout
// (which only forgets the *active* profile, see store.logout) drop back
// into a one-click reconnect instead of forcing the whole form to be
// retyped for every other saved server. The whole row is the click target
// (not a separate button) — same "click anywhere on the row" affordance as
// the grid cards elsewhere in the app.
function SavedServerRow({ name, url, username, onUse }: { name: string; url: string; username: string; onUse: () => Promise<void> }) {
  const [hovered, setHovered] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setError("");
    setLoading(true);
    try {
      await onUse();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setLoading(false);
    }
    // no finally-reset on success — Login unmounts once `connected` flips
  }

  return (
    <div className="flex flex-col" style={{ gap: 4 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex items-center w-full text-left rounded-lg px-3 py-2 transition-colors disabled:opacity-60"
        style={{
          gap: 10,
          background: hovered ? "var(--hover-bg)" : "var(--card-bg)",
          border: "1px solid var(--border)",
          cursor: loading ? "default" : "pointer",
        }}
      >
        <img src="img/navidrome.png" alt="" style={{ width: 25, height: 25, objectFit: "contain", flexShrink: 0 }} />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="truncate text-base font-medium" style={{ color: "var(--text-primary)" }}>{name}</span>
          <span className="truncate text-xs" style={{ color: "var(--text-secondary)" }}>{username}@{url}</span>
        </div>
        {loading && <span className="shrink-0 text-xs font-medium" style={{ color: "var(--accent)" }}>Connecting…</span>}
      </button>
      {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
    </div>
  );
}

const FAILED: Record<string, string> = {
  wrong: "Wrong user name or password.",
  rate: "Too many attempts. Wait a few minutes and try again.",
  busy: "There are already several sign-in requests open for this account. Wait for them to expire or answer them.",
  offline: "Could not reach the server.",
  denied: "The sign-in was denied.",
  expired: "Nobody answered in time.",
  gone: "That request is no longer open.",
  not_required: "This server does not ask for approval.",
  error: "Something went wrong.",
};

// Secure sign-in (docs/secure-sign-in.md): the server wants a device that is already signed in to approve this one.
function SignInApproval({ base, user, password, onGranted, onCancel }: {
  base: string; user: string; password: string; onGranted: (g: Granted) => Promise<void>; onCancel: () => void;
}) {
  type View =
    | { kind: "starting" }
    | { kind: "waiting"; number: number; expiresAt: number }
    | { kind: "failed"; reason: string }
    | { kind: "code"; error?: string; busy?: boolean }
    | { kind: "codes"; codes: string[]; granted: Granted };
  const [view, setView] = useState<View>({ kind: "starting" });
  const [code, setCode] = useState("");
  const [now, setNow] = useState(Date.now());
  const started = useRef(false);
  const request = useRef<{ id: string; secret: string } | null>(null);
  const granted = useRef(onGranted);
  granted.current = onGranted;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const r = await requestSignIn(base, user, password);
      if (!r.ok) { setView(r.reason === "no_trusted_device" ? { kind: "code" } : { kind: "failed", reason: r.reason }); return; }
      request.current = { id: r.id, secret: r.secret };
      setView({ kind: "waiting", number: r.number, expiresAt: Date.now() + r.expiresIn * 1000 });
    })();
  }, [base, user, password]);

  useEffect(() => {
    if (view.kind !== "waiting") return;
    const t = setInterval(async () => {
      setNow(Date.now());
      const req = request.current;
      if (!req) return;
      const p = await pollSignIn(base, req.id, req.secret);
      if (p.state === "approved") { clearInterval(t); void granted.current({ user: p.user, secret: p.secret }); }
      else if (p.state === "denied" || p.state === "expired" || p.state === "gone") { clearInterval(t); setView({ kind: "failed", reason: p.state }); }
    }, 2000);
    return () => clearInterval(t);
  }, [view.kind, base]);

  async function useCode() {
    setView({ kind: "code", busy: true });
    const r = await signInWithCode(base, user, password, code);
    if (!r.ok) { setView({ kind: "code", error: r.reason === "wrong" ? "That code is not valid." : FAILED[r.reason] }); return; }
    if (r.granted.recoveryCodes?.length) setView({ kind: "codes", codes: r.granted.recoveryCodes, granted: r.granted });
    else void granted.current(r.granted);
  }

  const textStyle = { color: "var(--text-primary)", opacity: 0.75, fontSize: "var(--fs-secondary)", lineHeight: 1.5 } as const;
  const link = { background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "var(--fs-small)", padding: 0 } as const;
  const inputStyle2 = { background: "var(--card-bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" };
  const left = view.kind === "waiting" ? Math.max(0, Math.round((view.expiresAt - now) / 1000)) : 0;

  return (
    <div className="space-y-4" style={{ textAlign: "center" }}>
      <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Approve this sign-in</h2>
      {view.kind === "starting" && <p style={textStyle}>Contacting the server…</p>}
      {view.kind === "waiting" && (
        <>
          <p style={textStyle}>Open Icosahedron on one of your devices that is already signed in and pick this number:</p>
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: 4, color: "var(--accent)" }}>{view.number}</div>
          <p style={{ ...textStyle, opacity: 0.5 }}>Waiting for approval… {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>
          <button type="button" style={link} onClick={() => setView({ kind: "code" })}>No device at hand? Use a code</button>
        </>
      )}
      {view.kind === "failed" && <p style={{ color: "var(--error)", fontSize: "var(--fs-secondary)" }}>{FAILED[view.reason] ?? FAILED.error}</p>}
      {view.kind === "code" && (
        <>
          <p style={textStyle}>Enter a recovery code, or the code you got from the server's administrator.</p>
          <input
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ ...inputStyle2, textAlign: "center", letterSpacing: 2 }}
            placeholder="XXXX-XXXX-XXXX" value={code} autoFocus onChange={(e) => setCode(e.target.value)}
          />
          {view.error && <p style={{ color: "var(--error)", fontSize: "var(--fs-small)" }}>{view.error}</p>}
          <button
            type="button" disabled={!code.trim() || view.busy} onClick={useCode}
            className="w-full rounded-lg py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--accent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}
          >{view.busy ? "Checking…" : "Sign in with code"}</button>
        </>
      )}
      {view.kind === "codes" && (
        <>
          <p style={textStyle}>This is your first device. Write these recovery codes down and keep them safe. Each works once, if you lose every device:</p>
          <pre style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, color: "var(--text-primary)", fontSize: 13, userSelect: "text" }}>{view.codes.join("\n")}</pre>
          <button
            type="button" onClick={() => void granted.current(view.granted)}
            className="w-full rounded-lg py-2 text-sm font-medium"
            style={{ background: "color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--accent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}
          >I have saved them</button>
        </>
      )}
      <button type="button" style={link} onClick={onCancel}>{view.kind === "failed" ? "Back" : "Cancel"}</button>
    </div>
  );
}

export function Login() {
  const connect = useStore((s) => s.connect);
  const servers = useStore((s) => s.servers);
  const loadServers = useStore((s) => s.loadServers);
  const switchServer = useStore((s) => s.switchServer);
  const [url, setUrl] = useState("");
  const [secure, setSecure] = useState(true);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [remember, setRemember] = useState(IS_WEB);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [approval, setApproval] = useState<{ url: string; user: string; pass: string; remember: boolean } | null>(null);

  useEffect(() => { loadServers(); }, [loadServers]);

  // In the browser the page itself says which server this is (its address) and which version it runs.
  const [serverVersion, setServerVersion] = useState("");
  useEffect(() => {
    if (!IS_WEB) return;
    fetch("config.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => { if (c?.version) setServerVersion(String(c.version)); })
      .catch(() => { /* the version line is only a courtesy */ });
  }, []);

  // Typing an explicit http:// or https:// prefix wins over the toggle, and
  // syncs the toggle to match it (rather than leaving the two disagreeing) —
  // so the toggle only ever decides the protocol for a bare "host" URL with
  // no prefix at all.
  function handleUrlChange(v: string) {
    setUrl(v);
    const m = v.match(PROTOCOL_RE);
    if (m) setSecure(m[1].toLowerCase() === "https");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const trimmed = IS_WEB ? location.origin : url.trim();
      const fullUrl = PROTOCOL_RE.test(trimmed) ? trimmed : `${secure ? "https" : "http"}://${trimmed}`;
      // A server with secure sign-in asks a device that is already signed in to approve this one.
      const probe = await probeEngine(fullUrl);
      if (probe.engine && probe.secure) {
        if (platform.kind === "electron" && !getEngineBase()) saveEngineUrl(fullUrl); // the approvals travel over the sync connection
        setApproval({ url: fullUrl, user: user.trim(), pass, remember });
        return;
      }
      await connect(fullUrl, user.trim(), pass, remember);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    background: "var(--card-bg)",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
  };

  if (approval) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "var(--main-bg)" }}>
        <div className="w-full rounded-xl p-8 shadow-2xl" style={{ maxWidth: 420, background: "var(--left-panel-bg)", border: "1px solid var(--border)" }}>
          <SignInApproval
            base={approval.url} user={approval.user} password={approval.pass}
            onGranted={async (g) => {
              try { await connect(approval.url, approval.user, g.secret, approval.remember); }
              catch (err) { setApproval(null); setError(String(err)); }
            }}
            onCancel={() => setApproval(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center" style={{ background: "var(--main-bg)" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full space-y-4 rounded-xl p-8 shadow-2xl"
        style={{ maxWidth: 420, background: "var(--left-panel-bg)", border: "1px solid var(--border)" }}
      >
        <div className="flex flex-col items-center" style={{ gap: 8 }}>
          {/* Same shahedron2 base + shahedron1 alpha-masked mark as LeftPanel.tsx's sidebar logo */}
          <div style={{ position: "relative", width: 64, height: 64 }}>
            <img
              src="img/shahedron2.png"
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
            />
            <div
              style={{
                position: "absolute", inset: 0,
                background: "var(--accent)",
                WebkitMaskImage: "url(img/shahedron1.png)",
                WebkitMaskSize: "100% 100%",
                WebkitMaskRepeat: "no-repeat",
                maskImage: "url(img/shahedron1.png)",
                maskSize: "100% 100%",
                maskRepeat: "no-repeat",
              }}
            />
          </div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--accent)" }}>Icosahedron</h1>
        </div>
        {IS_WEB ? (
          <div className="text-center" style={{ color: "var(--text-primary)" }}>
            <p className="text-sm" style={{ opacity: 0.6 }}>Sign in to</p>
            <p className="text-base font-medium" style={{ opacity: 0.9 }}>{location.host}</p>
            {serverVersion && <p className="text-xs" style={{ opacity: 0.4, marginTop: 2 }}>Server {serverVersion}</p>}
          </div>
        ) : (
          <p className="text-sm text-center" style={{ color: "var(--text-primary)", opacity: 0.6 }}>Connect to your Navidrome server</p>
        )}

        {/* The web app belongs to one server (the site itself), so there is no list of servers to pick from. */}
        {!IS_WEB && servers.length > 0 && (
          <>
            <div className="space-y-2">
              {servers.map((s) => (
                <SavedServerRow
                  key={s.id}
                  name={s.name}
                  url={s.url}
                  username={s.username}
                  onUse={() => switchServer(s.id)}
                />
              ))}
            </div>
            <div className="flex items-center" style={{ gap: 10 }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>or connect to a new server</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
          </>
        )}

        <div className="space-y-3">
          {!IS_WEB && (
          <input
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={inputStyle}
            placeholder="Server URL (e.g. server.domain.com)"
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
            required
            autoFocus
          />
          )}
          {!IS_WEB && (
          <div className="flex items-center justify-end gap-1 text-xs" style={{ marginTop: -6 }}>
            {(["http", "https"] as const).map((proto) => {
              const active = secure === (proto === "https");
              return (
                <button
                  key={proto}
                  type="button"
                  onClick={() => setSecure(proto === "https")}
                  className="rounded-md px-2 py-1 font-medium uppercase transition-colors"
                  style={{
                    background: active ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "transparent",
                    color: active ? "var(--accent)" : "var(--text-primary)",
                    opacity: active ? 1 : 0.5,
                    border: `1px solid ${active ? "color-mix(in srgb, var(--accent) 30%, transparent)" : "transparent"}`,
                    cursor: "pointer",
                  }}
                >
                  {proto}
                </button>
              );
            })}
          </div>
          )}
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            autoFocus={IS_WEB}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={inputStyle}
            placeholder="Username"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            required
          />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={inputStyle}
            placeholder="Password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            required
          />
        </div>

        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-primary)", opacity: 0.8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            style={{ accentColor: "var(--accent)" }}
          />
          {IS_WEB ? "Stay signed in on this device" : "Remember my credentials"}
        </label>

        {error && <p className="text-sm" style={{ color: "var(--error)" }}>{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg py-2 text-sm font-medium transition-opacity disabled:opacity-50"
          style={{ background: "color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--accent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}
        >
          {loading ? "Connecting…" : "Connect"}
        </button>
      </form>
    </div>
  );
}
