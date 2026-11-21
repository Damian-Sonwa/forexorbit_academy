/**
 * Dashboard charts (Phase 11), recharts. Each chart plots server data as given; nothing is
 * interpolated or invented (missing days are real zeros sent by the server). Money is plotted from
 * the server's decimal strings (format.ts chartNumber) and shown in tooltips as those strings.
 * Loaded on the client only (pages/dashboard.tsx, next/dynamic).
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTheme } from '@/hooks/useTheme';
import { chartPalette, chartTooltipStyle } from '@/lib/chart-theme';
import type { LearningSeries, TradingPerformance, AssessmentPerformance } from '@/lib/student-analytics';
import { bucketLabel, chartNumber, formatDate, pairLabel } from './format';

const SIGN = { light: { up: '#0f8a5f', down: '#c2363f' }, dark: { up: '#3cc48f', down: '#f2656f' } };

function usePalette() {
  const { isDark } = useTheme();
  return { c: chartPalette(isDark), sign: SIGN[isDark ? 'dark' : 'light'] };
}

const axis = (color: string) => ({ stroke: color, fontSize: 11, tickLine: false, axisLine: false });

export function LearningActivityChart({ series, metric }: { series: LearningSeries; metric: 'minutes' | 'lessons' }) {
  const { c } = usePalette();
  const data = series.buckets.map((b) => ({ label: bucketLabel(b.key), value: b[metric] }));
  return (
    <div className="h-56 w-full" role="img" aria-label={`${metric === 'minutes' ? 'Learning minutes' : 'Lessons completed'} per ${series.granularity}, ${series.range === 'all' ? 'all history' : `last ${series.range} days`}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" {...axis(c.axis)} interval="preserveStartEnd" minTickGap={18} />
          <YAxis {...axis(c.axis)} allowDecimals={false} width={44} />
          <Tooltip cursor={{ fill: c.grid }} contentStyle={chartTooltipStyle(c)} formatter={(v: number) => [metric === 'minutes' ? `${v} min` : `${v} lesson${v === 1 ? '' : 's'}`, metric === 'minutes' ? 'Learning time' : 'Completed']} />
          <Bar dataKey="value" fill={c.accent} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScoreTrendChart({ trend }: { trend: AssessmentPerformance['trend'] }) {
  const { c } = usePalette();
  const data = trend.map((t, i) => ({ n: i + 1, percent: t.percent, at: formatDate(t.at) }));
  return (
    <div className="h-48 w-full" role="img" aria-label={`Scores of your last ${data.length} quiz attempts`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="n" {...axis(c.axis)} />
          <YAxis domain={[0, 100]} {...axis(c.axis)} width={44} unit="%" />
          <Tooltip contentStyle={chartTooltipStyle(c)} labelFormatter={(_, p) => (p && p[0] ? String((p[0].payload as { at: string }).at) : '')} formatter={(v: number) => [`${v}%`, 'Score']} />
          <Line type="monotone" dataKey="percent" stroke={c.accent} strokeWidth={2} dot={{ r: 3, fill: c.accent }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Running total of realised results by day (SIMULATED). */
export function PerformanceChart({ series }: { series: TradingPerformance['series'] }) {
  const { c, sign } = usePalette();
  const data = series.map((p) => ({ label: bucketLabel(p.day), value: chartNumber(p.cumulative), text: p.cumulative, net: p.net, trades: p.trades }));
  const last = data.length ? data[data.length - 1].value : 0;
  const color = last < 0 ? sign.down : sign.up;
  return (
    <div className="h-56 w-full" role="img" aria-label="Cumulative realised result of simulated trades, by day">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
          <defs>
            <linearGradient id="pnl-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.28} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" {...axis(c.axis)} minTickGap={18} />
          <YAxis {...axis(c.axis)} width={56} />
          <ReferenceLine y={0} stroke={c.axis} strokeDasharray="3 3" />
          <Tooltip
            contentStyle={chartTooltipStyle(c)}
            formatter={(_v: number, _n, p) => {
              const d = p.payload as { text: string; net: string; trades: number };
              return [`${d.text} USD (day ${d.net}, ${d.trades} trade${d.trades === 1 ? '' : 's'})`, 'Running total'];
            }}
          />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#pnl-fill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OutcomeChart({ wins, losses, breakeven }: { wins: number; losses: number; breakeven: number }) {
  const { c, sign } = usePalette();
  const data = [
    { label: 'Wins', value: wins, color: sign.up },
    { label: 'Losses', value: losses, color: sign.down },
    { label: 'Breakeven', value: breakeven, color: c.muted },
  ];
  return (
    <div className="h-40 w-full" role="img" aria-label={`${wins} winning, ${losses} losing and ${breakeven} breakeven simulated trades`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="label" {...axis(c.axis)} width={72} />
          <Tooltip cursor={{ fill: c.grid }} contentStyle={chartTooltipStyle(c)} formatter={(v: number) => [v, 'Trades']} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={22} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.label} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function InstrumentChart({ rows }: { rows: TradingPerformance['byInstrument'] }) {
  const { c, sign } = usePalette();
  const data = rows.map((r) => ({ label: pairLabel(r.instrument), value: chartNumber(r.net), text: r.net, trades: r.trades, winRate: r.winRate }));
  return (
    <div className="h-48 w-full" role="img" aria-label="Realised result by currency pair (simulated)">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" {...axis(c.axis)} />
          <YAxis {...axis(c.axis)} width={56} />
          <ReferenceLine y={0} stroke={c.axis} />
          <Tooltip
            cursor={{ fill: c.grid }}
            contentStyle={chartTooltipStyle(c)}
            formatter={(_v: number, _n, p) => {
              const d = p.payload as { text: string; trades: number; winRate: string | null };
              return [`${d.text} USD · ${d.trades} trade${d.trades === 1 ? '' : 's'} · win rate ${d.winRate ?? '-'}%`, 'Result'];
            }}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.label} fill={d.value < 0 ? sign.down : sign.up} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
