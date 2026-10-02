// The owner's progress indicator (bafft-c4d.3): a circle that fills
// clockwise from empty to full while a clip plays.
const R = 15;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function ProgressRing({ fraction, size = 40 }: { fraction: number; size?: number }) {
  const clamped = Math.min(1, Math.max(0, fraction));
  return (
    <svg className="progress-ring" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <circle className="track" cx="18" cy="18" r={R} />
      {/* Rotated so the stroke starts at 12 o'clock; SVG strokes run clockwise. */}
      <circle
        className="fill"
        cx="18"
        cy="18"
        r={R}
        transform="rotate(-90 18 18)"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - clamped)}
      />
    </svg>
  );
}
