/**
 * Instructor portal views (Phase 12). Presentational: props in, markup out. Figures are the
 * server's (lib/instructor-portal.js); titles stored as HTML are shown as plain text.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { previewText } from '@/lib/plain-text';
import { safeLinkUrl } from '@/lib/safe-url';
import { Disclosure, EmptyState, Metric, MetricGrid } from '@/components/student/dashboard/Panels';
import { formatDate, relativeTime } from '@/components/student/dashboard/format';
import type { ActivityRow, CourseRow, OverviewMetrics, QueueRow, StudentRow, SubmissionReview, TeachingEvent } from '@/lib/instructor-portal';

const txt = (v: string | null | undefined) => previewText(v);
const pct = (v: number | null) => (v === null ? '-' : `${v}%`);

const COURSE_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: '' },
  in_review: { label: 'In review', tone: 'chip-brand' },
  published: { label: 'Published', tone: 'chip-up' },
  archived: { label: 'Archived', tone: '' },
};
const STUDENT_STATUS: Record<string, { label: string; tone: string }> = {
  completed: { label: 'Completed', tone: 'chip-up' },
  in_progress: { label: 'In progress', tone: 'chip-brand' },
  not_started: { label: 'Not started', tone: '' },
};

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className="flex items-center gap-2">
      <div className="progress-track h-1.5 flex-1" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="progress-fill" style={{ width: `${v}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-semibold text-ink num">{Math.round(v)}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function TeachingMetrics({ m }: { m: OverviewMetrics }) {
  return (
    <MetricGrid cols="sm:grid-cols-3 lg:grid-cols-6">
      <Metric label="Courses" value={m.courses} hint={`${m.coursesByStatus.published} published · ${m.coursesByStatus.draft} draft`} testId="tm-courses" />
      <Metric label="Students" value={m.students} hint={`${m.enrollments} enrollment${m.enrollments === 1 ? '' : 's'}`} testId="tm-students" />
      <Metric label="Completion" value={pct(m.completionRate)} hint="of enrollments" testId="tm-completion" />
      <Metric label="Avg progress" value={pct(m.averageProgress)} hint={`${m.activeLearners7d} active this week`} testId="tm-progress" />
      <Metric label="To grade" value={m.pendingSubmissions} tone={m.pendingSubmissions ? 'text-caution' : 'text-ink'} hint={m.latePending ? `${m.latePending} late` : `${m.gradedSubmissions} graded`} testId="tm-pending" />
      <Metric label="Quiz pass rate" value={pct(m.quizPassRate)} hint={m.quizAttempts ? `${m.quizAttempts} attempts · avg ${pct(m.quizAveragePercent)}` : 'no attempts yet'} testId="tm-quiz" />
    </MetricGrid>
  );
}

export function GradingCallout({ m }: { m: OverviewMetrics }) {
  if (!m.pendingSubmissions) {
    return <p className="notice text-sm" data-testid="grading-clear">Nothing waiting for a grade. New submissions will appear in Grading.</p>;
  }
  return (
    <div className="notice notice-brand flex flex-wrap items-center justify-between gap-3" data-testid="grading-callout">
      <span className="text-sm">
        <span className="font-semibold text-ink num">{m.pendingSubmissions}</span> submission{m.pendingSubmissions === 1 ? '' : 's'} waiting for a grade
        {m.oldestPendingAt ? `, the oldest from ${relativeTime(m.oldestPendingAt)}` : ''}{m.latePending ? ` · ${m.latePending} late` : ''}.
      </span>
      <Link href="/instructor/grading" className="btn btn-primary btn-sm">Start grading</Link>
    </div>
  );
}

export function CourseTable({ courses }: { courses: CourseRow[] }) {
  if (!courses.length) return <EmptyState title="No courses assigned yet" text="Courses an admin assigns to you appear here." testId="courses-none" />;
  return (
    <div className="overflow-x-auto rounded-panel border border-line bg-surface-1">
      <table className="table-orbit w-full text-sm" data-testid="course-table">
        <thead><tr><th>Course</th><th className="hidden sm:table-cell">Status</th><th className="hidden text-right sm:table-cell">Lessons</th><th className="text-right">Students</th><th className="hidden md:table-cell">Avg progress</th><th className="hidden text-right sm:table-cell">Completion</th><th className="text-right">To grade</th><th className="hidden sm:table-cell"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {courses.map((c) => {
            const st = COURSE_STATUS[c.status] || { label: c.status, tone: '' };
            return (
              <tr key={c.courseId}>
                <td className="max-w-[16rem] font-medium text-ink"><Link href={`/instructor/courses/${c.courseId}`} className="line-clamp-2 hover:underline">{txt(c.title)}</Link><span className={`chip mt-1 sm:hidden ${st.tone}`}>{st.label}</span></td>
                <td className="hidden sm:table-cell"><span className={`chip ${st.tone}`}>{st.label}</span></td>
                <td className="hidden text-right num sm:table-cell">{c.lessons}</td>
                <td className="text-right num">{c.enrollments}</td>
                <td className="hidden min-w-[8rem] md:table-cell">{c.averageProgress === null ? <span className="text-ink-subtle">-</span> : <ProgressBar value={c.averageProgress} label={`${txt(c.title)} average progress`} />}</td>
                <td className="hidden text-right num sm:table-cell">{pct(c.completionRate)}</td>
                <td className={`text-right num ${c.pendingSubmissions ? 'font-semibold text-caution' : ''}`}>{c.pendingSubmissions}</td>
                <td className="hidden whitespace-nowrap text-right sm:table-cell">
                  <Link href={`/instructor/courses/${c.courseId}`} className="btn btn-ghost btn-sm">Manage</Link>
                  <Link href={`/instructor/students?courseId=${c.courseId}`} className="btn btn-ghost btn-sm">Students</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const EVENT_LABEL: Record<TeachingEvent['type'], string> = { submission: 'submitted', submission_graded: 'was graded on', enrollment: 'enrolled in' };

export function RecentTeaching({ events }: { events: TeachingEvent[] }) {
  if (!events.length) return <EmptyState title="No activity yet" text="Enrollments and submissions in your courses appear here." testId="recent-none" />;
  return (
    <ul className="divide-y divide-[var(--fo-line)]" data-testid="recent-teaching">
      {events.map((e, i) => (
        <li key={`${e.type}:${e.studentId}:${e.at}:${i}`} className="flex items-start justify-between gap-3 py-2.5">
          <span className="min-w-0 text-sm">
            <Link href={`/instructor/students/${e.studentId}`} className="font-semibold text-ink hover:underline">{e.student}</Link>{' '}
            <span className="text-ink-muted">{EVENT_LABEL[e.type]}</span>{' '}
            <span className="text-ink">{e.assignmentTitle ? txt(e.assignmentTitle) : txt(e.courseTitle)}</span>
            {e.late && <span className="chip chip-down ml-2">Late</span>}
            <span className="block text-xs text-ink-subtle">{e.assignmentTitle ? `${txt(e.courseTitle)} · ` : ''}{relativeTime(e.at)}</span>
          </span>
          {e.type === 'submission' && e.submissionId && <Link href={`/instructor/grading?submission=${e.submissionId}`} className="btn btn-secondary btn-sm shrink-0">Grade</Link>}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export function StudentTable({ rows }: { rows: StudentRow[] }) {
  if (!rows.length) return <EmptyState title="No students match" text="Students appear here once they enroll in your courses." testId="students-none" />;
  return (
    <>
      {/* Phones: cards */}
      <ul className="space-y-2 md:hidden" data-testid="student-cards">
        {rows.map((r) => (
          <li key={`${r.studentId}:${r.courseId}`} className="card !p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/instructor/students/${r.studentId}?courseId=${r.courseId}`} className="font-semibold text-ink hover:underline">{r.name}</Link>
                <p className="truncate text-xs text-ink-subtle">{txt(r.courseTitle)}</p>
              </div>
              <span className={`chip ${STUDENT_STATUS[r.status].tone}`}>{STUDENT_STATUS[r.status].label}</span>
            </div>
            <div className="mt-3"><ProgressBar value={r.progress} label={`${r.name} progress`} /></div>
            <p className="mt-2 text-xs text-ink-subtle">{r.completedLessons}/{r.totalLessons} lessons · {r.quiz.attempts ? `quiz avg ${pct(r.quiz.averagePercent)}` : 'no quizzes yet'} · {r.submissions.pending ? `${r.submissions.pending} to grade` : `${r.submissions.graded} graded`}</p>
          </li>
        ))}
      </ul>
      {/* Wider screens: table */}
      <div className="hidden overflow-x-auto rounded-panel border border-line bg-surface-1 md:block">
        <table className="table-orbit w-full text-sm" data-testid="student-table">
          <thead><tr><th>Student</th><th>Course</th><th>Status</th><th>Progress</th><th className="text-right">Lessons</th><th className="text-right">Quiz avg</th><th className="text-right">Work</th><th>Last active</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.studentId}:${r.courseId}`}>
                <td className="font-medium">
                  <Link href={`/instructor/students/${r.studentId}?courseId=${r.courseId}`} className="text-ink hover:underline">{r.name}</Link>
                  {r.level && <span className="block text-2xs capitalize text-ink-subtle">{r.level}</span>}
                </td>
                <td className="max-w-[14rem]"><span className="line-clamp-2">{txt(r.courseTitle)}</span></td>
                <td><span className={`chip ${STUDENT_STATUS[r.status].tone}`}>{STUDENT_STATUS[r.status].label}</span></td>
                <td className="min-w-[8rem]"><ProgressBar value={r.progress} label={`${r.name} progress`} /></td>
                <td className="text-right num">{r.completedLessons}/{r.totalLessons}</td>
                <td className="text-right num">{r.quiz.attempts ? pct(r.quiz.averagePercent) : '-'}</td>
                <td className="text-right num">{r.submissions.pending ? <span className="font-semibold text-caution">{r.submissions.pending} to grade</span> : `${r.submissions.graded} graded`}</td>
                <td className="whitespace-nowrap text-xs text-ink-subtle">{r.lastActivityAt ? relativeTime(r.lastActivityAt) : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export function QueueList({ rows, selectedId, onSelect }: { rows: QueueRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (!rows.length) return <EmptyState title="Nothing here" text="Submissions matching this filter will appear here." testId="queue-empty" />;
  return (
    <ul className="space-y-1.5" data-testid="queue-list">
      {rows.map((r) => {
        const active = r.submissionId === selectedId;
        return (
          <li key={r.submissionId}>
            <button
              type="button"
              onClick={() => onSelect(r.submissionId)}
              aria-current={active ? 'true' : undefined}
              className={`w-full rounded-xl border px-3.5 py-3 text-left transition-colors ${active ? 'border-primary-500 bg-tint' : 'border-line bg-surface-1 hover:border-line-strong'}`}
              data-testid={`queue-item-${r.submissionId}`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{r.student}</span>
                  <span className="block truncate text-xs text-ink-muted">{txt(r.assignmentTitle)}</span>
                </span>
                {r.status === 'graded' ? <span className="chip chip-up shrink-0 num">{r.grade}/100</span> : r.late ? <span className="chip chip-down shrink-0">Late</span> : <span className="chip shrink-0">To grade</span>}
              </span>
              <span className="mt-1 block truncate text-2xs text-ink-subtle">{txt(r.courseTitle)} · {relativeTime(r.submittedAt)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The work under review: the assignment brief, the student's answer and file, and the history. */
export function ReviewBody({ review }: { review: SubmissionReview }) {
  const s = review.submission;
  const a = review.assignment;
  const file = s.submissionFile ? safeLinkUrl(s.submissionFile) : null;
  return (
    <div className="space-y-4" data-testid="review-body">
      <div>
        <p className="readout-label">{txt(a.courseTitle)}</p>
        <h2 className="mt-1 font-display text-xl font-semibold text-ink">{txt(a.title)}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          <span className="font-semibold text-ink">{s.student}</span> · submitted {formatDate(s.submittedAt, true)}
          {a.dueDate ? ` · due ${formatDate(a.dueDate, true)}` : ''}
          {s.late && <span className="chip chip-down ml-2">Late</span>}
        </p>
      </div>
      {(a.instructions || a.description) && (
        <Disclosure title="Assignment brief" hint={`${a.points} points`} testId="review-brief">
          <p className="whitespace-pre-wrap text-sm text-ink-muted [overflow-wrap:anywhere]">{a.instructions || a.description}</p>
        </Disclosure>
      )}
      <div className="rounded-panel border border-line bg-surface-1 p-4">
        <p className="readout-label mb-2">Student&apos;s work</p>
        {s.submissionText ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink [overflow-wrap:anywhere]" data-testid="review-text">{s.submissionText}</p> : <p className="text-sm text-ink-subtle">No written answer.</p>}
        {file && <a href={file} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm mt-3">Open attached file</a>}
        {s.submissionFile && !file && <p className="mt-3 text-xs text-ink-subtle">The attached file link is not a safe address and is not shown.</p>}
      </div>
      {s.gradeHistory.length > 0 && (
        <Disclosure title="Grading history" hint={`${s.gradeHistory.length} entr${s.gradeHistory.length === 1 ? 'y' : 'ies'}`} testId="review-history">
          <ol className="space-y-3 text-sm">
            {[...s.gradeHistory].reverse().map((h, i) => (
              <li key={i} className="border-l-2 border-line-strong pl-3">
                <p className="text-ink"><span className="font-semibold num">{h.previousGrade !== null && h.previousGrade !== h.grade ? `${h.previousGrade} → ${h.grade}` : h.grade}</span><span className="text-ink-subtle"> /100 · {h.gradedBy} · {formatDate(h.gradedAt, true)}</span></p>
                {h.reason && <p className="text-xs text-ink-muted">Reason: {h.reason}</p>}
                {h.feedback && <p className="mt-1 whitespace-pre-wrap text-xs text-ink-muted [overflow-wrap:anywhere]">{h.feedback}</p>}
              </li>
            ))}
          </ol>
        </Disclosure>
      )}
      {s.previousVersions.length > 0 && (
        <p className="text-xs text-ink-subtle">This is a resubmission. {s.previousVersions.length} earlier version{s.previousVersions.length === 1 ? ' is' : 's are'} kept with {s.previousVersions.length === 1 ? 'its grade' : 'their grades'}.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export function ActivityLog({ rows }: { rows: ActivityRow[] }) {
  if (!rows.length) return <EmptyState title="No activity yet" text="Grades you give and changes to your course assignments are recorded here." testId="activity-none" />;
  return (
    <ol className="space-y-2" data-testid="activity-log">
      {rows.map((r) => {
        const grade = r.action.startsWith('assignment_');
        const before = r.before && typeof r.before.grade === 'number' ? r.before.grade : null;
        const after = r.after && typeof r.after.grade === 'number' ? r.after.grade : null;
        let detail: ReactNode = null;
        if (grade) detail = <>{r.student || 'Student'} · {txt(r.assignmentTitle)} · <span className="font-semibold text-ink num">{before !== null && r.action === 'assignment_regraded' ? `${before} → ${after}` : after}</span>/100</>;
        else detail = <>{txt(r.courseTitle)} · {r.direction === 'assigned_to_you' ? 'assigned to you' : r.direction === 'moved_from_you' ? 'moved to another instructor' : 'reassigned'}</>;
        return (
          <li key={r.id} className="card flex flex-col gap-1 !p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{r.label}</p>
              <p className="text-xs text-ink-muted [overflow-wrap:anywhere] sm:truncate">{detail}</p>
              {r.reason && <p className="mt-1 text-xs text-ink-subtle">Reason: {r.reason}</p>}
            </div>
            <span className="shrink-0 text-xs text-ink-subtle sm:text-right">{formatDate(r.at, true)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink-muted">
      <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="num">Page {page} of {pages}</span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}
