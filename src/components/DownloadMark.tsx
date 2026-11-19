import { useDownloads } from "../lib/downloads";
import { Icon } from "./Icon";

/**
 * A small mark beside a song's title (desktop only; nothing is drawn in the browser or for songs that are not
 * downloaded): the accent arrow when the song is kept on this computer, a turning ring while it is being
 * downloaded, a faint arrow while it waits its turn.
 */
export function DownloadMark({ id }: { id: string }) {
  const supported = useDownloads((s) => s.supported);
  const kept = useDownloads((s) => s.ids.has(id));
  const loading = useDownloads((s) => s.current === id);
  const queued = useDownloads((s) => s.queued.has(id));
  if (!supported || (!kept && !loading && !queued)) return null;

  if (loading) {
    return (
      <span title="Downloading…" className="shrink-0" style={{ display: "inline-flex", width: 12, height: 12 }}>
        <svg width="12" height="12" viewBox="0 0 12 12">
          <circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--text-secondary)" strokeOpacity="0.3" strokeWidth="1.6" />
          <path d="M6 1.5 A4.5 4.5 0 0 1 10.5 6" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 6 6" to="360 6 6" dur="0.9s" repeatCount="indefinite" />
          </path>
        </svg>
      </span>
    );
  }
  return (
    <span title={kept ? "Downloaded" : "Waiting to download"} className="shrink-0" style={{ display: "inline-flex", opacity: kept ? 1 : 0.45 }}>
      <Icon src="img/download.png" size={12} style={{ background: kept ? "var(--accent)" : "var(--text-secondary)" }} />
    </span>
  );
}
