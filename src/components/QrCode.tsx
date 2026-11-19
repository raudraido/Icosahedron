import { useMemo } from "react";
import qrcode from "qrcode-generator";

/** A QR code for a short text (an address), drawn as one SVG path; dark on white so that every phone reads it. */
export function QrCode({ text, size = 160 }: { text: string; size?: number }) {
  const { n, path } = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const count = q.getModuleCount();
    let d = "";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { n: count, path: d };
  }, [text]);
  return (
    <svg
      viewBox={`-4 -4 ${n + 8} ${n + 8}`} width={size} height={size} role="img" aria-label="QR code of the address"
      shapeRendering="crispEdges" style={{ background: "#fff", borderRadius: 6, flexShrink: 0 }}
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
