/** A full-width candle session behind the onboarding headline; candles light up with progress (0 to 1). Decorative. */

const CLOSES = [52, 60, 57, 70, 66, 78, 92, 86, 98, 94, 108, 122, 115, 118, 132, 146, 139, 152, 168, 160, 176, 190, 184, 204];

export default function Skyline({ progress }: { progress: number }) {
  return (
    <svg className="onb-skyline" viewBox="0 0 1200 300" preserveAspectRatio="xMaxYMax slice" fill="none" aria-hidden focusable="false">
      {[60, 120, 180, 240].map((y) => <line key={y} x1="0" x2="1200" y1={y} y2={y} stroke="#fff" strokeOpacity=".08" />)}
      {CLOSES.map((close, i) => {
        const open = i === 0 ? 44 : CLOSES[i - 1];
        const x = 26 + i * 50;
        const middle = 296 - (open + close) / 2;
        const half = Math.abs(close - open) * 0.95 + 4;
        const top = middle - half;
        const bottom = middle + half;
        const down = close < open;
        return (
          <g key={x} className="onb-lit" opacity={i < Math.round(progress * CLOSES.length) ? 0.6 : 0.18}>
            <line x1={x} x2={x} y1={top - 9} y2={bottom + 10} stroke={down ? '#fff' : '#FFB56B'} strokeWidth="2" />
            <rect x={x - 8} y={top} width="16" height={bottom - top} rx="2" fill={down ? '#fff' : '#FF8A33'} />
          </g>
        );
      })}
    </svg>
  );
}
