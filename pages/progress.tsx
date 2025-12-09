/**
 * Progress Page
 * Role-based progress tracking:
 * - Student: Own courses and lessons
 * - Instructor: All students in their courses
 * - Admin: All students and all courses
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
// import Footer from '@/components/Footer'; // Reserved for future use
import BackButton from '@/components/BackButton';
import { useAuth } from '@/hooks/useAuth';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/lib/api-client';

interface ProgressItem {
  _id: string;
  userId: string;
  courseId: string;
  progress: number;
  completedLessons: string[];
  course?: {
    id: string;
    title: string;
    difficulty: string;
    category: string;
  };
  user?: {
    id: string;
    name: string;
    email: string;
  };
  totalLessons: number;
  completedLessonsCount: number;
  quizScores?: Array<{
    lessonId: string;
    score: number;
    totalQuestions: number;
    percentage: number;
  }>;
}

export default function Progress() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const { socket, connected } = useSocket();
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<{ difficulty?: string; courseId?: string; userId?: string }>({});

  // Fetch progress based on role
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }

    if (isAuthenticated && user) {
      fetchProgress();
    }
  }, [isAuthenticated, authLoading, user, filter]);

  // Real-time updates via Socket.io
  useEffect(() => {
    if (!socket || !connected || !user) return;

    // Listen for progress updates
    socket.on('progressUpdated', (data: { courseId: string; progress: number }) => {
      setProgress((prev) =>
        prev.map((p) =>
          p.courseId === data.courseId ? { ...p, progress: data.progress } : p
        )
      );
    });

    // Listen for student progress (instructor/admin)
    if (user.role === 'instructor' || user.role === 'admin') {
      socket.on('studentProgress', () => {
        fetchProgress(); // Refetch to get updated data
      });
    }

    return () => {
      socket.off('progressUpdated');
      socket.off('studentProgress');
    };
  }, [socket, connected, user]);

  const fetchProgress = async () => {
    try {
      setLoading(true);
      let response;
      
      if (user?.role === 'student') {
        response = await apiClient.get<ProgressItem[]>('/progress');
      } else {
        // Instructor/Admin: use /progress/all endpoint
        const params = new URLSearchParams();
        if (filter.difficulty) params.append('difficulty', filter.difficulty);
        if (filter.courseId) params.append('courseId', filter.courseId);
        if (filter.userId) params.append('userId', filter.userId);
        
        const queryString = params.toString();
        response = await apiClient.get<ProgressItem[]>(`/progress/all${queryString ? `?${queryString}` : ''}`);
      }
      
      setProgress(response);
    } catch (error: any) {
      console.error('Fetch progress error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading progress...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  // Student View - Enhanced Design
  if (user.role === 'student') {
    // Calculate overall stats
    const totalCourses = progress.length;
    const completedCourses = progress.filter(p => p.progress >= 100).length;
    const avgProgress = progress.length > 0 
      ? Math.round(progress.reduce((sum, p) => sum + p.progress, 0) / progress.length)
      : 0;
    const totalQuizzes = progress.reduce((sum, p) => sum + (p.quizScores?.length || 0), 0);

    return (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <Header />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
          {/* Back Button */}
          <div className="mb-4">
            <BackButton href="/dashboard" />
          </div>

          {/* Header Section */}
          <div className="mb-4 flex-shrink-0">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">My Progress</h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm">Track your learning journey and quiz scores</p>
          </div>

          {/* Stats Cards */}
          {progress.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 flex-shrink-0">
              <div className="bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl shadow-lg p-4 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-primary-100 text-xs font-medium mb-1">Total Courses</p>
                    <p className="text-2xl font-bold">{totalCourses}</p>
                  </div>
                  <svg className="w-8 h-8 text-primary-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
              </div>
              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-4 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-green-100 text-xs font-medium mb-1">Completed</p>
                    <p className="text-2xl font-bold">{completedCourses}</p>
                  </div>
                  <svg className="w-8 h-8 text-green-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-4 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-100 text-xs font-medium mb-1">Avg Progress</p>
                    <p className="text-2xl font-bold">{avgProgress}%</p>
                  </div>
                  <svg className="w-8 h-8 text-blue-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
              </div>
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-4 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-purple-100 text-xs font-medium mb-1">Quizzes Taken</p>
                    <p className="text-2xl font-bold">{totalQuizzes}</p>
                  </div>
                  <svg className="w-8 h-8 text-purple-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
              </div>
            </div>
          )}

          {progress.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="w-24 h-24 bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900 dark:to-primary-800 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-12 h-12 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">No Progress Yet</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">Start learning by enrolling in a course!</p>
              <Link href="/courses" className="inline-flex items-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all">
                Browse Courses
                <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {progress.map((item) => (
                <div key={item._id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-xl transition-all duration-300 group">
                  {/* Course Header */}
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-3 h-3 rounded-full ${
                          item.progress >= 100 ? 'bg-green-500' :
                          item.progress >= 50 ? 'bg-blue-500' :
                          'bg-yellow-500'
                        } ${item.progress >= 100 ? 'animate-pulse' : ''}`}></div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                          {item.course?.title || 'Unknown Course'}
                        </h3>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 capitalize ml-6">
                        {item.course?.difficulty} • {item.course?.category}
                      </p>
                    </div>
                    <div className={`px-4 py-2 rounded-xl font-bold text-lg shadow-md ${
                      item.progress >= 100 ? 'bg-gradient-to-br from-green-500 to-green-600 text-white' :
                      item.progress >= 50 ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white' :
                      'bg-gradient-to-br from-yellow-400 to-yellow-500 text-white'
                    }`}>
                      {Math.round(item.progress)}%
                    </div>
                  </div>

                  {/* Enhanced Progress Bar */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Progress</span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {item.completedLessonsCount} / {item.totalLessons} lessons
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ease-out ${
                          item.progress >= 100 ? 'bg-gradient-to-r from-green-500 to-green-600' :
                          item.progress >= 50 ? 'bg-gradient-to-r from-blue-500 to-blue-600' :
                          'bg-gradient-to-r from-yellow-400 to-yellow-500'
                        }`}
                        style={{ width: `${item.progress}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Quiz Scores - Enhanced */}
                  {item.quizScores && item.quizScores.length > 0 && (
                    <div className="mb-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center">
                        <svg className="w-5 h-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        Quiz Scores
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {item.quizScores.map((quiz, idx) => (
                          <div key={idx} className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-600">
                            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Quiz {idx + 1}</p>
                            <div className="flex items-baseline gap-2">
                              <p className="text-lg font-bold text-gray-900 dark:text-white">{quiz.percentage}%</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">({quiz.score}/{quiz.totalQuestions})</p>
                            </div>
                            <div className="mt-2 w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${
                                  quiz.percentage >= 80 ? 'bg-green-500' :
                                  quiz.percentage >= 60 ? 'bg-blue-500' :
                                  'bg-yellow-500'
                                }`}
                                style={{ width: `${quiz.percentage}%` }}
                              ></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Button */}
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <Link
                      href={`/courses/${item.courseId}`}
                      className="inline-flex items-center justify-center w-full px-4 py-3 bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600 text-white rounded-xl font-semibold shadow-md hover:shadow-lg transition-all"
                    >
                      {item.progress >= 100 ? 'View Certificate' : 'Continue Learning'}
                      <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    );
  }

  // Instructor/Admin View - Enhanced Design
  const uniqueStudents = new Set(progress.map(p => p.userId)).size;
  const uniqueCourses = new Set(progress.map(p => p.courseId)).size;
  const completedCount = progress.filter(p => p.progress >= 100).length;
  const inProgressCount = progress.filter(p => p.progress > 0 && p.progress < 100).length;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        {/* Header Section */}
        <div className="mb-4 flex-shrink-0">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
            {user.role === 'admin' ? 'All Students Progress' : 'My Students Progress'}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            {user.role === 'admin' 
              ? 'Monitor progress across all courses and students'
              : 'Track your students\' learning progress'}
          </p>
        </div>

        {/* Enhanced Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 mb-4 flex-shrink-0">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Filters</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {user.role === 'admin' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Filter by Difficulty</label>
                <select
                  value={filter.difficulty || ''}
                  onChange={(e) => setFilter({ ...filter, difficulty: e.target.value || undefined })}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">All Levels</option>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Search Course</label>
              <input
                type="text"
                placeholder="Course ID..."
                value={filter.courseId || ''}
                onChange={(e) => setFilter({ ...filter, courseId: e.target.value || undefined })}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            {user.role === 'admin' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Search Student</label>
                <input
                  type="text"
                  placeholder="Student ID..."
                  value={filter.userId || ''}
                  onChange={(e) => setFilter({ ...filter, userId: e.target.value || undefined })}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            )}
          </div>
        </div>

        {/* Enhanced Summary Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 flex-shrink-0">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-xs font-medium mb-1">Total Students</p>
                <p className="text-2xl font-bold">{uniqueStudents}</p>
              </div>
              <svg className="w-8 h-8 text-blue-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-xs font-medium mb-1">Total Courses</p>
                <p className="text-2xl font-bold">{uniqueCourses}</p>
              </div>
              <svg className="w-8 h-8 text-purple-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
          </div>
          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-xs font-medium mb-1">Completed</p>
                <p className="text-2xl font-bold">{completedCount}</p>
              </div>
              <svg className="w-8 h-8 text-green-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl shadow-lg p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-xs font-medium mb-1">In Progress</p>
                <p className="text-2xl font-bold">{inProgressCount}</p>
              </div>
              <svg className="w-8 h-8 text-orange-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Enhanced Progress Table */}
        {progress.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center min-h-[400px] flex items-center justify-center">
            <div>
              <svg className="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-gray-600 dark:text-gray-400">No progress data found</p>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-full">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Course</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Progress</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Lessons</th>
                    {user.role === 'admin' && (
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Quizzes</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {progress.map((item) => (
                    <tr key={item._id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-secondary-500 rounded-full flex items-center justify-center text-white font-bold mr-2 text-xs">
                            {item.user?.name?.charAt(0).toUpperCase() || 'U'}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-900 dark:text-white">{item.user?.name || 'Unknown'}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{item.user?.email || ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-bold text-gray-900 dark:text-white">{item.course?.title || 'Unknown'}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                            {item.course?.difficulty} • {item.course?.category}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full transition-all duration-500 ${
                                item.progress >= 100 ? 'bg-gradient-to-r from-green-500 to-green-600' :
                                item.progress >= 50 ? 'bg-gradient-to-r from-blue-500 to-blue-600' :
                                'bg-gradient-to-r from-yellow-400 to-yellow-500'
                              }`}
                              style={{ width: `${item.progress}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-bold text-gray-900 dark:text-white min-w-[3rem]">{Math.round(item.progress)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">
                          {item.completedLessonsCount} / {item.totalLessons}
                        </p>
                      </td>
                      {user.role === 'admin' && (
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                            {item.quizScores?.length || 0} completed
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

