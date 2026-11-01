/**
 * Lesson Page
 * Displays lesson content with video, description, documents, quiz, and chat
 *
 * Phase 7: course outline and previous/next from the outline view (no lesson bodies), explicit
 * completion separate from video playback, video resume, protected document links, and a state
 * the student can act on for every outcome (loading, locked, enroll first, not found, retryable
 * error, offline). Access is decided by the server on every lesson and document request; what
 * the page shows only mirrors it.
 */

import { useRouter } from 'next/router';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import BackButton from '@/components/BackButton';
import VideoPlayer from '@/components/VideoPlayer';
import Quiz from '@/components/Quiz';
import LessonOutline from '@/components/student/LessonOutline';
import LessonDocuments from '@/components/student/LessonDocuments';
import LessonCompletion from '@/components/student/LessonCompletion';
import { useLesson, useLessons } from '@/hooks/useLesson';
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useLearningActivity } from '@/hooks/useLearningActivity';
import { useProgressSync } from '@/hooks/useProgressSync';
import InstructorLessonEditor from '@/components/InstructorLessonEditor';
import { sanitizeForStudentView } from '@/lib/html-sanitizer';
import { safeLinkUrl } from '@/lib/safe-url';
import { getLessonDescriptionHtml, hasVisibleHtml } from '@/lib/lesson-html';
import { lessonHref, markCompleted, resolveLessonNavigation } from '@/lib/lesson-navigation';
import { playbackKey } from '@/lib/playback-position';
import { LessonSkeleton } from '@/components/loading';
import { ContentAdBanner } from '@/components/ads/ContentAdBanner';
import { ContentAdInterstitial } from '@/components/ads/ContentAdInterstitial';
import { PaystackCourseUnlock } from '@/components/monetization/PaystackCourseUnlock';
import type { LessonAccessDeniedPayload, LessonMonetization } from '@/hooks/useLesson';
import { COURSE_PRICE_LABEL } from '@/lib/course-price';
import { loginHref } from '@/lib/login-redirect';
import dynamic from 'next/dynamic';

// The market signal chart pulls in recharts; load it after the page instead of in the page bundle.
const MarketSignal = dynamic(() => import('@/components/MarketSignal'), {
  ssr: false,
  loading: () => <div className="card orbit-skeleton h-48" aria-hidden />,
});

