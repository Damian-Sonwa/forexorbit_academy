/**
 * Student Dashboard
 * Shows enrolled courses, progress, and statistics
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import CourseCard from '@/components/CourseCard';
import { useAuth } from '@/hooks/useAuth';
import { useProgress } from '@/hooks/useProgress';
import { useCourses } from '@/hooks/useCourses';
import { apiClient } from '@/lib/api-client';

interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  email: string;
  points?: number;
  avatar?: string;
}

interface UpcomingLesson {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  order: number;
  date?: string;
}

export default function Dashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { progress, loading: progressLoading } = useProgress();
  const { courses } = useCourses();
  const router = useRouter();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userPoints, setUserPoints] = useState(0);
  const [upcomingLessons, setUpcomingLessons] = useState<UpcomingLesson[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const fetchDashboardData = async () => {
    if (!user) return;
    
    try {
      setLoadingData(true);
      
      // Fetch leaderboard
      try {
        const leaderboardData = await apiClient.get<LeaderboardEntry[]>('/leaderboard?type=points');
        setLeaderboard(leaderboardData.slice(0, 5)); // Top 5
      } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
        setLeaderboard([]);
      }
      
      // Fetch user points
      try {
        const userData = await apiClient.get<any>('/auth/me');
        setUserPoints(userData.points || 0);
      } catch (error) {
        console.error('Failed to fetch user points:', error);
        setUserPoints(0);
      }
      
      // Fetch upcoming lessons
      try {
        const lessons: UpcomingLesson[] = [];
        for (const p of progress) {
          if (p.progress > 0 && p.progress < 100 && p.course) {
            const courseLessons = await apiClient.get<any[]>(`/lessons?courseId=${p.courseId}`);
            const nextLesson = courseLessons.find((l: any) => !p.completedLessons?.includes(l._id || l.id));
            if (nextLesson) {
              lessons.push({
                courseId: p.courseId,
                courseTitle: p.course.title,
                lessonId: nextLesson._id || nextLesson.id,
                lessonTitle: nextLesson.title,
                order: nextLesson.order || 0,
              });
            }
          }
        }
        setUpcomingLessons(lessons.slice(0, 5)); // Next 5 lessons
      } catch (error) {
        console.error('Failed to fetch upcoming lessons:', error);
        setUpcomingLessons([]);
      }
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    // Redirect instructors and admins to their respective dashboards
    // Check approval status for instructors and admins
    if (!authLoading && isAuthenticated && user) {
      // Onboarding is now optional - students can skip it
      // No redirect needed - they can complete it later
      
      if (user.role === 'instructor') {
        // Check if instructor is approved
        if (user.status && user.status !== 'approved') {
          if (user.status === 'pending') {
            alert('Your registration is pending approval. Please wait for Super Admin approval before accessing your dashboard.');
          } else if (user.status === 'rejected') {
            alert('Your registration has been rejected. Please contact support for more information.');
          }
          router.push('/login');
          return;
        }
        router.push('/instructor/dashboard');
        return;
      }
      if (user.role === 'admin' || user.role === 'superadmin') {
        // Check if admin is approved (superadmin is always approved)
        if (user.role === 'admin' && user.status && user.status !== 'approved') {
          if (user.status === 'pending') {
            alert('Your registration is pending approval. Please wait for Super Admin approval before accessing your dashboard.');
          } else if (user.status === 'rejected') {
            alert('Your registration has been rejected. Please contact support for more information.');
          }
          router.push('/login');
          return;
        }
        router.push('/admin');
        return;
      }
    }
  }, [isAuthenticated, authLoading, user, router]);

  useEffect(() => {
    if (isAuthenticated && user && !progressLoading) {
      fetchDashboardData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user, progressLoading]);

  if (authLoading || progressLoading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated || (user && user.role !== 'student')) {
    return null;
  }

  const enrolledCourses = courses.filter((c) => c.enrolled);
  const completedCourses = progress.filter((p) => p.progress >= 100);
  const activeCourses = progress.filter((p) => p.progress > 0 && p.progress < 100);
  const completedModules = progress.reduce((sum, p) => sum + (p.completedLessons?.length || 0), 0);
  const recommendedCourses = courses.filter((c) => !c.enrolled).slice(0, 3);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 overflow-hidden">
      <Header />

      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />

        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:ml-0 pt-14 lg:pt-6 bg-white lg:bg-gray-50 overflow-y-auto w-full">
          {/* Welcome Section */}
          <div className="mb-4 sm:mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
              <div className="flex-1">
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold text-gray-900 mb-2">
                  Welcome back, {user?.name?.split(' ')[0] || 'Student'}!
                </h1>
                <p className="text-sm sm:text-base text-gray-600">Continue your learning journey</p>
                {user?.learningLevel && (
                  <div className="mt-3 flex items-center space-x-2">
                    <span className="text-sm text-gray-500">Current Level:</span>
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-semibold capitalize">
                      {user.learningLevel}
                    </span>
                  </div>
                )}
              </div>
              <Link
                href="/onboarding"
                className="w-full sm:w-auto px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors text-sm shadow-md hover:shadow-lg whitespace-nowrap flex-shrink-0 text-center"
              >
                Edit Profile
              </Link>
            </div>
          </div>

          {/* Course Benefits Card */}
          <div className="mb-4 sm:mb-6 bg-white rounded-xl shadow-lg border-l-4 border-blue-700 p-4 sm:p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-3 sm:mb-4 flex items-center text-gray-900">
                  <span className="mr-2 sm:mr-3 text-2xl sm:text-3xl md:text-4xl">📈</span>
                  <span className="break-words">Forex Training – What You Will Gain</span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mt-4 sm:mt-6">
                  <div className="flex items-start space-x-3">
                    <span className="text-2xl">💹</span>
                    <div>
                      <h3 className="font-semibold mb-1 text-gray-900">Understanding Forex Markets</h3>
                      <p className="text-gray-700 text-sm">Master the fundamentals of currency trading and market dynamics</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <span className="text-2xl">⚡</span>
                    <div>
                      <h3 className="font-semibold mb-1 text-gray-900">Executing Trades</h3>
                      <p className="text-gray-700 text-sm">Learn to place and manage trades with confidence</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <span className="text-2xl">🛡️</span>
                    <div>
                      <h3 className="font-semibold mb-1 text-gray-900">Risk Management</h3>
                      <p className="text-gray-700 text-sm">Protect your capital with proven risk management strategies</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <span className="text-2xl">📊</span>
                    <div>
                      <h3 className="font-semibold mb-1 text-gray-900">Chart Analysis</h3>
                      <p className="text-gray-700 text-sm">Analyze price charts and identify profitable trading opportunities</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Overview Section */}
          <div className="mb-4 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">Overview</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              {/* Enrolled Courses Card */}
              <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6 hover:shadow-lg transition-shadow flex flex-col h-full">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <span className="text-2xl">📚</span>
                  </div>
                </div>
                <div className="text-4xl font-bold mb-1 text-gray-900">{enrolledCourses.length}</div>
                <div className="text-gray-600 text-sm font-medium">Enrolled Courses</div>
              </div>

              {/* Completed Modules Card */}
              <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6 hover:shadow-lg transition-shadow flex flex-col h-full">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <span className="text-2xl">✅</span>
                  </div>
                </div>
                <div className="text-4xl font-bold mb-1 text-gray-900">{completedModules}</div>
                <div className="text-gray-600 text-sm font-medium">Completed Modules</div>
              </div>

              {/* Points Card */}
              <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6 hover:shadow-lg transition-shadow flex flex-col h-full">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <span className="text-2xl">⭐</span>
                  </div>
                </div>
                <div className="text-4xl font-bold mb-1 text-gray-900">{userPoints}</div>
                <div className="text-gray-600 text-sm font-medium">Points Earned</div>
              </div>
            </div>
          </div>

          {/* My Enrolled Courses */}
          <div className="mb-4 sm:mb-6 bg-white rounded-xl shadow-md border border-gray-100 p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 gap-2">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">My Enrolled Courses</h2>
              <Link href="/courses" className="text-primary-600 hover:text-primary-700 font-medium text-sm">
                Browse All →
              </Link>
            </div>
            {enrolledCourses.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {enrolledCourses.map((course) => (
                  <CourseCard key={course._id || course.id} course={course} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500 mb-4">You haven't enrolled in any courses yet.</p>
                <Link href="/courses" className="inline-block px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors shadow-md hover:shadow-lg">
                  Browse Courses
                </Link>
              </div>
            )}
          </div>

          {/* Upcoming Classes */}
          <div className="mb-4 sm:mb-6 bg-white rounded-xl shadow-md border border-gray-100 p-4 sm:p-6">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">Upcoming Classes</h2>
            <div className="space-y-4">
              {upcomingLessons.length > 0 ? (
                upcomingLessons.map((lesson, index) => (
                  <Link
                    key={`${lesson.courseId}-${lesson.lessonId}`}
                    href={`/courses/${lesson.courseId}/lessons/${lesson.lessonId}`}
                    className="block p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors border border-gray-200"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 mb-1">{lesson.lessonTitle}</h3>
                        <p className="text-sm text-gray-600 mb-2">{lesson.courseTitle}</p>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-primary-500 to-primary-600 h-2 rounded-full"
                            style={{ width: `${(index + 1) * 20}%` }}
                          />
                        </div>
                      </div>
                      <div className="ml-4 text-right">
                        <div className="text-sm text-gray-500">Lesson {lesson.order}</div>
                        {lesson.date && (
                          <div className="text-xs text-gray-400 mt-1">{lesson.date}</div>
                        )}
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-500">No upcoming lessons. Enroll in a course to get started!</p>
                </div>
              )}
            </div>
          </div>

          {/* Course Recommendations */}
          <div className="mb-4 sm:mb-6 bg-white rounded-xl shadow-md border border-gray-100 p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 gap-2">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Course Recommendations</h2>
              <Link href="/courses" className="text-primary-600 hover:text-primary-700 font-medium text-sm">
                View All →
              </Link>
            </div>
            {recommendedCourses.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {recommendedCourses.map((course) => (
                  <div key={course._id || course.id} className="bg-gray-50 rounded-xl p-6 border border-gray-200 hover:shadow-lg transition-shadow flex flex-col h-full">
                    <h3 className="font-bold text-gray-900 mb-2">{course.title}</h3>
                    <p className="text-sm text-gray-600 mb-4 line-clamp-2 flex-grow">{course.description}</p>
                    <Link
                      href={`/courses/${course._id || course.id}`}
                      className="inline-block px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold text-sm transition-colors self-start"
                    >
                      Start Course
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No course recommendations available at the moment.</p>
            )}
          </div>

          {/* Leaderboard */}
          <div className="mb-4 sm:mb-6 bg-white rounded-xl shadow-md border border-gray-100 p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 gap-2">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Leaderboard</h2>
              <Link href="/leaderboard" className="text-primary-600 hover:text-primary-700 font-medium text-sm">
                View Full →
              </Link>
            </div>
            {leaderboard.length > 0 ? (
              <div className="space-y-3">
                {leaderboard.map((entry, index) => (
                  <div
                    key={entry.userId}
                    className={`flex items-center justify-between p-4 rounded-xl transition-colors ${
                      entry.userId === user?.id
                        ? 'bg-blue-50 border-2 border-blue-200'
                        : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm ${
                        index === 0 ? 'bg-gradient-to-br from-yellow-400 to-yellow-600' :
                        index === 1 ? 'bg-gradient-to-br from-gray-300 to-gray-500' :
                        index === 2 ? 'bg-gradient-to-br from-orange-400 to-orange-600' :
                        'bg-gradient-to-br from-primary-500 to-primary-600'
                      }`}>
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">
                          {entry.name} {entry.userId === user?.id && '(You)'}
                        </p>
                        <p className="text-xs text-gray-500">{entry.email}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-primary-600">{entry.points || 0}</div>
                      <div className="text-xs text-gray-500">points</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No leaderboard data available yet.</p>
            )}
          </div>

          {/* Progress Overview */}
          {progress.length > 0 && (
            <div className="bg-white rounded-xl shadow-md border border-gray-100 p-4 sm:p-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">Progress Overview</h2>
              <div className="space-y-6">
                {progress.map((p) => (
                  <div key={p._id || p.courseId} className="border-b border-gray-100 last:border-0 pb-6 last:pb-0">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 mb-1">
                          {p.course?.title || `Course ${p.courseId}`}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {p.completedLessons?.length || 0} of {p.course?.lessons?.length || 0} lessons completed
                        </p>
                      </div>
                      <div className="ml-4 text-right">
                        <div className="text-2xl font-bold text-primary-600">
                          {Math.round(p.progress)}%
                        </div>
                        <div className="text-xs text-gray-500">Complete</div>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-primary-500 to-primary-600 h-3 rounded-full transition-all duration-500 shadow-sm"
                        style={{ width: `${p.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      <Footer />
    </div>
  );
}

