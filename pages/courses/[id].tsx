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
import OrbitProgress from '@/components/ui/OrbitProgress';
import { difficultyChip } from '@/lib/difficulty-style';
import { decodeHtmlEntities } from '@/lib/plain-text';
import BackButton from '@/components/BackButton';
import LoadingSpinner from '@/components/LoadingSpinner';
import { ButtonLoadingState, LessonSkeleton } from '@/components/loading';
import { useCourse } from '@/hooks/useCourses';
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { messageFromUnknown } from '@/lib/public-error';
import { sanitizeForStudentView, stripHtml } from '@/lib/html-sanitizer';
import { getLessonDescriptionHtml, hasVisibleHtml } from '@/lib/lesson-html';
import { useLessons } from '@/hooks/useLesson';
import { continueLesson, lessonHref } from '@/lib/lesson-navigation';
import { useProgressSync } from '@/hooks/useProgressSync';
import { loginHref } from '@/lib/login-redirect';
import { PaystackCourseUnlock } from '@/components/monetization/PaystackCourseUnlock';

export default function CourseDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { isAuthenticated, user, loading: authLoading } = useAuth();
  const canFetch = !authLoading && isAuthenticated;
  const { course, loading, error, refetch: refetchCourse } = useCourse(id, canFetch) as any;
  const { lessons, loading: lessonsLoading, error: lessonsError, refetch: refetchLessons } = useLessons(id, canFetch);
  const { socket, connected } = useSocket();
  const goToLogin = useCallback(() => {
    void router.replace(loginHref(router.asPath));
  }, [router]);

  useEffect(() => {
    if (router.isReady && !authLoading && !isAuthenticated) goToLogin();
  }, [router.isReady, authLoading, isAuthenticated, goToLogin]);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [fixRef, setFixRef] = useState('');
  const [fixMessage, setFixMessage] = useState<string | null>(null);
  /** Server-derived: every lesson in the list is unlocked for this user. */
  const paid = lessons.length > 0 && lessons.every((lesson) => lesson.locked !== true);
  const lockedCount = lessons.filter((lesson) => lesson.locked === true).length;
  const completedCount = lessons.filter((lesson) => lesson.completed === true).length;
  /** Where to continue: the first open lesson not yet completed (outline only, Phase 7). */
  const continueTarget = continueLesson(lessons);

  const handleCourseUnlocked = useCallback(async () => {
    await refetchLessons();
    await refetchCourse?.();
  }, [refetchLessons, refetchCourse]);

  // Phase 8: progress made in another tab or device (or while this tab was in the background)
  // shows here from the server's records.
  useProgressSync(() => {
    void refetchLessons();
    void refetchCourse?.();
  }, { courseId: typeof id === 'string' ? id : undefined, enabled: canFetch });

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

    if (enrolling) return;
    if (course?.enrolled && typeof window !== 'undefined') {
      const kept = course.owned ? ' Your purchase is kept, and you can enroll again at any time.' : ' Your progress is kept if you enroll again.';
      if (!window.confirm(`Leave this course?${kept}`)) return;
    }
    setEnrolling(true);
    setEnrollError(null);
    try {
      if (course?.enrolled) {
        await apiClient.delete(`/courses/${id}/enroll`);
      } else {
        await apiClient.post(`/courses/${id}/enroll`);
      }
      router.reload();
    } catch (error) {
      setEnrollError(messageFromUnknown(error));
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
              <p className="text-lg font-semibold text-ink">{error ? 'This course could not be loaded' : 'Course not found'}</p>
              {error && (
                <button type="button" onClick={() => refetchCourse()} className="btn btn-primary mt-4">Try again</button>
              )}
            </div>
          </main>
        </div>
      </div>
    );
  }


  const difficultyKey = ((course && (course.difficulty as any)) || 'beginner') as 'beginner' | 'intermediate' | 'advanced';
  const difficultyClass = difficultyChip(difficultyKey);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex flex-1 lg:items-start">
        <Sidebar />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:pt-8">
        {/* Back Button */}
        <div className="mb-3">
          <BackButton href="/courses" />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2">
            <div className="panel-hero mb-6">
              <div className="relative">
                <CourseCover course={course} aspect="aspect-[16/9] sm:aspect-[21/9]" priority className="rounded-none" />
                <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--fo-surface-1)] via-[color-mix(in_srgb,var(--fo-surface-1)_35%,transparent)] to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className={`chip backdrop-blur-md ${difficultyClass}`}>{course.difficulty}</span>
                    {course.category && <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">{course.category.replace(/-/g, ' ')}</span>}
                  </div>
                  <h1 className="page-title break-words sm:!text-[2.5rem]">{course.title}</h1>
                </div>
              </div>
              <div className="p-5 pt-2 sm:p-7 sm:pt-3">

              {course.description && hasVisibleHtml(sanitizeForStudentView(course.description)) && (
                <div className="rich-html-readable text-base leading-relaxed mb-4">
                  <div dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(course.description) }} />
                </div>
              )}

              {/* Progress Bar */}
              {course.progress !== undefined && course.progress > 0 && (
                <div className="mt-5 flex items-center gap-4 rounded-xl border border-line bg-surface-2 p-4">
                  <OrbitProgress value={course.progress} size={60} label="Course progress" tone={course.progress >= 100 ? 'complete' : 'brand'} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">Your progress</p>
                    <p className="text-xs text-ink-subtle"><span className="num font-semibold text-ink">{Math.round(course.progress)}%</span> of the current course covered</p>
                  {course.completedAt && course.progress < 100 && (
                    <p className="mt-1 text-xs text-ink-muted">
                      You completed this course on {new Date(course.completedAt).toLocaleDateString()}. New lessons have been added since; the bar shows how much of the current course you have covered. Your completion and certificate are kept.
                    </p>
                  )}
                  </div>
                </div>
              )}
              </div>
            </div>

            {/* Lessons — source: GET /api/courses/:id/lessons { lessons } */}
            <div className="card rounded-2xl p-5 sm:p-7">
              <p className="page-kicker">Curriculum</p>
              <h2 className="mb-5 mt-2 section-title !text-xl">Course lessons</h2>
              {lessonsLoading && lessons.length === 0 ? (
                <p className="py-10 text-center text-ink-muted" role="status">Loading lessons…</p>
              ) : lessonsError && lessons.length === 0 ? (
                <div className="py-10 text-center" role="alert">
                  <p className="text-ink-muted">{lessonsError}</p>
                  <button type="button" onClick={() => void refetchLessons()} className="btn btn-primary mt-4">Try again</button>
                </div>
              ) : lessons.length > 0 ? (
                <div className="relative space-y-2.5">
                  {course.enrolled && continueTarget && (
                    <Link
                      href={lessonHref(String(id), continueTarget.id)}
                      className="btn btn-primary mb-2 w-full justify-center py-3 sm:w-auto"
                      data-testid="continue-lesson"
                    >
                      {completedCount > 0 ? `Continue: lesson ${continueTarget.position}` : 'Start the first lesson'}
                    </Link>
                  )}
                  {/* Every lesson in course order with the server's lock state: explicit free
                      previews and demo lessons open wherever they sit (Phase 7). Locked lessons
                      show their title only and lead to the unlock offer below. */}
                  {lessons.map((lesson, index) => {
                    const lessonId = String(lesson._id || lesson.id || '');
                    const key = lessonId || String(index);
                    const locked = lesson.locked === true;
                    const lessonDesc = getLessonDescriptionHtml(lesson as any);
                    const lessonDescStudent = sanitizeForStudentView(lessonDesc);
                    const previewPlain = decodeHtmlEntities(stripHtml(lessonDescStudent)).replace(/\s+/g, ' ').trim();
                    const badge = locked
                      ? 'Locked'
                      : lesson.completed
                        ? 'Completed'
                        : !paid && lesson.isFreePreview
                          ? 'Free preview'
                          : !paid && lesson.isDemo
                            ? 'Demo'
                            : null;
                    const inner = (
                      <>
                        <div className="flex min-w-0 flex-1 items-center space-x-4">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold num ring-4 ring-[var(--fo-surface-1)] ${lesson.completed ? 'bg-primary-500 text-neutral-950 shadow-[0_0_12px_rgba(255,112,18,0.45)]' : locked ? 'border border-[var(--fo-line-strong)] bg-surface-1 text-ink-subtle' : 'border border-primary-500/50 bg-tint text-primary-600 dark:text-primary-300'}`}>
                            {lesson.completed ? '✓' : index + 1}
                          </div>
                          <div className="min-w-0 flex-1 text-left">
                            <h3
                              className={`font-semibold ${locked ? 'text-ink-subtle' : 'text-ink transition-colors group-hover:text-primary-600 dark:group-hover:text-primary-400'}`}
                              dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(lesson.title) }}
                            />
                            {!locked && hasVisibleHtml(lessonDescStudent) && previewPlain && (
                              <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
                                {previewPlain.length > 200 ? `${previewPlain.slice(0, 200)}…` : previewPlain}
                              </p>
                            )}
                            {badge && (
                              <span className={`chip mt-1.5 ${locked ? '' : 'chip-brand'}`}>
                                {badge}
                              </span>
                            )}
                          </div>
                        </div>
                        {locked ? (
                          <svg className="h-5 w-5 shrink-0 text-ink-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                        ) : (
                          <svg
                            className="h-6 w-6 shrink-0 transition-all group-hover:translate-x-1 group-hover:text-primary-600 text-ink-subtle"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </>
                    );
                    return (
                      <div key={key}>
                        {locked ? (
                          <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-line-strong p-4 opacity-80 sm:p-5" data-testid="course-lesson-locked">
                            {inner}
                          </div>
                        ) : (
                          <Link
                            href={lessonHref(String(id), lessonId)}
                            className="group relative flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface-1 p-4 text-left transition-all duration-200 ease-orbit hover:-translate-y-px hover:border-line-strong hover:shadow-lift sm:p-5"
                            data-testid="course-lesson-open"
                          >
                            {inner}
                          </Link>
                        )}
                      </div>
                    );
                  })}
                  {lockedCount > 0 && (
                    <div className="notice notice-brand !p-5">
                      <p className="mb-1 text-sm text-ink-muted">
                        {lockedCount} locked lesson{lockedCount > 1 ? 's' : ''} in this course
                      </p>
                      {typeof id === 'string' && (
                        <PaystackCourseUnlock courseId={id} variant="compact" onUnlocked={handleCourseUnlocked} />
                      )}
                      <p className="mt-3 text-xs text-ink-muted">
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
                        <p className="mt-2 text-sm text-ink-muted" role="status">{fixMessage}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <p className="text-ink-muted">No lessons available yet.</p>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div>
            <div className="card panel-instrument sticky top-20 p-5 sm:p-6">
              <dl className="grid grid-cols-3 gap-3 lg:grid-cols-1 lg:gap-4">
                <div>
                  <dt className="readout-label">Category</dt>
                  <dd className="mt-1 font-semibold capitalize text-ink">{course.category}</dd>
                </div>
                <div>
                  <dt className="readout-label">Level</dt>
                  <dd className="mt-1 font-semibold capitalize text-ink">{course.difficulty}</dd>
                </div>
                <div>
                  <dt className="readout-label">Lessons</dt>
                  <dd className="mt-1 font-semibold text-ink">
                    {lessonsLoading ? '…' : lessons.length} lessons
                  </dd>
                </div>
              </dl>
              <div className="space-y-3">

                <div className="mt-5 border-t border-line pt-5">
                  {course.owned ? (
                    <p className="notice notice-brand mb-3 !py-2.5 font-semibold !text-ink">
                      You have full access to this course.
                    </p>
                  ) : null}
                  {course.completedAt ? (
                    <p className="mb-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">Completed</p>
                  ) : null}
                  {isAuthenticated && course.status === 'archived' && !course.enrolled && !course.owned ? (
                    <p className="text-sm text-ink-muted">This course is archived and no longer takes new students.</p>
                  ) : isAuthenticated ? (
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
                  {enrollError ? (
                    <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{enrollError}</p>
                  ) : null}
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

