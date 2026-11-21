/**
 * "Report" for a community discussion or reply (Phase 14): POST /api/community/reports. One report
 * per member per post; the moderators see the reason, not who reported it.
 */

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

const REASONS: Array<[string, string]> = [['spam', 'Spam or advertising'], ['abuse', 'Harassment or abuse'], ['misleading', 'Misleading trading advice or scams'], ['off_topic', 'Off topic'], ['other', 'Something else']];

export default function ReportButton({ targetType, targetId }: { targetType: 'question' | 'reply'; targetId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setState('busy');
    setError(null);
    try {
      await apiClient.post('/community/reports', { targetType, targetId, reason, details });
      setState('done');
      setOpen(false);
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'The report could not be sent.');
      setState('idle');
    }
  };

  if (state === 'done') return <span className="text-xs font-medium text-ink-subtle">Reported. Thank you.</span>;
  return (
    <>
      <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-ink-subtle hover:text-ink" onClick={() => setOpen(true)}><Flag className="h-3.5 w-3.5" aria-hidden />Report</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby={`report-${targetId}`}>
          <div className="card w-full max-w-md p-5 sm:p-6">
            <h2 id={`report-${targetId}`} className="font-display text-lg font-semibold text-ink">Report this {targetType === 'question' ? 'discussion' : 'reply'}</h2>
            <p className="mt-1 text-sm text-ink-muted">Moderators review every report. They see the reason, not your name.</p>
            <fieldset className="mt-4 space-y-2">
              <legend className="sr-only">Reason</legend>
              {REASONS.map(([id, label]) => (
                <label key={id} className="flex items-center gap-2 text-sm text-ink"><input type="radio" name={`reason-${targetId}`} className="accent-[var(--fo-brand)]" checked={reason === id} onChange={() => setReason(id)} />{label}</label>
              ))}
            </fieldset>
            <label className="mt-3 block"><span className="label">Details {reason === 'other' ? '(required)' : '(optional)'}</span><textarea className="input mt-1.5 min-h-[4.5rem] w-full" maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
            {error && <p className="notice notice-caution mt-3 text-sm" role="alert">{error}</p>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={state === 'busy'}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={state === 'busy' || (reason === 'other' && details.trim().length < 5)}>{state === 'busy' ? 'Sending…' : 'Send report'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
