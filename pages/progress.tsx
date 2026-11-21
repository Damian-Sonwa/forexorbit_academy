/**
 * Progress Page
 * Role-based progress tracking:
 * - Student: Own courses and lessons
 * - Instructor: All students in their courses
 * - Admin: All students and all courses
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';
import PageHeader, { ReadoutStrip } from '@/components/ui/PageHeader';
import OrbitProgress from '@/components/ui/OrbitProgress';
import BackButton from '@/components/BackButton';
import AssessmentHistory from '@/components/AssessmentHistory';
import LoadingSpinner from '@/components/LoadingSpinner';
import { CourseCardSkeleton, LoadingStatus, MetricSkeleton, TableSkeleton } from '@/components/loading';
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
  /** Phase 8: from the server's completion rule (completedAt is permanent; lib/course-progress.js). */
  status?: 'completed' | 'in_progress' | 'not_started';
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
  const [refreshing, setRefreshing] = useState(false);
  const hasContent = useRef(false);
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
    const background = hasContent.current;
    try {
      if (background) setRefreshing(true);
      else setLoading(true);
      let response;
      
      if (user?.role === 'student') {
        response = await apiClient.get<ProgressItem[]>('/progress');
        setProgress(response);
        hasContent.current = response.length > 0;
      } else {
        const params = new URLSearchParams();
        if (filter.difficulty) params.append('difficulty', filter.difficulty);
        if (filter.courseId) params.append('courseId', filter.courseId);
        const queryString = params.toString();
        response = await apiClient.get<{ courses: Array<{ courseId: string; title: string; difficulty: string; activeEnrollments: number; completed: number; inProgress: number }>; totals: { students: number; courses: number; completed: number; inProgress: number } }>(`/progress/all${queryString ? `?${queryString}` : ''}`);
        setStaffSummary(response);
        hasContent.current = true;
      }
      setLoadError(null);
    } catch (error: any) {
      console.error('Fetch progress error:');
      setLoadError('Progress could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  if (authLoading || !isAuthenticated || !user) {
    return <LoadingSpinner message="Checking your session" fullScreen />;
  }

  if (loading && !loadError && progress.length === 0 && !staffSummary) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
          <div className="mb-6">
            <LoadingStatus label={user.role === 'student' ? 'Loading your progress' : 'Loading course progress'} />
          </div>
          <MetricSkeleton count={user.role === 'student' ? 4 : 3} />
          <div className="mt-6">
            {user.role === 'student' ? <CourseCardSkeleton count={3} /> : <TableSkeleton rows={6} />}
          </div>
        </main>
      </div>
    );
  }

  // Student View - Enhanced Design
  if (user.role === 'student') {
    // Calculate overall stats
    const activeRows = progress.filter((item) => item.countsTowardActiveTotals === true);
    const totalCourses = activeRows.length;
    // A course stays completed once completedAt is recorded, even if lessons were added since.
    const isCompleted = (item: ProgressItem) => (item.status ? item.status === 'completed' : item.progress >= 100);
    const completedCourses = activeRows.filter(isCompleted).length;
    const avgProgress = activeRows.length > 0
      ? Math.round(activeRows.reduce((sum, item) => sum + item.progress, 0) / activeRows.length)
      : 0;
    const totalQuizzes = progress.reduce((sum, p) => sum + (p.quizScores?.length || 0), 0);

    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex flex-1 lg:items-start">
          <Sidebar />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:pt-8">
          {/* Back Button */}
          <div className="mb-4">
            <BackButton href="/dashboard" />
          </div>

          <PageHeader
            kicker="Learn"
            title="My progress"
            lede="Track your learning journey and quiz scores"
            actions={refreshing ? <LoadingStatus label="Updating progress" compact /> : undefined}
          />
          {progress.length > 0 && (
            <div className="mb-6 grid gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
              <div className="card panel-instrument flex items-center gap-4 !py-4">
                <OrbitProgress value={avgProgress} size={72} label="Average progress" />
                <div>
                  <p className="readout-label">Avg Progress</p>
                  <p className="mt-1 text-xs text-ink-subtle">across your active courses</p>
                </div>
              </div>
              <ReadoutStrip
                items={[
                  { label: 'Total Courses', value: totalCourses },
                  { label: 'Completed', value: completedCourses },
                  { label: 'Quizzes Taken', value: totalQuizzes },
                ]}
              />
            </div>
          )}

          {loadError ? (
            <div className="card rounded-2xl p-12 text-center">
              <h3 className="text-2xl font-bold mb-2 text-ink">Progress could not be loaded</h3>
              <p className="text-ink-muted">Your enrollments are unchanged.</p>
              <button type="button" onClick={() => fetchProgress()} className="btn btn-primary mt-6 inline-flex items-center px-6 py-3">Try again</button>
            </div>
          ) : progress.length === 0 ? (
            <div className="card rounded-2xl p-12 text-center">
              <div className="w-24 h-24 bg-primary-50 dark:bg-primary-950 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-12 h-12 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold mb-2 text-ink">No Progress Yet</h3>
              <p className="mb-6 text-ink-muted">Start learning by enrolling in a course!</p>
              <Link href="/courses" className="btn btn-primary inline-flex items-center px-6 py-3">
                Browse Courses
                <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {progress.map((item) => (
                <div key={item._id} className="card rounded-xl p-4 transition-colors group">
                  {/* Course Header */}
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-3 h-3 rounded-full ${
                          item.progress >= 100 ? 'bg-green-500' :
                          item.progress >= 50 ? 'bg-primary-600' :
                          'bg-yellow-500'
                        } ${item.progress >= 100 ? 'animate-pulse' : ''}`}></div>
                        <h3 className="text-xl font-bold group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors text-ink">
                          {item.course?.title || 'Unknown Course'}
                        </h3>
                        {item.active === false && (
                          <span className="text-xs font-medium text-ink-muted">Withdrawn</span>
                        )}
                      </div>
                      <p className="text-sm capitalize ml-6 text-ink-muted">
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
                      <span className="text-sm font-semibold text-ink-muted">Progress</span>
                      <span className="text-sm text-ink-muted">
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
                      <h4 className="text-sm font-bold mb-4 flex items-center text-ink">
                        <svg className="w-5 h-5 mr-2 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        Quiz Scores
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {item.quizScores.map((quiz, idx) => (
                          <div key={idx} className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-3 border border-gray-200 dark:border-gray-600">
                            <p className="text-xs font-medium mb-1 text-ink-muted">Quiz {idx + 1}</p>
                            <div className="flex items-baseline gap-2">
                              <p className="text-lg font-bold text-ink">{quiz.percentage}%</p>
                              {quiz.totalQuestions > 0 && <p className="text-xs text-ink-muted">({quiz.score}/{quiz.totalQuestions})</p>}
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
                      className="btn btn-primary inline-flex items-center justify-center w-full px-4 py-3"
                    >
                      {isCompleted(item) ? 'View Certificate' : 'Continue Learning'}
                      <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4"><AssessmentHistory /></div>
        </main>
        </div>
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
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-8 sm:px-6 lg:px-10">
        <PageHeader
          kicker={user.role === 'admin' ? 'Academy overview' : 'Teaching'}
          title={user.role === 'admin' ? 'All student progress' : 'Student progress'}
          lede={user.role === 'admin' ? 'Monitor progress across all courses and students' : 'Track your students\' learning progress'}
          actions={refreshing ? <LoadingStatus label="Updating progress" compact /> : undefined}
        />

        <ReadoutStrip
          className="mb-6"
          items={[
            { label: 'Total Students', value: uniqueStudents },
            { label: 'Total Courses', value: uniqueCourses },
            { label: 'Completed', value: completedCount },
            { label: 'In Progress', value: inProgressCount },
          ]}
        />

        <section className="card mb-6 !p-4" aria-label="Filters">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {user.role === 'admin' && (
              <label className="block text-xs font-medium text-ink-muted">Filter by Difficulty
                <select
                  value={filter.difficulty || ''}
                  onChange={(e) => setFilter({ ...filter, difficulty: e.target.value || undefined })}
                  className="input mt-1.5"
                >
                  <option value="">All Levels</option>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </label>
            )}
            <label className="block text-xs font-medium text-ink-muted">Search Course
              <input
                type="text"
                placeholder="Course ID..."
                value={filter.courseId || ''}
                onChange={(e) => setFilter({ ...filter, courseId: e.target.value || undefined })}
                className="input mt-1.5"
              />
            </label>
          </div>
        </section>

        {loadError ? (
          <div className="card p-12 text-center">
            <h3 className="section-title !text-xl">Progress could not be loaded</h3>
            <p className="mt-2 text-ink-muted">Enrollment records were not changed.</p>
            <button type="button" onClick={() => fetchProgress()} className="btn btn-primary mt-6">Try again</button>
          </div>
        ) : staffCourses.length === 0 ? (
          <div className="card flex min-h-[320px] flex-col items-center justify-center p-12 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-subtle">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            </div>
            <p className="text-ink-muted">No active course enrollments found</p>
          </div>
        ) : (
          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="table-orbit min-w-full">
                <thead className="sticky top-0 z-10 bg-surface-2">
                  <tr>
                    <th>Course</th>
                    <th>Active enrollments</th>
                    <th>Completed</th>
                    <th>In progress</th>
                  </tr>
                </thead>
                <tbody>
                  {staffCourses.map((course) => {
                    const total = Math.max(1, course.activeEnrollments);
                    return (
                      <tr key={course.courseId}>
                        <td>
                          <p className="text-sm font-semibold text-ink">{course.title || 'Untitled course'}</p>
                          <p className="text-xs capitalize text-ink-subtle">{course.difficulty}</p>
                        </td>
                        <td className="font-semibold num">{course.activeEnrollments}</td>
                        <td>
                          <div className="flex items-center gap-3">
                            <span className="w-8 font-semibold num">{course.completed}</span>
                            <span className="progress-track w-24" aria-hidden><span className="progress-fill" style={{ width: `${Math.round((course.completed / total) * 100)}%` }} /></span>
                          </div>
                        </td>
                        <td className="font-semibold num">{course.inProgress}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
