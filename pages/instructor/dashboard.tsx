/**
 * Instructor Dashboard - Redesigned
 * Enhanced course and lesson management for instructors
 * Features:
 * - Courses grouped by level (Beginner, Intermediate, Advanced)
 * - Full lesson management: Add/Edit/Delete lessons with summary and resources
 * - Quiz editing
 * - Video editing (MP4/WebM)
 * - Real-time updates via Socket.io
 * - Full-screen landscape optimized layout
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
// import Link from 'next/link'; // Reserved for future use
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/lib/api-client';
import axios from 'axios';
import { useCourses } from '@/hooks/useCourses';
import { formatDistanceToNow } from 'date-fns';

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
  _id: string;
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

export default function InstructorDashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const { courses, refetch } = useCourses();
  const { socket, connected } = useSocket();
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [selectedCourseData, setSelectedCourseData] = useState<Course | null>(null);
  const [courseLessons, setCourseLessons] = useState<Lesson[]>([]);
  const [editingLesson, setEditingLesson] = useState<string | null>(null);
  const [editingQuiz, setEditingQuiz] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState<string | null>(null);
  const [lessonForm, setLessonForm] = useState<Partial<Lesson> & { visualAids?: Array<{ url: string; caption?: string }> }>({});
  const [quizForm, setQuizForm] = useState<Partial<Quiz>>({});
  const [courseForm, setCourseForm] = useState<Partial<Course>>({});
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [showQuizForm, setShowQuizForm] = useState(false);
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showNewsModal, setShowNewsModal] = useState(false);
  const [newsItems, setNewsItems] = useState<any[]>([]);
  const [editingNews, setEditingNews] = useState<any>(null);
  // const [newsForm, setNewsForm] = useState({ // Reserved for future use
  //   title: '',
  //   description: '',
  //   category: 'market',
  //   content: '',
  //   link: '',
  // });
  const [newsEditForm, setNewsEditForm] = useState({
    title: '',
    description: '',
    category: 'market',
    content: '',
    link: '',
  });
  const [submittingNews, setSubmittingNews] = useState(false);
  // FIX: State for upcoming classes
  const [upcomingClasses, setUpcomingClasses] = useState<any[]>([]);
  const [classForm, setClassForm] = useState({
    title: '',
    description: '',
    date: '',
    time: '',
    meetingLink: '',
  });
  const [submittingClass, setSubmittingClass] = useState(false);
  const [showClassForm, setShowClassForm] = useState(false);
  const [editingClass, setEditingClass] = useState<any>(null);

  // Group courses by difficulty level - Show ALL courses for instructors
  const coursesByLevel = {
    beginner: allCourses.filter(c => c.difficulty === 'beginner'),
    intermediate: allCourses.filter(c => c.difficulty === 'intermediate'),
    advanced: allCourses.filter(c => c.difficulty === 'advanced'),
  };

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || user?.role !== 'instructor')) {
      router.push('/login');
      return;
    }
    // Check if instructor is approved (status must be 'approved')
    if (user && user.role === 'instructor' && user.status && user.status !== 'approved') {
      if (user.status === 'pending') {
        alert('Your registration is pending approval. Please wait for Super Admin approval before accessing your dashboard.');
      } else if (user.status === 'rejected') {
        alert('Your registration has been rejected. Please contact support for more information.');
      }
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, user, router]);

  // Consultation removed from dashboard - now only in sidebar page
  // Consultation state and functions removed to avoid duplication

  useEffect(() => {
    if (user?.role === 'instructor') {
      loadAllCourses();
      loadAnalytics();
      loadNews();
      loadUpcomingClasses();
    }
  }, [user, courses]);

  // Consultation functions removed - now only in sidebar page (/consultations/expert)

  // Real-time updates via Socket.io
  useEffect(() => {
    if (!socket || !connected || !user) return;

    socket.on('lessonUpdated', (data: { lessonId: string; courseId: string }) => {
      if (selectedCourse === data.courseId) {
        loadCourseLessons(selectedCourse);
      }
    });

    socket.on('quizUpdated', (data: { lessonId: string }) => {
      if (editingQuiz === data.lessonId) {
        loadQuiz(data.lessonId);
      }
    });

    return () => {
      socket.off('lessonUpdated');
      socket.off('quizUpdated');
    };
  }, [socket, connected, user, selectedCourse, editingQuiz]);

  const loadAllCourses = async () => {
    try {
      // Load ALL courses for instructors (full access)
      setAllCourses(courses as Course[]);
    } catch (error) {
      console.error('Failed to load courses:', error);
    }
  };

  const loadNews = async () => {
    try {
      const data = await apiClient.get('/community/news');
      setNewsItems(data as any[]);
    } catch (error) {
      console.error('Failed to load news:', error);
    }
  };

  // FIX: Load upcoming classes for instructor
  const loadUpcomingClasses = async () => {
    try {
      const data = await apiClient.get<any[]>('/classes');
      setUpcomingClasses(data || []);
    } catch (error) {
      console.error('Failed to load upcoming classes:', error);
      setUpcomingClasses([]);
    }
  };

  // FIX: Handle creating a new class
  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingClass(true);
    try {
      await apiClient.post('/classes', classForm);
      setClassForm({ title: '', description: '', date: '', time: '', meetingLink: '' });
      setShowClassForm(false);
      setEditingClass(null);
      await loadUpcomingClasses();
      alert('Class created successfully!');
    } catch (error: any) {
      alert(error.response?.data?.error || error.message || 'Failed to create class');
    } finally {
      setSubmittingClass(false);
    }
  };

  // FIX: Handle editing a class
  const handleEditClass = (cls: any) => {
    setEditingClass(cls);
    setClassForm({
      title: cls.title,
      description: cls.description,
      date: cls.date,
      time: cls.time,
      meetingLink: cls.meetingLink || '',
    });
    setShowClassForm(true);
  };

  // FIX: Handle updating a class
  const handleUpdateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClass) return;
    setSubmittingClass(true);
    try {
      await apiClient.put(`/classes?id=${editingClass._id}`, classForm);
      setClassForm({ title: '', description: '', date: '', time: '', meetingLink: '' });
      setShowClassForm(false);
      setEditingClass(null);
      await loadUpcomingClasses();
      alert('Class updated successfully!');
    } catch (error: any) {
      alert(error.response?.data?.error || error.message || 'Failed to update class');
    } finally {
      setSubmittingClass(false);
    }
  };

  // FIX: Handle deleting a class
  const handleDeleteClass = async (classId: string) => {
    if (!confirm('Are you sure you want to delete this class?')) return;
    try {
      await apiClient.delete(`/classes?id=${classId}`);
      await loadUpcomingClasses();
      alert('Class deleted successfully!');
    } catch (error: any) {
      alert(error.response?.data?.error || error.message || 'Failed to delete class');
    }
  };

  const loadAnalytics = async () => {
    try {
      const data = await apiClient.get('/instructor/analytics');
      setAnalytics(data as any);
    } catch {
      setAnalytics({
        totalCourses: allCourses.length,
        totalLessons: 0,
        totalStudents: 0,
        totalEnrollments: 0,
      });
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

  const loadQuiz = async (lessonId: string) => {
    try {
      const quiz = await apiClient.get<Quiz>(`/quizzes/${lessonId}`);
      setQuizForm(quiz);
    } catch {
      // Quiz might not exist yet
      setQuizForm({ lessonId, courseId: selectedCourse || '', questions: [] });
    }
  };

  const handleSelectCourse = async (courseId: string) => {
    setSelectedCourse(courseId);
    const course = allCourses.find(c => (c._id || c.id) === courseId);
    setSelectedCourseData(course || null);
    await loadCourseLessons(courseId);
    setEditingLesson(null);
    setEditingQuiz(null);
    setEditingCourse(null);
    setShowLessonForm(false);
    setShowQuizForm(false);
    setShowCourseForm(false);
  };

  const handleEditCourse = (course: Course) => {
    setEditingCourse(course._id || course.id || null);
    setCourseForm({
      title: course.title,
      description: course.description,
      category: course.category,
      difficulty: course.difficulty,
      thumbnail: (course as any).thumbnail || '',
    });
    setShowCourseForm(true);
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!user?.id) {
        throw new Error('User ID is required');
      }
      setLoading(true);
      await apiClient.post('/courses', {
        ...courseForm,
        instructorId: user.id,
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
      alert(error.message || 'Failed to save course');
    } finally {
      setLoading(false);
    }
  };

  const handleEditLesson = (lesson: Lesson) => {
    setEditingLesson(lesson._id);
    // Use lessonSummary.overview if available, otherwise fall back to summary
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
    if (!selectedCourse || !editingLesson) return;

    try {
      setLoading(true);
      // Convert summary to lessonSummary format for consistency
      const updateData: any = {
        ...lessonForm,
        courseId: selectedCourse,
      };
      
      // If summary exists, also update lessonSummary.overview
      const existingLesson = await apiClient.get(`/lessons/${editingLesson}`);
      const existingLessonSummary = (existingLesson as any).lessonSummary || {};
      
      // Always update lessonSummary to ensure visual aids are saved
      updateData.lessonSummary = {
        ...existingLessonSummary,
        overview: lessonForm.summary || existingLessonSummary.overview || '',
        screenshots: (lessonForm as any).visualAids || existingLessonSummary.screenshots || [],
        updatedAt: new Date(),
      };

      await apiClient.put(`/lessons/${editingLesson}`, updateData);

      // Emit real-time update
      if (socket && connected) {
        socket.emit('lessonUpdated', { lessonId: editingLesson, courseId: selectedCourse });
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

  const handleDeleteLesson = async (lessonId: string) => {
    if (!confirm('Are you sure you want to delete this lesson? This action cannot be undone.')) {
      return;
    }

    try {
      setLoading(true);
      await apiClient.delete(`/lessons/${lessonId}`);
      await loadCourseLessons(selectedCourse!);
      
      // Emit real-time update
      if (socket && connected) {
        socket.emit('lessonUpdated', { lessonId, courseId: selectedCourse });
      }
    } catch (error: any) {
      alert(error.message || 'Failed to delete lesson');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourse) {
      alert('Please select a course first');
      return;
    }

    try {
      setLoading(true);
      const lessonData: any = {
        ...lessonForm,
        courseId: selectedCourse,
        order: lessonForm.order || courseLessons.length + 1,
      };
      
      // Include lessonSummary with visual aids if provided
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

  const handleEditQuiz = async (lessonId: string) => {
    setEditingQuiz(lessonId);
    await loadQuiz(lessonId);
    setShowQuizForm(true);
  };

  const handleSaveQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuiz || !selectedCourse) return;

    try {
      setLoading(true);
      await apiClient.put(`/quizzes/${editingQuiz}`, {
        lessonId: editingQuiz,
        courseId: selectedCourse,
        questions: quizForm.questions || [],
      });

      // Emit real-time update
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
      const formData = new FormData();
      formData.append('file', file);

      // Get authentication token from localStorage
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      
      if (!token) {
        alert('Authentication required. Please log in again.');
        return;
      }

      // Use axios directly for better FormData handling
      const response = await axios.post('/api/upload/visual-aid', formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          // Don't set Content-Type - axios will set it automatically with boundary for FormData
        },
      });

      updateVisualAid(index, 'url', response.data.url);
    } catch (error: any) {
      console.error('Image upload error:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Failed to upload image';
      alert(errorMessage);
    }
  };

  const updateResource = (index: number, field: string, value: string) => {
    const resources = lessonForm.resources || [];
    resources[index] = { ...resources[index], [field]: value };
    setLessonForm({ ...lessonForm, resources });
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

  if (authLoading || !isAuthenticated || user?.role !== 'instructor') {
    return <LoadingSpinner message="Loading instructor dashboard..." fullScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      {/* Persistent Sidebar Layout - Sidebar remains visible across all instructor dashboard pages */}
      {/* Sidebar is NOT controlled by chat state, modal state, or consultation selection */}
      <div className="flex flex-1 overflow-hidden pt-20 lg:pt-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        {/* Header Section */}
        <div className="mb-3 sm:mb-4 flex-shrink-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-1">Instructor Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm">Manage your courses, lessons, and track student progress</p>
        </div>

        {/* Forex News Posting Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-3 sm:p-4 mb-3 sm:mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
            </svg>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Forex News Updates</h3>
              <p className="text-xs text-gray-600 dark:text-gray-400">Share important updates with the community</p>
            </div>
          </div>
          <button
            onClick={() => setShowNewsModal(true)}
            className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors flex items-center justify-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Post News</span>
          </button>
        </div>

        {/* Consultation removed from dashboard - now only in sidebar page (/consultations/expert) */}

        {/* FIX: Upcoming Classes Section - Allow instructors to post upcoming classes */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-3 sm:p-4 mb-3 sm:mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Upcoming Classes & Events</h3>
              <p className="text-xs text-gray-600 dark:text-gray-400">Schedule classes that students can see on their dashboard</p>
            </div>
          </div>
          <button
            onClick={() => setShowClassForm(!showClassForm)}
            className="w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition-colors flex items-center justify-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>{showClassForm ? 'Cancel' : 'Post Class'}</span>
          </button>
        </div>

        {/* FIX: Class Creation Form */}
        {showClassForm && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6 mb-3 sm:mb-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Create New Class/Event</h3>
            <form onSubmit={editingClass ? handleUpdateClass : handleCreateClass} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={classForm.title}
                    onChange={(e) => setClassForm({ ...classForm, title: e.target.value })}
                    placeholder="e.g., Advanced Trading Strategies Workshop"
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={classForm.date}
                    onChange={(e) => setClassForm({ ...classForm, date: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={classForm.description}
                  onChange={(e) => setClassForm({ ...classForm, description: e.target.value })}
                  placeholder="Describe the class or event..."
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Time <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="time"
                    value={classForm.time}
                    onChange={(e) => setClassForm({ ...classForm, time: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Meeting Link (Optional)
                  </label>
                  <input
                    type="url"
                    value={classForm.meetingLink}
                    onChange={(e) => setClassForm({ ...classForm, meetingLink: e.target.value })}
                    placeholder="https://meet.google.com/..."
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                {editingClass && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingClass(null);
                      setClassForm({ title: '', description: '', date: '', time: '', meetingLink: '' });
                      setShowClassForm(false);
                    }}
                    className="flex-1 px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-xl font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={submittingClass}
                  className="flex-1 md:w-auto px-6 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-colors"
                >
                  {submittingClass ? (editingClass ? 'Updating...' : 'Creating...') : (editingClass ? 'Update Class' : 'Create Class')}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* FIX: List of Upcoming Classes */}
        {upcomingClasses.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6 mb-3 sm:mb-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Your Scheduled Classes</h3>
            <div className="space-y-3">
              {upcomingClasses.map((cls) => (
                <div
                  key={cls._id}
                  className="p-4 bg-gray-50 dark:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-600"
                >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex-1">
                        <h4 className="font-bold text-gray-900 dark:text-white mb-1">{cls.title}</h4>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{cls.description}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
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
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* FIX: Edit and Delete buttons */}
                        <button
                          onClick={() => handleEditClass(cls)}
                          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors flex items-center space-x-1"
                          title="Edit Class"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          <span className="hidden sm:inline">Edit</span>
                        </button>
                        <button
                          onClick={() => handleDeleteClass(cls._id)}
                          className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors flex items-center space-x-1"
                          title="Delete Class"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          <span className="hidden sm:inline">Delete</span>
                        </button>
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
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Statistics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-3 sm:mb-4 flex-shrink-0">
          <div className="bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl shadow-lg p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-primary-100 text-xs font-medium mb-1">All Courses</p>
                <p className="text-2xl font-bold">{analytics?.totalCourses || allCourses.length}</p>
              </div>
              <svg className="w-8 h-8 text-primary-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
          </div>

          <div className="bg-gradient-to-br from-secondary-500 to-secondary-600 rounded-xl shadow-lg p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-secondary-100 text-xs font-medium mb-1">Total Lessons</p>
                <p className="text-2xl font-bold">{analytics?.totalLessons || 0}</p>
              </div>
              <svg className="w-8 h-8 text-secondary-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-xs font-medium mb-1">Total Students</p>
                <p className="text-2xl font-bold">{analytics?.totalStudents || 0}</p>
              </div>
              <svg className="w-8 h-8 text-green-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
          </div>

          <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl shadow-lg p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-yellow-100 text-xs font-medium mb-1">Enrollments</p>
                <p className="text-2xl font-bold">{analytics?.totalEnrollments || 0}</p>
              </div>
              <svg className="w-8 h-8 text-yellow-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
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

                      {/* Content Field */}
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
                                    className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
                                  >
                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    Upload
                                  </label>
                                </div>
                                
                                {/* URL Input - only show if no URL exists yet */}
                                {!aid.url && (
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
                                    placeholder="Paste image URL here or click in this area and paste an image (Ctrl+V / Cmd+V)"
                                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                                  />
                                )}
                                
                                {/* Show uploaded URL as read-only text when image is uploaded */}
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
                                    className="max-w-full h-32 object-contain rounded border border-gray-200 dark:border-gray-700"
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
                  </div>
                ) : showQuizForm ? (
                  <div className="p-6">
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
                                  onClick={() => {
                                    // Open lesson page with visual aids editor
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
                              {/* Lesson Type and Media */}
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
                              
                              {/* Resources */}
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

      {/* News Modal - View All Updates with Edit/Delete */}
      {showNewsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl shadow-2xl max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                  <svg className="w-6 h-6 mr-2 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                  Important Updates
                </h2>
                <div className="flex items-center space-x-2 w-full sm:w-auto">
                  <button
                    onClick={() => {
                      setShowNewsModal(false);
                      setEditingNews({ _id: null });
                      setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                    }}
                    className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors flex items-center justify-center space-x-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span>Post News</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowNewsModal(false);
                      setEditingNews(null);
                    }}
                    className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* News Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {newsItems.length === 0 ? (
                <div className="text-center py-8 sm:py-12">
                  <svg className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                  <p className="text-sm sm:text-base text-gray-500 dark:text-gray-400">No updates available at the moment</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {newsItems.map((news) => (
                    <div
                      key={news._id}
                      className="p-4 bg-gray-50 dark:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-600 hover:shadow-lg transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className="px-2 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-semibold rounded capitalize">
                          {news.category}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDistanceToNow(new Date(news.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-2">{news.title}</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3 mb-2">{news.description}</p>
                      {news.content && (
                        <p className="text-xs text-gray-500 dark:text-gray-500 line-clamp-2 mb-2">{news.content}</p>
                      )}
                      <div className="flex items-center justify-between mt-3">
                        {news.link && (
                          <a
                            href={news.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                          >
                            Read more →
                          </a>
                        )}
                        {/* Edit/Delete buttons */}
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => {
                              setEditingNews(news);
                              setNewsEditForm({
                                title: news.title,
                                description: news.description,
                                category: news.category,
                                content: news.content || '',
                                link: news.link || '',
                              });
                            }}
                            className="p-1.5 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition-colors"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm('Are you sure you want to delete this news update?')) return;
                              try {
                                await apiClient.delete(`/community/news/${news._id}`);
                                await loadNews();
                                alert('News deleted successfully');
                              } catch (error: any) {
                                alert(error.response?.data?.error || error.message || 'Failed to delete news');
                              }
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit/Create News Modal */}
      {editingNews && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl shadow-2xl max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
              <div className="flex items-center justify-between">
                <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                  {editingNews._id ? (
                    <svg className="w-6 h-6 mr-2 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6 mr-2 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                    </svg>
                  )}
                  {editingNews._id ? 'Edit Forex News Update' : 'Post Forex News Update'}
                </h2>
                <button
                  onClick={() => {
                    setEditingNews(null);
                    setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                  }}
                  className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Edit Form */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newsEditForm.title || !newsEditForm.description || !newsEditForm.category) {
                  alert('Please fill in all required fields');
                  return;
                }
                setSubmittingNews(true);
                try {
                  if (editingNews._id) {
                    await apiClient.put(`/community/news/${editingNews._id}`, newsEditForm);
                    alert('News updated successfully!');
                  } else {
                    await apiClient.post('/community/news', newsEditForm);
                    alert('News posted successfully!');
                  }
                  setEditingNews(null);
                  setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                  await loadNews();
                } catch (error: any) {
                  alert(error.response?.data?.error || error.message || `Failed to ${editingNews._id ? 'update' : 'post'} news`);
                } finally {
                  setSubmittingNews(false);
                }
              }}
              className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4"
            >
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newsEditForm.title}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, title: e.target.value })}
                  placeholder="e.g., NFP Results: 200K Jobs Added"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={newsEditForm.description}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, description: e.target.value })}
                  placeholder="Brief summary of the news update"
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={newsEditForm.category}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, category: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="market">Market News</option>
                  <option value="nfp">NFP Results</option>
                  <option value="cpi">CPI Data</option>
                  <option value="fomc">FOMC Updates</option>
                  <option value="announcement">Announcement</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Content (Optional)
                </label>
                <textarea
                  value={newsEditForm.content}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, content: e.target.value })}
                  placeholder="Detailed content or analysis"
                  rows={5}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Link (Optional)
                </label>
                <input
                  type="url"
                  value={newsEditForm.link}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, link: e.target.value })}
                  placeholder="https://example.com/article"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditingNews(null);
                    setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                  }}
                  className="w-full sm:w-auto px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-semibold transition-colors hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingNews}
                  className={`w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors ${
                    submittingNews ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {submittingNews ? (editingNews._id ? 'Updating...' : 'Posting...') : (editingNews._id ? 'Update News' : 'Post News')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
