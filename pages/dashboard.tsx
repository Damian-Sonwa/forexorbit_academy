/**
 * Student Dashboard
 * Shows enrolled courses, progress, and statistics
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import CourseCard from '@/components/CourseCard';
import LoadingSpinner from '@/components/LoadingSpinner';
import TodoList from '@/components/TodoList';
import RemindersPanel from '@/components/RemindersPanel';
import { useAuth } from '@/hooks/useAuth';
import { useProgress } from '@/hooks/useProgress';
import { useCourses } from '@/hooks/useCourses';
import { sumActiveCompletedLessons } from '@/lib/enrollment-state';
import { apiClient } from '@/lib/api-client';
import { sanitizeForStudentView, stripHtml } from '@/lib/html-sanitizer';
import { AlertTriangle, ArrowRight, BarChart3, BookOpen, CandlestickChart, CheckCircle2, Shield, Star, Zap } from 'lucide-react';


interface UpcomingLesson {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  order: number;
  date?: string;
}

export default function Dashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { progress, loading: progressLoading, error: progressError, refetch: refetchProgress } = useProgress();
  const { courses } = useCourses();
  const router = useRouter();
  const [userPoints, setUserPoints] = useState(0);
  const [upcomingLessons, setUpcomingLessons] = useState<UpcomingLesson[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const fetchDashboardData = async () => {
    if (!user) return;
    
    try {
      setLoadingData(true);
      
      // Fetch user points
      try {
        const userData = await apiClient.get<any>('/auth/me');
        setUserPoints(userData.points || 0);
      } catch (error) {
        console.error('Failed to fetch user points:', error);
        setUserPoints(0);
      }
      
      // Fetch upcoming lessons
      try {
        const lessons: UpcomingLesson[] = [];
        for (const p of progress) {
          if (p.progress > 0 && p.progress < 100 && p.course) {
            const courseLessons = await apiClient.get<any[]>(`/lessons?courseId=${p.courseId}`);
            const nextLesson = courseLessons.find((l: any) => !p.completedLessons?.includes(l._id || l.id));
            if (nextLesson) {
              lessons.push({
                courseId: p.courseId,
                courseTitle: p.course.title,
                lessonId: nextLesson._id || nextLesson.id,
                lessonTitle: nextLesson.title,
                order: nextLesson.order || 0,
              });
            }
          }
        }
        setUpcomingLessons(lessons.slice(0, 5)); // Next 5 lessons
      } catch (error) {
        console.error('Failed to fetch upcoming lessons:', error);
        setUpcomingLessons([]);
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
    // Redirect instructors and admins to their respective dashboards
    // Check approval status for instructors and admins
    if (!authLoading && isAuthenticated && user) {
      // Onboarding is now optional - students can skip it
      // No redirect needed - they can complete it later
      
      if (user.role === 'instructor') {
        // Check if instructor is approved
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
        // Check if admin is approved (superadmin is always approved)
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
        return;
      }
    }
  }, [isAuthenticated, authLoading, user, router]);

  useEffect(() => {
    if (isAuthenticated && user && !progressLoading) {
      fetchDashboardData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user, progressLoading]);

  if (authLoading || progressLoading || loadingData) {
    return <LoadingSpinner message="Loading your dashboard..." fullScreen />;
  }

  if (!isAuthenticated || (user && user.role !== 'student')) {
    return null;
  }

  const enrolledCourses = courses.filter((c) => c.enrolled);
  // const completedCourses = progress.filter((p) => p.progress >= 100); // Reserved for future use
  // const activeCourses = progress.filter((p) => p.progress > 0 && p.progress < 100); // Reserved for future use
  const completedModules = sumActiveCompletedLessons(progress);
  const recommendedCourses = courses.filter((c) => !c.enrolled).slice(0, 3);

  return (
    <div className="min-h-screen flex flex-col overflow-hidden">
      <Header />

      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />

        <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 pt-16 lg:pt-8 overflow-y-auto w-full">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="page-kicker mb-2">Learning home</p>
              <h1 className="page-title">
                Welcome back, {user?.name?.split(' ')[0] || 'Student'}
              </h1>
              <p className="mt-2 text-sm sm:text-base text-neutral-600">Pick up where you left off.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {(user?.learningLevel || (user as any)?.studentDetails?.tradingLevel) && (
                <span className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1 text-sm font-medium capitalize text-neutral-800">
                  {user?.learningLevel || (user as any)?.studentDetails?.tradingLevel}
                </span>
              )}
              <Link href="/onboarding" className="text-sm font-medium text-neutral-600 underline-offset-4 hover:text-neutral-900 hover:underline">
                Edit profile
              </Link>
            </div>
          </div>

          {upcomingLessons[0] ? (
            <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft sm:p-6">
              <p className="page-kicker">Next lesson</p>
              <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl" dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(upcomingLessons[0].lessonTitle) }} />
              <p className="mt-2 text-sm text-neutral-600">{upcomingLessons[0].courseTitle}</p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href={`/courses/${upcomingLessons[0].courseId}/lessons/${upcomingLessons[0].lessonId}`}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-400 px-4 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-primary-500"
                >
                  Continue lesson
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href="/student-dashboard" className="text-sm font-medium text-neutral-600 hover:text-neutral-900">
                  Open trading practice
                </Link>
              </div>
            </section>
          ) : enrolledCourses.length > 0 ? (
            <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft sm:p-6">
              <p className="page-kicker">Practice</p>
              <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl">Work through a demo trade</h2>
              <p className="mt-2 max-w-2xl text-sm text-neutral-600">
                Live prices, instructor tasks, and your trade journal are in the trading dashboard. Demo trading uses virtual money only.
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/student-dashboard"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-400 px-4 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-primary-500"
                >
                  Open trading dashboard
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
              <p className="mt-4 flex items-start gap-2 text-xs text-neutral-500">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
                <span>Demo trading is for education only. ForexOrbit Academy does not provide brokerage services or financial advice.</span>
              </p>
            </section>
          ) : progressError ? (
            <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft sm:p-6">
              <p className="page-kicker">Progress</p>
              <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl">Progress could not be loaded</h2>
              <p className="mt-2 max-w-2xl text-sm text-neutral-600">Your enrollments are unchanged. Try again before treating this as an empty enrollment list.</p>
              <button type="button" onClick={() => refetchProgress()} className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-primary-400 px-4 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-primary-500">Try again</button>
            </section>
          ) : (
            <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft sm:p-6">
              <p className="page-kicker">Get started</p>
              <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl">Choose a course to begin</h2>
              <p className="mt-2 max-w-2xl text-sm text-neutral-600">Your enrolled courses, lessons, and practice tools will show up here once you join a course.</p>
              <Link
                href="/courses"
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-primary-400 px-4 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-primary-500"
              >
                Browse courses
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </section>
          )}

          <section className="mb-8 grid grid-cols-1 divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-soft sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="flex items-center gap-3 px-5 py-4">
              <BookOpen className="h-4 w-4 shrink-0 text-primary-600" aria-hidden />
              <div>
                <p className="text-2xl font-semibold tracking-tight text-neutral-900">{enrolledCourses.length}</p>
                <p className="text-xs text-neutral-500">Enrolled courses</p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-4">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-700" aria-hidden />
              <div>
                <p className="text-2xl font-semibold tracking-tight text-neutral-900">{progressError ? '—' : completedModules}</p>
                <p className="text-xs text-neutral-500">Completed modules</p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-4">
              <Star className="h-4 w-4 shrink-0 text-primary-600" aria-hidden />
              <div>
                <p className="text-2xl font-semibold tracking-tight text-neutral-900">{userPoints}</p>
                <p className="text-xs text-neutral-500">Points earned</p>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <div className="mb-4 flex items-end justify-between gap-3">
              <h2 className="font-display text-lg font-semibold tracking-tight text-neutral-900">Enrolled courses</h2>
              <Link href="/courses" className="text-sm font-medium text-neutral-600 hover:text-neutral-900">
                Browse all
              </Link>
            </div>
            {enrolledCourses.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {enrolledCourses.map((course) => (
                  <CourseCard key={course._id || course.id} course={course} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-10 text-center">
                <p className="text-sm text-neutral-600">You have not enrolled in a course yet.</p>
                <Link href="/courses" className="mt-4 inline-flex rounded-lg bg-primary-400 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-primary-500">
                  Browse courses
                </Link>
              </div>
            )}
          </section>

          {upcomingLessons.length > 0 && (
            <section className="mb-8 rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft sm:p-6">
              <h2 className="mb-4 font-display text-lg font-semibold tracking-tight text-neutral-900">Upcoming lessons</h2>
              <div className="divide-y divide-neutral-200">
                {upcomingLessons.map((lesson) => (
                  <Link
                    key={`${lesson.courseId}-${lesson.lessonId}`}
                    href={`/courses/${lesson.courseId}/lessons/${lesson.lessonId}`}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <h3 className="truncate font-medium text-neutral-900" dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(lesson.lessonTitle) }} />
                      <p className="truncate text-sm text-neutral-500">{lesson.courseTitle}</p>
                    </div>
                    <span className="shrink-0 text-xs text-neutral-500">Lesson {lesson.order}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-semibold tracking-tight text-neutral-900">Recommended</h2>
                <Link href="/courses" className="text-sm font-medium text-neutral-600 hover:text-neutral-900">View all</Link>
              </div>
              {recommendedCourses.length > 0 ? (
                <div className="space-y-4">
                  {recommendedCourses.map((course) => (
                    <div key={course._id || course.id} className="border-t border-neutral-200 pt-4 first:border-0 first:pt-0">
                      <h3 className="font-medium text-neutral-900" dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(course.title) }} />
                      <p className="mt-1 line-clamp-2 text-sm text-neutral-600">
                        {stripHtml(sanitizeForStudentView(course.description || ''))}
                      </p>
                      <Link href={`/courses/${course._id || course.id}`} className="mt-2 inline-flex text-sm font-semibold text-primary-700 hover:text-primary-800">
                        View course
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-neutral-500">No recommendations right now.</p>
              )}
            </div>
            <div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-semibold tracking-tight text-neutral-900">Reminders</h2>
                <Link href="/student-dashboard?section=reminders" className="text-sm font-medium text-neutral-600 hover:text-neutral-900">
                  View all
                </Link>
              </div>
              <div className="space-y-4">
                <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-soft">
                  <RemindersPanel />
                </div>
                <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-soft">
                  <TodoList />
                </div>
              </div>
            </div>
          </section>

          <section className="mb-8 rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft sm:p-6">
            <h2 className="font-display text-lg font-semibold tracking-tight text-neutral-900">What this training covers</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex gap-3">
                <CandlestickChart className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">Understanding Forex markets</h3>
                  <p className="text-sm text-neutral-600">Currency pairs, sessions, and how prices move.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Zap className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">Executing trades</h3>
                  <p className="text-sm text-neutral-600">How orders are placed and managed in practice.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">Risk management</h3>
                  <p className="text-sm text-neutral-600">Position size, stops, and protecting capital.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">Chart analysis</h3>
                  <p className="text-sm text-neutral-600">Reading price charts without treating any setup as certain.</p>
                </div>
              </div>
            </div>
          </section>

          <Link href="/leaderboard" className="mb-4 flex items-center justify-between rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm shadow-soft hover:border-neutral-300">
            <span>
              <span className="block font-semibold text-neutral-900">Leaderboard</span>
              <span className="text-neutral-500">See how your points compare with other learners.</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
          </Link>

        </main>
      </div>

      <Footer />
    </div>
  );
}

