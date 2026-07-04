import React from "react";

/**
 * Renders a PNG icon tinted to `currentColor` — replicates Qt's
 * CompositionMode_SourceIn used by the old app's icon providers.
 * Parent button color drives the tint automatically.
 */
export function Icon({
  src,
  size = 18,
  style,
}: {
  src: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        background: "currentColor",
        WebkitMaskImage: `url(${src})`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskImage: `url(${src})`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        willChange: "transform",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        ...style,
      }}
    />
  );
}
