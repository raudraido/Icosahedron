import { useStore } from "../store";
import { CoverArt } from "./CoverArt";
import { Icon } from "./Icon";
import { PlayRingButton } from "./PlayRingButton";
import { fmtDuration } from "../lib/api";

/** Transport button — icon tinted via currentColor / Icon mask */
function TBtn({
  icon,
  active = false,
  iconSize = 20,
  btnSize = 40,
  radius = 20,
  onClick,
  dot = false,
  title,
}: {
  icon: string;
  active?: boolean;
  iconSize?: number;
  btnSize?: number;
  radius?: number;
  onClick: () => void;
  dot?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="relative flex items-center justify-center shrink-0 transition-colors"
      style={{
        width: btnSize, height: btnSize, borderRadius: radius,
        color: active ? "var(--accent)" : "var(--text-primary)",
        opacity: active ? 1 : 0.5,
        background: "transparent", border: "none", cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--hover-bg)";
        e.currentTarget.style.opacity = "1";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.opacity = active ? "1" : "0.5";
      }}
    >
      <Icon src={icon} size={iconSize} />
      {dot && (
        <span
          className="absolute rounded-full"
          style={{ width: 5, height: 5, background: "var(--accent)", bottom: 2, left: "50%", transform: "translateX(-50%)" }}
        />
      )}
    </button>
  );
}

export function PlayerBar() {
  const queue          = useStore((s) => s.queue);
  const currentIndex   = useStore((s) => s.currentIndex);
  const playing        = useStore((s) => s.playing);
  const shuffle        = useStore((s) => s.shuffle);
  const repeat         = useStore((s) => s.repeat);
  const volume         = useStore((s) => s.volume);
  const currentTime    = useStore((s) => s.currentTime);
  const duration       = useStore((s) => s.duration);
  const playPause      = useStore((s) => s.playPause);
  const next           = useStore((s) => s.next);
  const prev           = useStore((s) => s.prev);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const setVolume      = useStore((s) => s.setVolume);
  const toggleShuffle  = useStore((s) => s.toggleShuffle);
  const toggleRepeat   = useStore((s) => s.toggleRepeat);
  const stop           = useStore((s) => s.stop);

  const track = queue[currentIndex] ?? null;

  return (
    <div
      className="flex items-center shrink-0"
      style={{
        height: 132, background: "var(--panel-bg)",
        borderTop: "1px solid var(--border)",
        paddingLeft: 8, paddingRight: 12,
      }}
    >
      {/* ── LEFT: art + track info (330px = left panel width) ── */}
      <div className="flex items-center shrink-0 gap-3" style={{ width: 297 }}>
        <CoverArt coverId={track?.cover_id ?? null} size={84} className="w-[84px] h-[84px] rounded shrink-0" />
        <div className="min-w-0 flex flex-col justify-center gap-0.5">
          <p className="truncate font-semibold leading-snug" style={{ fontSize: "var(--fs-primary)", color: "var(--accent)" }}>
            {track?.title ?? "—"}
          </p>
          <p className="truncate leading-snug" style={{ fontSize: "var(--fs-secondary)", color: "var(--text-primary)", opacity: 0.75 }}>
            {track?.artist ?? ""}
          </p>
          {track?.album && (
            <p className="truncate leading-snug" style={{ fontSize: "var(--fs-small)", color: "var(--text-primary)", opacity: 0.45 }}>
              {track.album}
            </p>
          )}
        </div>
      </div>

      {/* ── CENTER: transport controls + scrubber ── */}
      <div className="flex-1 flex flex-col items-center justify-center" style={{ gap: 4 }}>

        {/* Transport row — matches QML controlsRow heights (58px items) */}
        <div className="flex items-center" style={{ gap: 2 }}>
          <TBtn icon="/img/stop.png"    iconSize={18} btnSize={36} radius={18} onClick={stop}          title="Stop" />
          <TBtn icon="/img/shuffle.png" iconSize={20} btnSize={45} radius={22} onClick={toggleShuffle} active={shuffle} dot={shuffle} title="Shuffle" />
          <TBtn icon="/img/prev.png"    iconSize={20} btnSize={45} radius={22} onClick={prev}          title="Previous" />

          {/* Play ring — 58×58, matches QML playBtn */}
          <PlayRingButton
            icon={playing ? "/img/pause.png" : "/img/play.png"}
            onClick={playPause}
            title={playing ? "Pause" : "Play"}
          />

          <TBtn icon="/img/next.png"   iconSize={20} btnSize={45} radius={22} onClick={next}          title="Next" />
          <TBtn icon="/img/repeat.png" iconSize={18} btnSize={36} radius={18} onClick={toggleRepeat}  active={repeat} dot={repeat} title="Repeat" />
        </div>

        {/* Scrubber row */}
        <div className="flex items-center w-full" style={{ gap: 8, maxWidth: 580 }}>
          <span className="tabular-nums text-right shrink-0" style={{ minWidth: 44, fontSize: "var(--fs-secondary)", fontWeight: 700, color: "var(--accent)" }}>
            {fmtDuration(currentTime)}
          </span>
          <input
            type="range" min={0} max={duration || 1} value={currentTime}
            onChange={(e) => setCurrentTime(Number(e.target.value))}
            className="flex-1 cursor-pointer"
            style={{ height: 5, accentColor: "var(--accent)" }}
          />
          <span className="tabular-nums shrink-0" style={{ minWidth: 44, fontSize: "var(--fs-secondary)", fontWeight: 700, color: "var(--accent)" }}>
            {fmtDuration(duration)}
          </span>
        </div>
      </div>

      {/* ── RIGHT: settings + volume + cast (400px = queue panel width) ── */}
      <div className="flex items-center shrink-0 justify-end" style={{ width: 360, gap: 6 }}>
        {/* Settings */}
        <button
          className="flex items-center justify-center shrink-0"
          style={{ width: 40, height: 40, borderRadius: 20, background: "transparent", border: "none", cursor: "pointer", color: "var(--text-primary)", opacity: 0.45 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover-bg)"; e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.opacity = "0.45"; }}
        >
          <Icon src="/img/settings.png" size={20} />
        </button>

        {/* Mute */}
        <button
          onClick={() => setVolume(volume === 0 ? 80 : 0)}
          className="flex items-center justify-center shrink-0"
          style={{ width: 40, height: 40, borderRadius: 20, background: "transparent", border: "none", cursor: "pointer", color: volume === 0 ? "var(--text-primary)" : "var(--accent)", opacity: volume === 0 ? 0.45 : 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover-bg)"; e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.opacity = volume === 0 ? "0.45" : "1"; }}
        >
          <Icon src={volume === 0 ? "/img/volume_mute.png" : "/img/volume.png"} size={28} />
        </button>

        {/* Volume slider — 100px groove matching QML */}
        <input
          type="range" min={0} max={100} value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="cursor-pointer shrink-0"
          style={{ width: 100, height: 5, accentColor: "var(--accent)" }}
        />

        {/* Cast */}
        <button
          className="flex items-center justify-center shrink-0"
          style={{ width: 40, height: 40, borderRadius: 20, background: "transparent", border: "none", cursor: "pointer", color: "var(--text-primary)", opacity: 0.35 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover-bg)"; e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.opacity = "0.35"; }}
        >
          <Icon src="/img/cast.png" size={22} />
        </button>
      </div>
    </div>
  );
}
