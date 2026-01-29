/**
 * Instructor Course Management Page
 * Full course management interface for instructors
 * Replaces student-style course view with management workspace
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import RichTextEditor from '@/components/RichTextEditor';
import { useAuth } from '@/hooks/useAuth';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/lib/api-client';
import axios from 'axios';

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

interface Quiz {
  _id?: string;
  lessonId: string;
  courseId: string;
  questions: Array<{
    question: string;
    options: string[];
    correctAnswer: number;
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

export default function InstructorCoursePage() {
  const router = useRouter();
  const { courseId } = router.query;
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { socket, connected } = useSocket();
  
  const [course, setCourse] = useState<Course | null>(null);
  const [courseLessons, setCourseLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCourse, setEditingCourse] = useState(false);
  const [editingLesson, setEditingLesson] = useState<string | null>(null);
  const [editingQuiz, setEditingQuiz] = useState<string | null>(null);
  const [lessonForm, setLessonForm] = useState<Partial<Lesson> & { visualAids?: Array<{ url: string; caption?: string }> }>({});
  const [quizForm, setQuizForm] = useState<Partial<Quiz>>({});
  const [courseForm, setCourseForm] = useState<Partial<Course>>({});
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [showQuizForm, setShowQuizForm] = useState(false);
  const [uploadingImageIndex, setUploadingImageIndex] = useState<number | null>(null);

  // Role enforcement
  useEffect(() => {
    if (!authLoading && (!isAuthenticated || (user?.role !== 'instructor' && user?.role !== 'admin' && user?.role !== 'superadmin'))) {
      router.push('/courses');
    }
  }, [authLoading, isAuthenticated, user, router]);

  // Load course data
  useEffect(() => {
    if (courseId && isAuthenticated && (user?.role === 'instructor' || user?.role === 'admin' || user?.role === 'superadmin')) {
      loadCourse();
      loadCourseLessons();
    }
  }, [courseId, isAuthenticated, user]);

  const loadCourse = async () => {
    try {
      setLoading(true);
      const courseData = await apiClient.get<Course>(`/courses/${courseId}`);
      setCourse(courseData);
      setCourseForm({
        title: courseData.title,
        description: courseData.description,
        category: courseData.category,
        difficulty: courseData.difficulty,
        thumbnail: courseData.thumbnail || '',
      });
    } catch (error: any) {
      console.error('Failed to load course:', error);
      alert(error.message || 'Failed to load course');
      router.push('/instructor/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const loadCourseLessons = async () => {
    if (!courseId) return;
    try {
      const lessons = await apiClient.get<Lesson[]>(`/lessons?courseId=${courseId}`);
      setCourseLessons(lessons.sort((a, b) => a.order - b.order));
    } catch (error: any) {
      console.error('Failed to load lessons:', error);
    }
  };

  const loadQuiz = async (lessonId: string) => {
    try {
      const quiz = await apiClient.get<Quiz>(`/quizzes/${lessonId}`);
      setQuizForm(quiz);
    } catch {
      // Quiz might not exist yet
      setQuizForm({ lessonId, courseId: courseId as string, questions: [] });
    }
  };

  const handleEditCourse = () => {
    setEditingCourse(true);
  };

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId) return;

    try {
      setLoading(true);
      await apiClient.put(`/courses/${courseId}`, courseForm);
      await loadCourse();
      setEditingCourse(false);
      alert('Course updated successfully!');
    } catch (error: any) {
      alert(error.message || 'Failed to save course');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (!confirm('Are you sure you want to delete this course? This will also delete all associated lessons and cannot be undone.')) {
      return;
    }

    try {
      setLoading(true);
      await apiClient.delete(`/courses/${courseId}`);
      alert('Course deleted successfully!');
      router.push('/instructor/dashboard');
    } catch (error: any) {
      alert(error.message || 'Failed to delete course');
    } finally {
      setLoading(false);
    }
  };

  const handleEditLesson = (lesson: Lesson) => {
    setEditingLesson(lesson._id);
    const summaryText = (lesson as any).lessonSummary?.overview || lesson.summary || '';
    setLessonForm({
      title: lesson.title,
      description: lesson.description,
      summary: summaryText,
      videoUrl: lesson.videoUrl || '',
      pdfUrl: lesson.pdfUrl || '',
      type: lesson.type,
      order: lesson.order,
      content: lesson.content || '',
      resources: lesson.resources || [],
      visualAids: (lesson as any).lessonSummary?.screenshots || [],
    });
    setShowLessonForm(true);
  };

  const handleSaveLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId || !editingLesson) return;

    try {
      setLoading(true);
      const updateData: any = {
        ...lessonForm,
        courseId: courseId,
      };
      
      const existingLesson = await apiClient.get(`/lessons/${editingLesson}`);
      const existingLessonSummary = (existingLesson as any).lessonSummary || {};
      
      // Save visual aids - URL is optional (can be uploaded file or URL, or both, or neither)
      // Only save visual aids that have a valid URL (uploaded images get URLs automatically)
      const allVisualAids = (lessonForm as any).visualAids || [];
      const validVisualAids = allVisualAids
        .filter((aid: any) => {
          // Only include visual aids that have a valid URL
          // If no URL is provided, the visual aid is simply not saved (no error)
          const url = aid.url?.trim() || '';
          return url !== '' && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/'));
        })
        .map((aid: any) => ({
          url: aid.url?.trim() || '',
          caption: aid.caption?.trim() || '',
        }));
      
      console.log('Saving lesson - Visual aids:', {
        total: allVisualAids.length,
        valid: validVisualAids.length,
        aids: validVisualAids
      });
      
      updateData.lessonSummary = {
        ...existingLessonSummary,
        overview: lessonForm.summary || existingLessonSummary.overview || '',
        screenshots: validVisualAids.length > 0 ? validVisualAids : existingLessonSummary.screenshots || [],
        updatedAt: new Date(),
      };

      await apiClient.put(`/lessons/${editingLesson}`, updateData);

      if (socket && connected) {
        socket.emit('lessonUpdated', { lessonId: editingLesson, courseId });
      }

      await loadCourseLessons();
      setEditingLesson(null);
      setShowLessonForm(false);
      setLessonForm({});
    } catch (error: any) {
      alert(error.message || 'Failed to save lesson');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLesson = async (lessonId: string) => {
    if (!confirm('Are you sure you want to delete this lesson? This action cannot be undone.')) {
      return;
    }

    try {
      setLoading(true);
      await apiClient.delete(`/lessons/${lessonId}`);
      await loadCourseLessons();
      
      if (socket && connected) {
        socket.emit('lessonUpdated', { lessonId, courseId });
      }
    } catch (error: any) {
      alert(error.message || 'Failed to delete lesson');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId) {
      alert('Course ID is required');
      return;
    }

    try {
      setLoading(true);
      const lessonData: any = {
        ...lessonForm,
        courseId: courseId,
        order: lessonForm.order || courseLessons.length + 1,
      };
      
      // Save visual aids - URL is optional (can be uploaded file or URL, or both, or neither)
      // Only save visual aids that have a valid URL (uploaded images get URLs automatically)
      const allVisualAids = (lessonForm as any).visualAids || [];
      const validVisualAids = allVisualAids
        .filter((aid: any) => {
          // Only include visual aids that have a valid URL
          // If no URL is provided, the visual aid is simply not saved (no error)
          const url = aid.url?.trim() || '';
          return url !== '' && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/'));
        })
        .map((aid: any) => ({
          url: aid.url?.trim() || '',
          caption: aid.caption?.trim() || '',
        }));
      
      console.log('Creating lesson - Visual aids:', {
        total: allVisualAids.length,
        valid: validVisualAids.length,
        aids: validVisualAids
      });
      
      if (lessonForm.summary || validVisualAids.length > 0) {
        lessonData.lessonSummary = {
          overview: lessonForm.summary || '',
          screenshots: validVisualAids,
          updatedAt: new Date(),
        };
      }
      
      await apiClient.post('/lessons', lessonData);
      await loadCourseLessons();
      setShowLessonForm(false);
      setLessonForm({});
    } catch (error: any) {
      alert(error.message || 'Failed to create lesson');
    } finally {
      setLoading(false);
    }
  };

  const handleEditQuiz = async (lessonId: string) => {
    setEditingQuiz(lessonId);
    await loadQuiz(lessonId);
    setShowQuizForm(true);
  };

  const handleSaveQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuiz || !courseId) return;

    try {
      setLoading(true);
      await apiClient.put(`/quizzes/${editingQuiz}`, {
        lessonId: editingQuiz,
        courseId: courseId,
        questions: quizForm.questions || [],
      });

      if (socket && connected) {
        socket.emit('quizUpdated', { lessonId: editingQuiz });
      }

      setEditingQuiz(null);
      setShowQuizForm(false);
      setQuizForm({});
    } catch (error: any) {
      alert(error.message || 'Failed to save quiz');
    } finally {
      setLoading(false);
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
    resources[index] = { ...resources[index], [field]: value };
    setLessonForm({ ...lessonForm, resources });
  };

  const addVisualAid = () => {
    const visualAids = lessonForm.visualAids || [];
    setLessonForm({
      ...lessonForm,
      visualAids: [...visualAids, { url: '', caption: '' }],
    });
  };

  const updateVisualAid = (index: number, field: string, value: string) => {
    const visualAids = [...(lessonForm.visualAids || [])];
    visualAids[index] = { ...visualAids[index], [field]: value };
    setLessonForm({ ...lessonForm, visualAids });
  };

  const removeVisualAid = (index: number) => {
    const visualAids = lessonForm.visualAids || [];
    setLessonForm({
      ...lessonForm,
      visualAids: visualAids.filter((_, i) => i !== index),
    });
  };

  const handleImageUpload = async (index: number, file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    try {
      setUploadingImageIndex(index);
      const formData = new FormData();
      formData.append('file', file);

      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      
      if (!token) {
        alert('Authentication required. Please log in again.');
        setUploadingImageIndex(null);
        return;
      }

      const response = await axios.post('/api/upload/visual-aid', formData, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      // Handle different response formats (url, imageUrl, secureUrl)
      const imageUrl = response.data.url || response.data.imageUrl || response.data.secureUrl || response.data.secure_url;
      
      if (!imageUrl) {
        console.error('Upload response missing URL:', response.data);
        alert('Upload succeeded but no URL was returned. Please try again.');
        setUploadingImageIndex(null);
        return;
      }

      // Update the visual aid URL with the uploaded image URL
      // Use a callback to ensure state is updated correctly
      setLessonForm(prev => {
        const visualAids = [...(prev.visualAids || [])];
        if (visualAids[index]) {
          visualAids[index] = { ...visualAids[index], url: imageUrl };
        } else {
          visualAids[index] = { url: imageUrl, caption: '' };
        }
        return { ...prev, visualAids };
      });
      
      console.log('Image uploaded successfully, URL set:', imageUrl);
    } catch (error: any) {
      console.error('Image upload error:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Failed to upload image';
      alert(errorMessage);
    } finally {
      setUploadingImageIndex(null);
    }
  };

  const addQuizQuestion = () => {
    const questions = quizForm.questions || [];
    setQuizForm({
      ...quizForm,
      questions: [...questions, { question: '', options: ['', '', '', ''], correctAnswer: 0 }],
    });
  };

  const removeQuizQuestion = (index: number) => {
    const questions = quizForm.questions || [];
    setQuizForm({
      ...quizForm,
      questions: questions.filter((_, i) => i !== index),
    });
  };

  // Show loading while checking auth or loading course
  if (authLoading || loading) {
    return <LoadingSpinner message="Loading course..." fullScreen />;
  }

  // Redirect non-authorized users
  if (!authLoading && (!isAuthenticated || (user?.role !== 'instructor' && user?.role !== 'admin' && user?.role !== 'superadmin'))) {
    return <LoadingSpinner message="Redirecting..." fullScreen />;
  }

  // Show error if course not found
  if (!course) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <Header />
        <div className="flex flex-1 overflow-hidden pt-20 lg:pt-0">
          <Sidebar />
          <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Course Not Found</h1>
              <p className="text-gray-600 dark:text-gray-400 mb-4">The course you're looking for doesn't exist or you don't have permission to access it.</p>
              <Link href="/instructor/dashboard" className="text-primary-600 dark:text-primary-400 hover:underline">
                ← Back to Dashboard
              </Link>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const difficultyColors = {
    beginner: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    advanced: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex flex-1 overflow-hidden pt-20 lg:pt-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <Link href="/instructor/dashboard" className="text-primary-600 dark:text-primary-400 hover:underline text-sm mb-2 inline-block">
                  ← Back to Dashboard
                </Link>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Course Management</h1>
                <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">Manage course content, lessons, and quizzes</p>
              </div>
            </div>
          </div>

          {/* Course Info Section */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            {editingCourse ? (
              <form onSubmit={handleSaveCourse} className="space-y-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Edit Course</h2>
                
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
                  <RichTextEditor
                    value={courseForm.description || ''}
                    onChange={(content) => setCourseForm({ ...courseForm, description: content })}
                    height={300}
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
                      onChange={(e) => setCourseForm({ ...courseForm, difficulty: e.target.value as any })}
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
                    {loading ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCourse(false);
                      setCourseForm({
                        title: course?.title || '',
                        description: course?.description || '',
                        category: course?.category || '',
                        difficulty: course?.difficulty || 'beginner',
                        thumbnail: course?.thumbnail || '',
                      });
                    }}
                    className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteCourse}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
                  >
                    Delete Course
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{course.title}</h2>
                    <div className="flex items-center gap-3 mb-4">
                      <span className={`px-3 py-1 rounded-full text-sm font-semibold ${difficultyColors[course.difficulty]}`}>
                        {course.difficulty}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">•</span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">{course.category}</span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">•</span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">{courseLessons.length} lessons</span>
                    </div>
                    <p className="text-gray-700 dark:text-gray-300">{course.description}</p>
                  </div>
                  <button
                    onClick={handleEditCourse}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors"
                  >
                    Edit Course
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Lessons Management */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Lessons</h2>
              {!showLessonForm && (
                <button
                  onClick={() => {
                    setEditingLesson(null);
                    setLessonForm({ order: courseLessons.length + 1, type: 'video', resources: [] });
                    setShowLessonForm(true);
                  }}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors"
                >
                  + Add Lesson
                </button>
              )}
            </div>

            {showLessonForm ? (
              <form onSubmit={editingLesson ? handleSaveLesson : handleCreateLesson} className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {editingLesson ? 'Edit Lesson' : 'Create New Lesson'}
                </h3>
                
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
                  <RichTextEditor
                    value={lessonForm.description || ''}
                    onChange={(content) => setLessonForm({ ...lessonForm, description: content })}
                    height={250}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Summary</label>
                  <RichTextEditor
                    value={lessonForm.summary || ''}
                    onChange={(content) => setLessonForm({ ...lessonForm, summary: content })}
                    height={200}
                    placeholder="Short text overview for the topic..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Video URL</label>
                    <input
                      type="url"
                      value={lessonForm.videoUrl || ''}
                      onChange={(e) => setLessonForm({ ...lessonForm, videoUrl: e.target.value })}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
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
                    rows={8}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                  />
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
                    Upload images from your computer or paste image URLs. Both methods work independently - you can use either one or both. URL is optional when uploading files. These will appear in the Visual Aids section for students.
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
                          {/* Image Upload */}
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
                              className={`inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm ${
                                uploadingImageIndex === index ? 'opacity-50 cursor-not-allowed' : ''
                              }`}
                            >
                              {uploadingImageIndex === index ? (
                                <>
                                  <svg className="animate-spin h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  Uploading...
                                </>
                              ) : (
                                <>
                                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                  Upload
                                </>
                              )}
                            </label>
                          </div>
                          
                          {/* URL Input - always available, works independently from file upload */}
                          <input
                            type="url"
                            value={aid.url || ''}
                            onChange={(e) => updateVisualAid(index, 'url', e.target.value)}
                            onPaste={(e) => {
                              // Allow pasting URLs, but also check for image data
                              const pastedText = e.clipboardData.getData('text');
                              if (pastedText.startsWith('http://') || pastedText.startsWith('https://') || pastedText.startsWith('data:image/')) {
                                // If it's a URL or data URL, update the URL field
                                updateVisualAid(index, 'url', pastedText);
                              }
                            }}
                            placeholder="Optional: Paste or type image URL here (works independently from file upload)"
                            className={`flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm focus:ring-2 focus:ring-primary-500 ${
                              aid.url ? 'border-green-500 dark:border-green-500' : ''
                            }`}
                          />
                          
                          {/* Optional: Show indicator when URL is set */}
                          {aid.url && (
                            <div className="flex items-center text-xs text-green-600 dark:text-green-400">
                              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              URL set
                            </div>
                          )}
                          
                          {/* Remove Button */}
                          <button
                            type="button"
                            onClick={() => removeVisualAid(index)}
                            className="px-3 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm hover:bg-red-200 dark:hover:bg-red-900/50"
                          >
                            Remove
                          </button>
                        </div>
                        
                        {/* Caption Input */}
                        <input
                          type="text"
                          value={aid.caption || ''}
                          onChange={(e) => updateVisualAid(index, 'caption', e.target.value)}
                          placeholder="Caption (e.g., 'RSI Indicator showing overbought levels')"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                        />
                        
                        {/* Preview */}
                        {aid.url && (
                          <div className="mt-2">
                            <img
                              src={aid.url}
                              alt={aid.caption || 'Visual aid preview'}
                              className="max-w-full max-h-96 w-auto h-auto object-contain rounded border border-gray-200 dark:border-gray-700"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
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
            ) : showQuizForm ? (
              <form onSubmit={handleSaveQuiz} className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">Edit Quiz</h3>
                  <button
                    type="button"
                    onClick={addQuizQuestion}
                    className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    + Add Question
                  </button>
                </div>

                {(quizForm.questions || []).map((question, qIndex) => (
                  <div key={qIndex} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Question {qIndex + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeQuizQuestion(qIndex)}
                        className="text-sm text-red-600 dark:text-red-400 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      type="text"
                      value={question.question}
                      onChange={(e) => {
                        const questions = [...(quizForm.questions || [])];
                        questions[qIndex].question = e.target.value;
                        setQuizForm({ ...quizForm, questions });
                      }}
                      placeholder="Question text"
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg"
                    />
                    {question.options.map((option, oIndex) => (
                      <div key={oIndex} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`correct-${qIndex}`}
                          checked={question.correctAnswer === oIndex}
                          onChange={() => {
                            const questions = [...(quizForm.questions || [])];
                            questions[qIndex].correctAnswer = oIndex;
                            setQuizForm({ ...quizForm, questions });
                          }}
                          className="w-4 h-4"
                        />
                        <input
                          type="text"
                          value={option}
                          onChange={(e) => {
                            const questions = [...(quizForm.questions || [])];
                            questions[qIndex].options[oIndex] = e.target.value;
                            setQuizForm({ ...quizForm, questions });
                          }}
                          placeholder={`Option ${oIndex + 1}`}
                          className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg"
                        />
                      </div>
                    ))}
                  </div>
                ))}

                {(!quizForm.questions || quizForm.questions.length === 0) && (
                  <p className="text-gray-500 dark:text-gray-400 text-center py-4">No questions yet. Click "+ Add Question" to start.</p>
                )}

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white rounded-lg font-semibold transition-colors"
                  >
                    {loading ? 'Saving...' : 'Save Quiz'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowQuizForm(false);
                      setEditingQuiz(null);
                      setQuizForm({});
                    }}
                    className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div>
                {courseLessons.length === 0 ? (
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
                              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{lesson.summary}</p>
                            )}
                            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{lesson.description}</p>
                          </div>
                          <div className="flex gap-2 ml-4">
                            <button
                              onClick={() => handleEditLesson(lesson)}
                              className="px-3 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded text-sm font-semibold hover:bg-primary-200 dark:hover:bg-primary-900/50"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleEditQuiz(lesson._id)}
                              className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-sm font-semibold hover:bg-blue-200 dark:hover:bg-blue-900/50"
                            >
                              Quiz
                            </button>
                            <button
                              onClick={() => handleDeleteLesson(lesson._id)}
                              className="px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-sm font-semibold hover:bg-red-200 dark:hover:bg-red-900/50"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                          Order: {lesson.order} • Type: {lesson.type}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