function StatePanel({ title, message, children }: { title: string; message?: string | null; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8 dark:border-gray-700 dark:bg-gray-800" role="alert" data-testid="lesson-state">
      <p className="text-lg font-semibold text-gray-900 dark:text-white">{title}</p>
      {message && <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 dark:text-gray-300">{message}</p>}
      {children && <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">{children}</div>}
    </div>
  );
}

export default function LessonPage() {
  const router = useRouter();
  const courseId = typeof router.query.id === 'string' ? router.query.id : '';
  const lessonId = typeof router.query.lessonId === 'string' ? router.query.lessonId : '';
  const { isAuthenticated, user, loading: authLoading } = useAuth();
  const canFetch = !authLoading && isAuthenticated;
  const online = useOnlineStatus();
  const {
    lesson,
    status: lessonStatus,
    error: lessonError,
    accessDenied,
    offline: lessonOffline,
    refetch: refetchLesson,
    setLesson,
  } = useLesson(lessonId || undefined, canFetch);
  const {
    lessons,
    loading: lessonsLoading,
    error: lessonsError,
    refetch: refetchLessons,
    setLessons,
  } = useLessons(courseId || undefined, canFetch);

  useEffect(() => {
    if (router.isReady && !authLoading && !isAuthenticated) {
      void router.replace(loginHref(router.asPath));
    }
  }, [router, authLoading, isAuthenticated]);
  const { joinLesson, leaveLesson, socket, connected } = useSocket();
  const [showQuiz, setShowQuiz] = useState(false);
  const [showContentEditor, setShowContentEditor] = useState(false);
  const [videoFinished, setVideoFinished] = useState(false);

  // A different lesson starts with its panels closed.
  useEffect(() => {
    setShowQuiz(false);
    setShowContentEditor(false);
    setVideoFinished(false);
  }, [lessonId]);

  // useLesson returns state only for the lesson this URL names, never the previous lesson during
  // a route change.
  const displayLesson = lesson;
  const lockedPayload = accessDenied as LessonAccessDeniedPayload | null;

  // Keep the URL's course and the lesson's course the same (a lesson URL under another course
  // would otherwise show that course's outline and wrong previous/next lessons).
  const ownCourseId = displayLesson?.courseId || lockedPayload?.lessonMeta?.courseId || '';
  useEffect(() => {
    if (ownCourseId && courseId && lessonId && ownCourseId !== courseId) {
      void router.replace(lessonHref(ownCourseId, lessonId));
    }
  }, [ownCourseId, courseId, lessonId, router]);

  useEffect(() => {
    if (!lessonId || !isAuthenticated) return;
    joinLesson(lessonId);
    return () => {
      leaveLesson(lessonId);
    };
  }, [lessonId, isAuthenticated, joinLesson, leaveLesson]);

  // Listen for lesson updates via Socket.io; the lesson stays on screen while it reloads.
  useEffect(() => {
    if (!socket || !connected || !lessonId) return;

    const handleLessonUpdate = (data: { lessonId: string; courseId: string }) => {
      if (data.lessonId === lessonId) {
        void refetchLesson({ silent: true });
      }
    };

    socket.on('lessonUpdated', handleLessonUpdate);

    return () => {
      socket.off('lessonUpdated', handleLessonUpdate);
    };
  }, [socket, connected, lessonId, refetchLesson]);

  // The video ending is not completion (Phase 7); it only prompts the student.
  const handleVideoEnd = useCallback(() => setVideoFinished(true), []);

  const handleCompleted = useCallback(() => {
    if (lesson) setLesson({ ...lesson, completed: true });
    setLessons((list) => markCompleted(list, lessonId));
  }, [lesson, lessonId, setLesson, setLessons]);

  // Phase 8: learning-time signals while a student studies an open lesson (idle or hidden tabs
  // send nothing), and completions made in other tabs or devices reflected here.
  const { markActive } = useLearningActivity(lessonId, user?.role === 'student' && lessonStatus === 'ready');
  useProgressSync((event) => {
    if (event) {
      if (event.lessonId) setLessons((list) => markCompleted(list, event.lessonId as string));
      if (event.lessonId === lessonId) setLesson((current) => (current ? { ...current, completed: true } : current));
      return;
    }
    void refetchLessons();
    void refetchLesson({ silent: true });
  }, { courseId, enabled: canFetch });

  const handleLessonUnlocked = useCallback(async () => {
    await refetchLesson();
    await refetchLessons();
  }, [refetchLesson, refetchLessons]);

  const monetization = (displayLesson?.monetization ?? lockedPayload?.monetization) as LessonMonetization | undefined;
  const payBlocked =
    user?.role === 'student' &&
    lessonStatus === 'locked' &&
    Boolean(monetization?.paymentsConfigured && monetization.unlocked === false);
  const isLockedAccessDenied = lessonStatus === 'locked';

  // Locked, but there is no checkout to offer (payments not configured): the course page explains.
  useEffect(() => {
    if (isLockedAccessDenied && !payBlocked && courseId) {
      void router.replace(`/courses/${courseId}`);
    }
  }, [isLockedAccessDenied, payBlocked, courseId, router]);

  const navigation = resolveLessonNavigation(lessons, lessonId);
  const outline = (
    <LessonOutline
      courseId={courseId}
      lessons={lessons}
      currentLessonId={lessonId}
      loading={lessonsLoading}
      error={lessonsError}
      onRetry={() => void refetchLessons()}
    />
  );

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex flex-1 relative">
        <Sidebar />
        <main className="flex-1 min-w-0 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-4 sm:py-6 md:py-8 pt-20 lg:pt-8">
          {!online && (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200" role="status" data-testid="offline-banner">
              You are offline. What is on screen stays available; anything new loads when your connection is back.
            </p>
          )}
          <div className="mb-2">
            <BackButton href={courseId ? `/courses/${courseId}` : '/courses'} label="Back to Course" />
          </div>
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-6">
            <div className="lg:order-2 lg:sticky lg:top-24">{outline}</div>
            <div className="min-w-0 lg:order-1">{body}</div>
          </div>
        </main>
      </div>
      <Footer />
    </div>
  );

  if (!canFetch || lessonStatus === 'loading') {
    return shell(<LessonSkeleton />);
  }

  if (lessonStatus === 'error') {
    return shell(
      <StatePanel
        title={lessonOffline ? 'You are offline' : 'This lesson could not be loaded'}
        message={lessonError}
      >
        <button type="button" onClick={() => void refetchLesson()} className="inline-flex min-h-[44px] items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
          Try again
        </button>
        {courseId && (
          <Link href={`/courses/${courseId}`} className="text-sm font-semibold text-primary-600 hover:underline">
            Back to course
          </Link>
        )}
      </StatePanel>
    );
  }

  if (lessonStatus === 'not_found') {
    return shell(
      <StatePanel title="Lesson not found" message={lessonError}>
        <Link href={courseId ? `/courses/${courseId}` : '/courses'} className="inline-flex min-h-[44px] items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
          {courseId ? 'Back to course' : 'Browse courses'}
        </Link>
      </StatePanel>
    );
  }

  if (lessonStatus === 'forbidden') {
    return shell(
      <StatePanel title="This lesson is not open to you yet" message={lessonError}>
        <Link href={courseId ? `/courses/${courseId}` : '/courses'} className="inline-flex min-h-[44px] items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
          Go to the course
        </Link>
      </StatePanel>
    );
  }

  if (isLockedAccessDenied && !payBlocked) {
    // Redirecting to the course page (effect above).
    return shell(<LessonSkeleton />);
  }

  /** Free tier + demo: ads only when full lesson payload is loaded and backend marks showAds. */
  const freeContentAds = Boolean(displayLesson && monetization?.unlocked && monetization?.showAds === true);

  const lessonDescriptionHtml = displayLesson ? getLessonDescriptionHtml(displayLesson as any) : '';
  const lessonDescStudent = sanitizeForStudentView(lessonDescriptionHtml);

  const lessonBodyRaw = displayLesson
    ? String(
        (displayLesson as any).content ||
          (displayLesson as any).lessonSummary?.overview ||
          (displayLesson as any).summary ||
          ''
      ) || ''
    : '';
  const lessonBodyStudent = sanitizeForStudentView(lessonBodyRaw);

  const displayTitleHtml = displayLesson
    ? displayLesson.title
    : lockedPayload?.lessonMeta?.title || 'Lesson';
  const videoUrl = displayLesson ? safeLinkUrl(displayLesson.videoUrl) : null;
  const isStudent = user?.role === 'student';

  const navButton = 'flex min-h-[44px] items-center justify-center px-4 sm:px-6 py-2 sm:py-3 rounded-xl text-sm sm:text-base transition-colors';

  return shell(
    <>
      {/* Lesson Header */}
      <div className="mb-4">
        {navigation.position > 0 && (
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400" data-testid="lesson-position">
            Lesson {navigation.position} of {navigation.total}
          </p>
        )}
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-display font-bold text-gray-900 dark:text-white mb-2 break-words"
          dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(displayTitleHtml) }}
        />
      </div>

      <ContentAdInterstitial
        storageKey={`fo-ad-int-lesson-${String(lessonId)}`}
        enabled={freeContentAds}
      />

      {freeContentAds && (
        <div className="mb-4">
          <ContentAdBanner propellerPlacement="freeLessonTop" />
        </div>
      )}

      {payBlocked && monetization && lessonId && courseId && (
        <div className="mb-8 rounded-xl border-2 border-amber-200 bg-amber-50/80 p-6 dark:border-amber-800/50 dark:bg-amber-950/40" data-testid="lesson-locked">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">This lesson is locked</h2>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            {lockedPayload?.message ||
              'Pay once to unlock this course. Free preview and demo lessons stay free.'}
          </p>
          <div className="mt-4 max-w-md">
            <PaystackCourseUnlock
              courseId={courseId}
              variant="compact"
              onUnlocked={handleLessonUnlocked}
            />
          </div>
        </div>
      )}

      {/* Video Player - Display YouTube videos and other video URLs */}
      {!payBlocked && displayLesson && videoUrl && (
        <div className="bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 p-2 mb-4 overflow-hidden">
          <VideoPlayer
            url={videoUrl}
            resumeKey={user?.id ? playbackKey(user.id, lessonId) : null}
            onEnded={handleVideoEnd}
            onProgress={markActive}
          />
        </div>
      )}

      {/* Lesson Description (description field; legacy fallback: summary) */}
      {!payBlocked && freeContentAds && (
        <div className="mb-4">
          <ContentAdBanner format="horizontal" propellerPlacement="freeLessonInline" />
        </div>
      )}

      {!payBlocked && hasVisibleHtml(lessonDescStudent) && (
        <div className="lesson-reading mb-8 border-t border-neutral-200 pt-6">
          <h2 className="font-display text-lg font-semibold text-neutral-900 dark:text-white">Lesson</h2>
          <div className="rich-html-readable mt-4 text-base leading-relaxed">
            <div dangerouslySetInnerHTML={{ __html: lessonDescStudent }} />
          </div>
        </div>
      )}

      {/* Instructor/Admin Lesson Content Editor - ONLY visible to instructors/admins */}
      {user?.role === 'instructor' && displayLesson && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Lesson Content Editor</h2>
            <button
              onClick={() => setShowContentEditor(!showContentEditor)}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-sm transition-colors"
            >
              {showContentEditor ? 'Hide Editor' : 'Edit Content'}
            </button>
          </div>
          {showContentEditor && (
            <InstructorLessonEditor
              lessonId={lessonId}
              courseId={courseId}
              initialContent={
                (displayLesson as any).content ||
                (displayLesson as any).lessonSummary?.overview ||
                (displayLesson as any).lessonSummary?.summary ||
                (displayLesson as any).summary ||
                ''
              }
              onSave={() => {
                setShowContentEditor(false);
                // Show the saved content without leaving or blanking the page.
                void refetchLesson({ silent: true });
              }}
            />
          )}
        </div>
      )}

      {/* Lesson Content - Summary (stored in `content`; legacy: lessonSummary.overview / summary) */}
      {!payBlocked && hasVisibleHtml(lessonBodyStudent) && (
        <div className="bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 sm:p-6 mb-4">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-3">Lesson Content</h2>
          <div className="rich-html-readable text-base leading-relaxed break-words">
            <div dangerouslySetInnerHTML={{ __html: lessonBodyStudent }} />
          </div>
        </div>
      )}

      {/* Lesson PDF and resources (protected links for students) */}
      {!payBlocked && displayLesson && (
        <LessonDocuments
          pdfUrl={displayLesson.pdfUrl}
          pdfAvailable={displayLesson.pdfAvailable}
          resources={displayLesson.resources}
        />
      )}

      {/* Quiz */}
      {!payBlocked && displayLesson && displayLesson.quiz && (
        <div className="bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 sm:p-6 mb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 gap-3">
            <div className="flex-1">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">Lesson Quiz</h2>
              <p className="text-gray-600 dark:text-gray-300 text-xs sm:text-sm">Test your understanding</p>
            </div>
            <button
              onClick={() => setShowQuiz(!showQuiz)}
              className="w-full sm:w-auto px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors shadow-sm"
            >
              {showQuiz ? 'Hide Quiz' : 'Take Quiz'}
            </button>
          </div>
          {showQuiz && (
            <div className="border-t border-gray-200 pt-4">
              <Quiz
                lessonId={lessonId}
                courseId={courseId}
                quiz={displayLesson.quiz}
              />
            </div>
          )}
        </div>
      )}

      {/* Explicit completion: students, on a lesson they may open */}
      {!payBlocked && displayLesson && isStudent && (
        <LessonCompletion
          courseId={courseId}
          lessonId={lessonId}
          completed={displayLesson.completed === true}
          videoFinished={videoFinished}
          onCompleted={handleCompleted}
        />
      )}

      {/* Market Signal */}
      {!payBlocked && (
        <div className="mb-4">
          <MarketSignal />
        </div>
      )}

      {/* Previous / next, from the outline only */}
      <nav aria-label="Lesson navigation" className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center mb-4 gap-3 sm:gap-4" data-testid="lesson-nav">
        {navigation.prev ? (
          <Link
            href={navigation.prev.locked ? `/courses/${courseId}` : lessonHref(courseId, navigation.prev.id)}
            className={`${navButton} border-2 border-gray-300 text-gray-700 font-medium hover:border-primary-500 hover:text-primary-600 dark:border-gray-600 dark:text-gray-200`}
            data-testid="lesson-prev"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>{navigation.prev.locked ? 'Previous (locked)' : 'Previous lesson'}</span>
          </Link>
        ) : (
          <div />
        )}
        {navigation.next ? (
          navigation.next.locked ? (
            <Link
              href={`/courses/${courseId}`}
              className={`${navButton} bg-primary-600 hover:bg-primary-700 text-white font-semibold shadow-sm sm:ml-auto`}
              data-testid="lesson-next"
            >
              <span className="hidden sm:inline">Unlock full course – {COURSE_PRICE_LABEL}</span>
              <span className="sm:hidden">Unlock course</span>
              <svg className="w-4 h-4 sm:w-5 sm:h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ) : (
            <Link
              href={lessonHref(courseId, navigation.next.id)}
              className={`${navButton} bg-primary-600 hover:bg-primary-700 text-white font-semibold shadow-sm sm:ml-auto`}
              data-testid="lesson-next"
            >
              <span>Next lesson</span>
              <svg className="w-4 h-4 sm:w-5 sm:h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )
        ) : (
          <div />
        )}
      </nav>
    </>
  );
}
