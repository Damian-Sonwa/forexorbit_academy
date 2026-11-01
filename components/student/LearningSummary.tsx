/**
 * Learning time, streak, recent activity and the in-progress / completed course lists (Phase 8),
 * all from GET /api/progress/summary. Definitions: docs/audits/phase-8-learning-progress.md
 * (learning time = active minutes; a learning day is a calendar day in the platform timezone with
 * at least one active minute; the streak counts consecutive learning days up to today, or up to
 * yesterday when today has no activity yet).
 */

import Link from 'next/link';
import type { ProgressSummary, SummaryCourse } from '@/lib/progress-summary';
import { previewText } from '@/lib/plain-text';

export function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total || 0));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const weekday = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });

function CourseRow({ course }: { course: SummaryCourse }) {
  const href = course.status !== 'completed' && course.next && course.next.lessonId
    ? `/courses/${course.courseId}/lessons/${course.next.lessonId}`
    : `/courses/${course.courseId}`;
  const percent = Math.round(Math.min(100, Math.max(0, course.percent)));
  return (
    <li>
      <Link href={href} className="flex min-h-[44px] items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 hover:border-primary-300 hover:bg-primary-50/40">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900">{previewText(course.title) || 'Course'}</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {course.completedLessons} of {course.totalLessons} lessons
            {course.status === 'completed' && course.completedAt
              ? ` · completed ${new Date(course.completedAt).toLocaleDateString()}`
              : ''}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${previewText(course.title)} progress`}>
            <div className={`h-full rounded-full ${course.status === 'completed' ? 'bg-emerald-500' : 'bg-primary-500'}`} style={{ width: `${percent}%` }} />
          </div>
        </div>
        <span className={`shrink-0 text-xs font-semibold ${course.status === 'completed' ? 'text-emerald-700' : 'text-neutral-700'}`}>
          {course.status === 'completed' ? 'Completed' : `${percent}%`}
        </span>
      </Link>
    </li>
  );
}

export function LearningStatsTiles({ summary }: { summary: ProgressSummary | null }) {
  const totals = summary?.totals;
  const learning = summary?.learning;
  const tile = (value: string, label: string, testId: string) => (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-soft" data-testid={testId}>
      <p className="font-display text-2xl font-semibold text-neutral-900">{value}</p>
      <p className="mt-1 text-xs text-neutral-500">{label}</p>
    </div>
  );
  const dash = '—';
  const streak = learning?.streak;
  return (
    <section className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5" aria-label="Learning progress">
      {tile(totals ? String(totals.enrolled) : dash, 'Active courses', 'stat-enrolled')}
      {tile(totals ? String(totals.completedLessons) : dash, 'Lessons completed', 'stat-lessons')}
      {tile(totals ? String(totals.completedCourses) : dash, 'Courses completed', 'stat-courses')}
      {tile(learning ? formatMinutes(learning.recentMinutes) : dash, 'Learning time, last 7 days', 'stat-time')}
      {tile(streak ? `${streak.current} ${streak.current === 1 ? 'day' : 'days'}` : dash, streak ? `Streak · best ${streak.longest}` : 'Streak', 'stat-streak')}
    </section>
  );
}

export function RecentActivity({ summary }: { summary: ProgressSummary }) {
  const days = summary.learning.recent;
  const max = Math.max(1, ...days.map((d) => d.minutes));
  return (
    <section className="mb-10" aria-label="Recent learning activity" data-testid="recent-activity">
      <p className="page-kicker">Recent activity</p>
      <div className="mt-3 flex items-end gap-2" role="list">
        {days.map((d) => (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-1" role="listitem" aria-label={`${d.day}: ${formatMinutes(d.minutes)}`}>
            <div className="flex h-16 w-full items-end overflow-hidden rounded-md bg-neutral-100">
              <div className={`w-full ${d.minutes ? 'bg-primary-500' : ''}`} style={{ height: `${Math.round((d.minutes / max) * 100)}%` }} />
            </div>
            <span className={`text-[11px] ${d.day === summary.learning.today ? 'font-semibold text-neutral-900' : 'text-neutral-500'}`}>{weekday(d.day)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Today {formatMinutes(summary.learning.todayMinutes)} · total {formatMinutes(summary.learning.totalMinutes)}. Only time spent actively in a lesson counts.
      </p>
      {summary.recent.length > 0 && (
        <ul className="mt-4 space-y-2" data-testid="recent-courses">
          {summary.recent.map((course) => (
            <li key={course.courseId} className="text-sm text-neutral-700">
              <Link href={course.lastLesson ? `/courses/${course.courseId}/lessons/${course.lastLesson.lessonId}` : `/courses/${course.courseId}`} className="hover:underline">
                <span className="font-medium text-neutral-900">{previewText(course.title)}</span>
                {course.lastLesson ? ` · ${previewText(course.lastLesson.title)}` : ''}
              </Link>
              {course.lastViewedAt && <span className="text-xs text-neutral-500"> · {new Date(course.lastViewedAt).toLocaleString()}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CourseLists({ summary }: { summary: ProgressSummary }) {
  if (!summary.inProgress.length && !summary.completed.length) return null;
  return (
    <section className="mb-10 grid gap-6 md:grid-cols-2" aria-label="Your courses">
      <div data-testid="in-progress-courses">
        <p className="page-kicker">In progress</p>
        {summary.inProgress.length ? (
          <ul className="mt-3 space-y-2">{summary.inProgress.map((c) => <CourseRow key={c.courseId} course={c} />)}</ul>
        ) : (
          <p className="mt-3 text-sm text-neutral-500">Nothing in progress.</p>
        )}
      </div>
      <div data-testid="completed-courses">
        <p className="page-kicker">Completed</p>
        {summary.completed.length ? (
          <ul className="mt-3 space-y-2">{summary.completed.map((c) => <CourseRow key={c.courseId} course={c} />)}</ul>
        ) : (
          <p className="mt-3 text-sm text-neutral-500">No completed courses yet.</p>
        )}
      </div>
    </section>
  );
}
