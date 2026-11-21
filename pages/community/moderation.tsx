/**
 * Community moderation queue (Phase 14; instructors, Admin, Super Admin).
 *   GET  /api/community/moderation?status=reported|hidden
 *   POST /api/community/moderation { targetType, targetId, action, reason }
 * Hiding keeps the post as evidence (members no longer see it); every action needs a reason and is
 * recorded in the item's history and the audit log. Reporters are not identified here.
 */

import Link from 'next/link';
import { useState } from 'react';
import { EyeOff, RotateCcw, ShieldCheck } from 'lucide-react';
import CommShell, { Tabs, errorText } from '@/components/communication/CommShell';
import { EmptyState, ErrorState } from '@/components/student/dashboard/Panels';
import { TableSkeleton } from '@/components/loading';
import { formatDate, relativeTime } from '@/components/student/dashboard/format';
import { usePortalResource } from '@/hooks/usePortalResource';
import { apiClient } from '@/lib/api-client';
import type { ModerationItem } from '@/lib/communication/moderation';

type Queue = { items: ModerationItem[]; counts: { reported: number; hidden: number } };

export default function ModerationPage() {
  const [status, setStatus] = useState('reported');
  const { data, error, loading, reload } = usePortalResource<Queue>(`/community/moderation?status=${status}`);
  const [acting, setActing] = useState<{ item: ModerationItem; action: 'hide' | 'restore' | 'clear' } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const submit = async () => {
    if (!acting) return;
    setBusy(true);
    try {
      await apiClient.post('/community/moderation', { targetType: acting.item.type, targetId: acting.item.id, action: acting.action, reason });
      setNotice({ kind: 'ok', text: acting.action === 'hide' ? 'Hidden from members. The post is kept as evidence.' : acting.action === 'restore' ? 'Restored.' : 'Reports cleared.' });
      setActing(null);
      setReason('');
      await reload();
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'That action did not work.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CommShell kicker="Community" title="Moderation" lede="Posts members reported. Hide what breaks the rules, clear what does not. Every decision is recorded." roles={['instructor', 'admin', 'superadmin']}>
      <div className="mb-5"><Tabs label="Queue" items={[['reported', 'Reported'], ['hidden', 'Hidden']]} value={status} onChange={setStatus} counts={data?.counts} /></div>
      {notice && <p className={`notice ${notice.kind === 'ok' ? 'notice-brand' : 'notice-caution'} mb-4 text-sm`} role="status">{notice.text}</p>}
      {loading && !data && <TableSkeleton rows={4} />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (data.items.length ? (
        <ul className="space-y-4" data-testid="moderation-queue">
          {data.items.map((item) => (
            <li key={`${item.type}-${item.id}`} className="card p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                <span className="chip">{item.type === 'question' ? 'Discussion' : 'Reply'}</span>
                <span className="chip chip-down">{item.reportCount} report{item.reportCount === 1 ? '' : 's'}</span>
                <span>by {item.author} · {relativeTime(item.createdAt)}</span>
              </div>
              {item.title && <h2 className="mt-3 font-display text-base font-semibold text-ink [overflow-wrap:anywhere]">{item.title}</h2>}
              <p className="mt-2 whitespace-pre-line rounded-lg bg-surface-2 p-3 text-sm text-ink [overflow-wrap:anywhere]">{item.excerpt || 'No text.'}</p>
              <div className="mt-3 flex flex-wrap gap-2">{item.reasons.map((r) => <span key={r.reason} className="chip">{r.label} · {r.count}</span>)}</div>
              {item.details.length > 0 && <ul className="mt-2 space-y-1 text-xs text-ink-muted">{item.details.map((d, i) => <li key={i}>“{d}”</li>)}</ul>}
              {item.history.length > 0 && <p className="mt-2 text-2xs text-ink-subtle">History: {item.history.map((h) => `${h.action}${h.at ? ` ${formatDate(h.at)}` : ''}`).join(' · ')}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                {item.questionId && <Link href={`/community/questions/${item.questionId}`} className="btn btn-ghost btn-sm">Open discussion</Link>}
                {item.status !== 'hidden' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActing({ item, action: 'hide' })}><EyeOff className="h-4 w-4" aria-hidden />Hide</button>}
                {item.status === 'hidden' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActing({ item, action: 'restore' })}><RotateCcw className="h-4 w-4" aria-hidden />Restore</button>}
                {item.status === 'reported' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActing({ item, action: 'clear' })}><ShieldCheck className="h-4 w-4" aria-hidden />Clear reports</button>}
              </div>
            </li>
          ))}
        </ul>
      ) : <EmptyState title={status === 'reported' ? 'Nothing to review' : 'Nothing hidden'} text="Reported posts wait here for a moderator." />)}

      {acting && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="mod-title">
          <div className="card w-full max-w-md p-5 sm:p-6">
            <h2 id="mod-title" className="font-display text-lg font-semibold text-ink">{acting.action === 'hide' ? 'Hide this post?' : acting.action === 'restore' ? 'Restore this post?' : 'Clear the reports?'}</h2>
            <p className="mt-2 text-sm text-ink-muted">{acting.action === 'hide' ? 'Members will no longer see it. It is kept, with its reports, as evidence.' : acting.action === 'restore' ? 'Members will see it again.' : 'The post stays visible and leaves the queue.'}</p>
            <label className="mt-4 block"><span className="label">Reason (recorded)</span><textarea className="input mt-1.5 min-h-[5rem] w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-ghost" onClick={() => { setActing(null); setReason(''); }} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || reason.trim().length < 5}>{busy ? 'Saving…' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </CommShell>
  );
}
