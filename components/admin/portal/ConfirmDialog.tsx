/**
 * Confirmation for a sensitive admin action (Phase 13): states the consequence, optionally requires
 * a reason (5-500 characters), and reports the server's answer. The server decides and audits;
 * this dialog only collects intent.
 */

import { useEffect, useState } from 'react';

export default function ConfirmDialog({ title, consequence, confirmLabel, requireReason = false, danger = false, onConfirm, onClose }: {
  title: string;
  consequence: string;
  confirmLabel: string;
  requireReason?: boolean;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const ok = !requireReason || (reason.trim().length >= 5 && reason.trim().length <= 500);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    const problem = await onConfirm(reason.trim());
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="card w-full max-w-md !p-6" onClick={(e) => e.stopPropagation()} data-testid="confirm-dialog">
        <h2 id="confirm-title" className="font-display text-lg font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm text-ink-muted">{consequence}</p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          {requireReason && (
            <label className="block">
              <span className="label">Reason (recorded in the audit log)</span>
              <input className="input mt-1.5 w-full" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} required />
            </label>
          )}
          {error && <p className="notice notice-caution text-sm" role="alert">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={`btn ${danger ? 'btn-danger-quiet' : 'btn-primary'}`} disabled={!ok || busy}>{busy ? 'Working…' : confirmLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
