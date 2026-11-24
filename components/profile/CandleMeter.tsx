/** Small candle meter: orange and white candles, filled of total. Decorative. */

const METER = [[11, 8], [9, 8], [10, 6], [6, 9], [7, 6], [4, 8], [2, 8]];
export default function CandleMeter({ filled, total, className = '' }: { filled: number; total: number; className?: string }) {
  return (
    <svg viewBox={`0 0 ${total * 12} 24`} className={className} aria-hidden focusable="false">
      {Array.from({ length: total }, (_, i) => {
        const [y, h] = METER[i % METER.length];
        const on = i < filled;
        const color = i % 3 === 2 ? '#FFFFFF' : '#FF7417';
        return (
          <g key={i} opacity={on ? 1 : 0.5}>
            <line x1={i * 12 + 6} x2={i * 12 + 6} y1={Math.max(0.5, y - 2.5)} y2={y + h + 2.5} stroke={on ? color : '#8FA3BC'} strokeWidth="1.2" />
            <rect x={i * 12 + 2.5} y={y} width="7" height={h} rx="1.2" fill={on ? color : '#14263E'} stroke={on ? color : '#8FA3BC'} strokeWidth="1" />
          </g>
        );
      })}
    </svg>
  );
}
