/**
 * Student learning home.
 * One continuation, a short progress summary, and one catalog suggestion.
 * The course library stays on /courses.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { LoadingStatus, MetricSkeleton } from '@/components/loading';
import { resolveLoadingPresentation } from '@/lib/loading-presentation';
import RemindersPanel from '@/components/RemindersPanel';
import { useAuth } from '@/hooks/useAuth';
import { useProgress } from '@/hooks/useProgress';
import { useCourses } from '@/hooks/useCourses';
import { countsTowardActiveTotals, sumActiveCompletedLessons } from '@/lib/enrollment-state';
import { apiClient } from '@/lib/api-client';
import { sanitizeForStudentView, stripHtml } from '@/lib/html-sanitizer';
import { ArrowRight } from 'lucide-react';

interface UpcomingLesson {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  order: number;
}

interface UpcomingConsultation {
  _id: string;
  topic: string;
  lifecycle: string;
  startsAt?: string | null;
}

export default function Dashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { progress, loading: progressLoading, error: progressError, refetch: refetchProgress } = useProgress();
  const { courses } = useCourses();
  const router = useRouter();
  const [upcomingLessons, setUpcomingLessons] = useState<UpcomingLesson[]>([]);
  const [consultations, setConsultations] = useState<UpcomingConsultation[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const fetchDashboardData = async () => {
    if (!user) return;

    try {
      setLoadingData(true);
      try {
        const lessons: UpcomingLesson[] = [];
        for (const row of progress) {
          if (!countsTowardActiveTotals(row) || !row.course || row.progress <= 0 || row.progress >= 100) continue;
          const courseLessons = await apiClient.get<Array<{ _id?: string; id?: string; title: string; order?: number }>>(`/lessons?courseId=${row.courseId}`);
          const nextLesson = courseLessons.find((lesson) => !row.completedLessons?.includes(lesson._id || lesson.id || ''));
          if (nextLesson) {
            lessons.push({
              courseId: row.courseId,
              courseTitle: row.course.title,
              lessonId: nextLesson._id || nextLesson.id || '',
              lessonTitle: nextLesson.title,
              order: nextLesson.order || 0,
            });
          }
        }
        setUpcomingLessons(lessons.slice(0, 3));
      } catch {
        setUpcomingLessons([]);
      }

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
    if (isAuthenticated && user && !progressLoading) {
      fetchDashboardData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user, progressLoading, progress]);

  const sessionBlocked = authLoading || !isAuthenticated || !user || user.role !== 'student';
  const progressView = resolveLoadingPresentation({
    authLoading: false,
    authorized: true,
    dataLoading: progressLoading || loadingData,
    error: progressError,
    hasData: progress.length > 0,
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
          <main className="flex-1 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10 pt-16 lg:pt-10 w-full">
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

  const activeProgress = progress.filter((row) => countsTowardActiveTotals(row));
  const enrolledCourses = courses.filter((course) => course.enrolled);
  const completedLessons = sumActiveCompletedLessons(progress);
  const finishedCourses = activeProgress.filter((row) => row.progress >= 100).length;
  const nextLesson = upcomingLessons[0];
  const continueCourse = nextLesson
    ? courses.find((course) => (course._id || course.id) === nextLesson.courseId)
    : undefined;
  const continueProgress = nextLesson
    ? activeProgress.find((row) => row.courseId === nextLesson.courseId)
    : undefined;
  const catalogSuggestion = courses.find((course) => !course.enrolled);
  const started = enrolledCourses.length > 0 || completedLessons > 0;

  return (
    <div className="min-h-screen flex flex-col overflow-hidden">
      <Header />
      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />
        <main className="flex-1 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10 pt-16 lg:pt-10 overflow-y-auto w-full">
          <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="page-kicker mb-2">Learning home</p>
              <h1 className="page-title">{started ? `Welcome back, ${firstName}` : `Welcome, ${firstName}`}</h1>
              <p className="mt-2 max-w-xl text-sm text-neutral-600">
                {started ? 'Your next lesson is ready when you are.' : 'Start with a course. Your place in it will stay here.'}
              </p>
              {progressView === 'refresh' && (
                <div className="mt-3">
                  <LoadingStatus label="Updating your dashboard" compact />
                </div>
              )}
            </div>
            {level ? (
              <span className="inline-flex w-fit items-center rounded-full border border-neutral-200 px-3 py-1 text-sm font-medium capitalize text-neutral-800">
                {level}
              </span>
            ) : (
              <Link href="/onboarding" className="text-sm font-medium text-neutral-600 underline-offset-4 hover:underline">
                Set your level
              </Link>
            )}
          </header>

          {nextLesson ? (
            <section className="mb-10 border-t border-neutral-200 pt-8">
              <p className="page-kicker">Continue learning</p>
              <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
                {continueCourse?.thumbnail ? (
                  <img src={continueCourse.thumbnail} alt="" className="h-28 w-full rounded-xl object-cover sm:h-32 sm:w-44" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-neutral-500">{nextLesson.courseTitle}</p>
                  <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-neutral-900" dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(nextLesson.lessonTitle) }} />
                  {typeof continueProgress?.progress === 'number' ? (
                    <p className="mt-3 text-sm text-neutral-600">{Math.round(continueProgress.progress)}% of this course</p>
                  ) : null}
                  <Link
                    href={`/courses/${nextLesson.courseId}/lessons/${nextLesson.lessonId}`}
                    className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary-400 px-5 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700"
                  >
                    Continue learning
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              </div>
            </section>
          ) : progressError ? (
            <section className="mb-10 border-t border-neutral-200 pt-8">
              <p className="page-kicker">Progress</p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-neutral-900">Progress could not be loaded</h2>
              <p className="mt-2 max-w-xl text-sm text-neutral-600">Your enrollments are unchanged. Try again before treating this as an empty enrollment list.</p>
              <button type="button" onClick={() => refetchProgress()} className="mt-5 inline-flex rounded-full bg-primary-400 px-5 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-primary-500">Try again</button>
            </section>
          ) : enrolledCourses.length > 0 ? (
            <section className="mb-10 border-t border-neutral-200 pt-8">
              <p className="page-kicker">Continue learning</p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-neutral-900">You have finished the lessons in your current courses</h2>
              <p className="mt-2 max-w-xl text-sm text-neutral-600">Review a course, or open another one from the library.</p>
              <Link href="/courses" className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary-400 px-5 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-primary-500">
                View your courses
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </section>
          ) : (
            <section className="mb-10 border-t border-neutral-200 pt-8">
              <p className="page-kicker">Where to begin</p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-neutral-900">Choose a course, then open its first lesson</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-600">
                Lessons, practice on the demo desk, and questions in the community all start from a course. Progress is kept on this page and on My progress.
              </p>
              <Link href="/courses" className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary-400 px-5 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-primary-500">
                Browse courses
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </section>
          )}

          <section className="mb-10 grid grid-cols-3 gap-4 border-y border-neutral-200 py-5" aria-label="Learning progress">
            <div>
              <p className="font-display text-2xl font-semibold text-neutral-900">{progressError ? '—' : enrolledCourses.length}</p>
              <p className="mt-1 text-xs text-neutral-500">Active courses</p>
            </div>
            <div>
              <p className="font-display text-2xl font-semibold text-neutral-900">{progressError ? '—' : completedLessons}</p>
              <p className="mt-1 text-xs text-neutral-500">Lessons completed</p>
            </div>
            <div>
              <p className="font-display text-2xl font-semibold text-neutral-900">{progressError ? '—' : finishedCourses}</p>
              <p className="mt-1 text-xs text-neutral-500">Courses completed</p>
            </div>
          </section>

          {catalogSuggestion ? (
            <section className="mb-10">
              <p className="page-kicker">From the catalog</p>
              <h2 className="mt-2 font-display text-xl font-semibold text-neutral-900" dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(catalogSuggestion.title) }} />
              <p className="mt-2 line-clamp-3 max-w-xl text-sm text-neutral-600">{stripHtml(sanitizeForStudentView(catalogSuggestion.description || ''))}</p>
              <p className="mt-2 text-xs capitalize text-neutral-500">{catalogSuggestion.difficulty} · {catalogSuggestion.category}</p>
              <Link href={`/courses/${catalogSuggestion._id || catalogSuggestion.id}`} className="mt-3 inline-flex text-sm font-semibold text-primary-700 hover:underline">
                View this course
              </Link>
            </section>
          ) : null}

          {upcomingLessons.length > 1 ? (
            <section className="mb-10">
              <h2 className="font-display text-lg font-semibold text-neutral-900">Also waiting</h2>
              <ul className="mt-3 divide-y divide-neutral-200">
                {upcomingLessons.slice(1).map((lesson) => (
                  <li key={`${lesson.courseId}-${lesson.lessonId}`}>
                    <Link href={`/courses/${lesson.courseId}/lessons/${lesson.lessonId}`} className="flex items-center justify-between gap-4 py-3">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-neutral-900" dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(lesson.lessonTitle) }} />
                        <span className="block truncate text-sm text-neutral-500">{lesson.courseTitle}</span>
                      </span>
                      <span className="shrink-0 text-xs text-neutral-500">Lesson {lesson.order}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {consultations.length > 0 ? (
            <section className="mb-10">
              <h2 className="font-display text-lg font-semibold text-neutral-900">Consultations</h2>
              <ul className="mt-3 divide-y divide-neutral-200">
                {consultations.map((booking) => (
                  <li key={booking._id} className="flex items-center justify-between gap-4 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-neutral-900">{booking.topic}</span>
                      <span className="block text-sm text-neutral-500">{booking.startsAt ? new Date(booking.startsAt).toLocaleString() : ''}</span>
                    </span>
                    <Link href="/consultations" className="shrink-0 text-sm font-semibold text-primary-700">Open</Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <RemindersPanel hideWhenEmpty />

          <p className="mt-10 text-sm text-neutral-500">
            <Link href="/courses" className="font-semibold text-neutral-800 underline-offset-4 hover:underline">All courses</Link>
            <span aria-hidden> · </span>
            <Link href="/progress" className="font-semibold text-neutral-800 underline-offset-4 hover:underline">Progress</Link>
          </p>
        </main>
      </div>
      <Footer />
    </div>
  );
}
