/**
 * What a student does after reading a lesson: the lesson quiz, its assignments and the practical
 * trading tasks attached to it. Each comes from its own system (quizzes, assignments, practical
 * tasks); this component only lays them out, the same way for students and in preview.
 *
 * Preview never records anything: the quiz shows its questions with the answer key (the existing
 * staff view, no attempt), assignments show what students will be asked without a submit form,
 * and practical tasks link to the task, never start an attempt.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ClipboardCheck, LineChart, ListChecks } from 'lucide-react';
import Quiz from '@/components/Quiz';
import LessonAssignments from '@/components/LessonAssignments';
import { apiClient } from '@/lib/api-client';

type PreviewQuiz = { questions: Array<{ id?: string; question: string; options: string[]; correctAnswer: number; points?: number }>; status?: string } | null;

type Props =
  | {
      mode: 'student';
      lessonId: string;
      courseId: string;
      quiz: unknown;
    }
  | {
      mode: 'preview';
      lessonId: string;
      courseId: string;
      quiz: PreviewQuiz;
      assignments: Array<{ id: string; title: string; status: string; dueDate: string | null; points: number }>;
      practicalTasks: Array<{ id: string; title: string; status: string }>;
    };

function Frame({ kicker, title, Icon, children, action, testId }: { kicker: string; title: string; Icon: typeof ListChecks; children?: React.ReactNode; action?: React.ReactNode; testId: string }) {
  return (
    <section className="rounded-xl border border-line bg-surface-1 p-4 sm:p-5" data-testid={testId}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
          <div>
            <p className="page-kicker">{kicker}</p>
            <h2 className="lesson-h3 mt-1">{title}</h2>
          </div>
        </div>
        {action}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

function StudentQuizPanel({ lessonId, courseId, quiz }: { lessonId: string; courseId: string; quiz: unknown }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [lessonId]);
  if (!quiz) return null;
  return (
    <Frame kicker="Check your understanding" title="Lesson quiz" Icon={ListChecks} testId="activity-quiz"
      action={<button type="button" onClick={() => setOpen((v) => !v)} className="btn btn-primary w-full shrink-0 sm:w-auto">{open ? 'Hide quiz' : 'Take quiz'}</button>}>
      {open && <div className="border-t border-line pt-4"><Quiz lessonId={lessonId} courseId={courseId} quiz={quiz as never} /></div>}
    </Frame>
  );
}

type StudentTask = { id: string; title: string; lessonId: string | null; state: string; dueAt: string | null };
const TASK_STATE: Record<string, string> = { todo: 'To do', in_progress: 'In progress', overdue: 'Overdue', awaiting_grading: 'Awaiting grading', returned: 'Returned for revision', graded: 'Graded', closed: 'Closed' };

function StudentPracticalTasks({ lessonId }: { lessonId: string }) {
  const [tasks, setTasks] = useState<StudentTask[]>([]);
  useEffect(() => {
    let alive = true;
    apiClient.get<{ tasks: StudentTask[] }>('/practical-tasks')
      .then((res) => { if (alive) setTasks((res.tasks || []).filter((t) => t.lessonId === lessonId)); })
      .catch(() => { if (alive) setTasks([]); });
    return () => { alive = false; };
  }, [lessonId]);
  if (!tasks.length) return null;
  return (
    <Frame kicker="Practise on the simulated market" title="Practical tasks" Icon={LineChart} testId="activity-practical">
      <ul className="divide-y divide-[var(--fo-line)]">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <span className="min-w-0">
              <span className="block text-[0.9375rem] font-medium text-ink">{t.title}</span>
              <span className="text-xs text-ink-subtle">{TASK_STATE[t.state] || t.state}{t.dueAt ? ` · due ${new Date(t.dueAt).toLocaleDateString()}` : ''}</span>
            </span>
            <Link href={`/student-dashboard/practical/${t.id}`} className="btn btn-secondary btn-sm">Open task</Link>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

export default function LessonActivities(props: Props) {
  if (props.mode === 'student') {
    return (
      <div className="space-y-5" data-testid="lesson-activities">
        <StudentQuizPanel lessonId={props.lessonId} courseId={props.courseId} quiz={props.quiz} />
        <LessonAssignments lessonId={props.lessonId} />
        <StudentPracticalTasks lessonId={props.lessonId} />
      </div>
    );
  }
  const { quiz, assignments, practicalTasks } = props;
  const visibleAssignments = assignments.filter((a) => a.status !== 'draft');
  const visibleTasks = practicalTasks.filter((t) => t.status === 'published' || t.status === 'closed');
  const showQuiz = quiz && quiz.questions.length > 0 && quiz.status === 'published';
  if (!showQuiz && !visibleAssignments.length && !visibleTasks.length) return null;
  return (
    <div className="space-y-5" data-testid="lesson-activities">
      {showQuiz && <PreviewQuizPanel quiz={quiz!} lessonId={props.lessonId} courseId={props.courseId} />}
      {visibleAssignments.length > 0 && (
        <Frame kicker="Show what you learned" title="Assignments" Icon={ClipboardCheck} testId="activity-assignments">
          <ul className="divide-y divide-[var(--fo-line)]">
            {visibleAssignments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <span>
                  <span className="block text-[0.9375rem] font-medium text-ink">{a.title}</span>
                  <span className="text-xs text-ink-subtle">{a.points} points{a.dueDate ? ` · due ${new Date(a.dueDate).toLocaleDateString()}` : ''}{a.status === 'closed' ? ' · closed' : ''}</span>
                </span>
                <span className="chip">Submission form · not available in preview</span>
              </li>
            ))}
          </ul>
        </Frame>
      )}
      {visibleTasks.length > 0 && (
        <Frame kicker="Practise on the simulated market" title="Practical tasks" Icon={LineChart} testId="activity-practical">
          <ul className="divide-y divide-[var(--fo-line)]">
            {visibleTasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <span className="font-medium text-ink">{t.title}</span>
                <span className="chip">Assigned students open it from here</span>
              </li>
            ))}
          </ul>
        </Frame>
      )}
    </div>
  );
}

function PreviewQuizPanel({ quiz, lessonId, courseId }: { quiz: NonNullable<PreviewQuiz>; lessonId: string; courseId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Frame kicker="Check your understanding" title="Lesson quiz" Icon={ListChecks} testId="activity-quiz"
      action={<button type="button" onClick={() => setOpen((v) => !v)} className="btn btn-primary w-full shrink-0 sm:w-auto">{open ? 'Hide quiz' : 'Take quiz'}</button>}>
      {open && <div className="border-t border-line pt-4"><Quiz lessonId={lessonId} courseId={courseId} quiz={{ questions: quiz.questions }} /></div>}
    </Frame>
  );
}
