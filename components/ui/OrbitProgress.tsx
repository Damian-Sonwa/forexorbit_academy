/**
 * OrbitProgress: ForexOrbit's progress mark. A faint orbital track, a lit arc for the share
 * completed, and a node riding the orbit at the current position. Accessible as a progressbar.
 */

import { useId } from 'react';

interface OrbitProgressProps {
  /** 0-100 */
  value: number;
  size?: number;
  /** Stroke width of the track and arc. */
  stroke?: number;
  label: string;
  /** Text in the middle; defaults to the rounded percentage. */
  center?: React.ReactNode;
  className?: string;
  tone?: 'brand' | 'complete';
}

export default function OrbitProgress({ value, size = 64, stroke = 4, label, center, className = '', tone = 'brand' }: OrbitProgressProps) {
  const id = useId().replace(/:/g, '');
  const pct = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2 - 3;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;
  // The node sits at the end of the arc; the arc starts at 12 o'clock and runs clockwise.
  const angle = (pct / 100) * 2 * Math.PI - Math.PI / 2;
  const nx = c + r * Math.cos(angle);
  const ny = c + r * Math.sin(angle);
  const done = tone === 'complete' || pct >= 100;

  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="overflow-visible">
        <defs>
          <linearGradient id={`orbit-arc-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={done ? '#3cc48f' : '#ffab6b'} />
            <stop offset="100%" stopColor={done ? '#0f8a5f' : '#ff7012'} />
          </linearGradient>
        </defs>
        {/* track, with a dashed outer echo: the orbit */}
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--fo-line-strong)" strokeWidth={stroke} />
        <circle cx={c} cy={c} r={r + stroke + 1.5} fill="none" stroke="var(--fo-line)" strokeWidth={1} strokeDasharray="1.5 4" />
        {pct > 0 && (
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={`url(#orbit-arc-${id})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform={`rotate(-90 ${c} ${c})`}
            className="transition-[stroke-dasharray] duration-700 ease-orbit motion-reduce:transition-none"
          />
        )}
        {pct > 0 && pct < 100 && (
          <>
            <circle cx={nx} cy={ny} r={stroke + 2.5} fill={done ? '#3cc48f' : '#ff7012'} opacity={0.25} />
            <circle cx={nx} cy={ny} r={stroke / 2 + 1.2} fill="#fff4ea" stroke={done ? '#3cc48f' : '#ff7012'} strokeWidth={1.5} />
          </>
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-ink num" style={{ fontSize: Math.max(10, size * 0.2) }}>
        {center ?? `${Math.round(pct)}%`}
      </span>
    </div>
  );
}
