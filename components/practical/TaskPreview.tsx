/** How a student will see a task: the server's own presentation (POST /api/practical-tasks/preview). */

import { Chip, Deadline, DifficultyDots, Instructions, MODE, ModeBadge, RubricList, SimulatedNote, TASK_STATUS, pair } from './Common';
import type { Block, StaffTaskView } from '@/lib/practical-tasks';

export default function TaskPreview({ task, blocks }: { task: StaffTaskView; blocks: Block[] }) {
  const r = task.requirements;
  return (
    <div className="space-y-5" data-testid="task-preview">
      <div className="panel-hero p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Chip map={TASK_STATUS} value={task.status} />
          <span className="chip">{task.categoryLabel}</span>
          {r.simulator && <SimulatedNote />}
        </div>
        <h2 className="page-title mt-4 [overflow-wrap:anywhere]">{task.title}</h2>
        {task.summary && <p className="page-lede">{task.summary}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-muted">
          <DifficultyDots value={task.difficulty} />
          <ModeBadge mode={task.gradingMode} long />
          <span>{task.instruments.map(pair).join(' · ')}</span>
          <Deadline iso={task.dueAt} quiet />
          <span className="num">{task.rubric.maxScore} points · {task.maxAttempts} attempt{task.maxAttempts === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-5">
          <div className="card p-5">
            <p className="readout-label">Learning objectives</p>
            <ul className="mt-2 space-y-1.5 text-sm text-ink">{task.objectives.map((o) => <li key={o} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" aria-hidden />{o}</li>)}</ul>
            <p className="readout-label mb-2 mt-5">Instructions</p>
            <Instructions blocks={blocks} />
          </div>
          <RubricList criteria={task.rubric.criteria} maxScore={task.rubric.maxScore} />
        </div>
        <div className="card h-fit p-5 text-sm">
          <p className="readout-label">Rules the student sees</p>
          <dl className="mt-3 space-y-2">
            {r.simulator && <div className="flex justify-between gap-3"><dt className="text-ink-muted">Trades</dt><dd className="num">{r.minTrades === r.maxTrades ? r.minTrades : `${r.minTrades}-${r.maxTrades}`}</dd></div>}
            <div className="flex justify-between gap-3"><dt className="text-ink-muted">Max risk</dt><dd className="num">{r.maxRiskPercent}%</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-muted">Min reward : risk</dt><dd className="num">{r.minRewardRisk} : 1</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-muted">Order types</dt><dd className="capitalize">{r.orderTypes.join(', ')}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-muted">External evidence</dt><dd className="capitalize">{r.external === 'none' ? 'Not used' : r.external}</dd></div>
          </dl>
          <p className="mt-4 text-xs text-ink-muted">{MODE[task.gradingMode].help}</p>
        </div>
      </div>
    </div>
  );
}
