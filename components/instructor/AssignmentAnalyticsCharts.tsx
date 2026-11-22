/**
 * The three charts of the assignment analytics page (Phase 15: split out so the page loads
 * recharts on demand, through next/dynamic, instead of in its first-load bundle).
 */

import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { format } from 'date-fns';
import { chartTooltipStyle, type ChartPalette } from '@/lib/chart-theme';

type Props = {
  timeline: Array<{ date: string; count: number }>;
  scoreDistribution: Array<{ range: string; count: number }>;
  studentScores: Array<{ name: string; score: number | null }>;
  colors: string[];
  chart: ChartPalette;
};

export default function AssignmentAnalyticsCharts({ timeline, scoreDistribution, studentScores, colors, chart }: Props) {
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card rounded-xl p-6">
          <h2 className="text-xl font-bold mb-4 text-ink">Submission Timeline</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis dataKey="date" tickFormatter={(value) => format(new Date(value), 'MMM dd')} stroke={chart.axis} />
              <YAxis stroke={chart.axis} />
              <Tooltip labelFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')} contentStyle={chartTooltipStyle(chart)} />
              <Legend />
              <Line type="monotone" dataKey="count" stroke={chart.accent} strokeWidth={2} name="Submissions" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card rounded-xl p-6">
          <h2 className="text-xl font-bold mb-4 text-ink">Score Distribution</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={scoreDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis dataKey="range" stroke={chart.axis} />
              <YAxis stroke={chart.axis} />
              <Tooltip contentStyle={chartTooltipStyle(chart)} />
              <Legend />
              <Bar dataKey="count" name="Students" fill={chart.accent}>
                {scoreDistribution.map((entry, index) => <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      {studentScores.length > 0 && (
        <div className="card rounded-xl p-6 mb-8">
          <h2 className="text-xl font-bold mb-4 text-ink">Top Student Scores</h2>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={studentScores} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis type="number" domain={[0, 100]} stroke={chart.axis} />
              <YAxis dataKey="name" type="category" stroke={chart.axis} width={120} />
              <Tooltip contentStyle={chartTooltipStyle(chart)} formatter={(value: number) => `${value}%`} />
              <Legend />
              <Bar dataKey="score" name="Score (%)" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}
