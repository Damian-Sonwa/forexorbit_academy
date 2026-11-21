/**
 * Announcements (Phase 14).
 *   Everyone: GET /api/announcements, the announcements addressed to them (published, unexpired).
 *   Staff:    GET /api/announcements?manage=1, POST to create a draft, POST /api/announcements/:id
 *             { action: 'publish' | 'archive' }. Instructors announce to courses they teach; Admin and
 *             Super Admin to the whole academy. Publishing notifies each recipient once.
 */

import { useState } from 'react';
import { Megaphone, Plus, Send } from 'lucide-react';
import CommShell, { Tabs, errorText } from '@/components/communication/CommShell';
import { EmptyState, ErrorState } from '@/components/student/dashboard/Panels';
import { TableSkeleton } from '@/components/loading';
import { formatDate } from '@/components/student/dashboard/format';
import { useAuth } from '@/hooks/useAuth';
import { usePortalResource } from '@/hooks/usePortalResource';
import { apiClient } from '@/lib/api-client';
import type { Announcement } from '@/lib/communication/announcements';

const AUDIENCE: Record<string, string> = { all: 'Everyone', students: 'All students', instructors: 'All instructors', course: 'Course' };
const STATUS_TONE: Record<string, string> = { draft: '', scheduled: 'chip-brand', published: 'chip-up', archived: '' };
type Manage = { announcements: Announcement[]; courses: Array<{ id: string; title: string }>; canAnnounceToAll: boolean };
const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function Composer({ manage, onDone }: { manage: Manage; onDone: () => void }) {
  const [form, setForm] = useState({ title: '', body: '', audience: manage.canAnnounceToAll ? 'students' : 'course', courseId: manage.courses[0]?.id || '', publishAt: '', expiresAt: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (publishNow: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, courseId: form.audience === 'course' ? form.courseId : undefined, publishAt: form.publishAt ? new Date(form.publishAt).toISOString() : null, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null };
      const res = await apiClient.post<{ announcement: Announcement }>('/announcements', body);
      if (publishNow) await apiClient.post(`/announcements/${res.announcement.id}`, { action: 'publish' });
      setForm({ ...form, title: '', body: '' });
      onDone();
    } catch (err) {
      setError(errorText(err, 'The announcement could not be saved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card space-y-4 p-5" aria-labelledby="compose-title">
      <h2 id="compose-title" className="section-title">New announcement</h2>
      <label className="block"><span className="label">Title</span><input className="input mt-1.5 w-full" maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
      <label className="block"><span className="label">Message</span><textarea className="input mt-1.5 min-h-[8rem] w-full" maxLength={4000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block"><span className="label">Audience</span>
          <select className="input mt-1.5 w-full" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
            {manage.canAnnounceToAll && <><option value="all">Everyone</option><option value="students">All students</option><option value="instructors">All instructors</option></>}
            <option value="course">One course</option>
          </select>
        </label>
        {form.audience === 'course' && (
          <label className="block"><span className="label">Course</span>
            <select className="input mt-1.5 w-full" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })}>
              {manage.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        )}
        <label className="block"><span className="label">Publish at (optional)</span><input type="datetime-local" className="input mt-1.5 w-full" min={toLocal(new Date())} value={form.publishAt} onChange={(e) => setForm({ ...form, publishAt: e.target.value })} /></label>
        <label className="block"><span className="label">Expires (optional)</span><input type="datetime-local" className="input mt-1.5 w-full" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label>
      </div>
      {error && <p className="notice notice-caution text-sm" role="alert">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" disabled={busy || !form.title || !form.body} onClick={() => void submit(false)}>Save draft</button>
        <button type="button" className="btn btn-primary" disabled={busy || !form.title || !form.body} onClick={() => void submit(true)}><Send className="h-4 w-4" aria-hidden />{form.publishAt ? 'Schedule' : 'Publish now'}</button>
      </div>
      <p className="text-xs text-ink-subtle">Each recipient is notified once, in the app and by email if they keep announcement emails on. Recipients see only announcements meant for them.</p>
    </section>
  );
}

export default function AnnouncementsPage() {
  const { user } = useAuth();
  const staff = Boolean(user && ['instructor', 'admin', 'superadmin'].includes(user.role));
  const [view, setView] = useState('feed');
  const feed = usePortalResource<{ announcements: Announcement[]; hasMore: boolean }>('/announcements');
  const manage = usePortalResource<Manage>(staff && view === 'manage' ? '/announcements?manage=1' : null);
  const [composing, setComposing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const act = async (id: string, action: 'publish' | 'archive') => {
    setProblem(null);
    try {
      await apiClient.post(`/announcements/${id}`, { action });
      await Promise.all([manage.reload(), feed.reload()]);
    } catch (err) {
      setProblem(errorText(err, 'That did not work.'));
    }
  };

  return (
    <CommShell title="Announcements" lede="Notices from the academy and your instructors." actions={staff && view === 'manage' ? <button type="button" className="btn btn-primary" onClick={() => setComposing(!composing)}><Plus className="h-4 w-4" aria-hidden />New announcement</button> : undefined}>
      {staff && <div className="mb-5"><Tabs label="View" items={[['feed', 'For me'], ['manage', 'Manage']]} value={view} onChange={setView} /></div>}
      {view === 'feed' && (
        <>
          {feed.loading && !feed.data && <TableSkeleton rows={4} />}
          {feed.error && <ErrorState text={feed.error} onRetry={() => void feed.reload()} />}
          {feed.data && (feed.data.announcements.length ? (
            <ol className="space-y-4" data-testid="announcement-feed">
              {feed.data.announcements.map((a) => (
                <li key={a.id} id={`a-${a.id}`} className="card scroll-mt-24 p-5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle"><Megaphone className="h-4 w-4 text-primary-500" aria-hidden /><span>{formatDate(a.publishedAt, true)}</span><span>· {AUDIENCE[a.audience]}</span></div>
                  <h2 className="mt-2 font-display text-lg font-semibold text-ink [overflow-wrap:anywhere]">{a.title}</h2>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-muted [overflow-wrap:anywhere]">{a.body}</p>
                </li>
              ))}
            </ol>
          ) : <EmptyState title="No announcements" text="Announcements for you and your courses appear here." />)}
        </>
      )}
      {view === 'manage' && staff && (
        <div className="space-y-5">
          {composing && manage.data && <Composer manage={manage.data} onDone={() => { setComposing(false); void manage.reload(); void feed.reload(); }} />}
          {problem && <p className="notice notice-caution text-sm" role="alert">{problem}</p>}
          {manage.loading && !manage.data && <TableSkeleton rows={4} />}
          {manage.error && <ErrorState text={manage.error} onRetry={() => void manage.reload()} />}
          {manage.data && (manage.data.announcements.length ? (
            <ul className="space-y-3" data-testid="announcement-manage">
              {manage.data.announcements.map((a) => (
                <li key={a.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className={`chip ${STATUS_TONE[a.status]}`}>{a.status}</span><span className="text-xs text-ink-subtle">{AUDIENCE[a.audience]}{a.audience === 'course' ? `: ${manage.data!.courses.find((c) => c.id === a.courseId)?.title || 'course'}` : ''}</span></div>
                    <p className="mt-1.5 truncate font-medium text-ink">{a.title}</p>
                    <p className="text-xs text-ink-subtle">{a.status === 'published' ? `Sent to ${a.recipients} · ${formatDate(a.publishedAt, true)}` : a.status === 'scheduled' ? `Publishes ${formatDate(a.publishAt, true)}` : `Created ${formatDate(a.createdAt, true)}`}{a.expiresAt ? ` · expires ${formatDate(a.expiresAt, true)}` : ''}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {a.status === 'draft' && <button type="button" className="btn btn-primary btn-sm" onClick={() => void act(a.id, 'publish')}>{a.publishAt && new Date(a.publishAt) > new Date() ? 'Schedule' : 'Publish'}</button>}
                    {a.status !== 'archived' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(a.id, 'archive')}>Archive</button>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No announcements yet" text="Create one for a course you teach, or for the academy if you are an administrator." />)}
        </div>
      )}
    </CommShell>
  );
}
