/**
 * Student learning home.
 * One continuation, a short progress summary, and one catalog suggestion.
 * Phase 8: everything about progress comes from GET /api/progress/summary (one request, from
 * persisted records, kept in sync across tabs and devices) instead of one request per course.
 * The course library stays on /courses.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import CourseCover from '@/components/CourseCover';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { LoadingStatus, MetricSkeleton } from '@/components/loading';
import { resolveLoadingPresentation } from '@/lib/loading-presentation';
import RemindersPanel from '@/components/RemindersPanel';
import { useAuth } from '@/hooks/useAuth';
import { useProgressSummary } from '@/hooks/useProgressSummary';
import { useCourses } from '@/hooks/useCourses';
import { CourseLists, LearningStatsTiles, RecentActivity } from '@/components/student/LearningSummary';
import { apiClient } from '@/lib/api-client';
import { sanitizeForStudentView } from '@/lib/html-sanitizer';
import { previewText } from '@/lib/plain-text';
import { ArrowRight } from 'lucide-react';
import OrbitProgress from '@/components/ui/OrbitProgress';

interface UpcomingConsultation {
  _id: string;
  topic: string;
  lifecycle: string;
  startsAt?: string | null;
}

export default function Dashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { summary, loading: progressLoading, error: progressError, refetch: refetchProgress } = useProgressSummary(Boolean(isAuthenticated && user?.role === 'student'));
  const { courses } = useCourses();
  const router = useRouter();
  const [consultations, setConsultations] = useState<UpcomingConsultation[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const fetchDashboardData = async () => {
    if (!user) return;

    try {
      setLoadingData(true);

      try {
        const rows = await apiClient.get<UpcomingConsultation[]>('/consultations/requests');
        const upcoming = (Array.isArray(rows) ? rows : []).filter((row) => {
          if (!row.startsAt) return false;
          if (!['CONFIRMED', 'PENDING_CONFIRMATION', 'RESCHEDULE_REQUESTED'].includes(row.lifecycle)) return false;
          return new Date(row.startsAt).getTime() > Date.now() - 60 * 60 * 1000;
        });
        setConsultations(upcoming.slice(0, 3));
      } catch {
        setConsultations([]);
      }
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!authLoading && isAuthenticated && user) {
      if (user.role === 'instructor') {
        if (user.status && user.status !== 'approved') {
          if (user.status === 'pending') {
            alert('Your registration is pending approval. Please wait for Super Admin approval before accessing your dashboard.');
          } else if (user.status === 'rejected') {
            alert('Your registration has been rejected. Please contact support for more information.');
          }
          router.push('/login');
          return;
        }
        router.push('/instructor/dashboard');
        return;
      }
      if (user.role === 'admin' || user.role === 'superadmin') {
        if (user.role === 'admin' && user.status && user.status !== 'approved') {
          if (user.status === 'pending') {
            alert('Your registration is pending approval. Please wait for Super Admin approval before accessing your dashboard.');
          } else if (user.status === 'rejected') {
            alert('Your registration has been rejected. Please contact support for more information.');
          }
          router.push('/login');
          return;
        }
        router.push('/admin');
      }
    }
  }, [isAuthenticated, authLoading, user, router]);

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchDashboardData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user]);

  const sessionBlocked = authLoading || !isAuthenticated || !user || user.role !== 'student';
  const progressView = resolveLoadingPresentation({
    authLoading: false,
    authorized: true,
    dataLoading: progressLoading || loadingData,
    error: progressError,
    hasData: Boolean(summary),
  });

  if (sessionBlocked) {
    return <LoadingSpinner message="Checking your session" fullScreen />;
  }

  const firstName = user?.name?.split(' ')[0] || 'there';
  const level = user?.learningLevel || (user as { studentDetails?: { tradingLevel?: string } })?.studentDetails?.tradingLevel;

  if (progressView === 'skeleton') {
    return (
      <div className="min-h-screen flex flex-col overflow-hidden">
        <Header />
        <div className="flex flex-1 relative overflow-hidden lg:items-start">
          <Sidebar />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:pt-10">
            <p className="page-kicker mb-2">Learning home</p>
            <h1 className="page-title">Welcome back, {firstName}</h1>
            <div className="mt-8 space-y-8">
              <LoadingStatus label="Loading your dashboard" />
              <MetricSkeleton count={3} />
            </div>
          </main>
        </div>
      </div>
    );
  }

  const enrolledCount = summary ? summary.totals.enrolled : courses.filter((course) => course.enrolled).length;
  const completedLessons = summary ? summary.totals.completedLessons : 0;
  // Continue learning (lib/progress-summary.js): last viewed course and lesson from the server.
  const nextLesson = summary?.continue || null;
  const continueCourse = nextLesson
    ? courses.find((course) => (course._id || course.id) === nextLesson.courseId)
    : undefined;
  const continueHref = nextLesson
    ? nextLesson.lessonId ? `/courses/${nextLesson.courseId}/lessons/${nextLesson.lessonId}` : `/courses/${nextLesson.courseId}`
    : '/courses';
  const catalogSuggestion = courses.find((course) => !course.enrolled);
  const started = enrolledCount > 0 || completedLessons > 0;

  return (
    <div className="min-h-screen flex flex-col overflow-hidden">
      <Header />
      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:pt-10">
          {/* Hero: the learning orbit. Greeting on the left, the next lesson on the right. */}
          <section className="panel-hero mb-8 animate-rise-in" data-testid={nextLesson ? 'continue-learning' : undefined}>
            <svg aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-[340px] w-[560px] text-primary-500 opacity-25" viewBox="0 0 560 340" fill="none">
              <ellipse cx="280" cy="170" rx="260" ry="118" transform="rotate(-16 280 170)" stroke="currentColor" />
              <ellipse cx="280" cy="170" rx="210" ry="88" transform="rotate(-16 280 170)" stroke="currentColor" strokeDasharray="2 8" />
            </svg>
            <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-8 lg:p-8">
              <div className="flex flex-col justify-between gap-5">
                <div>
                  <p className="page-kicker">Learning home</p>
                  <h1 className="page-title mt-3">{started ? `Welcome back, ${firstName}` : `Welcome, ${firstName}`}</h1>
                  <p className="page-lede">
                    {started ? 'Your next lesson is ready when you are.' : 'Start with a course. Your place in it will stay here.'}
                  </p>
                  {progressView === 'refresh' && (
                    <div className="mt-3">
                      <LoadingStatus label="Updating your dashboard" compact />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {level ? (
                    <span className="chip chip-brand !px-3 !py-1 text-xs">Level · {level}</span>
                  ) : (
                    <Link href="/onboarding" className="chip !px-3 !py-1 text-xs hover:border-primary-400 hover:text-ink">
                      Set your level
                    </Link>
                  )}
                  <Link href="/progress" className="chip !px-3 !py-1 text-xs hover:border-primary-400 hover:text-ink">My progress</Link>
                  <Link href="/student-dashboard" className="chip !px-3 !py-1 text-xs hover:border-primary-400 hover:text-ink">Practice desk</Link>
                </div>
              </div>

              {nextLesson ? (
                <div className="flex flex-col gap-4 rounded-2xl border border-line bg-[color-mix(in_srgb,var(--fo-surface-1)_88%,transparent)] p-4 sm:flex-row sm:items-center sm:p-5">
                  <div className="relative w-full shrink-0 sm:w-48">
                    <CourseCover
                      course={continueCourse || { id: nextLesson.courseId, title: nextLesson.courseTitle }}
                      className="w-full rounded-xl ring-1 ring-[var(--fo-line)]"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">Continue · {nextLesson.courseTitle}</p>
                    <h2 className="mt-1.5 font-display text-xl font-semibold leading-snug tracking-tight text-ink sm:text-2xl" dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(nextLesson.lessonTitle || 'Unlock the course to continue') }} />
                    <div className="mt-4 flex items-center gap-4">
                      {typeof nextLesson.percent === 'number' ? (
                        <OrbitProgress value={nextLesson.percent} size={52} label={`${nextLesson.courseTitle} progress`} />
                      ) : null}
                      <div className="min-w-0">
                        {typeof nextLesson.percent === 'number' ? (
                          <p className="text-xs text-ink-subtle"><span className="num font-semibold text-ink">{Math.round(nextLesson.percent)}%</span> of this course</p>
                        ) : null}
                        <Link href={continueHref} className="btn btn-primary mt-2 rounded-full px-5">
                          Continue learning
                          <ArrowRight className="h-4 w-4" aria-hidden />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ) : progressError ? (
                <div className="rounded-2xl border border-line bg-surface-1 p-5">
                  <p className="page-kicker">Progress</p>
                  <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-ink">Progress could not be loaded</h2>
                  <p className="mt-2 text-sm text-ink-muted">Your enrollments are unchanged. Try again before treating this as an empty enrollment list.</p>
                  <button type="button" onClick={() => refetchProgress()} className="btn btn-primary mt-4 rounded-full px-5">Try again</button>
                </div>
              ) : enrolledCount > 0 ? (
                <div className="rounded-2xl border border-line bg-surface-1 p-5">
                  <p className="page-kicker">Continue learning</p>
                  <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-ink">You have finished the lessons in your current courses</h2>
                  <p className="mt-2 text-sm text-ink-muted">Review a course, or open another one from the library.</p>
                  <Link href="/courses" className="btn btn-primary mt-4 rounded-full px-5">
                    View your courses
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              ) : (
                <div className="rounded-2xl border border-line bg-surface-1 p-5">
                  <p className="page-kicker">Where to begin</p>
                  <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-ink">Choose a course, then open its first lesson</h2>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                    Lessons, practice on the demo desk, and questions in the community all start from a course. Progress is kept on this page and on My progress.
                  </p>
                  <Link href="/courses" className="btn btn-primary mt-4 rounded-full px-5">
                    Browse courses
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              )}
            </div>
          </section>

          {progressError && !summary ? null : <LearningStatsTiles summary={summary} />}

          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0">
              {summary && <CourseLists summary={summary} />}
              {summary && <RecentActivity summary={summary} />}
            </div>

            <aside className="space-y-6" aria-label="Suggestions and reminders">
              {catalogSuggestion ? (
                <section className="card card-interactive overflow-hidden !p-0">
                  <CourseCover course={catalogSuggestion} className="w-full rounded-none" />
                  <div className="p-5">
                    <p className="page-kicker">From the catalog</p>
                    <h2 className="mt-2 font-display text-lg font-semibold tracking-tight text-ink" dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(catalogSuggestion.title) }} />
                    <p className="mt-2 line-clamp-3 text-sm text-ink-muted">{previewText(catalogSuggestion.description)}</p>
                    <p className="mt-3 text-xs capitalize text-ink-subtle">{catalogSuggestion.difficulty} · {catalogSuggestion.category}</p>
                    <Link href={`/courses/${catalogSuggestion._id || catalogSuggestion.id}`} className="btn btn-secondary btn-sm mt-4">
                      View this course
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </div>
                </section>
              ) : null}

              {consultations.length > 0 ? (
                <section className="card">
                  <h2 className="section-title">Consultations</h2>
                  <ul className="mt-3 divide-y divide-[var(--fo-line)]">
                    {consultations.map((booking) => (
                      <li key={booking._id} className="flex items-center justify-between gap-4 py-3">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">{booking.topic}</span>
                          <span className="block text-xs text-ink-subtle">{booking.startsAt ? new Date(booking.startsAt).toLocaleString() : ''}</span>
                        </span>
                        <Link href="/consultations" className="shrink-0 text-sm font-semibold text-primary-600 dark:text-primary-400">Open</Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <RemindersPanel hideWhenEmpty />

              <nav className="flex flex-wrap gap-2 text-sm" aria-label="More">
                <Link href="/courses" className="btn btn-ghost btn-sm">All courses</Link>
                <Link href="/progress" className="btn btn-ghost btn-sm">Progress</Link>
              </nav>
            </aside>
          </div>
        </main>
      </div>
      <Footer />
    </div>
  );
}
