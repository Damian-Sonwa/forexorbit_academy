/**
 * Chart colours per theme. recharts takes literal colours rather than CSS classes, so charts
 * pick their palette from the current theme instead of relying on the dark-mode class remaps.
 */
export const CHART_THEME = {
  light: {
    grid: '#e5e7eb',
    axis: '#6b7280',
    tooltipBg: '#ffffff',
    tooltipBorder: '#e5e7eb',
    tooltipText: '#171717',
    accent: '#B85C0E',
    strong: '#171717',
    muted: '#737373',
  },
  dark: {
    grid: 'rgba(255,255,255,0.1)',
    axis: '#a3a3a3',
    tooltipBg: '#16191e',
    tooltipBorder: 'rgba(255,255,255,0.12)',
    tooltipText: '#f5f5f5',
    accent: '#FF8A33',
    strong: '#e5e5e5',
    muted: '#8a8a8a',
  },
} as const;

export type ChartPalette = (typeof CHART_THEME)['light' | 'dark'];

export function chartPalette(isDark: boolean): ChartPalette {
  return CHART_THEME[isDark ? 'dark' : 'light'];
}

export function chartTooltipStyle(c: ChartPalette) {
  return { backgroundColor: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: '8px', color: c.tooltipText };
}
