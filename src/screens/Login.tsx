import { useState } from "react";
import { useStore } from "../store";

export function Login() {
  const connect = useStore((s) => s.connect);
  const [url, setUrl] = useState("http://");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await connect(url.trim(), user.trim(), pass);
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

  return (
    <div className="flex h-screen items-center justify-center" style={{ background: "var(--main-bg)" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl p-8 shadow-2xl"
        style={{ background: "var(--panel-bg)", border: "1px solid var(--border)" }}
      >
        <h1 className="text-2xl font-semibold" style={{ color: "var(--accent)" }}>Icosahedron</h1>
        <p className="text-sm" style={{ color: "var(--text-primary)", opacity: 0.6 }}>Connect to your Navidrome server</p>

        <div className="space-y-3">
          <input
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={inputStyle}
            placeholder="Server URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            autoFocus
          />
          <input
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={inputStyle}
            placeholder="Username"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            required
          />
          <input
            type="password"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={inputStyle}
            placeholder="Password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            required
          />
        </div>

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
