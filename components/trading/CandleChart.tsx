/**
 * Candlestick chart of the simulated market. The server sends finished candles. Numbers here only
 * place shapes on screen; no financial figure is derived from them.
 */

type Candle = { time: string; open: string; high: string; low: string; close: string; complete: boolean };

const WIDTH = 720;
const HEIGHT = 280;
const PAD = 8;
const AXIS = 62;

export default function CandleChart({ candles, label }: { candles: Candle[]; label: string }) {
  if (candles.length === 0) return null;
  const lows = candles.map((c) => Number(c.low));
  const highs = candles.map((c) => Number(c.high));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = max - min || 1;
  const plot = WIDTH - AXIS;
  const slot = plot / candles.length;
  const body = Math.max(1, slot * 0.65);
  const y = (price: number) => PAD + ((max - price) / range) * (HEIGHT - 2 * PAD);
  const last = candles[candles.length - 1];
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label={`${label}. Latest close ${last.close}. Range ${candles.map((c) => c.low).sort()[0]} to ${candles.map((c) => c.high).sort().slice(-1)[0]}.`} data-testid="candle-chart">
      <text x={WIDTH - AXIS + 4} y={PAD + 8} className="fill-gray-500" fontSize="11">{max}</text>
      <text x={WIDTH - AXIS + 4} y={HEIGHT - PAD} className="fill-gray-500" fontSize="11">{min}</text>
      {candles.map((c, i) => {
        const x = i * slot + slot / 2;
        const open = Number(c.open);
        const close = Number(c.close);
        const up = close >= open;
        const colour = up ? '#15803d' : '#b91c1c';
        const top = y(Math.max(open, close));
        return (
          <g key={c.time}>
            <line x1={x} x2={x} y1={y(Number(c.high))} y2={y(Number(c.low))} stroke={colour} strokeWidth="1" />
            <rect x={x - body / 2} y={top} width={body} height={Math.max(1, y(Math.min(open, close)) - top)} fill={colour} opacity={c.complete ? 1 : 0.6} />
          </g>
        );
      })}
    </svg>
  );
}
