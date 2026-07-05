// Indeterminate loading ring — ports the old app's `_SpinnerRing` (queue_panel.py):
// a faint full ring plus a rotating 100°-long accent-colored arc. The old app
// stepped the angle 5° every 16ms (~60fps); one full revolution is 72 steps ×
// 16ms = 1152ms, reproduced here as a single CSS animation instead of a timer.
const SIZE = 52;
const STROKE = 3.5;
const MARGIN = 5; // matches the old app's ring inset
const RADIUS = SIZE / 2 - MARGIN;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_DEGREES = 100;
const ARC_LENGTH = CIRCUMFERENCE * (ARC_DEGREES / 360);

export function SpinnerRing() {
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <circle
        cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
        fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={STROKE} strokeLinecap="round"
      />
      <circle
        cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
        fill="none" stroke="var(--accent)" strokeOpacity={0.82} strokeWidth={STROKE} strokeLinecap="round"
        strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE - ARC_LENGTH}`}
        style={{
          transformOrigin: "50% 50%", transformBox: "fill-box",
          animation: "spinner-rotate 1152ms linear infinite",
        }}
      />
    </svg>
  );
}
