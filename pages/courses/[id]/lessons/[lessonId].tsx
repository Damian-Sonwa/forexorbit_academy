/**
 * Lesson Page
 * Displays lesson content with video, description, quiz, and chat
 */

import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import VideoPlayer from '@/components/VideoPlayer';
import Chat from '@/components/Chat';
import MarketSignal from '@/components/MarketSignal';
import Quiz from '@/components/Quiz';
import { useLesson, useLessons } from '@/hooks/useLesson';
import { useCourse } from '@/hooks/useCourses';
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect } from 'react';

export default function LessonPage() {
  const router = useRouter();
  const { id: courseId, lessonId } = router.query;
  const { lesson, loading: lessonLoading } = useLesson(lessonId);
  const { lessons } = useLessons(courseId);
  const { course } = useCourse(courseId);
  const { isAuthenticated } = useAuth();
  const { updateProgress, joinLesson, leaveLesson } = useSocket();
  const [showQuiz, setShowQuiz] = useState(false);

  useEffect(() => {
    if (lessonId && isAuthenticated) {
      joinLesson(lessonId as string);
      return () => {
        leaveLesson(lessonId as string);
      };
    }
  }, [lessonId, isAuthenticated]);

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

  if (!lesson) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Lesson not found</p>
      </div>
    );
  }

  // Find current lesson index
  const currentIndex = lessons.findIndex((l) => (l._id || l.id) === (lesson._id || lesson.id));
  const prevLesson = currentIndex > 0 ? lessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < lessons.length - 1 ? lessons[currentIndex + 1] : null;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />

      <div className="flex flex-1">
        <Sidebar
          courseId={courseId as string}
          lessons={lessons.map((l) => ({
            id: l._id || l.id || '',
            title: l.title,
            order: l.order,
          }))}
          currentLessonId={lessonId as string}
        />

        <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Lesson Header */}
          <div className="mb-8">
            <Link
              href={`/courses/${courseId}`}
              className="inline-flex items-center text-primary-600 hover:text-primary-700 text-sm font-medium mb-4 group"
            >
              <svg className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Course
            </Link>
            <h1 className="text-3xl md:text-4xl font-display font-bold text-gray-900 mb-3">{lesson.title}</h1>
            {lesson.description && (
              <p className="text-lg text-gray-600 leading-relaxed">{lesson.description}</p>
            )}
          </div>

          {/* Video Player */}
          {lesson.videoUrl && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-2 mb-8 overflow-hidden">
              <VideoPlayer url={lesson.videoUrl} onEnded={handleVideoEnd} />
            </div>
          )}

          {/* Content */}
          {lesson.content && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Lesson Content</h2>
              <div
                className="prose prose-lg max-w-none text-gray-700"
                dangerouslySetInnerHTML={{ __html: lesson.content }}
              />
            </div>
          )}

          {/* Quiz */}
          {lesson.quiz && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-1">Lesson Quiz</h2>
                  <p className="text-gray-600 text-sm">Test your understanding</p>
                </div>
                <button
                  onClick={() => setShowQuiz(!showQuiz)}
                  className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors shadow-sm"
                >
                  {showQuiz ? 'Hide Quiz' : 'Take Quiz'}
                </button>
              </div>
              {showQuiz && (
                <div className="border-t border-gray-200 pt-6">
                  <Quiz
                    lessonId={lessonId as string}
                    courseId={courseId as string}
                    quiz={lesson.quiz}
                  />
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between items-center mb-8 gap-4">
            {prevLesson ? (
              <Link
                href={`/courses/${courseId}/lessons/${prevLesson._id || prevLesson.id}`}
                className="flex items-center px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-medium hover:border-primary-500 hover:text-primary-600 transition-colors"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Previous Lesson
              </Link>
            ) : (
              <div />
            )}
            {nextLesson ? (
              <Link
                href={`/courses/${courseId}/lessons/${nextLesson._id || nextLesson.id}`}
                className="flex items-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors shadow-sm ml-auto"
              >
                Next Lesson
                <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ) : (
              <div />
            )}
          </div>

          {/* Chat and Market Signal */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Lesson Chat</h2>
              <Chat lessonId={lessonId as string} />
            </div>
            <div>
              <MarketSignal />
            </div>
          </div>
        </main>
      </div>

      <Footer />
    </div>
  );
}

