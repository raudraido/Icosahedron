import { useStore } from "../store";

interface Props {
  coverId: string | null;
  size?: number;
  className?: string;
}

export function CoverArt({ coverId, size = 200, className = "" }: Props) {
  const coverUrl = useStore((s) => s.coverUrl);
  const src = coverUrl(coverId, size);

  if (!src) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ background: "var(--skeleton)" }}>
        <span className="select-none" style={{ fontSize: "var(--fs-title)", color: "var(--text-primary)", opacity: 0.3 }}>♪</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      className={`object-cover ${className}`}
      loading="lazy"
      decoding="async"
    />
  );
}
