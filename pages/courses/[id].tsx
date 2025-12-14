/**
 * Course Detail Page
 * Shows course information and lessons
 */

import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { useCourse } from '@/hooks/useCourses';
import { useAuth } from '@/hooks/useAuth';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';

export default function CourseDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { course, loading } = useCourse(id);
  const { isAuthenticated, user } = useAuth();
  const [enrolling, setEnrolling] = useState(false);

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
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
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

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-6">
              <div className="flex items-start justify-between mb-6">
                <div className="flex-1">
                  <h1 className="text-4xl font-display font-bold text-gray-900 mb-3">{course.title}</h1>
                  <div className="flex items-center gap-3 mb-4">
                    <span className={`px-4 py-1.5 rounded-full text-sm font-semibold ${difficultyColors[course.difficulty]}`}>
                      {course.difficulty}
                    </span>
                    <span className="text-sm text-gray-500">•</span>
                    <span className="text-sm text-gray-600">{course.category}</span>
                  </div>
                </div>
              </div>

              <p className="text-lg text-gray-700 leading-relaxed mb-6">{course.description}</p>

              {/* Progress Bar */}
              {course.progress !== undefined && course.progress > 0 && (
                <div className="mb-6 p-4 bg-gray-50 rounded-xl">
                  <div className="flex justify-between text-sm mb-3">
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

            {/* Lessons */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Course Lessons</h2>
              {course.lessons && course.lessons.length > 0 ? (
                <div className="space-y-3">
                  {course.lessons.map((lesson: any, index: number) => (
                    <Link
                      key={lesson._id || lesson.id}
                      href={`/courses/${id}/lessons/${lesson._id || lesson.id}`}
                      className="flex items-center justify-between p-5 border-2 border-gray-200 rounded-xl hover:border-primary-300 hover:bg-primary-50 transition-all group"
                    >
                      <div className="flex items-center space-x-4 flex-1">
                        <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-primary-600 text-white rounded-xl flex items-center justify-center font-bold shadow-md group-hover:scale-110 transition-transform">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">{lesson.title}</h3>
                          {lesson.description && (
                            <p className="text-sm text-gray-500 line-clamp-1 mt-1">{lesson.description}</p>
                          )}
                        </div>
                      </div>
                      <svg className="w-6 h-6 text-gray-400 group-hover:text-primary-600 group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500">No lessons available yet.</p>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sticky top-24">
              <div className="space-y-6">
                <div>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</span>
                  <p className="font-bold text-gray-900 mt-1">{course.category}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Difficulty</span>
                  <p className="font-bold text-gray-900 mt-1 capitalize">{course.difficulty}</p>
                </div>
                {course.lessons && (
                  <div>
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lessons</span>
                    <p className="font-bold text-gray-900 mt-1">{course.lessons.length} lessons</p>
                  </div>
                )}

                <div className="pt-4 border-t border-gray-200">
                  {isAuthenticated ? (
                    <button
                      onClick={handleEnroll}
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

