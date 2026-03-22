/**
 * Course Detail Page
 * Shows course information and lessons
 */

import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import BackButton from '@/components/BackButton';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useCourse } from '@/hooks/useCourses';
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { sanitizeForStudentView, stripHtml } from '@/lib/html-sanitizer';
import { getLessonDescriptionHtml, hasVisibleHtml } from '@/lib/lesson-html';
import { useLessons } from '@/hooks/useLesson';
import { readCoursePaidClient, writeCoursePaidClient } from '@/lib/forexorbit-course-paid';
import { loadPaystackInline } from '@/lib/paystack-inline-script';

export default function CourseDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { course, loading, refetch: refetchCourse } = useCourse(id) as any;
  const { lessons, loading: lessonsLoading, refetch: refetchLessons } = useLessons(id);
  const { socket, connected } = useSocket();
  const { isAuthenticated, user } = useAuth();
  const [enrolling, setEnrolling] = useState(false);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (typeof id === 'string' && readCoursePaidClient(id)) {
      setPaid(true);
    }
  }, [id]);

  const openLesson = useCallback(
    (href: string) => {
      void router.push(href);
    },
    [router]
  );

  /**
   * Paystack: callback MUST be function(response) { ... } to avoid "Attribute callback must be a valid function".
   * IMPORTANT: Never use onClick={handlePay(courseId)} — it runs on render and breaks everything.
   * Always use: onClick={() => handlePay(courseId)}
   */
  const handlePay = useCallback(async (courseId: string) => {
    if (!courseId?.trim()) return;

    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY?.trim();
    if (!publicKey) {
      alert('Missing NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY in environment.');
      return;
    }

    try {
      await loadPaystackInline();
      const PaystackPop = window.PaystackPop;
      if (!PaystackPop) {
        alert('Paystack script failed to load.');
        return;
      }

      const ref = `fo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const handler = PaystackPop.setup({
        key: publicKey,
        email: 'test@example.com',
        amount: 5000 * 100, // ₦5,000
        currency: 'NGN',
        ref,
        metadata: { courseId, unlockCourse: 'true' },
        callback: function (response: { reference?: string }) {
          console.log('Payment success:', response);
          setPaid(true);
          writeCoursePaidClient(courseId);
        },
        onClose: function () {
          console.log('Payment closed');
        },
      });

      if (typeof handler.openIframe === 'function') {
        handler.openIframe();
      }
    } catch (e) {
      console.error(e);
      alert('Could not start payment. Check console.');
    }
  }, []);

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
      router.push('/login');
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
      console.error('Enrollment error:', error);
    } finally {
      setEnrolling(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading course..." fullScreen />;
  }

  if (!course) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Course not found</p>
      </div>
    );
  }

  const difficultyColors = {
    beginner: 'bg-green-100 text-green-800',
    intermediate: 'bg-yellow-100 text-yellow-800',
    advanced: 'bg-red-100 text-red-800',
  };

  const difficultyKey = ((course && (course.difficulty as any)) || 'beginner') as 'beginner' | 'intermediate' | 'advanced';
  const difficultyClass = difficultyColors[difficultyKey];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 md:py-8">
        {/* Back Button */}
        <div className="mb-3">
          <BackButton href="/courses" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 mb-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h1 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold text-gray-900 mb-2 break-words">{course.title}</h1>
                  <div className="flex items-center gap-3 mb-3">
                      <span className={`px-4 py-1.5 rounded-full text-sm font-semibold ${difficultyClass}`}>
                      {course.difficulty}
                    </span>
                    <span className="text-sm text-gray-500">•</span>
                    <span className="text-sm text-gray-600">{course.category}</span>
                  </div>
                </div>
              </div>

              {course.description && hasVisibleHtml(sanitizeForStudentView(course.description)) && (
                <div className="rich-html-readable text-base leading-relaxed mb-4">
                  <div dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(course.description) }} />
                </div>
              )}

              {/* Progress Bar */}
              {course.progress !== undefined && course.progress > 0 && (
                <div className="mb-0 p-3 bg-gray-50 rounded-xl">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-semibold text-gray-700">Your Progress</span>
                    <span className="font-bold text-primary-600">{Math.round(course.progress)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-primary-500 to-primary-600 h-3 rounded-full transition-all duration-500 shadow-sm"
                      style={{ width: `${course.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Lessons — source: GET /api/courses/:id/lessons { lessons } */}
            <div className="bg-white rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">Course Lessons</h2>
              {lessonsLoading ? (
                <p className="py-10 text-center text-gray-500">Loading lessons…</p>
              ) : lessons.length > 0 ? (
                <div className="space-y-3">
                  {(paid ? lessons : lessons.slice(0, 1)).map((lesson, index) => {
                    const href = `/courses/${id}/lessons/${lesson._id || lesson.id}`;
                    const key = String(lesson._id || lesson.id || index);
                    const lessonDesc = getLessonDescriptionHtml(lesson as any);
                    const lessonDescStudent = sanitizeForStudentView(lessonDesc);
                    const previewPlain = stripHtml(lessonDescStudent).replace(/\s+/g, ' ').trim();
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          className="relative flex w-full items-center justify-between gap-3 rounded-xl border-2 border-gray-200 p-5 text-left transition-all hover:border-primary-300 hover:bg-primary-50 group"
                          onClick={() => openLesson(href)}
                        >
                          <div className="flex min-w-0 flex-1 items-center space-x-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 text-base font-bold text-white shadow-md transition-transform group-hover:scale-110">
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
                    <div className="rounded-xl border-2 border-amber-200 bg-amber-50/60 p-5 dark:border-amber-800/50 dark:bg-amber-950/30">
                      <p className="mb-1 text-sm text-gray-700 dark:text-gray-300">
                        {lessons.length - 1} more lesson{lessons.length > 2 ? 's' : ''} in this course
                      </p>
                      <button
                        type="button"
                        className="w-full rounded-xl bg-primary-600 px-4 py-3 text-center text-base font-bold text-white shadow-md hover:bg-primary-700"
                        onClick={() => handlePay(typeof id === 'string' ? id : '')}
                      >
                        Unlock full course – ₦5,000
                      </button>
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
            <div className="bg-white rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 sticky top-20 sm:top-24">
              <div className="space-y-3">
                <div>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</span>
                  <p className="font-bold text-gray-900 mt-1">{course.category}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Difficulty</span>
                  <p className="font-bold text-gray-900 mt-1 capitalize">{course.difficulty}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lessons</span>
                  <p className="font-bold text-gray-900 mt-1">
                    {lessonsLoading ? '…' : lessons.length} lessons
                  </p>
                </div>

                <div className="pt-3 border-t border-gray-200">
                  {isAuthenticated ? (
                    <button
                      type="button"
                      onClick={() => void handleEnroll()}
                      disabled={enrolling}
                      className={`w-full px-6 py-4 rounded-xl font-bold text-lg transition-all shadow-lg ${
                        course.enrolled
                          ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                          : 'bg-primary-600 hover:bg-primary-700 text-white hover:shadow-xl transform hover:scale-105'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {enrolling ? 'Processing...' : course.enrolled ? 'Unenroll' : 'Enroll Now'}
                    </button>
                  ) : (
                    <Link href="/login" className="block w-full px-6 py-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold text-lg text-center transition-colors shadow-lg hover:shadow-xl">
                      Login to Enroll
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

