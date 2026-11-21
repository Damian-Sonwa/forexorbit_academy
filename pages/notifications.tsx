/**
 * Notification centre (Phase 14). GET /api/notifications returns only the member's own
 * notifications (bounded pages, ?before cursor, ?category, ?unreadOnly) with the true unread count;
 * PUT marks one read, POST /api/notifications/mark-all-read marks all. A destination opens only
 * when it is a same-site path (lib/class-notifications.js), and the destination page checks access.
 * New notifications arriving over the socket (and a reconnect) refresh the first page.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Settings } from 'lucide-react';
import CommShell, { Tabs, errorText } from '@/components/communication/CommShell';
import { EmptyState, ErrorState } from '@/components/student/dashboard/Panels';
import { TableSkeleton } from '@/components/loading';
import { formatDate, relativeTime } from '@/components/student/dashboard/format';
import { apiClient } from '@/lib/api-client';
import { useSocket } from '@/hooks/useSocket';
import { notificationDestination } from '@/lib/class-notifications';

type Item = { _id: string; type: string; title: string; message: string; read: boolean; createdAt: string | null; category?: string; metadata?: { href?: string } };
type Page = { notifications: Item[]; unreadCount: number; hasMore: boolean; nextCursor: string | null };
const CATEGORIES: Array<[string, string]> = [['', 'All'], ['learning', 'Learning'], ['announcements', 'Announcements'], ['consultations', 'Consultations'], ['community', 'Community'], ['messages', 'Messages'], ['account', 'Account']];
const DOT: Record<string, string> = { learning: 'bg-primary-500', announcements: 'bg-sky-500', consultations: 'bg-violet-500', community: 'bg-emerald-500', messages: 'bg-amber-500', account: 'bg-ink-muted' };

export default function NotificationCentre() {
  const router = useRouter();
  const { socket } = useSocket();
  const [category, setCategory] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback((before?: string | null) => {
    const p = new URLSearchParams({ limit: '20' });
    if (category) p.set('category', category);
    if (unreadOnly) p.set('unreadOnly', 'true');
    if (before) p.set('before', before);
    return `/notifications?${p.toString()}`;
  }, [category, unreadOnly]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await apiClient.get<Page>(query());
      setItems(page.notifications);
      setUnread(page.unreadCount);
      setHasMore(page.hasMore);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Notifications could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);
  // Live updates are hints: refetch the authoritative first page.
  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => { void load(); };
    socket.on('notification:new', refresh);
    socket.on('connect', refresh);
    return () => { socket.off('notification:new', refresh); socket.off('connect', refresh); };
  }, [socket, load]);

  const more = async () => {
    if (!cursor) return;
    try {
      const page = await apiClient.get<Page>(query(cursor));
      setItems((prev) => [...prev, ...page.notifications.filter((n) => !prev.some((p) => p._id === n._id))]);
      setHasMore(page.hasMore);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(errorText(err, 'More notifications could not be loaded.'));
    }
  };
  const markRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n._id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    await apiClient.put('/notifications', { notificationId: id }).catch(() => undefined);
  };
  const markAll = async () => {
    await apiClient.post('/notifications/mark-all-read', {}).catch(() => undefined);
    void load();
  };
  const open = (n: Item) => {
    if (!n.read) void markRead(n._id);
    const href = notificationDestination(n);
    if (href) void router.push(href);
  };

  return (
    <CommShell
      title="Notifications"
      lede="Everything the academy has sent you, newest first. Turn categories on or off in your notification settings."
      actions={(
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => void markAll()} disabled={!unread}><CheckCheck className="h-4 w-4" aria-hidden />Mark all read</button>
          <Link href="/settings/communication" className="btn btn-ghost"><Settings className="h-4 w-4" aria-hidden />Settings</Link>
        </div>
      )}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs label="Category" items={CATEGORIES} value={category} onChange={setCategory} />
        <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4 accent-[var(--fo-brand)]" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />Unread only <span className="num text-ink-subtle">({unread})</span></label>
      </div>
      {loading && !items.length && <TableSkeleton rows={6} />}
      {error && <ErrorState text={error} onRetry={() => void load()} />}
      {!loading && !error && !items.length && <EmptyState title={unreadOnly ? 'No unread notifications' : 'No notifications yet'} text="Grades, feedback, announcements, consultation updates and replies appear here." />}
      {items.length > 0 && (
        <ul className="divide-y divide-[var(--fo-line)] overflow-hidden rounded-panel border border-line bg-surface-1" data-testid="notification-list">
          {items.map((n) => (
            <li key={n._id} className={n.read ? '' : 'bg-[color-mix(in_srgb,var(--fo-brand)_6%,transparent)]'}>
              <div className="flex items-start gap-3 px-4 py-3.5">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : DOT[n.category || ''] || 'bg-primary-500'}`} aria-hidden />
                <button type="button" onClick={() => open(n)} className="min-w-0 flex-1 text-left">
                  <span className={`block text-sm [overflow-wrap:anywhere] ${n.read ? 'text-ink-muted' : 'font-semibold text-ink'}`}>{n.title}</span>
                  {n.message && <span className="mt-0.5 block text-sm text-ink-muted [overflow-wrap:anywhere]">{n.message}</span>}
                  <span className="mt-1 block text-2xs text-ink-subtle" title={formatDate(n.createdAt, true)}>{relativeTime(n.createdAt)}{n.category ? ` · ${CATEGORIES.find(([id]) => id === n.category)?.[1] || n.category}` : ''}</span>
                </button>
                {!n.read && <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => void markRead(n._id)} aria-label={`Mark "${n.title}" as read`}>Mark read</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {hasMore && <div className="mt-4 text-center"><button type="button" className="btn btn-secondary" onClick={() => void more()}><Bell className="h-4 w-4" aria-hidden />Load older</button></div>}
    </CommShell>
  );
}
