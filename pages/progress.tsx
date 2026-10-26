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
import LoadingSpinner from '@/components/LoadingSpinner';
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
  active?: boolean;
  countsTowardActiveTotals?: boolean;
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
  const [staffSummary, setStaffSummary] = useState<{
    courses: Array<{ courseId: string; title: string; difficulty: string; activeEnrollments: number; completed: number; inProgress: number }>;
    totals: { students: number; courses: number; completed: number; inProgress: number };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
        setProgress(response);
      } else {
        const params = new URLSearchParams();
        if (filter.difficulty) params.append('difficulty', filter.difficulty);
        if (filter.courseId) params.append('courseId', filter.courseId);
        const queryString = params.toString();
        response = await apiClient.get<{ courses: Array<{ courseId: string; title: string; difficulty: string; activeEnrollments: number; completed: number; inProgress: number }>; totals: { students: number; courses: number; completed: number; inProgress: number } }>(`/progress/all${queryString ? `?${queryString}` : ''}`);
        setStaffSummary(response);
      }
      setLoadError(null);
    } catch (error: any) {
      console.error('Fetch progress error:', error);
      setLoadError('Progress could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return <LoadingSpinner message="Loading progress..." fullScreen />;
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  // Student View - Enhanced Design
  if (user.role === 'student') {
    // Calculate overall stats
    const activeRows = progress.filter((item) => item.countsTowardActiveTotals === true);
    const totalCourses = activeRows.length;
    const completedCourses = activeRows.filter((item) => item.progress >= 100).length;
    const avgProgress = activeRows.length > 0
      ? Math.round(activeRows.reduce((sum, item) => sum + item.progress, 0) / activeRows.length)
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
            <h1 className="page-title">My progress</h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm">Track your learning journey and quiz scores</p>
          </div>

          {/* Stats Cards */}
          {progress.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 flex-shrink-0">
              <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm p-4 text-neutral-900 dark:text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-neutral-500 text-xs font-medium mb-1">Total Courses</p>
                    <p className="text-2xl font-bold">{totalCourses}</p>
                  </div>
                  <svg className="w-8 h-8 text-primary-600 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
              </div>
              <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm p-4 text-neutral-900 dark:text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-neutral-500 text-xs font-medium mb-1">Completed</p>
                    <p className="text-2xl font-bold">{completedCourses}</p>
                  </div>
                  <svg className="w-8 h-8 text-primary-600 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm p-4 text-neutral-900 dark:text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-neutral-500 text-xs font-medium mb-1">Avg Progress</p>
                    <p className="text-2xl font-bold">{avgProgress}%</p>
                  </div>
                  <svg className="w-8 h-8 text-primary-600 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
              </div>
              <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm p-4 text-neutral-900 dark:text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-neutral-500 text-xs font-medium mb-1">Quizzes Taken</p>
                    <p className="text-2xl font-bold">{totalQuizzes}</p>
                  </div>
                  <svg className="w-8 h-8 text-primary-600 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
              </div>
            </div>
          )}

          {loadError ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Progress could not be loaded</h3>
              <p className="text-gray-600 dark:text-gray-400">Your enrollments are unchanged.</p>
              <button type="button" onClick={() => fetchProgress()} className="mt-6 inline-flex items-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold">Try again</button>
            </div>
          ) : progress.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="w-24 h-24 bg-primary-50 dark:bg-primary-950 rounded-full flex items-center justify-center mx-auto mb-6">
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
                <div key={item._id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 transition-colors group">
                  {/* Course Header */}
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-3 h-3 rounded-full ${
                          item.progress >= 100 ? 'bg-green-500' :
                          item.progress >= 50 ? 'bg-primary-600' :
                          'bg-yellow-500'
                        } ${item.progress >= 100 ? 'animate-pulse' : ''}`}></div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                          {item.course?.title || 'Unknown Course'}
                        </h3>
                        {item.active === false && (
                          <span className="text-xs font-medium text-neutral-500">Withdrawn</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 capitalize ml-6">
                        {item.course?.difficulty} • {item.course?.category}
                      </p>
                    </div>
                    <div className={`px-4 py-2 rounded-xl font-bold text-lg shadow-md ${
                      item.progress >= 100 ? 'bg-green-700 text-white' :
                      item.progress >= 50 ? 'bg-primary-600 text-white' :
                      'bg-neutral-200 text-neutral-800'
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
                          item.progress >= 100 ? 'bg-green-600' :
                          item.progress >= 50 ? 'bg-primary-600' :
                          'bg-neutral-300'
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
                          <div key={idx} className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-3 border border-gray-200 dark:border-gray-600">
                            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Quiz {idx + 1}</p>
                            <div className="flex items-baseline gap-2">
                              <p className="text-lg font-bold text-gray-900 dark:text-white">{quiz.percentage}%</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">({quiz.score}/{quiz.totalQuestions})</p>
                            </div>
                            <div className="mt-2 w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${
                                  quiz.percentage >= 80 ? 'bg-green-500' :
                                  quiz.percentage >= 60 ? 'bg-primary-600' :
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
                      className="inline-flex items-center justify-center w-full px-4 py-3 bg-primary-600 hover:bg-primary-700 dark:bg-primary-600 dark:hover:bg-primary-700 text-white rounded-xl font-semibold shadow-md hover:shadow-lg transition-all"
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
  const uniqueStudents = staffSummary?.totals.students || 0;
  const uniqueCourses = staffSummary?.totals.courses || 0;
  const completedCount = staffSummary?.totals.completed || 0;
  const inProgressCount = staffSummary?.totals.inProgress || 0;
  const staffCourses = staffSummary?.courses || [];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        {/* Header Section */}
        <div className="mb-4 flex-shrink-0">
          <h1 className="page-title">
            {user.role === 'admin' ? 'All student progress' : 'Student progress'}
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
          </div>
        </div>

        {/* Enhanced Summary Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 flex-shrink-0">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm p-4 text-neutral-900 dark:text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-neutral-500 text-xs font-medium mb-1">Total Students</p>
                <p className="text-2xl font-bold">{uniqueStudents}</p>
              </div>
              <svg className="w-8 h-8 text-primary-600 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
          </div>
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm p-4 text-neutral-900 dark:text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-neutral-500 text-xs font-medium mb-1">Total Courses</p>
                <p className="text-2xl font-bold">{uniqueCourses}</p>
              </div>
              <svg className="w-8 h-8 text-primary-600 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
          </div>
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm p-4 text-neutral-900 dark:text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-neutral-500 text-xs font-medium mb-1">Completed</p>
                <p className="text-2xl font-bold">{completedCount}</p>
              </div>
              <svg className="w-8 h-8 text-primary-600 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm p-4 text-neutral-900 dark:text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-neutral-500 text-xs font-medium mb-1">In Progress</p>
                <p className="text-2xl font-bold">{inProgressCount}</p>
              </div>
              <svg className="w-8 h-8 text-primary-600 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Enhanced Progress Table */}
        {loadError ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Progress could not be loaded</h3>
            <p className="text-gray-600 dark:text-gray-400">Enrollment records were not changed.</p>
            <button type="button" onClick={() => fetchProgress()} className="mt-6 inline-flex items-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold">Try again</button>
          </div>
        ) : staffCourses.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center min-h-[400px] flex items-center justify-center">
            <p className="text-gray-600 dark:text-gray-400">No active course enrollments found</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-full">
                <thead className="bg-neutral-50 dark:bg-neutral-800 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Course</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Active enrollments</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Completed</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">In progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {staffCourses.map((course) => (
                    <tr key={course.courseId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-bold text-gray-900 dark:text-white">{course.title || 'Untitled course'}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{course.difficulty}</p>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">{course.activeEnrollments}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">{course.completed}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">{course.inProgress}</td>
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

