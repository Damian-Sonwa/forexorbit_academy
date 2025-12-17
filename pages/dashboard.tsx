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
import WhatYouWillGain from '@/components/WhatYouWillGain';
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

interface UpcomingClass {
  _id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  meetingLink?: string;
  instructorName: string;
  createdAt: string;
}

export default function Dashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { progress, loading: progressLoading } = useProgress();
  const { courses } = useCourses();
  const router = useRouter();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userPoints, setUserPoints] = useState(0);
  const [upcomingLessons, setUpcomingLessons] = useState<UpcomingLesson[]>([]);
  const [upcomingClasses, setUpcomingClasses] = useState<UpcomingClass[]>([]);
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
      
      // FIX: Fetch upcoming classes/events posted by instructors/admins
      try {
        const classes = await apiClient.get<UpcomingClass[]>('/classes');
        setUpcomingClasses(classes || []);

        // Track class event viewed in GA4 when classes are loaded
        if (classes && classes.length > 0 && typeof window !== 'undefined' && window.gtag) {
          window.gtag('event', 'class_event_viewed', {
            event_category: 'classes',
            event_label: 'dashboard',
            value: classes.length,
          });
        }
      } catch (error) {
        console.error('Failed to fetch upcoming classes:', error);
        setUpcomingClasses([]);
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
  // const completedCourses = progress.filter((p) => p.progress >= 100); // Reserved for future use
  // const activeCourses = progress.filter((p) => p.progress > 0 && p.progress < 100); // Reserved for future use
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

          {/* What You Will Gain - Dynamic based on learning level */}
          <WhatYouWillGain />

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

          {/* Upcoming Classes/Events - FIX: Display classes posted by instructors/admins */}
          <div className="mb-4 sm:mb-6 bg-white rounded-xl shadow-md border border-gray-100 p-4 sm:p-6">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">Upcoming Classes & Events</h2>
            <div className="space-y-4">
              {upcomingClasses.length > 0 ? (
                upcomingClasses.map((cls) => (
                  <div
                    key={cls._id}
                    className="block p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl hover:shadow-md transition-all border border-blue-200"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex-1">
                        <h3 className="font-bold text-gray-900 mb-1 text-lg">{cls.title}</h3>
                        <p className="text-sm text-gray-700 mb-2">{cls.description}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                          <span className="flex items-center">
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            {cls.date}
                          </span>
                          <span className="flex items-center">
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {cls.time}
                          </span>
                          <span className="flex items-center">
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            {cls.instructorName}
                          </span>
                        </div>
                      </div>
                      {cls.meetingLink && (
                        <a
                          href={cls.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold text-sm transition-colors whitespace-nowrap"
                        >
                          Join Class
                        </a>
                      )}
                    </div>
                  </div>
                ))
              ) : upcomingLessons.length > 0 ? (
                // Fallback to lessons if no classes posted
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
                  <p className="text-gray-500">No upcoming classes or events scheduled. Check back later!</p>
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

        </main>
      </div>

      <Footer />
    </div>
  );
}

