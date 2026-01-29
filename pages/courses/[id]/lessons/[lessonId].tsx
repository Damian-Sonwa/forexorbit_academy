/**
 * Lesson Page
 * Displays lesson content with video, description, quiz, and chat
 */

import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import BackButton from '@/components/BackButton';
import VideoPlayer from '@/components/VideoPlayer';
import MarketSignal from '@/components/MarketSignal';
import Quiz from '@/components/Quiz';
import { useLesson, useLessons } from '@/hooks/useLesson';
import { apiClient } from '@/lib/api-client';
// import { useCourse } from '@/hooks/useCourses'; // Reserved for future use
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/hooks/useAuth';
import LessonSummaryView from '@/components/LessonSummaryView';
import LessonSummaryEditor from '@/components/LessonSummaryEditor';
import InstructorLessonEditor from '@/components/InstructorLessonEditor';
import { sanitizeHtml } from '@/lib/html-sanitizer';
import { useState, useEffect } from 'react';

export default function LessonPage() {
  const router = useRouter();
  const { id: courseId, lessonId } = router.query;
  const { lesson, loading: lessonLoading } = useLesson(lessonId);
  const { lessons } = useLessons(courseId);
  // const { course } = useCourse(courseId); // Reserved for future use
  const { isAuthenticated } = useAuth();
  const { updateProgress, joinLesson, leaveLesson, socket, connected } = useSocket();
  const { user } = useAuth();
  const [showQuiz, setShowQuiz] = useState(false);
  const [showSummaryEditor, setShowSummaryEditor] = useState(false);
  const [showContentEditor, setShowContentEditor] = useState(false);
  const [currentLesson, setCurrentLesson] = useState(lesson);

  // Update currentLesson when lesson data changes
  useEffect(() => {
    if (lesson) {
      setCurrentLesson(lesson);
    }
  }, [lesson]);

  useEffect(() => {
    if (lessonId && isAuthenticated) {
      joinLesson(lessonId as string);
      return () => {
        leaveLesson(lessonId as string);
      };
    }
  }, [lessonId, isAuthenticated]);

  // Listen for lesson updates via Socket.io
  useEffect(() => {
    if (!socket || !connected || !lessonId) return;

    const handleLessonUpdate = (data: { lessonId: string; courseId: string }) => {
      if (data.lessonId === lessonId) {
        // Refetch lesson data when updated
        (async () => {
          try {
            const fresh = await apiClient.get<any>(`/lessons/${lessonId}`);
            setCurrentLesson(fresh);
          } catch (err) {
            // Fallback to route replace if direct fetch fails
            router.replace(router.asPath);
          }
        })();
      }
    };

    socket.on('lessonUpdated', handleLessonUpdate);

    return () => {
      socket.off('lessonUpdated', handleLessonUpdate);
    };
  }, [socket, connected, lessonId, router]);

  const handleVideoEnd = () => {
    if (courseId && lessonId && isAuthenticated) {
      updateProgress(courseId as string, lessonId as string);
    }
  };

  if (lessonLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading lesson...</p>
      </div>
    );
  }

  const displayLesson = currentLesson || lesson;
  if (!displayLesson) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Lesson not found</p>
      </div>
    );
  }

  // Find current lesson index
  const currentIndex = lessons.findIndex((l) => (l._id || l.id) === (displayLesson._id || displayLesson.id));
  const prevLesson = currentIndex > 0 ? lessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < lessons.length - 1 ? lessons[currentIndex + 1] : null;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />

      <div className="flex flex-1 relative">
        <Sidebar
          courseId={courseId as string}
          lessons={lessons.map((l) => ({
            id: l._id || l.id || '',
            title: l.title,
            order: l.order,
          }))}
          currentLessonId={lessonId as string}
        />

        <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 md:py-8 pt-20 lg:pt-8">
          {/* Lesson Header */}
          <div className="mb-4">
            <div className="mb-2">
              <BackButton href={`/courses/${courseId}`} label="Back to Course" />
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold text-gray-900 mb-2 break-words" dangerouslySetInnerHTML={{ __html: sanitizeHtml(displayLesson.title) }} />
          </div>

          {/* Video Player - Display YouTube videos and other video URLs */}
          {displayLesson.videoUrl && (
            <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg border border-gray-100 p-2 mb-4 overflow-hidden">
              <VideoPlayer url={displayLesson.videoUrl} onEnded={handleVideoEnd} />
            </div>
          )}

          {/* Instructor/Admin Lesson Content Editor - ONLY visible to instructors/admins */}
          {user?.role === 'instructor' && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-900">Lesson Content Editor</h2>
                <button
                  onClick={() => setShowContentEditor(!showContentEditor)}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-sm transition-colors"
                >
                  {showContentEditor ? 'Hide Editor' : 'Edit Content'}
                </button>
              </div>
              {showContentEditor && (
                <InstructorLessonEditor
                  lessonId={lessonId as string}
                  courseId={courseId as string}
                  initialContent={displayLesson.content || ''}
                  onSave={() => {
                    setShowContentEditor(false);
                    // Refetch lesson data to show updated content
                    router.replace(router.asPath);
                  }}
                />
              )}
            </div>
          )}

          {/* Lesson Content - Summary */}
          {((displayLesson as any).lessonSummary?.overview || (displayLesson as any).summary || (currentLesson as any)?.lessonSummary?.overview) && (
            <div className="bg-white rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 mb-4">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">Lesson Content</h2>
              <div className="prose prose-lg max-w-none text-gray-700">
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml((currentLesson as any)?.lessonSummary?.overview || (displayLesson as any).lessonSummary?.overview || (displayLesson as any).summary) }} />
              </div>
            </div>
          )}

          {/* Visual Aids */}
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 mb-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 gap-3">
              <div className="flex-1">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">Visual Aids</h2>
                <p className="text-gray-600 text-xs sm:text-sm">Charts, screenshots, resources, and visual materials for this lesson</p>
              </div>
              {user?.role === 'instructor' && (
                <button
                  onClick={() => setShowSummaryEditor(!showSummaryEditor)}
                  className="w-full sm:w-auto px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold text-sm transition-colors"
                >
                  {showSummaryEditor ? 'Cancel' : 'Edit Visual Aids'}
                </button>
              )}
            </div>
            
            {user?.role === 'instructor' && showSummaryEditor && (currentLesson || lesson) ? (
              <LessonSummaryEditor lessonId={lessonId as string} lesson={currentLesson || lesson!} onSave={() => {
                setShowSummaryEditor(false);
                // Refetch lesson data to show updated summary
                router.replace(router.asPath);
              }} />
            ) : (currentLesson || lesson) ? (
              <LessonSummaryView lesson={currentLesson || lesson!} />
            ) : null}
          </div>

          {/* Lesson Resources */}
          {((displayLesson as any).resources && (displayLesson as any).resources.length > 0) && (
            <div className="bg-white rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 mb-4">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 flex items-center">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Lesson Resources
              </h2>
              <p className="text-sm sm:text-base text-gray-600 mb-3">Downloadable resources and links for this lesson</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {(displayLesson as any).resources.map((resource: any, index: number) => (
                  <a
                    key={index}
                    href={resource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center p-4 bg-gray-50 hover:bg-primary-50 rounded-xl border-2 border-gray-200 hover:border-primary-300 transition-all group"
                  >
                    <div className="flex-shrink-0 w-12 h-12 bg-primary-100 group-hover:bg-primary-200 rounded-lg flex items-center justify-center mr-4 transition-colors">
                      {resource.type === 'pdf' && (
                        <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      )}
                      {resource.type === 'link' && (
                        <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                      )}
                      {resource.type === 'slide' && (
                        <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                      {!['pdf', 'link', 'slide'].includes(resource.type) && (
                        <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 group-hover:text-primary-600 transition-colors truncate">
                        {resource.title || `Resource ${index + 1}`}
                      </p>
                      <p className="text-xs text-gray-500 capitalize mt-1">{resource.type || 'file'}</p>
                    </div>
                    <svg className="w-5 h-5 text-gray-400 group-hover:text-primary-600 transition-colors ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Quiz */}
          {displayLesson.quiz && (
            <div className="bg-white rounded-xl sm:rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 mb-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 gap-3">
                <div className="flex-1">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">Lesson Quiz</h2>
                  <p className="text-gray-600 text-xs sm:text-sm">Test your understanding</p>
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
                    lessonId={lessonId as string}
                    courseId={courseId as string}
                    quiz={displayLesson.quiz}
                  />
                </div>
              )}
            </div>
          )}

          {/* Market Signal */}
          <div className="mb-4">
            <MarketSignal />
          </div>

          {/* Navigation - Moved to end of page */}
          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center mb-4 gap-3 sm:gap-4">
            {prevLesson ? (
              <Link
                href={`/courses/${courseId}/lessons/${prevLesson._id || prevLesson.id}`}
                className="flex items-center justify-center px-4 sm:px-6 py-2 sm:py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-medium hover:border-primary-500 hover:text-primary-600 transition-colors text-sm sm:text-base"
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span className="hidden sm:inline">Previous Lesson</span>
                <span className="sm:hidden">Previous</span>
              </Link>
            ) : (
              <div />
            )}
            {nextLesson ? (
              <Link
                href={`/courses/${courseId}/lessons/${nextLesson._id || nextLesson.id}`}
                className="flex items-center justify-center px-4 sm:px-6 py-2 sm:py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors shadow-sm sm:ml-auto text-sm sm:text-base"
              >
                <span className="hidden sm:inline">Next Lesson</span>
                <span className="sm:hidden">Next</span>
                <svg className="w-4 h-4 sm:w-5 sm:h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ) : (
              <div />
            )}
          </div>
        </main>
      </div>

      <Footer />
    </div>
  );
}

