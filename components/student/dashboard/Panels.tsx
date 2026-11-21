/**
 * Student dashboard sections (Phase 11). Presentational: props in, markup out. Every figure is the
 * server's (lib/student-analytics.js); these components only lay it out and pick empty states.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import OrbitProgress from '@/components/ui/OrbitProgress';
import CourseCover from '@/components/CourseCover';
import type {
  ActivityEvent,
  AssessmentPerformance,
  CourseCard,
  Milestone,
  Overview,
  Recommendation,
  StudentDashboard,
  UpcomingItem,
} from '@/lib/student-analytics';
import { previewText } from '@/lib/plain-text';
import { COURSE_STATUS, UPCOMING_STATUS, formatDate, learningStatus, minutesLabel, relativeTime } from './format';

/** Titles are stored as HTML in places: shown as plain, escaped text (no HTML sink). */
const txt = (value: string | null | undefined) => previewText(value);

export function Section({ id, kicker, title, action, children, className = '' }: { id?: string; kicker?: string; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={`scroll-mt-24 ${className}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          {kicker && <p className="page-kicker">{kicker}</p>}
          <h2 id={id ? `${id}-title` : undefined} className="section-title mt-2">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ title, text, action, testId }: { title: string; text?: string; action?: ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-5 py-8 text-center" data-testid={testId}>
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {text && <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-caution flex flex-wrap items-center justify-between gap-3 text-sm" role="alert">
      <span>{text}</span>
      {onRetry && <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm">Try again</button>}
    </div>
  );
}

/** A labelled figure. */
export function Metric({ label, value, hint, tone = 'text-ink', testId }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string; testId?: string }) {
  return (
    <div className="bg-surface-1 px-4 py-3.5">
      <dt className="readout-label">{label}</dt>
      <dd className={`mt-1 font-display text-xl font-semibold num ${tone}`} data-testid={testId}>{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-ink-subtle">{hint}</dd>}
    </div>
  );
}

export function MetricGrid({ children, cols = 'sm:grid-cols-3 lg:grid-cols-6' }: { children: ReactNode; cols?: string }) {
  return <dl className={`grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-[var(--fo-line)] ${cols}`}>{children}</dl>;
}

/**
 * Secondary information behind a native disclosure (keyboard and screen-reader friendly, works
 * without JavaScript). Content stays in the document, so it is searchable and testable.
 */
export function Disclosure({ title, hint, children, defaultOpen = false, testId }: { title: string; hint?: ReactNode; children: ReactNode; defaultOpen?: boolean; testId?: string }) {
  return (
    <details className="group rounded-panel border border-line bg-surface-1 open:shadow-panel" open={defaultOpen || undefined} data-testid={testId}>
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 rounded-panel px-4 py-3 hover:bg-[color-mix(in_srgb,var(--fo-text)_3%,transparent)] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="text-sm font-semibold text-ink">{title}</span>
          {hint && <span className="ml-2 text-xs text-ink-subtle">{hint}</span>}
        </span>
        <svg className="h-4 w-4 shrink-0 text-ink-subtle transition-transform duration-200 group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="border-t border-line p-4">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Welcome and continue learning
// ---------------------------------------------------------------------------

export function WelcomeHero({ data, fallbackName, levelChip }: { data: StudentDashboard; fallbackName?: string | null; levelChip?: ReactNode }) {
  const name = data.student.firstName || fallbackName || null;
  const o = data.overview;
  const started = o.enrolled > 0 || o.completedLessons > 0;
  const next = data.recommendations[0];
  const c = data.continue;
  return (
    <section className="panel-hero animate-rise-in" aria-labelledby="welcome-title">
      <svg aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-[340px] w-[560px] text-primary-500 opacity-25" viewBox="0 0 560 340" fill="none">
        <ellipse cx="280" cy="170" rx="260" ry="118" transform="rotate(-16 280 170)" stroke="currentColor" />
        <ellipse cx="280" cy="170" rx="210" ry="88" transform="rotate(-16 280 170)" stroke="currentColor" strokeDasharray="2 8" />
      </svg>
      <div className="relative grid grid-cols-1 gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-8 lg:p-8">
        <div className="flex flex-col justify-between gap-5">
          <div>
            <p className="page-kicker">Learning home</p>
            <h1 id="welcome-title" className="page-title mt-3" data-testid="welcome-name">
              {started ? 'Welcome back' : 'Welcome'}{name ? `, ${name}` : ''}
            </h1>
            <p className="page-lede" data-testid="learning-status">{learningStatus(o)}</p>
            {data.learning.streak.current > 0 && (
              <p className="mt-2 text-sm text-ink-muted">
                <span className="font-semibold text-ink num">{data.learning.streak.current}-day</span> learning streak{data.learning.streak.activeToday ? '' : ' · learn today to keep it'}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {levelChip}
            {next && (
              <Link href={next.href} className="chip !px-3 !py-1 text-xs hover:border-primary-400 hover:text-ink" data-testid="next-action">
                Next: {next.action}
              </Link>
            )}
          </div>
        </div>
        <ContinueCard data={data} />
      </div>
      {c && <span className="sr-only">Continue {txt(c.courseTitle)}</span>}
    </section>
  );
}

export function ContinueCard({ data }: { data: StudentDashboard }) {
  const c = data.continue;
  const course = c ? data.courses.find((x) => x.courseId === c.courseId) : null;
  if (!c) {
    const allDone = data.overview.enrolled > 0 && data.overview.completedCourses === data.overview.enrolled;
    return (
      <div className="rounded-2xl border border-line bg-surface-1 p-5" data-testid="continue-empty">
        <p className="page-kicker">{data.overview.enrolled ? 'Continue learning' : 'Where to begin'}</p>
        <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-ink">
          {data.overview.enrolled === 0 ? 'Choose a course, then open its first lesson' : allDone ? 'You have finished the lessons in your courses' : 'Nothing to resume right now'}
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          {data.overview.enrolled === 0 ? 'Your progress, quizzes and practice all start from a course.' : 'Review a course, or open another one from the library.'}
        </p>
        <Link href="/courses" className="btn btn-primary mt-4 rounded-full px-5">{data.overview.enrolled === 0 ? 'Browse courses' : 'View courses'} →</Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-[color-mix(in_srgb,var(--fo-surface-1)_88%,transparent)] p-4 sm:flex-row sm:items-center sm:p-5" data-testid="continue-learning">
      <div className="relative w-full shrink-0 sm:w-44">
        <CourseCover course={{ id: c.courseId, title: txt(c.courseTitle), thumbnail: course ? course.thumbnail : null }} className="w-full rounded-xl ring-1 ring-[var(--fo-line)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">Continue · {txt(c.courseTitle)}</p>
        <h2 className="mt-1.5 font-display text-xl font-semibold leading-snug tracking-tight text-ink">{txt(c.lessonTitle) || 'Unlock the course to continue'}</h2>
        <div className="mt-4 flex items-center gap-4">
          <OrbitProgress value={c.percent} size={52} label={`${txt(c.courseTitle)} progress`} />
          <div className="min-w-0">
            <p className="text-xs text-ink-subtle">
              <span className="num font-semibold text-ink">{Math.round(c.percent)}%</span> of this course
              {c.lastStudiedAt ? ` · last studied ${relativeTime(c.lastStudiedAt)}` : ''}
            </p>
            <Link href={c.href} className="btn btn-primary mt-2 rounded-full px-5" data-testid="resume-link">
              {c.lessonId ? 'Resume lesson' : 'Open course'} →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The overview's four figures: courses, lessons, overall progress, this week's learning time. */
export function KeyFigures({ overview, weekMinutes }: { overview: Overview; weekMinutes: number }) {
  return (
    <MetricGrid cols="lg:grid-cols-4">
      <Metric label="Courses in progress" value={overview.inProgressCourses} hint={`${overview.enrolled} enrolled · ${overview.completedCourses} completed`} testId="metric-in-progress" />
      <Metric label="Lessons done" value={overview.completedLessons} hint={overview.totalLessons ? `of ${overview.totalLessons}` : 'none yet'} testId="metric-lessons" />
      <Metric label="Overall progress" value={overview.overallPercent === null ? '-' : `${overview.overallPercent}%`} hint="across your courses" testId="metric-overall" />
      <Metric label="This week" value={minutesLabel(weekMinutes)} hint="learning time, 7 days" testId="metric-week" />
    </MetricGrid>
  );
}

export function OverviewMetrics({ overview, minutes, certificates }: { overview: Overview; minutes: number; certificates: number }) {
  return (
    <MetricGrid>
      <Metric label="Enrolled" value={overview.enrolled} testId="metric-enrolled" />
      <Metric label="In progress" value={overview.inProgressCourses} testId="metric-in-progress" />
      <Metric label="Completed" value={overview.completedCourses} testId="metric-completed" />
      <Metric label="Lessons done" value={overview.completedLessons} hint={overview.totalLessons ? `of ${overview.totalLessons}` : undefined} testId="metric-lessons" />
      <Metric label="Overall progress" value={overview.overallPercent === null ? '-' : `${overview.overallPercent}%`} hint="lessons, all courses" testId="metric-overall" />
      <Metric label="Learning time" value={minutesLabel(minutes)} hint={certificates ? `${certificates} certificate${certificates === 1 ? '' : 's'}` : 'all time'} testId="metric-time" />
    </MetricGrid>
  );
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export function MyCourses({ courses }: { courses: CourseCard[] }) {
  if (!courses.length) {
    return <EmptyState title="No courses yet" text="Enrolled courses appear here with your progress." action={<Link href="/courses" className="btn btn-primary btn-sm">Browse courses</Link>} testId="courses-empty" />;
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="my-courses">
      {courses.map((c) => (
        <li key={c.courseId} className="card card-interactive flex flex-col overflow-hidden !p-0">
          <CourseCover course={{ id: c.courseId, title: txt(c.title), thumbnail: c.thumbnail }} className="w-full rounded-none" />
          <div className="flex flex-1 flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-base font-semibold leading-snug text-ink">{txt(c.title)}</h3>
              <span className={`chip shrink-0 ${c.status === 'completed' ? 'chip-up' : c.status === 'in_progress' ? 'chip-brand' : ''}`}>{COURSE_STATUS[c.status]}</span>
            </div>
            <p className="mt-1 text-xs capitalize text-ink-subtle">{[c.difficulty, c.category].filter(Boolean).join(' · ')}{c.archived ? ' · archived' : ''}</p>
            <div className="mt-3 flex items-center gap-3">
              <div className="progress-track h-1.5 flex-1" role="progressbar" aria-valuenow={Math.round(c.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${txt(c.title)} progress`}>
                <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, c.percent))}%` }} />
              </div>
              <span className="text-xs font-semibold text-ink num">{Math.round(c.percent)}%</span>
            </div>
            <p className="mt-1.5 text-xs text-ink-subtle num">{c.completedLessons} of {c.totalLessons} lessons{c.lastStudiedAt ? ` · ${relativeTime(c.lastStudiedAt)}` : ''}</p>
            <div className="mt-auto pt-4">
              <Link href={c.href} className={`btn btn-sm w-full ${c.action === 'continue' ? 'btn-primary' : 'btn-secondary'}`} data-testid={`course-action-${c.courseId}`}>
                {c.action === 'review' ? 'Review course' : c.action === 'start' ? 'Start course' : 'Continue'}
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export function UpcomingAssessments({ upcoming, limit, onViewAll }: { upcoming: StudentDashboard['upcoming']; limit?: number; onViewAll?: () => void }) {
  const shown = limit ? upcoming.items.slice(0, limit) : upcoming.items;
  const hidden = upcoming.total - shown.length;
  if (!upcoming.items.length) {
    return <EmptyState title="Nothing due right now" text="Quizzes and assignments from your courses appear here when they are open to you." testId="upcoming-empty" />;
  }
  return (
    <ul className="divide-y divide-[var(--fo-line)] overflow-hidden rounded-panel border border-line bg-surface-1" data-testid="upcoming-list">
      {shown.map((item: UpcomingItem) => {
        const status = UPCOMING_STATUS[item.status] || { label: item.status, tone: '' };
        return (
          <li key={item.id} className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold text-ink sm:truncate">{txt(item.title)}</p>
              <p className="line-clamp-2 text-xs text-ink-subtle sm:truncate">
                {txt(item.courseTitle)}
                {item.kind === 'assignment' && item.lessonTitle ? ` · ${txt(item.lessonTitle)}` : ''}
                {item.status === 'opens_soon' && item.opensAt ? ` · opens ${formatDate(item.opensAt, true)}` : ''}
                {item.dueAt && item.status !== 'opens_soon' ? ` · ${item.kind === 'quiz' ? 'closes' : 'due'} ${formatDate(item.dueAt, true)}` : ''}
                {item.kind === 'quiz' && typeof item.attemptsRemaining === 'number' ? ` · ${item.attemptsRemaining} attempt${item.attemptsRemaining === 1 ? '' : 's'} left` : ''}
                {item.kind === 'quiz' && item.timeLimitMinutes ? ` · ${item.timeLimitMinutes} min` : ''}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 sm:contents">
            <span className={`chip ${status.tone}`}>{status.label}</span>
            {item.status === 'opens_soon' ? (
              <span className="btn btn-ghost btn-sm pointer-events-none opacity-60" aria-disabled="true">Not open yet</span>
            ) : (
              <Link href={item.href} className="btn btn-secondary btn-sm" data-testid={`upcoming-open-${item.id}`}>
                {item.status === 'in_progress' ? 'Resume' : item.kind === 'quiz' ? 'Open quiz' : 'Open'}
              </Link>
            )}
            </div>
          </li>
        );
      })}
      {hidden > 0 && (
        <li className="px-4 py-2.5 text-xs text-ink-subtle">
          {onViewAll ? (
            <button type="button" onClick={onViewAll} className="font-semibold text-primary-600 hover:underline dark:text-primary-400" data-testid="upcoming-view-all">View all {upcoming.total} →</button>
          ) : `and ${hidden} more in your courses`}
        </li>
      )}
    </ul>
  );
}

export function AssessmentSummary({ a, retakes, showRecent = true }: { a: AssessmentPerformance; retakes: number; showRecent?: boolean }) {
  if (!a.attempts) {
    return <EmptyState title="No quiz results yet" text="Your quiz scores and pass rate appear here after your first attempt." testId="assessments-empty" />;
  }
  return (
    <div className="space-y-4" data-testid="assessment-summary">
      <MetricGrid cols="sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Attempts" value={a.attempts} testId="metric-attempts" />
        <Metric label="Quizzes passed" value={a.quizzesPassed} hint={`of ${a.quizzesAttempted} attempted`} testId="metric-quizzes-passed" />
        <Metric label="Pass rate" value={a.passRate === null ? '-' : `${a.passRate}%`} hint="attempts with a pass mark" testId="metric-pass-rate" />
        <Metric label="Average score" value={a.averagePercent === null ? '-' : `${a.averagePercent}%`} hint={a.scanned < a.attempts ? `last ${a.scanned} attempts` : undefined} testId="metric-average" />
        <Metric label="Retakes open" value={retakes} testId="metric-retakes" />
      </MetricGrid>
      {showRecent && <RecentScores a={a} />}
    </div>
  );
}

/** The latest quiz results, newest first. */
export function RecentScores({ a }: { a: AssessmentPerformance }) {
  if (!a.recent.length) return <p className="text-sm text-ink-subtle">No results yet.</p>;
  return (
    <div>
      <ul className="divide-y divide-[var(--fo-line)] overflow-hidden rounded-panel border border-line bg-surface-1" data-testid="recent-scores">
        {a.recent.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{txt(r.lessonTitle) || 'Lesson quiz'}</p>
              <p className="truncate text-xs text-ink-subtle">{txt(r.courseTitle) || 'Course'}{r.attemptNumber ? ` · attempt ${r.attemptNumber}` : ''} · {relativeTime(r.finishedAt)}</p>
            </div>
            <span className="text-sm font-semibold text-ink num">{r.percent}%</span>
            {r.passed !== null && <span className={`chip ${r.passed ? 'chip-up' : 'chip-down'}`}>{r.passed ? 'Passed' : 'Not passed'}</span>}
            {r.href && <Link href={r.href} className="btn btn-ghost btn-sm">Review</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recommendations, milestones, activity
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<Recommendation['kind'], string> = { learn: 'Learn', assess: 'Assess', practice: 'Practise' };

export function Recommendations({ items: all, limit, exclude = [] }: { items: Recommendation[]; limit?: number; exclude?: string[] }) {
  const filtered = all.filter((r) => !exclude.includes(r.id));
  const items = limit ? filtered.slice(0, limit) : filtered;
  if (!items.length) return <EmptyState title="You are up to date" text="Nothing needs your attention right now." testId="recommendations-empty" />;
  return (
    <ol className="space-y-2" data-testid="recommendations">
      {items.map((r, i) => (
        <li key={r.id} className="card flex flex-col gap-3 !p-4 sm:flex-row sm:items-start">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs font-semibold text-ink-muted num" aria-hidden>{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-400">{KIND_LABEL[r.kind]}</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">{txt(r.title)}</p>
            <p className="mt-0.5 text-xs text-ink-muted">{txt(r.reason)}</p>
          </div>
          <Link href={r.href} className="btn btn-secondary btn-sm w-full shrink-0 sm:w-auto">{r.action}</Link>
        </li>
      ))}
    </ol>
  );
}

export function Milestones({ items }: { items: Milestone[] }) {
  const achieved = items.filter((m) => m.achieved).length;
  return (
    <div>
      <p className="mb-3 text-sm text-ink-muted" data-testid="milestones-count"><span className="font-semibold text-ink num">{achieved}</span> of {items.length} milestones reached</p>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="milestones">
        {items.map((m) => (
          <li key={m.id} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${m.achieved ? 'border-primary-500/40 bg-tint' : 'border-line bg-surface-1'}`} data-achieved={m.achieved}>
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${m.achieved ? 'bg-primary-500 text-neutral-950' : 'border border-line-strong text-ink-subtle'}`} aria-hidden>{m.achieved ? '✓' : ''}</span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${m.achieved ? 'text-ink' : 'text-ink-muted'}`}>{m.title}</p>
              <p className="text-xs text-ink-subtle">
                {m.achieved ? (m.at ? `Reached ${formatDate(m.at)}` : 'Reached') : m.description}
                {!m.achieved && m.progress ? ` · ${m.progress.current}/${m.progress.target}` : ''}
              </p>
              {!m.achieved && m.progress && (
                <div className="progress-track mt-2 h-1" aria-hidden><div className="progress-fill" style={{ width: `${(m.progress.current / m.progress.target) * 100}%` }} /></div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const EVENT_GLYPH: Record<ActivityEvent['type'], string> = {
  course_started: '▶',
  course_completed: '★',
  lesson_completed: '✓',
  quiz_finished: '?',
  assignment_submitted: '↑',
  certificate_earned: '◆',
  trade_closed: '⇄',
};

export function ActivityList({ events, now }: { events: ActivityEvent[]; now?: Date }) {
  if (!events.length) return <EmptyState title="No activity yet" text="Completed lessons, quiz results, submissions and practice trades appear here." testId="activity-empty" />;
  return (
    <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-[var(--fo-line-strong)]" data-testid="activity-list">
      {events.map((e) => {
        const body = (
          <>
            <span className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-1 text-xs text-ink-muted ring-4 ring-[var(--fo-bg)]" aria-hidden>{EVENT_GLYPH[e.type]}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{txt(e.title)}</span>
              <span className="block truncate text-xs text-ink-subtle">{[e.detail ? txt(e.detail) : null, relativeTime(e.at, now)].filter(Boolean).join(' · ')}</span>
            </span>
          </>
        );
        return (
          <li key={e.id}>
            {e.href ? (
              <Link href={e.href} className="flex items-center gap-3 rounded-lg px-0 py-1.5 hover:bg-[color-mix(in_srgb,var(--fo-text)_4%,transparent)]">{body}</Link>
            ) : (
              <div className="flex items-center gap-3 py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The overview's practice summary: four figures and a way into the Practice tab. SIMULATED. */
export function PracticeSnapshot({ trading, onOpen }: { trading: StudentDashboard['trading']; onOpen?: () => void }) {
  const p = trading.performance;
  const o = trading.overview;
  const tone = (v: string | null) => (!v ? 'text-ink' : v.startsWith('-') ? 'text-down' : /^0(\.0+)?$/.test(v) ? 'text-ink' : 'text-up');
  return (
    <section className="card !p-5" aria-labelledby="practice-snapshot" data-testid="practice-snapshot">
      <div className="flex items-center justify-between gap-3">
        <h2 id="practice-snapshot" className="section-title">Practice desk</h2>
        <span className="sim-badge">Simulated</span>
      </div>
      {!trading.hasAccount && p.closedTrades === 0 ? (
        <>
          <p className="mt-3 text-sm text-ink-muted">Try what you learn with USD 10,000 of virtual funds.</p>
          <Link href="/student-dashboard" className="btn btn-secondary btn-sm mt-4 w-full">Open the practice desk</Link>
        </>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            <div><dt className="readout-label">Balance</dt><dd className="mt-0.5 font-semibold text-ink num" data-testid="snapshot-balance">{o ? o.account.balance : '-'}</dd></div>
            <div><dt className="readout-label">Closed trades</dt><dd className="mt-0.5 font-semibold text-ink num">{p.closedTrades}</dd></div>
            <div><dt className="readout-label">Win rate</dt><dd className="mt-0.5 font-semibold text-ink num">{p.winRate === null ? '-' : `${p.winRate}%`}</dd></div>
            <div><dt className="readout-label">Net realised</dt><dd className={`mt-0.5 font-semibold num ${tone(p.netRealized)}`}>{p.netRealized}</dd></div>
          </dl>
          {onOpen && <button type="button" onClick={onOpen} className="btn btn-ghost btn-sm mt-4 w-full" data-testid="practice-snapshot-open">View practice analytics →</button>}
        </>
      )}
    </section>
  );
}
