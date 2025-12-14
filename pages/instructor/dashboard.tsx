/**
 * Instructor Dashboard
 * Course and lesson management for instructors
 * Features: Add/Edit/Delete courses, lessons, upload videos/resources, track student progress
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { useCourses } from '@/hooks/useCourses';

export default function InstructorDashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const { courses, refetch } = useCourses();
  const [myCourses, setMyCourses] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'courses' | 'lessons' | 'students' | 'analytics' | 'classes'>('courses');
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [showClassForm, setShowClassForm] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [upcomingClasses, setUpcomingClasses] = useState<any[]>([]);
  const [classForm, setClassForm] = useState({
    title: '',
    description: '',
    date: '',
    time: '',
    link: '',
  });
  const [courseForm, setCourseForm] = useState({
    title: '',
    description: '',
    category: '',
    difficulty: 'beginner',
    thumbnail: '',
  });
  const [lessonForm, setLessonForm] = useState({
    title: '',
    description: '',
    content: '',
    videoUrl: '',
    order: 1,
  });

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || user?.role !== 'instructor')) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, user, router]);

  useEffect(() => {
    if (user?.role === 'instructor') {
      loadMyCourses();
      loadAnalytics();
      loadUpcomingClasses();
    }
  }, [user]);

  const loadUpcomingClasses = async () => {
    try {
      const data = await apiClient.get('/classes');
      setUpcomingClasses(data);
    } catch (error) {
      console.error('Failed to load upcoming classes:', error);
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/classes', classForm);
      setShowClassForm(false);
      setClassForm({ title: '', description: '', date: '', time: '', link: '' });
      loadUpcomingClasses();
      alert('Upcoming class created successfully!');
    } catch (error: any) {
      alert(error.message || 'Failed to create class');
    }
  };

  const loadMyCourses = async () => {
    try {
      // Filter courses where current user is the instructor
      const userId = user?.id || user?._id;
      const instructorCourses = courses.filter((c) => {
        const courseInstructorId = c.instructorId?.toString() || c.instructorId;
        return courseInstructorId === userId?.toString() || courseInstructorId === userId;
      });
      setMyCourses(instructorCourses);
    } catch (error) {
      console.error('Failed to load courses:', error);
    }
  };

  const loadAnalytics = async () => {
    try {
      const data = await apiClient.get('/instructor/analytics');
      setAnalytics(data);
    } catch (error) {
      console.error('Failed to load analytics:', error);
      // Set default analytics if endpoint doesn't exist yet
      setAnalytics({
        totalCourses: myCourses.length,
        totalLessons: 0,
        totalStudents: 0,
        totalEnrollments: 0,
      });
    }
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/courses', courseForm);
      setShowCourseForm(false);
      setCourseForm({ title: '', description: '', category: '', difficulty: 'beginner', thumbnail: '' });
      refetch();
      loadMyCourses();
    } catch (error: any) {
      alert(error.message || 'Failed to create course');
    }
  };

  const handleCreateLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourse) {
      alert('Please select a course first');
      return;
    }
    try {
      await apiClient.post('/lessons', {
        ...lessonForm,
        courseId: selectedCourse,
      });
      setShowLessonForm(false);
      setLessonForm({ title: '', description: '', content: '', videoUrl: '', order: 1 });
      setSelectedCourse(null);
      refetch();
    } catch (error: any) {
      alert(error.message || 'Failed to create lesson');
    }
  };

  if (authLoading || !isAuthenticated || user?.role !== 'instructor') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-display font-bold text-gray-900 mb-2">Instructor Dashboard</h1>
          <p className="text-gray-600">Manage your courses, lessons, and track student progress</p>
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
            <div className="text-4xl font-bold mb-1">{analytics?.totalCourses || myCourses.length}</div>
            <div className="text-primary-100 text-sm font-medium">My Courses</div>
          </div>

          <div className="bg-gradient-to-br from-secondary-500 to-secondary-600 rounded-2xl p-6 text-white shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
            </div>
            <div className="text-4xl font-bold mb-1">{analytics?.totalLessons || 0}</div>
            <div className="text-secondary-100 text-sm font-medium">Total Lessons</div>
          </div>

          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl p-6 text-white shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
            </div>
            <div className="text-4xl font-bold mb-1">{analytics?.totalStudents || 0}</div>
            <div className="text-green-100 text-sm font-medium">Total Students</div>
          </div>

          <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-2xl p-6 text-white shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <div className="text-4xl font-bold mb-1">{analytics?.totalEnrollments || 0}</div>
            <div className="text-yellow-100 text-sm font-medium">Enrollments</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 mb-8 bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('courses')}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'courses'
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            My Courses
          </button>
          <button
            onClick={() => setActiveTab('lessons')}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'lessons'
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Lessons
          </button>
          <button
            onClick={() => setActiveTab('students')}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'students'
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Students
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'analytics'
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Analytics
          </button>
          <button
            onClick={() => setActiveTab('classes')}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'classes'
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Upcoming Classes
          </button>
        </div>

        {/* Courses Tab */}
        {activeTab === 'courses' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">My Courses</h2>
              <button
                onClick={() => setShowCourseForm(!showCourseForm)}
                className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors shadow-sm"
              >
                {showCourseForm ? 'Cancel' : '+ Create Course'}
              </button>
            </div>

            {showCourseForm && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-6">Create New Course</h3>
                <form onSubmit={handleCreateCourse} className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Title</label>
                    <input
                      type="text"
                      value={courseForm.title}
                      onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
                    <textarea
                      value={courseForm.description}
                      onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      rows={4}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Category</label>
                      <select
                        value={courseForm.category}
                        onChange={(e) => setCourseForm({ ...courseForm, category: e.target.value })}
                        required
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                      >
                        <option value="">Select category</option>
                        <option value="Beginner">Beginner</option>
                        <option value="Intermediate">Intermediate</option>
                        <option value="Advanced">Advanced</option>
                        <option value="Technical Analysis">Technical Analysis</option>
                        <option value="Fundamental Analysis">Fundamental Analysis</option>
                        <option value="Trading Strategies">Trading Strategies</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Difficulty</label>
                      <select
                        value={courseForm.difficulty}
                        onChange={(e) => setCourseForm({ ...courseForm, difficulty: e.target.value })}
                        required
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                      >
                        <option value="beginner">Beginner</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="advanced">Advanced</option>
                      </select>
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full px-6 py-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold text-lg transition-colors shadow-lg"
                  >
                    Create Course
                  </button>
                </form>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {myCourses.length === 0 ? (
                <div className="col-span-full text-center py-12 bg-white rounded-2xl shadow-sm border border-gray-100">
                  <p className="text-gray-500 mb-4">You haven't created any courses yet.</p>
                  <button
                    onClick={() => setShowCourseForm(true)}
                    className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors"
                  >
                    Create Your First Course
                  </button>
                </div>
              ) : (
                myCourses.map((course) => (
                  <div key={course._id || course.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-lg transition-shadow">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{course.title}</h3>
                    <p className="text-sm text-gray-600 mb-4 line-clamp-2">{course.description}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500 capitalize">{course.difficulty}</span>
                      <Link
                        href={`/courses/${course._id || course.id}`}
                        className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold transition-colors"
                      >
                        Manage
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Lessons Tab */}
        {activeTab === 'lessons' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Manage Lessons</h2>
              <button
                onClick={() => {
                  if (myCourses.length === 0) {
                    alert('Please create a course first');
                    return;
                  }
                  setShowLessonForm(!showLessonForm);
                }}
                className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors shadow-sm"
              >
                {showLessonForm ? 'Cancel' : '+ Create Lesson'}
              </button>
            </div>

            {showLessonForm && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-6">Create New Lesson</h3>
                <form onSubmit={handleCreateLesson} className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Select Course</label>
                    <select
                      value={selectedCourse || ''}
                      onChange={(e) => setSelectedCourse(e.target.value)}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                    >
                      <option value="">Select a course</option>
                      {myCourses.map((course) => (
                        <option key={course._id || course.id} value={course._id || course.id}>
                          {course.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Lesson Title</label>
                    <input
                      type="text"
                      value={lessonForm.title}
                      onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
                    <textarea
                      value={lessonForm.description}
                      onChange={(e) => setLessonForm({ ...lessonForm, description: e.target.value })}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      rows={3}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Video URL (MP4/WebM)</label>
                    <input
                      type="url"
                      value={lessonForm.videoUrl}
                      onChange={(e) => setLessonForm({ ...lessonForm, videoUrl: e.target.value })}
                      placeholder="https://example.com/video.mp4"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-500 mt-1">Upload video to your hosting service and paste URL here</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Lesson Content (HTML)</label>
                    <textarea
                      value={lessonForm.content}
                      onChange={(e) => setLessonForm({ ...lessonForm, content: e.target.value })}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      rows={6}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Order</label>
                    <input
                      type="number"
                      value={lessonForm.order}
                      onChange={(e) => setLessonForm({ ...lessonForm, order: parseInt(e.target.value) })}
                      min={1}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full px-6 py-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold text-lg transition-colors shadow-lg"
                  >
                    Create Lesson
                  </button>
                </form>
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <p className="text-gray-600 text-center py-8">
                Select a course to view and manage its lessons, or create a new lesson above.
              </p>
            </div>
          </div>
        )}

        {/* Students Tab */}
        {activeTab === 'students' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Student Progress</h2>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <p className="text-gray-600 text-center py-8">
                Student progress tracking will be displayed here. This feature integrates with the progress API.
              </p>
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Course Analytics</h2>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <p className="text-gray-600 text-center py-8">
                Detailed analytics for your courses will be displayed here.
              </p>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

