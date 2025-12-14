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
import { format } from 'date-fns';

export default function Dashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { progress, loading: progressLoading } = useProgress();
  const { courses } = useCourses();
  const router = useRouter();
  const [upcomingClasses, setUpcomingClasses] = useState<any[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    // Redirect instructors and admins to their respective dashboards
    if (!authLoading && isAuthenticated && user) {
      if (user.role === 'instructor') {
        router.push('/instructor/dashboard');
        return;
      }
      if (user.role === 'admin') {
        router.push('/admin');
        return;
      }
    }
  }, [isAuthenticated, authLoading, user, router]);

  useEffect(() => {
    if (isAuthenticated && user?.role === 'student') {
      loadUpcomingClasses();
    }
  }, [isAuthenticated, user]);

  const loadUpcomingClasses = async () => {
    try {
      const data = await apiClient.get<any[]>('/classes');
      setUpcomingClasses(data);
    } catch (error) {
      console.error('Failed to load upcoming classes:', error);
    } finally {
      setLoadingClasses(false);
    }
  };

  if (authLoading || progressLoading) {
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

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />

      <div className="flex flex-1">
        <Sidebar />

        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:ml-0">
          <h1 className="text-4xl font-display font-bold mb-8">Dashboard</h1>

          {/* Welcome Section */}
          <div className="mb-8">
            <h1 className="text-4xl font-display font-bold text-gray-900 mb-2">
              Welcome back, {user?.name?.split(' ')[0] || 'Student'}!
            </h1>
            <p className="text-gray-600">Continue your learning journey</p>
          </div>

          {/* Statistics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-gradient-to-br from-primary-500 to-primary-600 rounded-2xl p-6 text-white shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
              </div>
              <div className="text-4xl font-bold mb-1">{enrolledCourses.length}</div>
              <div className="text-primary-100 text-sm font-medium">Enrolled Courses</div>
            </div>

            <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl p-6 text-white shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="text-4xl font-bold mb-1">{completedCourses.length}</div>
              <div className="text-green-100 text-sm font-medium">Completed</div>
            </div>

            <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-2xl p-6 text-white shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <div className="text-4xl font-bold mb-1">{activeCourses.length}</div>
              <div className="text-yellow-100 text-sm font-medium">In Progress</div>
            </div>

            <div className="bg-gradient-to-br from-secondary-500 to-secondary-600 rounded-2xl p-6 text-white shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
              </div>
              <div className="text-4xl font-bold mb-1">
                {Math.round(progress.reduce((sum, p) => sum + p.progress, 0) / (progress.length || 1))}%
              </div>
              <div className="text-secondary-100 text-sm font-medium">Avg Progress</div>
            </div>
          </div>

          {/* Upcoming Classes */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Upcoming Classes</h2>
            {loadingClasses ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center">
                <p className="text-gray-500">Loading upcoming classes...</p>
              </div>
            ) : upcomingClasses.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
                <div className="text-6xl mb-4">📅</div>
                <p className="text-gray-500 mb-2">No upcoming classes scheduled</p>
                <p className="text-gray-400 text-sm">Check back later for new classes!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {upcomingClasses.map((classItem: any) => (
                  <div key={classItem._id || classItem.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-lg transition-shadow">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-gray-900 mb-2">{classItem.title}</h3>
                        <p className="text-gray-600 text-sm mb-3">{classItem.description}</p>
                        <div className="flex items-center text-sm text-gray-500 mb-2">
                          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          {format(new Date(classItem.date), 'MMM dd, yyyy')}
                        </div>
                        <div className="flex items-center text-sm text-gray-500 mb-2">
                          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {format(new Date(classItem.date), 'HH:mm')}
                        </div>
                        {classItem.instructor && (
                          <div className="flex items-center text-sm text-gray-500">
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            {classItem.instructor}
                          </div>
                        )}
                      </div>
                    </div>
                    {classItem.link && (
                      <a
                        href={classItem.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold transition-colors"
                      >
                        Join Class
                        <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Enrolled Courses */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900">My Courses</h2>
              <Link href="/courses" className="text-primary-600 hover:text-primary-700 font-medium text-sm">
                Browse All →
              </Link>
            </div>
            {enrolledCourses.length === 0 ? (
              <div className="card text-center py-12">
                <p className="text-gray-500 mb-4">You haven't enrolled in any courses yet.</p>
                <Link href="/courses" className="btn btn-primary">
                  Browse Courses
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {enrolledCourses.map((course) => (
                  <CourseCard key={course._id || course.id} course={course} />
                ))}
              </div>
            )}
          </div>

          {/* Progress Overview */}
          {progress.length > 0 && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Progress Overview</h2>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
                {progress.map((p) => (
                  <div key={p._id || p.courseId} className="border-b border-gray-100 last:border-0 pb-6 last:pb-0">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 mb-1">
                          {p.course?.title || `Course ${p.courseId}`}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {p.completedLessons?.length || 0} of {(p.course as any)?.lessons?.length || 0} lessons completed
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

