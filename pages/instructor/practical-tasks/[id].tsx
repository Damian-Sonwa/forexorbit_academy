/**
 * One practical task (instructors; admins read only).
 *   GET    /api/practical-tasks/:id          task, figures, per-student state, eligible students
 *   PUT    /api/practical-tasks/:id          save edits (version check; policy changes after attempts
 *                                            need confirmation and a reason, audited)
 *   POST   /api/practical-tasks/:id/publish  publish or assign more students (confirmation first)
 *   POST   /api/practical-tasks/:id/status   close, reopen, archive;  DELETE discards a draft
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import PortalShell from '@/components/instructor/portal/PortalShell';
import TaskEditor, { draftFromTask, type EditorDraft } from '@/components/practical/TaskEditor';
import TaskPreview from '@/components/practical/TaskPreview';
import { Chip, MODE, ModeBadge, STUDENT_STATE, TASK_STATUS } from '@/components/practical/Common';
import { EmptyState, ErrorState, Metric, MetricGrid } from '@/components/student/dashboard/Panels';
import { LessonSkeleton } from '@/components/loading';
import { formatDate } from '@/components/student/dashboard/format';
import { usePortalResource } from '@/hooks/usePortalResource';
import { apiClient } from '@/lib/api-client';
import { formatBlocks } from '@/lib/practical-task-spec';
import type { StaffTaskDetail, StaffTaskList } from '@/lib/practical-tasks';

type Tab = 'overview' | 'students' | 'assign' | 'edit' | 'history';
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
type Problem = { error: string; field?: string; code?: string; changes?: string[] };
const failure = (err: unknown): Problem => { const d = (err as { response?: { data?: Partial<Problem> } })?.response?.data; return { ...(d || {}), error: d?.error || 'Something went wrong. Try again.' }; };

function Confirm({ title, children, confirmLabel, onConfirm, onCancel, busy, danger = false, disabled = false }: { title: string; children: React.ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="card w-full max-w-lg p-5 sm:p-6">
        <h2 id="confirm-title" className="font-display text-lg font-semibold text-ink">{title}</h2>
        <div className="mt-3 space-y-3 text-sm text-ink-muted">{children}</div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={`btn ${danger ? 'btn-danger-quiet' : 'btn-primary'}`} onClick={onConfirm} disabled={busy || disabled} data-testid="confirm-action">{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export default function PracticalTaskDetail() {
  const router = useRouter();
  const id = one(router.query.id);
  const { data, error, loading, reload } = usePortalResource<StaffTaskDetail>(router.isReady && id ? `/practical-tasks/${id}` : null);
  const courses = usePortalResource<StaffTaskList>(router.isReady ? '/practical-tasks?limit=1' : null);
  const [tab, setTab] = useState<Tab>('overview');
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [problem, setProblem] = useState<{ field?: string; error: string; code?: string; changes?: string[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(router.query.created ? 'Draft saved. Review it, then assign students to publish.' : null);
  const [audience, setAudience] = useState<'course' | 'students'>('course');
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<null | 'publish' | 'close' | 'reopen' | 'archive' | 'discard' | 'policy'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data && !draft) setDraft(draftFromTask(data.task)); }, [data, draft]);
  useEffect(() => { if (router.query.created) setNotice('Draft saved. Review it, then assign students to publish.'); }, [router.query.created]);
  const t = data?.task;
  const readOnly = Boolean(data?.readOnly);
  const unassigned = useMemo(() => (data?.eligibleStudents || []).filter((s) => !s.assigned), [data]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setProblem(null);
    try {
      await fn();
      setNotice(done);
      setConfirm(null);
      setReason('');
      setDraft(null);
      await reload();
    } catch (err) {
      const f = failure(err);
      if ((f as { code?: string }).code === 'policy_change_needs_confirmation') setConfirm('policy');
      else setConfirm(null);
      setProblem(f);
    } finally { setBusy(false); }
  };

  const publish = () => act(() => apiClient.post(`/practical-tasks/${id}/publish`, { audience, studentIds: audience === 'students' ? picked : undefined, expectedVersion: t!.version }), t!.status === 'draft' ? 'Published. Students were notified once each.' : 'Assigned. New students were notified.');
  const status = (action: 'close' | 'reopen' | 'archive') => act(() => apiClient.post(`/practical-tasks/${id}/status`, { action }), action === 'close' ? 'Closed: no new submissions.' : action === 'reopen' ? 'Reopened.' : 'Archived.');
  const save = (confirmPolicyChange = false) => draft && act(() => apiClient.put(`/practical-tasks/${id}`, { definition: draft.definition, courseId: draft.courseId, lessonId: draft.lessonId || null, resources: draft.resources.filter((r) => r.label || r.url), expectedVersion: t!.version, ...(confirmPolicyChange ? { confirmPolicyChange: true, reason } : {}) }), 'Changes saved.');
  const discard = async () => {
    setBusy(true);
    try { await apiClient.delete(`/practical-tasks/${id}`); void router.push('/instructor/practical-tasks'); } catch (err) { setProblem(failure(err)); setConfirm(null); } finally { setBusy(false); }
  };

  const TABS: Array<[Tab, string]> = [['overview', 'Overview'], ['students', `Students${t ? ` (${t.recipients})` : ''}`], ...(!readOnly && t && ['draft', 'published'].includes(t.status) ? [['assign', t.status === 'draft' ? 'Publish' : 'Assign more'] as [Tab, string]] : []), ...(!readOnly && t && t.status !== 'archived' ? [['edit', 'Edit'] as [Tab, string]] : []), ['history', 'Versions']];

  return (
    <PortalShell title={t ? t.title : 'Practical task'} lede={t ? `${t.categoryLabel} · ${data?.course?.title || ''}` : undefined}
      actions={t && !readOnly && (
        <div className="flex flex-wrap gap-2">
          {t.status === 'published' && <button type="button" className="btn btn-secondary" onClick={() => setConfirm('close')}>Close</button>}
          {t.status === 'closed' && <button type="button" className="btn btn-secondary" onClick={() => setConfirm('reopen')}>Reopen</button>}
          {t.status === 'closed' && <button type="button" className="btn btn-ghost" onClick={() => setConfirm('archive')}>Archive</button>}
          {t.status === 'draft' && <button type="button" className="btn btn-ghost" onClick={() => setConfirm('discard')}>Discard draft</button>}
          {t.status === 'draft' && <button type="button" className="btn btn-primary" onClick={() => setTab('assign')}><Send className="h-4 w-4" aria-hidden />Publish</button>}
        </div>
      )}>
      <Link href="/instructor/practical-tasks" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />All practical tasks</Link>
      {loading && !data && <LessonSkeleton />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {notice && <p className="notice notice-brand mb-4 text-sm" role="status">{notice}</p>}
      {problem && confirm !== 'policy' && <p className="notice notice-caution mb-4 text-sm" role="alert">{problem.error}</p>}
      {t && data && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
            <Chip map={TASK_STATUS} value={t.status} />
            <ModeBadge mode={t.gradingMode} long />
            <span>Version {t.version} · rubric v{t.rubric.version}</span>
            {t.dueAt && <span>Due {formatDate(t.dueAt, true)}</span>}
            {readOnly && <span className="chip">Read only</span>}
          </div>
          <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="inline-flex min-w-max gap-1 rounded-xl border border-line bg-surface-2 p-1" role="tablist" aria-label="Task sections">
              {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-[40px] rounded-lg px-3.5 text-sm font-medium ${tab === k ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}>{label}</button>)}
            </div>
          </div>

          {tab === 'overview' && (
            <div className="space-y-6">
              <MetricGrid cols="sm:grid-cols-3 lg:grid-cols-6">
                <Metric label="Assigned" value={data.stats.recipients} />
                <Metric label="Started" value={data.stats.started} />
                <Metric label="Submission rate" value={data.stats.submissionRate ? `${data.stats.submissionRate}%` : '-'} hint={`${data.stats.submitted} submitted`} />
                <Metric label="To grade" value={data.stats.waiting} tone={data.stats.waiting ? 'text-caution' : 'text-ink'} />
                <Metric label="Completion" value={data.stats.completionRate ? `${data.stats.completionRate}%` : '-'} hint={`${data.stats.graded} graded`} />
                <Metric label="Average score" value={data.stats.averagePercent ? `${data.stats.averagePercent}%` : '-'} hint="latest graded attempts" />
              </MetricGrid>
              {data.missedCriteria.length > 0 && (
                <section className="card p-5">
                  <h2 className="section-title">Frequently missed criteria</h2>
                  <ul className="mt-4 space-y-3">
                    {data.missedCriteria.map((m) => {
                      const pct = m.assessed ? Math.round((m.missed / m.assessed) * 100) : 0;
                      return (
                        <li key={m.id}>
                          <div className="flex justify-between gap-3 text-sm"><span className="text-ink">{m.label}</span><span className="num text-ink-muted">{m.missed} of {m.assessed}</span></div>
                          <div className="progress-track mt-1.5"><div className="progress-fill bg-down" style={{ width: `${pct}%` }} /></div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              <TaskPreview task={t} blocks={formatBlocks(t.instructions)} />
            </div>
          )}

          {tab === 'students' && (data.students.length ? (
            <div className="overflow-x-auto rounded-panel border border-line bg-surface-1">
              <table className="table-orbit w-full text-sm" data-testid="task-students">
                <thead><tr><th>Student</th><th>State</th><th className="hidden sm:table-cell">Attempts</th><th className="text-right">Result</th><th><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium text-ink">{s.name}{s.submittedAt && <span className="block text-2xs font-normal text-ink-subtle">Submitted {formatDate(s.submittedAt, true)}</span>}</td>
                      <td><Chip map={STUDENT_STATE} value={s.state} /></td>
                      <td className="hidden num sm:table-cell">{s.attemptsUsed}</td>
                      <td className="text-right num">{s.result ? `${s.result.score}/${s.result.maxScore}` : '-'}</td>
                      <td className="text-right">{s.latestAttemptId && s.state !== 'in_progress' && <Link className="btn btn-secondary btn-sm" href={`/instructor/practical-tasks/review/${encodeURIComponent(s.latestAttemptId)}`}>Open</Link>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Not assigned yet" text="Publish the task to the course or to selected students." />)}

          {tab === 'assign' && (
            <section className="card space-y-5 p-5 sm:p-6">
              <div>
                <h2 className="section-title">{t.status === 'draft' ? 'Publish and assign' : 'Assign more students'}</h2>
                <p className="mt-1 text-sm text-ink-muted">Only students actively enrolled in {data.course?.title || 'the course'} can receive this task. Students already assigned are never notified twice.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Audience">
                {([['course', 'Everyone in the course', `${unassigned.length} not yet assigned`], ['students', 'Selected students', 'Choose from the enrolment list']] as const).map(([k, title, hint]) => (
                  <button key={k} type="button" role="radio" aria-checked={audience === k} onClick={() => setAudience(k)} className={`rounded-xl border p-4 text-left ${audience === k ? 'border-primary-500 bg-tint' : 'border-line'}`}><span className="block text-sm font-semibold text-ink">{title}</span><span className="text-xs text-ink-muted">{hint}</span></button>
                ))}
              </div>
              {audience === 'students' && (data.eligibleStudents.length ? (
                <ul className="max-h-80 divide-y divide-[var(--fo-line)] overflow-y-auto rounded-xl border border-line">
                  {data.eligibleStudents.map((s) => (
                    <li key={s.id}>
                      <label className={`flex min-h-[44px] items-center gap-3 px-4 py-2 text-sm ${s.assigned ? 'text-ink-subtle' : 'text-ink'}`}>
                        <input type="checkbox" className="h-4 w-4 accent-[var(--fo-brand)]" disabled={s.assigned} checked={s.assigned || picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
                        {s.name}{s.assigned && <span className="ml-auto text-2xs">assigned</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="No enrolled students" text="Students appear here once they enrol in the course." />)}
              <div className="rounded-xl border border-line bg-surface-2 p-4 text-sm">
                <p className="font-semibold text-ink">{MODE[t.gradingMode].label}</p>
                <p className="mt-1 text-ink-muted">{MODE[t.gradingMode].help}</p>
              </div>
              <button type="button" className="btn btn-primary" disabled={audience === 'students' ? !picked.length : !unassigned.length} onClick={() => setConfirm('publish')} data-testid="publish-open"><Send className="h-4 w-4" aria-hidden />{t.status === 'draft' ? 'Publish' : 'Assign'}</button>
            </section>
          )}

          {tab === 'edit' && draft && (
            <div className="space-y-4">
              {data.attemptsExist && <p className="notice notice-caution text-sm">Students have started this task. Text and deadline changes apply at once. Rubric, requirement or grading-method changes apply only to new attempts, need a reason, and are recorded.</p>}
              <TaskEditor draft={draft} onChange={setDraft} courses={courses.data?.courses || (data.course ? [data.course] : [])} errorField={problem} lockedCourse={t.status !== 'draft'} />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setDraft(draftFromTask(t))}>Reset</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
              </div>
            </div>
          )}

          {tab === 'history' && (
            <ol className="space-y-3">
              {[...t.versions].reverse().map((v) => (
                <li key={v.version} className="card p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-ink">Version {v.version} · rubric v{v.rubricVersion}</span><span className="text-xs text-ink-subtle">{formatDate(v.at, true)}</span></div>
                  <p className="mt-1 text-ink-muted">{v.changes.join(', ')}</p>
                  {v.reason && <p className="mt-1 text-xs text-ink-muted">Reason: {v.reason}</p>}
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {confirm === 'publish' && t && <Confirm title={t.status === 'draft' ? 'Publish this task?' : 'Assign to more students?'} confirmLabel={t.status === 'draft' ? 'Publish' : 'Assign'} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void publish()}>
        <p>{audience === 'course' ? `${unassigned.length} student${unassigned.length === 1 ? '' : 's'}` : `${picked.length} selected student${picked.length === 1 ? '' : 's'}`} will see it on their dashboard and get one notification.</p>
        <p>Grading: <span className="font-semibold text-ink">{MODE[t.gradingMode].label}</span>. Each attempt keeps this method and rubric (v{t.rubric.version}) from the moment it starts.</p>
      </Confirm>}
      {confirm === 'close' && <Confirm title="Close this task?" confirmLabel="Close task" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void status('close')}><p>Students can no longer start or submit attempts. Submitted work can still be graded. You can reopen it while the deadline is in the future.</p></Confirm>}
      {confirm === 'reopen' && <Confirm title="Reopen this task?" confirmLabel="Reopen" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void status('reopen')}><p>Assigned students can start and submit attempts again until the deadline.</p></Confirm>}
      {confirm === 'archive' && <Confirm title="Archive this task?" confirmLabel="Archive" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void status('archive')}><p>The task and every submission and grade are kept. It can no longer be edited or reopened.</p></Confirm>}
      {confirm === 'discard' && <Confirm title="Discard this draft?" confirmLabel="Discard" danger busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void discard()}><p>The draft was never published, so no student has seen it. This cannot be undone.</p></Confirm>}
      {confirm === 'policy' && <Confirm title="Change the grading rules?" confirmLabel="Confirm change" busy={busy} disabled={reason.trim().length < 10} onCancel={() => { setConfirm(null); setProblem(null); }} onConfirm={() => void save(true)}>
        <p>{problem?.error}</p>
        <label className="block"><span className="label">Reason (recorded)</span><textarea className="input mt-1.5 min-h-[5rem] w-full" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
      </Confirm>}
    </PortalShell>
  );
}
