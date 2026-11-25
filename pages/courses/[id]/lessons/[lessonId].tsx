/**
 * Lesson Page
 * Displays lesson content with video, description, documents, quiz, and chat
 *
 * Course builder: the lesson body is rendered by components/course/LessonBlocks and the quiz,
 * assignments and practical tasks by components/course/LessonActivities, the same components the
 * builder preview uses, so students see exactly what was previewed. Lessons are grouped under
 * their modules in the outline. Editing happens in the course builder (/builder/:courseId).
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
import LessonBlocks from '@/components/course/LessonBlocks';
import LessonActivities from '@/components/course/LessonActivities';
import LessonOutline from '@/components/student/LessonOutline';
import LessonCompletion from '@/components/student/LessonCompletion';
import { useLesson, useLessons } from '@/hooks/useLesson';
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useLearningActivity } from '@/hooks/useLearningActivity';
import { useProgressSync } from '@/hooks/useProgressSync';
import { apiClient } from '@/lib/api-client';
import LessonHeader from '@/components/course/LessonHeader';
import { moduleHeadings } from '@/components/student/LessonOutline';
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
  const [videoFinished, setVideoFinished] = useState(false);
  const [modules, setModules] = useState<Array<{ id: string; title: string }>>([]);

  // A different lesson starts with its video prompt cleared.
  useEffect(() => {
    setVideoFinished(false);
  }, [lessonId]);

  // Module titles for the outline (the course record; lesson membership is on each lesson).
  useEffect(() => {
    if (!canFetch || !courseId) return;
    let alive = true;
    apiClient.get<{ modules?: Array<{ id: string; title: string }> }>(`/courses/${courseId}?lessons=none`)
      .then((course) => { if (alive) setModules(Array.isArray(course.modules) ? course.modules : []); })
      .catch(() => { if (alive) setModules([]); });
    return () => { alive = false; };
  }, [canFetch, courseId]);

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
  // The module this lesson belongs to (the closest module heading at or before it).
  const headings = moduleHeadings(lessons, modules);
  const lessonIndex = navigation.position - 1;
  let moduleTitle: string | null = null;
  for (let i = lessonIndex; i >= 0; i -= 1) { if (headings[i]) { moduleTitle = headings[i]; break; } }
  const outline = (
    <LessonOutline
      courseId={courseId}
      lessons={lessons}
      currentLessonId={lessonId}
      loading={lessonsLoading}
      error={lessonsError}
      onRetry={() => void refetchLessons()}
      modules={modules}
    />
  );

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex flex-1 relative">
        <Sidebar />
        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:pt-8">
          {!online && (
            <p className="notice notice-caution mb-4" role="status" data-testid="offline-banner">
              You are offline. What is on screen stays available; anything new loads when your connection is back.
            </p>
          )}
          <div className="mb-2">
            <BackButton href={courseId ? `/courses/${courseId}` : '/courses'} label="Back to Course" />
          </div>
          <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start lg:gap-8">
            <div className="lg:order-2 lg:sticky lg:top-20">{outline}</div>
            <div className="min-w-0 lg:order-1"><div className="lesson-column">{body}</div></div>
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
        <button type="button" onClick={() => void refetchLesson()} className="btn btn-primary min-h-[44px]">
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
        <Link href={courseId ? `/courses/${courseId}` : '/courses'} className="btn btn-primary min-h-[44px]">
          {courseId ? 'Back to course' : 'Browse courses'}
        </Link>
      </StatePanel>
    );
  }

  if (lessonStatus === 'forbidden') {
    return shell(
      <StatePanel title="This lesson is not open to you yet" message={lessonError}>
        <Link href={courseId ? `/courses/${courseId}` : '/courses'} className="btn btn-primary min-h-[44px]">
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

  const displayTitleHtml = displayLesson
    ? displayLesson.title
    : lockedPayload?.lessonMeta?.title || 'Lesson';
  const isStudent = user?.role === 'student';

  const navButton = 'btn min-h-[44px]';

  return shell(
    <>
      {/* Lesson header (shared with the builder preview) */}
      <LessonHeader title={displayTitleHtml} position={navigation.position} total={navigation.total} moduleTitle={moduleTitle} />

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
        <div className="panel-hero mb-8 p-6" data-testid="lesson-locked">
          <h2 className="section-title">This lesson is locked</h2>
          <p className="mt-2 text-sm text-ink-muted">
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

      {/* Staff open the course builder to change a lesson; the page itself is what students see. */}
      {displayLesson && user && user.role !== 'student' && (
        <div className="notice notice-brand mb-6 flex flex-wrap items-center justify-between gap-3 text-sm" data-testid="staff-lesson-note">
          <span>You are viewing this lesson as students see it.</span>
          <Link href={`/builder/${courseId}?lesson=${lessonId}`} className="btn btn-secondary btn-sm">Edit in course builder</Link>
        </div>
      )}

      {!payBlocked && freeContentAds && (
        <div className="mb-4">
          <ContentAdBanner format="horizontal" propellerPlacement="freeLessonInline" />
        </div>
      )}

      {/* Lesson body: the shared renderer (components/course/LessonBlocks). */}
      {!payBlocked && displayLesson && (
        <div className="mb-9">
          <LessonBlocks
            lesson={displayLesson as never}
            mode="student"
            resolveAsset={isStudent ? undefined : (assetId) => `/api/courses/${courseId}/assets?assetId=${assetId}`}
            videoResumeKey={user?.id ? playbackKey(user.id, lessonId) : null}
            onVideoEnded={handleVideoEnd}
            onVideoProgress={markActive}
          />
        </div>
      )}

      {/* Quiz, assignments and practical tasks (components/course/LessonActivities). */}
      {!payBlocked && displayLesson && (isStudent || displayLesson.quiz) && (
        <div className="mb-8">
          <LessonActivities mode="student" lessonId={lessonId} courseId={courseId} quiz={displayLesson.quiz || null} />
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
      <nav aria-label="Lesson navigation" className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5 max-sm:[&>.btn]:flex-1 max-sm:[&>.btn]:px-3 max-sm:[&>div]:hidden sm:gap-4" data-testid="lesson-nav">
        {navigation.prev ? (
          <Link
            href={navigation.prev.locked ? `/courses/${courseId}` : lessonHref(courseId, navigation.prev.id)}
            className={`${navButton} btn-secondary`}
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
              className={`${navButton} btn-primary ml-auto`}
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
              className={`${navButton} btn-primary ml-auto`}
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
