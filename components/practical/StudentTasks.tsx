/**
 * The student's practical tasks (practice dashboard section). GET /api/practical-tasks lists only
 * the tasks assigned to this student, with their state; figures in the summary are the student's
 * own graded attempts.
 */

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, ClipboardCheck, Target } from 'lucide-react';
import { EmptyState, ErrorState } from '@/components/student/dashboard/Panels';
import { CourseCardSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import { Chip, Deadline, DifficultyDots, ModeBadge, STUDENT_STATE, pair } from './Common';
import type { StudentTaskCard, StudentTaskList } from '@/lib/practical-tasks';

const GROUPS: Array<[string, string]> = [['todo', 'To do'], ['waiting', 'Awaiting grade'], ['graded', 'Graded'], ['overdue', 'Overdue'], ['', 'All']];
const COMPETENCY: Record<string, string> = { analysis: 'Market analysis', execution: 'Execution', risk: 'Risk management', management: 'Trade management', reflection: 'Reflection' };

function action(t: StudentTaskCard) {
  if (t.state === 'returned') return 'Revise';
  if (t.state === 'in_progress') return 'Continue';
  if (t.state === 'not_started') return 'Start task';
  if (t.state === 'graded') return 'View result';
  return 'Open';
}

export function TaskCard({ t }: { t: StudentTaskCard }) {
  const open = ['not_started', 'in_progress', 'returned'].includes(t.state);
  return (
    <li className={`card card-interactive flex flex-col p-0 ${open ? '' : 'opacity-[0.97]'}`} data-testid="practical-card">
      <Link href={`/student-dashboard/practical/${t.id}`} className="flex h-full flex-col gap-3 p-5 focus-visible:outline-none">
        <div className="flex items-start justify-between gap-3">
          <Chip map={STUDENT_STATE} value={t.state} />
          <span className="text-xs text-ink-subtle">{t.instruments.map(pair).join(' · ')}</span>
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{t.title}</h3>
          <p className="mt-1 text-xs text-ink-muted">{t.category}{t.course ? ` · ${t.course}` : ''} · {t.instructor}</p>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          <DifficultyDots value={t.difficulty} />
          <ModeBadge mode={t.gradingMode} />
          {open && <Deadline iso={t.dueAt} />}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-xs text-ink-muted num">
            {t.result ? <><span className="font-semibold text-ink">{t.result.score}</span> / {t.result.maxScore} · {t.result.percent}%</> : `${t.maxScore} points · ${t.attemptsLeft} of ${t.maxAttempts} attempt${t.maxAttempts === 1 ? '' : 's'} left`}
          </span>
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary-600 dark:text-primary-400">{action(t)}<ArrowRight className="h-4 w-4" aria-hidden /></span>
        </div>
      </Link>
    </li>
  );
}

export default function StudentPracticalTasks() {
  const [group, setGroup] = useState('todo');
  const { data, error, loading, reload } = usePortalResource<StudentTaskList>(`/practical-tasks${group ? `?group=${group}` : ''}`);
  const s = data?.summary;
  return (
    <div className="space-y-5" data-testid="practical-tasks">
      <div className="panel-hero p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <p className="page-kicker">Practical assessment</p>
            <h2 className="section-title mt-2">Practical trading tasks</h2>
            <p className="mt-1.5 text-sm text-ink-muted">Tasks from your instructors. Trade them on the simulated desk; you are assessed on your decisions and risk, not on whether the market moved your way.</p>
          </div>
          {s && (
            <dl className="grid grid-cols-3 gap-4 text-left sm:text-right">
              <div><dt className="readout-label">To do</dt><dd className="font-display text-xl font-semibold num text-ink">{s.pending}</dd></div>
              <div><dt className="readout-label">Completed</dt><dd className="font-display text-xl font-semibold num text-ink">{s.completed}</dd></div>
              <div><dt className="readout-label">Average</dt><dd className="font-display text-xl font-semibold num text-ink">{s.averagePercent ? `${s.averagePercent}%` : '-'}</dd></div>
            </dl>
          )}
        </div>
        {s && (s.competencies.length > 0 || s.riskDiscipline) && (
          <div className="mt-5 flex flex-wrap gap-2">
            {s.riskDiscipline && <span className="chip chip-brand"><Target className="h-3.5 w-3.5" aria-hidden />Risk discipline {s.riskDiscipline.percent}%</span>}
            {s.competencies.map((c) => <span key={c.id} className="chip">{COMPETENCY[c.id] || c.id} {c.percent}%</span>)}
          </div>
        )}
      </div>

      <div className="max-w-full overflow-x-auto">
        <div className="inline-flex min-w-max gap-1 rounded-xl border border-line bg-surface-2 p-1" role="tablist" aria-label="Task status">
          {GROUPS.map(([id, label]) => (
            <button key={id || 'all'} type="button" role="tab" aria-selected={group === id} onClick={() => setGroup(id)} className={`min-h-[40px] rounded-lg px-3.5 text-sm font-medium ${group === id ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}>
              {label}{data && id && data.counts[id as keyof StudentTaskList['counts']] > 0 && <span className="ml-1.5 text-ink-subtle num">{data.counts[id as keyof StudentTaskList['counts']]}</span>}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><CourseCardSkeleton /><CourseCardSkeleton /><CourseCardSkeleton /></div>}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (data.tasks.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.tasks.map((t) => <TaskCard key={t.id} t={t} />)}</ul>
      ) : (
        <EmptyState
          title={group === 'todo' ? 'Nothing to do right now' : 'No tasks here'}
          text={group === 'todo' ? 'New practical tasks from your instructors appear here, with their deadline and how they are graded.' : 'Tasks move here as you work through them.'}
          action={<span className="inline-flex items-center gap-2 text-xs text-ink-subtle"><ClipboardCheck className="h-4 w-4" aria-hidden />Assigned through your courses</span>}
        />
      ))}
    </div>
  );
}
