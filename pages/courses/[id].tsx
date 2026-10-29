/**
 * Course Detail Page
 * Shows course information and lessons
 */

import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';
import CourseCover from '@/components/CourseCover';
import { decodeHtmlEntities } from '@/lib/plain-text';
import BackButton from '@/components/BackButton';
import LoadingSpinner from '@/components/LoadingSpinner';
import { ButtonLoadingState, LessonSkeleton } from '@/components/loading';
import { useCourse } from '@/hooks/useCourses';
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { sanitizeForStudentView, stripHtml } from '@/lib/html-sanitizer';
import { getLessonDescriptionHtml, hasVisibleHtml } from '@/lib/lesson-html';
import { useLessons } from '@/hooks/useLesson';
import { loginHref } from '@/lib/login-redirect';
import { PaystackCourseUnlock } from '@/components/monetization/PaystackCourseUnlock';

export default function CourseDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { isAuthenticated, user, loading: authLoading } = useAuth();
  const canFetch = !authLoading && isAuthenticated;
  const { course, loading, error, refetch: refetchCourse } = useCourse(id, canFetch) as any;
  const { lessons, loading: lessonsLoading, refetch: refetchLessons } = useLessons(id, canFetch);
  const { socket, connected } = useSocket();
  const goToLogin = useCallback(() => {
    void router.replace(loginHref(router.asPath));
  }, [router]);

  useEffect(() => {
    if (router.isReady && !authLoading && !isAuthenticated) goToLogin();
  }, [router.isReady, authLoading, isAuthenticated, goToLogin]);
  const [enrolling, setEnrolling] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [fixRef, setFixRef] = useState('');
  const [fixMessage, setFixMessage] = useState<string | null>(null);
  /** Server-derived: every lesson in the list is unlocked for this user. */
  const paid = lessons.length > 0 && lessons.every((lesson) => lesson.locked !== true);

  const handleCourseUnlocked = useCallback(async () => {
    await refetchLessons();
    await refetchCourse?.();
  }, [refetchLessons, refetchCourse]);

  const openLesson = useCallback(
    (href: string) => {
      void router.push(href);
    },
    [router]
  );

  const handleManualVerify = useCallback(async () => {
    const ref = fixRef.trim().replace(/[.,;:!?]+$/, '');
    if (!ref || typeof id !== 'string') return;
    if (!isAuthenticated) {
      goToLogin();
      return;
    }
    setVerifyBusy(true);
    setFixMessage(null);
    try {
      await apiClient.post('/verify-payment/manual', { reference: ref, courseId: id });
      await handleCourseUnlocked();
      setFixRef('');
      setFixMessage('Payment confirmed. The full course is unlocked.');
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string; supportId?: string } } };
      const supportId = ax.response?.data?.supportId;
      setFixMessage(
        `${ax.response?.data?.message || 'Verification failed.'}${supportId ? ` Support ID: ${supportId}` : ''}`
      );
    } finally {
      setVerifyBusy(false);
    }
  }, [fixRef, id, isAuthenticated, goToLogin, handleCourseUnlocked]);

  // Redirect instructors to instructor course management page
  useEffect(() => {
    if (user && id && (user.role === 'instructor' || user.role === 'admin' || user.role === 'superadmin')) {
      router.replace(`/instructor/courses/${id}`);
    }
  }, [user, id, router]);

  // Listen for lesson updates via socket and refresh course data
  useEffect(() => {
    if (!socket || !connected || !id || !refetchCourse) return;

    const onLessonUpdated = (data: { lessonId?: string; courseId?: string }) => {
      if (data.courseId === id) {
        refetchCourse();
      }
    };

    socket.on('lessonUpdated', onLessonUpdated);
    return () => { socket.off('lessonUpdated', onLessonUpdated); };
  }, [socket, connected, id, refetchCourse]);

  // Early return to prevent student UI from rendering for instructors
  if (user && (user.role === 'instructor' || user.role === 'admin' || user.role === 'superadmin')) {
    return <LoadingSpinner message="Redirecting to course management..." fullScreen />;
  }

  const handleEnroll = async () => {
    if (!isAuthenticated) {
      goToLogin();
      return;
    }

    setEnrolling(true);
    try {
      if (course?.enrolled) {
        await apiClient.delete(`/courses/${id}/enroll`);
      } else {
        await apiClient.post(`/courses/${id}/enroll`);
      }
      router.reload();
    } catch (error) {
      console.error('Enrollment error:');
    } finally {
      setEnrolling(false);
    }
  };

  if (!canFetch) {
    return <LoadingSpinner message={authLoading ? 'Loading course...' : 'Redirecting to sign in...'} fullScreen />;
  }

  if (loading && !course) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex flex-1 lg:items-start">
          <Sidebar />
          <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8 pt-16 lg:pt-8">
            <LessonSkeleton />
          </main>
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex flex-1 lg:items-start">
          <Sidebar />
          <main className="flex-1 flex items-center justify-center px-6 pt-16">
            <div className="max-w-md text-center">
              <p className="text-lg font-semibold text-neutral-900">{error ? 'This course could not be loaded' : 'Course not found'}</p>
              {error && (
                <button type="button" onClick={() => refetchCourse()} className="btn btn-primary mt-4">Try again</button>
              )}
            </div>
          </main>
        </div>
      </div>
    );
  }

  const difficultyColors = {
    beginner: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300',
    intermediate: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
    advanced: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300',
  };

  const difficultyKey = ((course && (course.difficulty as any)) || 'beginner') as 'beginner' | 'intermediate' | 'advanced';
  const difficultyClass = difficultyColors[difficultyKey];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex flex-1 lg:items-start">
        <Sidebar />
        <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pt-16 lg:pt-8 w-full">
        {/* Back Button */}
        <div className="mb-3">
          <BackButton href="/courses" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2">
            <div className="mb-4 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-soft">
              <CourseCover course={course} aspect="aspect-[16/9] sm:aspect-[21/9]" priority />
              <div className="p-5 sm:p-7">
              <div className="mb-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className={`chip ${difficultyClass}`}>{course.difficulty}</span>
                  {course.category && <span className="text-sm capitalize text-neutral-500">{course.category}</span>}
                </div>
                <h1 className="page-title break-words sm:text-4xl">{course.title}</h1>
              </div>

              {course.description && hasVisibleHtml(sanitizeForStudentView(course.description)) && (
                <div className="rich-html-readable text-base leading-relaxed mb-4">
                  <div dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(course.description) }} />
                </div>
              )}

              {/* Progress Bar */}
              {course.progress !== undefined && course.progress > 0 && (
                <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="font-semibold text-neutral-700">Your progress</span>
                    <span className="font-semibold text-neutral-900">{Math.round(course.progress)}%</span>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-neutral-200"
                    role="progressbar"
                    aria-valuenow={Math.round(course.progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Course progress"
                  >
                    <div
                      className="h-2 rounded-full bg-primary-500 transition-[width] duration-500"
                      style={{ width: `${course.progress}%` }}
                    />
                  </div>
                </div>
              )}
              </div>
            </div>

            {/* Lessons — source: GET /api/courses/:id/lessons { lessons } */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft sm:p-7">
              <h2 className="mb-4 font-display text-xl font-semibold text-neutral-900 sm:text-2xl">Course lessons</h2>
              {lessonsLoading ? (
                <p className="py-10 text-center text-gray-500">Loading lessons…</p>
              ) : lessons.length > 0 ? (
                <div className="space-y-3">
                  {(paid ? lessons : lessons.slice(0, 1)).map((lesson, index) => {
                    const href = `/courses/${id}/lessons/${lesson._id || lesson.id}`;
                    const key = String(lesson._id || lesson.id || index);
                    const lessonDesc = getLessonDescriptionHtml(lesson as any);
                    const lessonDescStudent = sanitizeForStudentView(lessonDesc);
                    const previewPlain = decodeHtmlEntities(stripHtml(lessonDescStudent)).replace(/\s+/g, ' ').trim();
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          className="group relative flex w-full items-center justify-between gap-3 rounded-xl border border-neutral-200 p-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50 dark:hover:border-primary-400/40 dark:hover:bg-primary-400/5 sm:p-5"
                          onClick={() => openLesson(href)}
                        >
                          <div className="flex min-w-0 flex-1 items-center space-x-4">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-sm font-semibold text-primary-700 dark:bg-primary-400/10 dark:text-primary-300">
                              {index + 1}
                            </div>
                            <div className="min-w-0 flex-1 text-left">
                              <h3
                                className="font-semibold text-gray-900 group-hover:text-primary-600 dark:text-gray-100"
                                dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(lesson.title) }}
                              />
                              {hasVisibleHtml(lessonDescStudent) && previewPlain && (
                                <p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-gray-300">
                                  {previewPlain.length > 200 ? `${previewPlain.slice(0, 200)}…` : previewPlain}
                                </p>
                              )}
                            </div>
                          </div>
                          <svg
                            className="h-6 w-6 shrink-0 text-gray-400 transition-all group-hover:translate-x-1 group-hover:text-primary-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                  {!paid && lessons.length > 1 && (
                    <div className="rounded-xl border border-primary-200 bg-primary-50/70 p-5 dark:border-primary-400/25 dark:bg-primary-400/[0.06]">
                      <p className="mb-1 text-sm text-gray-700 dark:text-gray-300">
                        {lessons.length - 1} more lesson{lessons.length > 2 ? 's' : ''} in this course
                      </p>
                      {typeof id === 'string' && (
                        <PaystackCourseUnlock courseId={id} variant="compact" onUnlocked={handleCourseUnlocked} />
                      )}
                      <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
                        Paid but still locked? Enter your Paystack reference below.
                      </p>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          type="text"
                          value={fixRef}
                          onChange={(e) => setFixRef(e.target.value)}
                          placeholder="Paystack reference"
                          className="input"
                          aria-label="Paystack reference"
                        />
                        <button
                          type="button"
                          disabled={verifyBusy || !fixRef.trim()}
                          onClick={() => void handleManualVerify()}
                          className="btn btn-outline shrink-0"
                        >
                          {verifyBusy ? 'Verifying…' : 'Fix payment'}
                        </button>
                      </div>
                      {fixMessage && (
                        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300" role="status">{fixMessage}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <p className="text-gray-500">No lessons available yet.</p>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div>
            <div className="sticky top-20 rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft sm:top-24 sm:p-6">
              <dl className="grid grid-cols-3 gap-3 lg:grid-cols-1 lg:gap-4">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Category</dt>
                  <dd className="mt-1 font-semibold capitalize text-neutral-900">{course.category}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Level</dt>
                  <dd className="mt-1 font-semibold capitalize text-neutral-900">{course.difficulty}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Lessons</dt>
                  <dd className="mt-1 font-semibold text-neutral-900">
                    {lessonsLoading ? '…' : lessons.length} lessons
                  </dd>
                </div>
              </dl>
              <div className="space-y-3">

                <div className="mt-5 border-t border-neutral-200 pt-5">
                  {isAuthenticated ? (
                    <button
                      type="button"
                      onClick={() => void handleEnroll()}
                      disabled={enrolling}
                      className={`btn w-full py-3 ${course.enrolled ? 'btn-ghost border border-neutral-200' : 'btn-primary text-base'}`}
                    >
                      {enrolling ? <ButtonLoadingState loading loadingLabel={course.enrolled ? 'Leaving course' : 'Enrolling'} /> : course.enrolled ? 'Unenroll' : 'Enroll Now'}
                    </button>
                  ) : (
                    <Link href={loginHref(router.asPath)} className="btn btn-primary w-full py-3 text-base">
                      Login to Enroll
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      </div>

      <Footer />
    </div>
  );
}

