/**
 * Instructor Lessons Page
 * Manage lessons for courses - extracted from dashboard
 * Reuses same logic and components as dashboard
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/hooks/useAuth';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/lib/api-client';
import { sanitizeHtml } from '@/lib/html-sanitizer';
import { useCourses } from '@/hooks/useCourses';

interface Lesson {
  _id: string;
  courseId: string;
  title: string;
  description: string;
  summary?: string;
  videoUrl?: string;
  pdfUrl?: string;
  type: 'video' | 'pdf' | 'interactive';
  order: number;
  content?: string;
  resources?: Array<{
    type: 'pdf' | 'link' | 'slide';
    url: string;
    title: string;
  }>;
}

interface Course {
  _id?: string;
  id?: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  category: string;
  instructorId?: string;
  thumbnail?: string;
}

export default function InstructorLessons() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const { courses, refetch } = useCourses();
  const { socket, connected } = useSocket();
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [selectedCourseData, setSelectedCourseData] = useState<Course | null>(null);
  const [courseLessons, setCourseLessons] = useState<Lesson[]>([]);
  const [editingLesson, setEditingLesson] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState<string | null>(null);
  const [lessonForm, setLessonForm] = useState<Partial<Lesson> & { visualAids?: Array<{ url: string; caption?: string }> }>({});
  const [courseForm, setCourseForm] = useState<Partial<Course>>({});
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [loading, setLoading] = useState(false);

  // Group courses by difficulty level
  const coursesByLevel = {
    beginner: allCourses.filter(c => c.difficulty === 'beginner'),
    intermediate: allCourses.filter(c => c.difficulty === 'intermediate'),
    advanced: allCourses.filter(c => c.difficulty === 'advanced'),
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && user?.role !== 'instructor' && user?.role !== 'admin' && user?.role !== 'superadmin') {
      router.push('/dashboard');
      return;
    }
    if (isAuthenticated && user) {
      loadAllCourses();
    }
  }, [authLoading, isAuthenticated, user, router]);

  useEffect(() => {
    if (selectedCourse) {
      loadCourseLessons(selectedCourse);
    }
  }, [selectedCourse]);

  const loadAllCourses = async () => {
    try {
      setAllCourses(courses as Course[]);
    } catch (error) {
      console.error('Failed to load courses:', error);
    }
  };

  const loadCourseLessons = async (courseId: string) => {
    try {
      setLoading(true);
      const lessons = await apiClient.get<Lesson[]>(`/lessons?courseId=${courseId}`);
      setCourseLessons(lessons.sort((a, b) => a.order - b.order));
    } catch (error: any) {
      console.error('Failed to load lessons:', error);
      alert(error.message || 'Failed to load lessons');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCourse = async (courseId: string) => {
    setSelectedCourse(courseId);
    const course = allCourses.find(c => (c._id || c.id) === courseId);
    setSelectedCourseData(course || null);
    await loadCourseLessons(courseId);
    setEditingLesson(null);
    setEditingCourse(null);
  };

  const handleEditCourse = (course: Course) => {
    setEditingCourse(course._id || course.id || null);
    setCourseForm({
      title: course.title,
      description: course.description,
      difficulty: course.difficulty,
      category: course.category,
      thumbnail: course.thumbnail,
    });
    setShowCourseForm(true);
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      await apiClient.post('/courses', {
        ...courseForm,
        instructorId: user?.id,
      });
      await refetch();
      await loadAllCourses();
      setShowCourseForm(false);
      setEditingCourse(null);
      setCourseForm({});
    } catch (error: any) {
      alert(error.message || 'Failed to create course');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCourse) return;
    try {
      setLoading(true);
      await apiClient.put(`/courses/${editingCourse}`, {
        ...courseForm,
      });
      await refetch();
      await loadAllCourses();
      if (selectedCourse === editingCourse) {
        const updated = allCourses.find(c => (c._id || c.id) === editingCourse);
        if (updated) {
          setSelectedCourseData({ ...updated, ...courseForm } as Course);
        }
      }
      setShowCourseForm(false);
      setEditingCourse(null);
      setCourseForm({});
    } catch (error: any) {
      alert(error.message || 'Failed to update course');
    } finally {
      setLoading(false);
    }
  };

  const handleEditLesson = async (lesson: Lesson) => {
    setEditingLesson(lesson._id);
    const existingLesson = await apiClient.get(`/lessons/${lesson._id}`);
    const summaryText = (existingLesson as any).lessonSummary?.overview || lesson.summary || '';
    setLessonForm({
      title: lesson.title,
      description: lesson.description,
      summary: summaryText,
      videoUrl: lesson.videoUrl,
      pdfUrl: lesson.pdfUrl,
      type: lesson.type,
      order: lesson.order,
      content: lesson.content,
      resources: lesson.resources || [],
      visualAids: (existingLesson as any).lessonSummary?.screenshots || [],
    });
    setShowLessonForm(true);
  };

  const handleSaveLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLesson || !selectedCourse) return;
    try {
      setLoading(true);
      const updateData: any = {
        ...lessonForm,
        courseId: selectedCourse,
      };
      const existingLesson = await apiClient.get(`/lessons/${editingLesson}`);
      const existingLessonSummary = (existingLesson as any).lessonSummary || {};
      updateData.lessonSummary = {
        ...existingLessonSummary,
        overview: lessonForm.summary || existingLessonSummary.overview || '',
        screenshots: (lessonForm as any).visualAids || existingLessonSummary.screenshots || [],
        updatedAt: new Date(),
      };
      await apiClient.put(`/lessons/${editingLesson}`, updateData);
      if (socket && connected) {
        socket.emit('lessonUpdated', { lessonId: editingLesson });
      }
      await loadCourseLessons(selectedCourse);
      setEditingLesson(null);
      setShowLessonForm(false);
      setLessonForm({});
    } catch (error: any) {
      alert(error.message || 'Failed to save lesson');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourse) return;
    try {
      setLoading(true);
      const lessonData: any = {
        ...lessonForm,
        courseId: selectedCourse,
        order: lessonForm.order || courseLessons.length + 1,
      };
      if (lessonForm.summary || lessonForm.visualAids) {
        lessonData.lessonSummary = {
          overview: lessonForm.summary || '',
          screenshots: lessonForm.visualAids || [],
          updatedAt: new Date(),
        };
      }
      await apiClient.post('/lessons', lessonData);
      await loadCourseLessons(selectedCourse);
      setShowLessonForm(false);
      setLessonForm({});
    } catch (error: any) {
      alert(error.message || 'Failed to create lesson');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLesson = async (lessonId: string) => {
    if (!confirm('Are you sure you want to delete this lesson?')) return;
    try {
      await apiClient.delete(`/lessons/${lessonId}`);
      if (socket && connected) {
        socket.emit('lessonUpdated', { lessonId });
      }
      await loadCourseLessons(selectedCourse!);
    } catch (error: any) {
      alert(error.message || 'Failed to delete lesson');
    }
  };

  const addResource = () => {
    const resources = lessonForm.resources || [];
    setLessonForm({
      ...lessonForm,
      resources: [...resources, { type: 'link', url: '', title: '' }],
    });
  };

  const removeResource = (index: number) => {
    const resources = lessonForm.resources || [];
    setLessonForm({
      ...lessonForm,
      resources: resources.filter((_, i) => i !== index),
    });
  };

  const updateResource = (index: number, field: string, value: string) => {
    const resources = lessonForm.resources || [];
    const updated = [...resources];
    (updated[index] as any)[field] = value;
    setLessonForm({ ...lessonForm, resources: updated });
  };

  const addVisualAid = () => {
    const visualAids = lessonForm.visualAids || [];
    setLessonForm({
      ...lessonForm,
      visualAids: [...visualAids, { url: '', caption: '' }],
    });
  };

  const removeVisualAid = (index: number) => {
    const visualAids = lessonForm.visualAids || [];
    setLessonForm({
      ...lessonForm,
      visualAids: visualAids.filter((_, i) => i !== index),
    });
  };

  const updateVisualAid = (index: number, field: string, value: string) => {
    const visualAids = lessonForm.visualAids || [];
    const updated = [...visualAids];
    (updated[index] as any)[field] = value;
    setLessonForm({ ...lessonForm, visualAids: updated });
  };

  const handleImageUpload = async (index: number, file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'visual-aid');
      const response = await apiClient.post<{ url: string }>('/upload/visual-aid', formData);
      updateVisualAid(index, 'url', response.url);
    } catch (error: any) {
      alert(error.message || 'Failed to upload image');
    }
  };

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 dark:border-primary-400 mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      {/* Persistent Sidebar Layout - Sidebar remains visible across all instructor pages */}
      <div className="flex flex-1 overflow-hidden pt-20 lg:pt-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          {/* Header Section */}
          <div className="mb-3 sm:mb-4 flex-shrink-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Lessons Management</h1>
            <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm mt-1">Manage your courses and lessons</p>
          </div>

          {/* Main Content Area */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Left Panel: Courses by Level */}
            <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
              <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800 z-10">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">All Courses</h2>
                <button
                  onClick={() => {
                    setEditingCourse(null);
                    setCourseForm({ difficulty: 'beginner' });
                    setShowCourseForm(true);
                  }}
                  className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold transition-colors"
                  title="Create New Course"
                >
                  + New
                </button>
              </div>
              <div className="p-3 sm:p-4 space-y-3 sm:space-y-4 max-h-[calc(100vh-300px)] overflow-y-auto">
                {/* Beginner Courses */}
                {coursesByLevel.beginner.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-level-basic-dark dark:text-level-basic mb-2 uppercase tracking-wide">
                      Beginner
                    </h3>
                    <div className="space-y-2">
                      {coursesByLevel.beginner.map((course) => (
                        <div
                          key={course._id || course.id}
                          className={`w-full rounded-lg border-2 transition-all ${
                            selectedCourse === (course._id || course.id)
                              ? 'border-level-basic-dark dark:border-level-basic bg-level-basic-light dark:bg-level-basic/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <button
                            onClick={() => handleSelectCourse(course._id || course.id || '')}
                            className="w-full text-left p-3"
                          >
                            <p className="font-semibold text-sm text-gray-900 dark:text-white">{course.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{course.description}</p>
                          </button>
                          <div className="px-3 pb-2 flex gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditCourse(course);
                              }}
                              className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Intermediate Courses */}
                {coursesByLevel.intermediate.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-level-intermediate-dark dark:text-level-intermediate mb-2 uppercase tracking-wide">
                      Intermediate
                    </h3>
                    <div className="space-y-2">
                      {coursesByLevel.intermediate.map((course) => (
                        <div
                          key={course._id || course.id}
                          className={`w-full rounded-lg border-2 transition-all ${
                            selectedCourse === (course._id || course.id)
                              ? 'border-level-intermediate-dark dark:border-level-intermediate bg-level-intermediate-light dark:bg-level-intermediate/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <button
                            onClick={() => handleSelectCourse(course._id || course.id || '')}
                            className="w-full text-left p-3"
                          >
                            <p className="font-semibold text-sm text-gray-900 dark:text-white">{course.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{course.description}</p>
                          </button>
                          <div className="px-3 pb-2 flex gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditCourse(course);
                              }}
                              className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Advanced Courses */}
                {coursesByLevel.advanced.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-level-advanced-dark dark:text-level-advanced mb-2 uppercase tracking-wide">
                      Advanced
                    </h3>
                    <div className="space-y-2">
                      {coursesByLevel.advanced.map((course) => (
                        <div
                          key={course._id || course.id}
                          className={`w-full rounded-lg border-2 transition-all ${
                            selectedCourse === (course._id || course.id)
                              ? 'border-level-advanced-dark dark:border-level-advanced bg-level-advanced-light dark:bg-level-advanced/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <button
                            onClick={() => handleSelectCourse(course._id || course.id || '')}
                            className="w-full text-left p-3"
                          >
                            <p className="font-semibold text-sm text-gray-900 dark:text-white">{course.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{course.description}</p>
                          </button>
                          <div className="px-3 pb-2 flex gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditCourse(course);
                              }}
                              className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {allCourses.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-gray-500 dark:text-gray-400 text-sm mb-3">No courses yet.</p>
                    <button
                      onClick={() => {
                        setEditingCourse(null);
                        setCourseForm({ difficulty: 'beginner' });
                        setShowCourseForm(true);
                      }}
                      className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                      Create First Course
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Lessons Management */}
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
              {!selectedCourse ? (
                <div className="flex items-center justify-center p-6 sm:p-12 min-h-[300px] sm:min-h-[400px]">
                  <div className="text-center px-4">
                    <svg className="w-12 h-12 sm:w-16 sm:h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">Select a course from the left to manage its lessons</p>
                  </div>
                </div>
              ) : showCourseForm ? (
                <div className="p-4 sm:p-6">
                  <form onSubmit={editingCourse ? handleSaveCourse : handleCreateCourse} className="space-y-4">
                    <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-4">
                      {editingCourse ? 'Edit Course' : 'Create New Course'}
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Course Title *</label>
                      <input
                        type="text"
                        value={courseForm.title || ''}
                        onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })}
                        required
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Description *</label>
                      <textarea
                        value={courseForm.description || ''}
                        onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })}
                        required
                        rows={4}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Category *</label>
                        <select
                          value={courseForm.category || ''}
                          onChange={(e) => setCourseForm({ ...courseForm, category: e.target.value })}
                          required
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                        >
                          <option value="">Select category</option>
                          <option value="basics">Basics</option>
                          <option value="technical">Technical Analysis</option>
                          <option value="trading">Trading Strategies</option>
                          <option value="fundamental">Fundamental Analysis</option>
                          <option value="risk">Risk Management</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Difficulty Level *</label>
                        <select
                          value={courseForm.difficulty || 'beginner'}
                          onChange={(e) => setCourseForm({ ...courseForm, difficulty: e.target.value as 'beginner' | 'intermediate' | 'advanced' })}
                          required
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                        >
                          <option value="beginner">Beginner</option>
                          <option value="intermediate">Intermediate</option>
                          <option value="advanced">Advanced</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Thumbnail URL</label>
                      <input
                        type="url"
                        value={courseForm.thumbnail || ''}
                        onChange={(e) => setCourseForm({ ...courseForm, thumbnail: e.target.value })}
                        placeholder="https://example.com/image.jpg"
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                      />
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={loading}
                        className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white rounded-lg font-semibold transition-colors"
                      >
                        {loading ? 'Saving...' : editingCourse ? 'Save Changes' : 'Create Course'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCourseForm(false);
                          setEditingCourse(null);
                          setCourseForm({});
                        }}
                        className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <>
                  <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex-1">
                      <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white break-words">
                        {selectedCourseData?.title || 'Lessons'}
                      </h2>
                      {selectedCourseData && (
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span className="capitalize">{selectedCourseData.difficulty}</span>
                          <span>•</span>
                          <span>{selectedCourseData.category}</span>
                          <span>•</span>
                          <span>{courseLessons.length} lessons</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                      <button
                        onClick={() => handleEditCourse(selectedCourseData!)}
                        className="w-full sm:w-auto px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                      >
                        Edit Course
                      </button>
                      <button
                        onClick={() => {
                          setEditingLesson(null);
                          setLessonForm({ order: courseLessons.length + 1, type: 'video', resources: [] });
                          setShowLessonForm(true);
                        }}
                        className="w-full sm:w-auto px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold transition-colors"
                      >
                        + Add Lesson
                      </button>
                    </div>
                  </div>

                  {showLessonForm ? (
                    <div className="flex-1 overflow-y-auto p-3 sm:p-4">
                      <form onSubmit={editingLesson ? handleSaveLesson : handleCreateLesson} className="space-y-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Lesson Title *</label>
                          <input
                            type="text"
                            value={lessonForm.title || ''}
                            onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })}
                            required
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Description *</label>
                          <textarea
                            value={lessonForm.description || ''}
                            onChange={(e) => setLessonForm({ ...lessonForm, description: e.target.value })}
                            required
                            rows={3}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Summary</label>
                          <textarea
                            value={lessonForm.summary || ''}
                            onChange={(e) => setLessonForm({ ...lessonForm, summary: e.target.value })}
                            placeholder="Short text overview for the topic..."
                            rows={2}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                          />
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Brief summary that appears in lesson cards</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Video URL (YouTube/MP4/WebM)</label>
                            <input
                              type="url"
                              value={lessonForm.videoUrl || ''}
                              onChange={(e) => setLessonForm({ ...lessonForm, videoUrl: e.target.value })}
                              placeholder="https://www.youtube.com/watch?v=... or https://example.com/video.mp4"
                              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Supports YouTube, Vimeo, or direct video file URLs</p>
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Order</label>
                            <input
                              type="number"
                              value={lessonForm.order || 1}
                              onChange={(e) => setLessonForm({ ...lessonForm, order: parseInt(e.target.value) })}
                              min={1}
                              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Content (HTML)</label>
                          <textarea
                            value={lessonForm.content || ''}
                            onChange={(e) => setLessonForm({ ...lessonForm, content: e.target.value })}
                            placeholder="Enter lesson content in HTML format. You can include embedded videos, images, and formatted text."
                            rows={8}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                          />
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">HTML content that will be displayed in the lesson. Can include embedded videos, images, and formatted text.</p>
                        </div>

                        {/* Resources Section */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Resources</label>
                            <button
                              type="button"
                              onClick={addResource}
                              className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
                            >
                              + Add Resource
                            </button>
                          </div>
                          {(lessonForm.resources || []).map((resource, index) => (
                            <div key={index} className="flex gap-2 mb-2">
                              <select
                                value={resource.type}
                                onChange={(e) => updateResource(index, 'type', e.target.value)}
                                className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm"
                              >
                                <option value="pdf">PDF</option>
                                <option value="link">Link</option>
                                <option value="slide">Slide</option>
                              </select>
                              <input
                                type="text"
                                value={resource.title}
                                onChange={(e) => updateResource(index, 'title', e.target.value)}
                                placeholder="Resource title"
                                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm"
                              />
                              <input
                                type="url"
                                value={resource.url}
                                onChange={(e) => updateResource(index, 'url', e.target.value)}
                                placeholder="URL"
                                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm"
                              />
                              <button
                                type="button"
                                onClick={() => removeResource(index)}
                                className="px-3 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm hover:bg-red-200 dark:hover:bg-red-900/50"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Visual Aids Section */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Visual Aids (Charts & Screenshots)</label>
                            <button
                              type="button"
                              onClick={addVisualAid}
                              className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
                            >
                              + Add Visual Aid
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                            Upload images, paste image URLs, or paste images directly from clipboard (Ctrl+V / Cmd+V). These will appear in the Visual Aids section for students.
                          </p>
                          <div className="space-y-3">
                            {(lessonForm.visualAids || []).map((aid, index) => (
                              <div 
                                key={index} 
                                className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2"
                                onPaste={async (e) => {
                                  e.preventDefault();
                                  const items = e.clipboardData.items;
                                  for (let i = 0; i < items.length; i++) {
                                    if (items[i].type.indexOf('image') !== -1) {
                                      const blob = items[i].getAsFile();
                                      if (blob) {
                                        const file = new File([blob], `pasted-image-${Date.now()}.png`, { type: 'image/png' });
                                        await handleImageUpload(index, file);
                                      }
                                      break;
                                    }
                                  }
                                }}
                              >
                                <div className="flex gap-2">
                                  <div className="flex-shrink-0">
                                    <input
                                      type="file"
                                      accept="image/*"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleImageUpload(index, file);
                                      }}
                                      className="hidden"
                                      id={`visual-aid-upload-${index}`}
                                    />
                                    <label
                                      htmlFor={`visual-aid-upload-${index}`}
                                      className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
                                    >
                                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                      Upload
                                    </label>
                                  </div>
                                  
                                  {!aid.url && (
                                    <input
                                      type="url"
                                      value={aid.url || ''}
                                      onChange={(e) => updateVisualAid(index, 'url', e.target.value)}
                                      onPaste={(e) => {
                                        const pastedText = e.clipboardData.getData('text');
                                        if (pastedText.startsWith('http://') || pastedText.startsWith('https://') || pastedText.startsWith('data:image/')) {
                                          updateVisualAid(index, 'url', pastedText);
                                        }
                                      }}
                                      placeholder="Paste image URL here or click in this area and paste an image (Ctrl+V / Cmd+V)"
                                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                                    />
                                  )}
                                  
                                  {aid.url && (
                                    <div className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg text-sm flex items-center">
                                      <svg className="w-4 h-4 mr-2 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      <span className="truncate" title={aid.url}>Image uploaded</span>
                                      <button
                                        type="button"
                                        onClick={() => updateVisualAid(index, 'url', '')}
                                        className="ml-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                                        title="Remove image"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      </button>
                                    </div>
                                  )}
                                  
                                  <button
                                    type="button"
                                    onClick={() => removeVisualAid(index)}
                                    className="px-3 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm hover:bg-red-200 dark:hover:bg-red-900/50"
                                  >
                                    Remove
                                  </button>
                                </div>
                                
                                {aid.url && (
                                  <div className="mt-2">
                                    <img
                                      src={aid.url}
                                      alt={`Visual aid ${index + 1}`}
                                      className="max-w-full h-auto rounded-lg border border-gray-200 dark:border-gray-700"
                                      style={{ maxHeight: '200px' }}
                                    />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white rounded-lg font-semibold transition-colors"
                          >
                            {loading ? 'Saving...' : editingLesson ? 'Save Changes' : 'Create Lesson'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowLessonForm(false);
                              setEditingLesson(null);
                              setLessonForm({});
                            }}
                            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  ) : (
                    <div className="p-6">
                      {loading ? (
                        <div className="flex items-center justify-center py-8">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                        </div>
                      ) : courseLessons.length === 0 ? (
                        <div className="text-center py-8">
                          <p className="text-gray-500 dark:text-gray-400 mb-4">No lessons yet. Click "+ Add Lesson" to create one.</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {courseLessons.map((lesson) => (
                            <div
                              key={lesson._id}
                              className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow"
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex-1">
                                  <h3 className="font-bold text-gray-900 dark:text-white mb-1">{lesson.title}</h3>
                                  {lesson.summary && (
                                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-2 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(lesson.summary) }} />
                                  )}
                                  <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(lesson.description) }} />
                                </div>
                                <div className="flex gap-2 ml-4">
                                  <button
                                    onClick={() => handleEditLesson(lesson)}
                                    className="px-3 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded text-sm font-semibold hover:bg-primary-200 dark:hover:bg-primary-900/50"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => {
                                      window.open(`/courses/${selectedCourse}/lessons/${lesson._id}`, '_blank');
                                    }}
                                    className="px-3 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded text-sm font-semibold hover:bg-purple-200 dark:hover:bg-purple-900/50"
                                    title="Edit Visual Aids"
                                  >
                                    Visual Aids
                                  </button>
                                  <button
                                    onClick={() => handleDeleteLesson(lesson._id)}
                                    className="px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-sm font-semibold hover:bg-red-200 dark:hover:bg-red-900/50"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                              <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
                                <div className="flex items-center gap-3 text-xs">
                                  {lesson.videoUrl && (
                                    <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                      </svg>
                                      Video
                                    </span>
                                  )}
                                  {lesson.pdfUrl && (
                                    <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                      </svg>
                                      PDF
                                    </span>
                                  )}
                                  <span className="text-gray-500 dark:text-gray-400 capitalize">Type: {lesson.type}</span>
                                  <span className="text-gray-500 dark:text-gray-400">Order: {lesson.order}</span>
                                </div>
                                
                                {lesson.resources && lesson.resources.length > 0 && (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Resources:</p>
                                    <div className="flex flex-wrap gap-2">
                                      {lesson.resources.map((resource, idx) => (
                                        <a
                                          key={idx}
                                          href={resource.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center gap-1"
                                        >
                                          {resource.type === 'pdf' && (
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                            </svg>
                                          )}
                                          {resource.type === 'link' && (
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                            </svg>
                                          )}
                                          {resource.type === 'slide' && (
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                          )}
                                          {resource.title || resource.type}
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

