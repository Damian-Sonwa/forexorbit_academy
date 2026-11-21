/**
 * Display helpers for the student dashboard (Phase 11). Presentation only: every figure arrives
 * computed by the server. Money arrives as exact decimal strings and is shown as-is; `chartNumber`
 * converts a string for plotting a chart point only, never for arithmetic on money.
 */

export const pairLabel = (instrument: string) => instrument.replace('_', '/');

/** 'up' | 'down' | 'flat' from a signed decimal string (no arithmetic). */
export function signOf(value: string | null | undefined): 'up' | 'down' | 'flat' {
  if (!value) return 'flat';
  if (value.trim().startsWith('-')) return 'down';
  return /^[+]?0*(\.0+)?$/.test(value.trim()) ? 'flat' : 'up';
}

export const toneClass = (value: string | null | undefined) => {
  const s = signOf(value);
  return s === 'up' ? 'text-up' : s === 'down' ? 'text-down' : 'text-ink';
};

/** Adds a + to positive amounts for display. */
export const signed = (value: string | null | undefined) => (value && signOf(value) === 'up' && !value.startsWith('+') ? `+${value}` : value || '-');

/** For plotting a chart point only. */
export const chartNumber = (value: string | null | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function formatDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

/** "3 hours ago", "yesterday", or the date. `now` is injectable for tests. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()) {
  if (!iso) return '-';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '-';
  const diff = Math.round((now.getTime() - then) / 1000);
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 3600) return `in ${Math.max(1, Math.round(ahead / 60))} min`;
    if (ahead < 86400) return `in ${Math.round(ahead / 3600)} h`;
    return `in ${Math.round(ahead / 86400)} days`;
  }
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 172800) return 'yesterday';
  if (diff < 7 * 86400) return `${Math.round(diff / 86400)} days ago`;
  return formatDate(iso);
}

export const minutesLabel = (minutes: number) => {
  if (!minutes) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
};

/** Bucket label: '2026-11-21' -> '21 Nov', '2026-11' -> 'Nov 2026'. Dates are calendar keys, not instants. */
export function bucketLabel(key: string) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = key.split('-');
  const month = months[Number(m) - 1] || m;
  return d ? `${Number(d)} ${month}` : `${month} ${y}`;
}

export const UPCOMING_STATUS: Record<string, { label: string; tone: string }> = {
  in_progress: { label: 'In progress', tone: 'chip-brand' },
  overdue: { label: 'Overdue', tone: 'chip-down' },
  retake_available: { label: 'Retake available', tone: '' },
  not_started: { label: 'Not started', tone: '' },
  not_submitted: { label: 'To submit', tone: '' },
  opens_soon: { label: 'Opens soon', tone: '' },
};

export const COURSE_STATUS: Record<string, string> = { completed: 'Completed', in_progress: 'In progress', not_started: 'Not started' };

export const CLOSE_REASONS: Record<string, string> = { manual: 'Closed by you', stop_loss: 'Stop-loss', take_profit: 'Take-profit', stop_out: 'Stop-out' };

/** A one-line learning status for the welcome section, from the overview only. */
export function learningStatus(o: { enrolled: number; completedCourses: number; inProgressCourses: number; completedLessons: number }) {
  if (o.enrolled === 0) return 'You have not enrolled in a course yet.';
  if (o.completedCourses === o.enrolled) return `You have completed all ${o.enrolled} of your course${o.enrolled === 1 ? '' : 's'}.`;
  const parts = [`${o.inProgressCourses} course${o.inProgressCourses === 1 ? '' : 's'} in progress`];
  if (o.completedCourses) parts.push(`${o.completedCourses} completed`);
  parts.push(`${o.completedLessons} lesson${o.completedLessons === 1 ? '' : 's'} done`);
  return `${parts.join(' · ')}.`;
}
