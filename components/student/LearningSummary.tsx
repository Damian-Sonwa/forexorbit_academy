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
import OrbitProgress from '@/components/ui/OrbitProgress';

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
  const completed = course.status === 'completed';
  return (
    <li>
      <Link
        href={href}
        className="group flex min-h-[44px] items-center gap-4 rounded-xl border border-line bg-surface-1 p-3 pr-4 transition-all duration-200 ease-orbit hover:-translate-y-px hover:border-line-strong hover:shadow-lift"
      >
        <OrbitProgress value={percent} size={46} stroke={3.5} label={`${previewText(course.title)} progress`} tone={completed ? 'complete' : 'brand'} center={completed ? '✓' : undefined} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{previewText(course.title) || 'Course'}</p>
          <p className="mt-0.5 text-xs text-ink-subtle num">
            {course.completedLessons} of {course.totalLessons} lessons
            {completed && course.completedAt ? ` · completed ${new Date(course.completedAt).toLocaleDateString()}` : ''}
          </p>
        </div>
        <span className={`shrink-0 text-xs font-semibold ${completed ? 'text-up' : 'text-ink-muted group-hover:text-primary-600 dark:group-hover:text-primary-400'}`}>
          {completed ? 'Completed' : 'Resume →'}
        </span>
      </Link>
    </li>
  );
}

/** The five readouts as one instrument strip: a single panel divided by hairlines. */
export function LearningStatsTiles({ summary }: { summary: ProgressSummary | null }) {
  const totals = summary?.totals;
  const learning = summary?.learning;
  const dash = '—';
  const streak = learning?.streak;
  const tiles: Array<[string, string, string]> = [
    [totals ? String(totals.enrolled) : dash, 'Active courses', 'stat-enrolled'],
    [totals ? String(totals.completedLessons) : dash, 'Lessons completed', 'stat-lessons'],
    [totals ? String(totals.completedCourses) : dash, 'Courses completed', 'stat-courses'],
    [learning ? formatMinutes(learning.recentMinutes) : dash, 'Learning time, last 7 days', 'stat-time'],
    [streak ? `${streak.current} ${streak.current === 1 ? 'day' : 'days'}` : dash, streak ? `Streak · best ${streak.longest}` : 'Streak', 'stat-streak'],
  ];
  return (
    <section className="mb-8 overflow-hidden rounded-panel border border-line shadow-panel" aria-label="Learning progress">
      <div className="grid grid-cols-2 gap-px bg-[var(--fo-line)] sm:grid-cols-5">
        {tiles.map(([value, label, testId], i) => (
          <div
            key={testId}
            data-testid={testId}
            className={`relative bg-surface-1 px-5 py-4 sm:py-5 ${i === tiles.length - 1 ? 'col-span-2 sm:col-span-1' : ''}`}
          >
            {i === 0 && <span aria-hidden className="absolute left-0 top-4 h-6 w-[2px] rounded-r bg-primary-500" />}
            <p className="readout-value">{value}</p>
            <p className="mt-1 text-xs leading-snug text-ink-subtle">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RecentActivity({ summary }: { summary: ProgressSummary }) {
  const days = summary.learning.recent;
  const max = Math.max(1, ...days.map((d) => d.minutes));
  return (
    <section className="card mb-8" aria-label="Recent learning activity" data-testid="recent-activity">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="page-kicker">Recent activity</p>
        <p className="text-xs text-ink-subtle num">
          Today {formatMinutes(summary.learning.todayMinutes)} · total {formatMinutes(summary.learning.totalMinutes)}
        </p>
      </div>
      <div className="relative mt-5">
        {/* baseline grid */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[linear-gradient(var(--fo-line)_1px,transparent_1px)] bg-[length:100%_25%]" />
        <div className="relative flex items-end gap-2 sm:gap-3" role="list">
          {days.map((d) => {
            const today = d.day === summary.learning.today;
            const h = Math.round((d.minutes / max) * 100);
            return (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-2" role="listitem" aria-label={`${d.day}: ${formatMinutes(d.minutes)}`}>
                <div className="flex h-20 w-full items-end justify-center">
                  {d.minutes ? (
                    <div
                      className={`w-full max-w-[2.25rem] rounded-t-md ${today ? 'bg-[linear-gradient(180deg,#ffab6b,#ff7012)] shadow-[0_0_14px_rgba(255,112,18,0.45)]' : 'bg-[linear-gradient(180deg,rgba(255,138,51,0.75),rgba(194,78,0,0.55))]'}`}
                      style={{ height: `${Math.max(6, h)}%` }}
                    />
                  ) : (
                    <div className={`h-1 w-full max-w-[2.25rem] rounded-full ${today ? 'bg-primary-500/50' : 'bg-[var(--fo-line-strong)]'}`} />
                  )}
                </div>
                <span className={`text-[11px] ${today ? 'font-semibold text-primary-600 dark:text-primary-400' : 'text-ink-subtle'}`}>{weekday(d.day)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-subtle">Only time spent actively in a lesson counts.</p>
      {summary.recent.length > 0 && (
        <ul className="mt-5 space-y-1 border-t border-line pt-4" data-testid="recent-courses">
          {summary.recent.map((course) => (
            <li key={course.courseId} className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-muted">
              <Link href={course.lastLesson ? `/courses/${course.courseId}/lessons/${course.lastLesson.lessonId}` : `/courses/${course.courseId}`} className="hover:text-ink">
                <span className="font-medium text-ink">{previewText(course.title)}</span>
                {course.lastLesson ? ` · ${previewText(course.lastLesson.title)}` : ''}
              </Link>
              {course.lastViewedAt && <span className="text-xs text-ink-subtle">{new Date(course.lastViewedAt).toLocaleString()}</span>}
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
    <section className="mb-8 grid gap-6 md:grid-cols-2" aria-label="Your courses">
      <div data-testid="in-progress-courses">
        <p className="page-kicker">In progress</p>
        {summary.inProgress.length ? (
          <ul className="mt-3 space-y-2">{summary.inProgress.map((c) => <CourseRow key={c.courseId} course={c} />)}</ul>
        ) : (
          <p className="mt-3 text-sm text-ink-subtle">Nothing in progress.</p>
        )}
      </div>
      <div data-testid="completed-courses">
        <p className="page-kicker">Completed</p>
        {summary.completed.length ? (
          <ul className="mt-3 space-y-2">{summary.completed.map((c) => <CourseRow key={c.courseId} course={c} />)}</ul>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-line-strong p-4 text-sm text-ink-subtle">
            No completed courses yet. Finish every lesson in a course to see it here.
          </div>
        )}
      </div>
    </section>
  );
}
