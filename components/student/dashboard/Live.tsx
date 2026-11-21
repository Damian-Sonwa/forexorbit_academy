/**
 * The stateful dashboard parts (Phase 11): the learning range switcher, the activity feed's "load
 * more", and the latest notifications. Each fetches only its own slice, from the student's own
 * endpoints; the main dashboard data is fetched once by hooks/useStudentDashboard.ts.
 */

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { apiClient } from '@/lib/api-client';
import type { ActivityEvent, ActivityPage, LearningSeries, Range } from '@/lib/student-analytics';
import { ActivityList, ErrorState } from './Panels';
import { minutesLabel, relativeTime } from './format';

const RANGES: Array<[Range, string]> = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All']];

type ChartProps = { series: LearningSeries; metric: 'minutes' | 'lessons' };

export function LearningActivity({ initial, Chart }: { initial: LearningSeries; Chart: ComponentType<ChartProps> }) {
  const [range, setRange] = useState<Range>(initial.range);
  const [metric, setMetric] = useState<'minutes' | 'lessons'>('minutes');
  const [series, setSeries] = useState<LearningSeries>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => { setSeries(initial); }, [initial]);

  const choose = useCallback(async (next: Range) => {
    setRange(next);
    if (next === initial.range) { setSeries(initial); setError(null); return; }
    const id = ++request.current;
    setLoading(true);
    try {
      const data = await apiClient.get<LearningSeries>(`/student/analytics/learning?range=${next}`);
      if (id === request.current) { setSeries(data); setError(null); }
    } catch {
      if (id === request.current) setError('This range could not be loaded.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [initial]);

  const empty = series.totals.minutes === 0 && series.totals.lessons === 0;
  return (
    <div className="card !p-5" data-testid="learning-activity">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl border border-line bg-surface-2 p-1" role="group" aria-label="Measure">
          {(['minutes', 'lessons'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)} className={`min-h-[36px] rounded-lg px-3 text-xs font-medium ${metric === m ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}>
              {m === 'minutes' ? 'Learning time' : 'Lessons completed'}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-xl border border-line bg-surface-2 p-1" role="group" aria-label="Time range">
          {RANGES.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={range === id} onClick={() => void choose(id)} className={`min-h-[36px] rounded-lg px-3 text-xs font-medium ${range === id ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <dl className="mt-4 flex flex-wrap gap-6 text-sm">
        <div><dt className="readout-label">Learning time</dt><dd className="mt-0.5 font-semibold text-ink num">{minutesLabel(series.totals.minutes)}</dd></div>
        <div><dt className="readout-label">Lessons completed</dt><dd className="mt-0.5 font-semibold text-ink num">{series.totals.lessons}</dd></div>
        <div><dt className="readout-label">Active days</dt><dd className="mt-0.5 font-semibold text-ink num">{series.totals.activeDays}</dd></div>
      </dl>
      <div className={`mt-3 transition-opacity ${loading ? 'opacity-50' : ''}`} aria-busy={loading}>
        {error ? <ErrorState text={error} onRetry={() => void choose(range)} /> : empty ? (
          <p className="py-14 text-center text-sm text-ink-subtle" data-testid="learning-empty">No learning recorded in this period.</p>
        ) : <Chart series={series} metric={metric} />}
      </div>
      <p className="mt-2 text-xs text-ink-subtle">
        Days in {series.timezone.replace('_', ' ')} time.
        {metric === 'lessons' && series.undatedCompletions > 0 ? ` ${series.undatedCompletions} earlier lesson completion${series.undatedCompletions === 1 ? ' was' : 's were'} recorded without a date and are not shown on the chart.` : ''}
      </p>
    </div>
  );
}

export function ActivityFeed({ initial, hasMore: initialMore }: { initial: ActivityEvent[]; hasMore: boolean }) {
  const [events, setEvents] = useState(initial);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setEvents(initial); setPage(1); setHasMore(initialMore); }, [initial, initialMore]);

  const more = async () => {
    setLoading(true);
    try {
      const next = await apiClient.get<ActivityPage>(`/student/analytics/activity?page=${page + 1}&limit=10`);
      setEvents((list) => {
        const seen = new Set(list.map((e) => e.id));
        return [...list, ...next.events.filter((e) => !seen.has(e.id))];
      });
      setPage(next.page);
      setHasMore(next.hasMore);
      setError(null);
    } catch {
      setError('More activity could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card !p-5">
      <ActivityList events={events} />
      {error && <div className="mt-3"><ErrorState text={error} onRetry={() => void more()} /></div>}
      {hasMore && !error && (
        <button type="button" onClick={() => void more()} disabled={loading} className="btn btn-ghost btn-sm mt-3 w-full" data-testid="activity-more">
          {loading ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}

type NotificationRow = { _id: string; title: string; message: string; read: boolean; createdAt: string | null; type: string };

/**
 * The latest notifications from the existing API (GET /api/notifications); read state is the API's.
 * `bare` drops the card and heading, for use inside a disclosure.
 */
export function NotificationsPanel({ bare = false }: { bare?: boolean } = {}) {
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ notifications: NotificationRow[]; unreadCount: number }>('/notifications?limit=5');
      setRows(res.notifications || []);
      setUnread(res.unreadCount || 0);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const markRead = async (id: string) => {
    setRows((list) => list && list.map((n) => (n._id === id ? { ...n, read: true } : n)));
    setUnread((n) => Math.max(0, n - 1));
    try {
      await apiClient.put('/notifications', { notificationId: id });
    } catch {
      void load();
    }
  };

  const Wrapper = bare ? 'div' : 'section';
  return (
    <Wrapper className={bare ? '' : 'card !p-5'} aria-labelledby={bare ? undefined : 'dash-notifications'}>
      {bare ? (
        unread > 0 ? <span className="chip chip-brand" data-testid="notifications-unread">{unread} new</span> : null
      ) : (
        <div className="flex items-center justify-between">
          <h2 id="dash-notifications" className="section-title">Notifications</h2>
          {unread > 0 && <span className="chip chip-brand" data-testid="notifications-unread">{unread} new</span>}
        </div>
      )}
      {error ? (
        <div className="mt-3"><ErrorState text="Notifications could not be loaded." onRetry={() => void load()} /></div>
      ) : rows === null ? (
        <p className="mt-3 text-sm text-ink-subtle">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-subtle">No notifications.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--fo-line)]">
          {rows.map((n) => (
            <li key={n._id} className="flex items-start gap-3 py-2.5">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-primary-500'}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${n.read ? 'text-ink-muted' : 'font-semibold text-ink'}`}>{n.title || 'Notification'}</p>
                {n.message && <p className="line-clamp-2 text-xs text-ink-subtle">{n.message}</p>}
                <p className="text-2xs text-ink-subtle">{relativeTime(n.createdAt)}</p>
              </div>
              {!n.read && <button type="button" onClick={() => void markRead(n._id)} className="btn btn-ghost btn-sm shrink-0 !px-2 text-xs">Mark read</button>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-ink-subtle">All notifications are in the bell menu at the top of the page.</p>
    </Wrapper>
  );
}
