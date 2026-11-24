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
import { previewText } from '@/lib/plain-text';
import Link from 'next/link';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import PageHeader, { ReadoutStrip } from '@/components/ui/PageHeader';
import { PortalNav } from '@/components/instructor/portal/PortalShell';
import LoadingSpinner from '@/components/LoadingSpinner';
import RichTextEditor from '@/components/RichTextEditor';
import { useAuth } from '@/hooks/useAuth';
import { FEATURES } from '@/lib/config/features';
import { isAbortedRequest } from '@/lib/request-status';
import { canReadCourseLessons } from '@/lib/course-response';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/lib/api-client';
import { sanitizeHtml } from '@/lib/html-sanitizer';
import SafeExternalLink from '@/components/SafeExternalLink';
import { getLessonDescriptionHtml, hasVisibleHtml } from '@/lib/lesson-html';
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
  const [lessonForm, setLessonForm] = useState<Partial<Lesson>>({});
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
    courseId: '',
  });
  const [submittingClass, setSubmittingClass] = useState(false);
  const [showClassForm, setShowClassForm] = useState(false);
  const [editingClass, setEditingClass] = useState<any>(null);
  // Demo task submissions state
  const [demoSubmissions, setDemoSubmissions] = useState<any[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

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
      loadDemoSubmissions();
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

    // Real-time dashboard metrics updates
    socket.on('student_enrolled', (data: { courseId: string; instructorId?: string }) => {
      // Only refresh if it's for this instructor's course
      if (!data.instructorId || data.instructorId === user?.id) {
        loadAnalytics();
      }
    });

    socket.on('task_submitted', (data: { taskId: string; instructorId?: string }) => {
      // Only refresh if it's for this instructor's task
      if (!data.instructorId || data.instructorId === user?.id) {
        loadAnalytics();
        loadDemoSubmissions();
      }
    });

    socket.on('task_completed', (data: { taskId: string; instructorId?: string }) => {
      // Only refresh if it's for this instructor's task
      if (!data.instructorId || data.instructorId === user?.id) {
        loadAnalytics();
        loadDemoSubmissions();
      }
    });

    socket.on('course_progress_updated', (data: { courseId: string; instructorId?: string }) => {
      // Only refresh if it's for this instructor's course
      if (!data.instructorId || data.instructorId === user?.id) {
        loadAnalytics();
      }
    });

    return () => {
      socket.off('lessonUpdated');
      socket.off('quizUpdated');
      socket.off('student_enrolled');
      socket.off('task_submitted');
      socket.off('task_completed');
      socket.off('course_progress_updated');
    };
  }, [socket, connected, user, selectedCourse, editingQuiz]);

  const loadAllCourses = async () => {
    try {
      // Load ALL courses for instructors (full access)
      setAllCourses(courses as Course[]);
    } catch (error) {
      console.error('Failed to load courses:');
    }
  };

  const loadNews = async () => {
    if (!FEATURES.COMMUNITY) {
      setNewsItems([]);
      return;
    }
    try {
      const data = await apiClient.get('/community/news');
      setNewsItems(data as any[]);
    } catch (error) {
      if (isAbortedRequest(error)) return;
      console.error('Failed to load news');
    }
  };

  // FIX: Load upcoming classes for instructor
  const loadUpcomingClasses = async () => {
    try {
      const data = await apiClient.get<any[]>('/classes');
      setUpcomingClasses(data || []);
    } catch (error) {
      console.error('Failed to load upcoming classes:');
      setUpcomingClasses([]);
    }
  };

  // Load student demo task submissions
  const loadDemoSubmissions = async () => {
    try {
      setLoadingSubmissions(true);
      const data = await apiClient.get<any[]>('/demo-trading/submissions');
      setDemoSubmissions(data || []);
    } catch (error) {
      console.error('Failed to load demo submissions:');
      setDemoSubmissions([]);
    } finally {
      setLoadingSubmissions(false);
    }
  };

  // FIX: Handle creating a new class
  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingClass(true);
    try {
      await apiClient.post('/classes', classForm);
      setClassForm({ title: '', description: '', date: '', time: '', meetingLink: '', courseId: '' });
      setShowClassForm(false);
      setEditingClass(null);
      await loadUpcomingClasses();
      alert('Class created successfully!');
    } catch (error: any) {
      alert(error.response?.data?.message || error.response?.data?.error || error.message || 'Failed to create class');
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
      courseId: cls.courseId || '',
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
      setClassForm({ title: '', description: '', date: '', time: '', meetingLink: '', courseId: '' });
      setShowClassForm(false);
      setEditingClass(null);
      await loadUpcomingClasses();
      alert('Class updated successfully!');
    } catch (error: any) {
      alert(error.response?.data?.message || error.response?.data?.error || error.message || 'Failed to update class');
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
      alert(error.response?.data?.message || error.response?.data?.error || error.message || 'Failed to delete class');
    }
  };

  const loadAnalytics = async () => {
    try {
      const data = await apiClient.get('/instructor/analytics');
      setAnalytics(data as any);
    } catch (error: any) {
      console.error('[Instructor Dashboard] Failed to load analytics:');
      // Don't set fallback zeros - analytics will remain null and show loading/error state
      setAnalytics(null);
    }
  };

  const loadCourseLessons = async (courseId: string) => {
    const selected = allCourses.find((item) => (item._id || item.id) === courseId);
    if (!canReadCourseLessons(user?.role, user?.id, selected?.instructorId)) {
      setCourseLessons([]);
      return;
    }
    try {
      setLoading(true);
      const lessons = await apiClient.get<Lesson[]>(`/lessons?courseId=${courseId}`);
      setCourseLessons(lessons.sort((a, b) => a.order - b.order));
    } catch {
      setCourseLessons([]);
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

  const handleEditLesson = async (lesson: Lesson) => {
    setEditingLesson(lesson._id);
    try {
      const lessonDetails = await apiClient.get<any>(`/lessons/${lesson._id}`);
      const bodyHtml =
        lessonDetails.content ||
        lessonDetails.lessonSummary?.overview ||
        lessonDetails.lessonSummary?.summary ||
        lessonDetails.summary ||
        '';
      setLessonForm({
        title: lessonDetails.title || lesson.title,
        description:
          lessonDetails.description ||
          lessonDetails.summary ||
          lesson.description ||
          (lesson as any).summary ||
          '',
        videoUrl: lessonDetails.videoUrl || lesson.videoUrl || '',
        pdfUrl: lessonDetails.pdfUrl || lesson.pdfUrl || '',
        type: lessonDetails.type || lesson.type,
        order: lessonDetails.order || lesson.order,
        content: bodyHtml,
        resources: lessonDetails.resources || lesson.resources || [],
      });
    } catch (error) {
      const bodyHtml =
        lesson.content ||
        (lesson as any).lessonSummary?.overview ||
        (lesson as any).lessonSummary?.summary ||
        (lesson as any).summary ||
        '';
      setLessonForm({
        title: lesson.title,
        description: lesson.description || (lesson as any).summary || '',
        videoUrl: lesson.videoUrl || '',
        pdfUrl: lesson.pdfUrl || '',
        type: lesson.type,
        order: lesson.order,
        content: bodyHtml,
        resources: lesson.resources || [],
      });
    }
    setShowLessonForm(true);
  };

  const handleSaveLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourse || !editingLesson) return;

    try {
      setLoading(true);
      const existingLesson = await apiClient.get(`/lessons/${editingLesson}`);
      const existingLessonSummary = (existingLesson as any).lessonSummary || {};

      const payload: Record<string, unknown> = {
        title: lessonForm.title,
        description: lessonForm.description,
        videoUrl: lessonForm.videoUrl,
        pdfUrl: lessonForm.pdfUrl,
        type: lessonForm.type,
        order: lessonForm.order,
        content: lessonForm.content,
        resources: lessonForm.resources || [],
        courseId: selectedCourse,
        lessonSummary: {
          ...existingLessonSummary,
          overview: lessonForm.content ?? existingLessonSummary.overview ?? '',
          screenshots: [],
          updatedAt: new Date(),
        },
      };

      await apiClient.put(`/lessons/${editingLesson}`, payload);

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

      const lessonData: Record<string, unknown> = {
        title: lessonForm.title,
        description: lessonForm.description,
        videoUrl: lessonForm.videoUrl,
        pdfUrl: lessonForm.pdfUrl,
        type: lessonForm.type,
        order: lessonForm.order || courseLessons.length + 1,
        content: lessonForm.content,
        resources: lessonForm.resources || [],
        courseId: selectedCourse,
      };

      if (lessonForm.content) {
        lessonData.lessonSummary = {
          overview: lessonForm.content || '',
          screenshots: [],
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

  // Handle section-based navigation (e.g., ?section=courses)
  useEffect(() => {
    if (router.query.section === 'courses' && allCourses.length > 0) {
      // Scroll to course management section after a short delay to ensure DOM is ready
      setTimeout(() => {
        const courseSection = document.getElementById('course-management-section');
        if (courseSection) {
          courseSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 300);
    }
  }, [router.query.section, allCourses.length]);

  if (authLoading || !isAuthenticated || user?.role !== 'instructor') {
    return <LoadingSpinner message="Loading instructor dashboard..." fullScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      {/* Persistent Sidebar Layout - Sidebar remains visible across all instructor dashboard pages */}
      {/* Sidebar is NOT controlled by chat state, modal state, or consultation selection */}
      <div className="flex flex-1 overflow-hidden pt-14 lg:pt-0 lg:items-start">
        <Sidebar />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-6 sm:px-6 lg:px-10 lg:pt-10">
        <PageHeader
          kicker="Instructor workspace"
          title="Instructor Dashboard"
          lede="Manage your courses, lessons, and track student progress"
          className="!mb-6"
        />
        {/* Phase 12: the teaching portal's areas (overview, students, grading, activity, profile). */}
        <div className="mb-6"><PortalNav pathname={router.pathname} /></div>

        <ReadoutStrip
          className="mb-6"
          items={[
            { label: 'All Courses', value: analytics === null ? <span className="orbit-skeleton inline-block h-7 w-14 rounded-md" aria-label="Loading" /> : (analytics?.totalCourses ?? allCourses.length) },
            { label: 'Total Lessons', value: analytics === null ? <span className="orbit-skeleton inline-block h-7 w-14 rounded-md" aria-label="Loading" /> : (analytics?.totalLessons ?? 0) },
            { label: 'Total Students', value: analytics === null ? <span className="orbit-skeleton inline-block h-7 w-14 rounded-md" aria-label="Loading" /> : (analytics?.totalStudents ?? 0) },
            { label: 'Enrollments', value: analytics === null ? <span className="orbit-skeleton inline-block h-7 w-14 rounded-md" aria-label="Loading" /> : (analytics?.totalEnrollments ?? analytics?.enrolledStudents ?? 0) },
          ]}
        />

        {FEATURES.COMMUNITY && (
        <div className="card rounded-xl p-3 sm:p-4 mb-3 sm:mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <svg className="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
            </svg>
            <div>
              <h3 className="text-sm font-bold text-ink">Forex News Updates</h3>
              <p className="text-xs text-ink-muted">Share important updates with the community</p>
            </div>
          </div>
          <button
            onClick={() => setShowNewsModal(true)}
            className="btn btn-primary w-full sm:w-auto px-4 py-2 text-sm flex items-center justify-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Post News</span>
          </button>
        </div>
        )}

        {/* Consultation removed from dashboard - now only in sidebar page (/consultations/expert) */}

        {/* FIX: Upcoming Classes Section - Allow instructors to post upcoming classes */}
        <div className="card rounded-xl p-3 sm:p-4 mb-3 sm:mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <svg className="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div>
              <h3 className="text-sm font-bold text-ink">Upcoming Classes & Events</h3>
              <p className="text-xs text-ink-muted">Schedule classes that students can see on their dashboard</p>
            </div>
          </div>
          <button
            onClick={() => setShowClassForm(!showClassForm)}
            className="btn btn-primary w-full sm:w-auto"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>{showClassForm ? 'Cancel' : 'Post Class'}</span>
          </button>
        </div>

        {/* FIX: Class Creation Form */}
        {showClassForm && (
          <div className="card rounded-xl p-4 sm:p-6 mb-3 sm:mb-4">
            <h3 className="text-lg font-bold mb-4 text-ink">Create New Class/Event</h3>
            <form onSubmit={editingClass ? handleUpdateClass : handleCreateClass} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-2 text-ink-muted">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={classForm.title}
                    onChange={(e) => setClassForm({ ...classForm, title: e.target.value })}
                    placeholder="e.g., Advanced Trading Strategies Workshop"
                    className="input w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-ink-muted">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={classForm.date}
                    onChange={(e) => setClassForm({ ...classForm, date: e.target.value })}
                    className="input w-full"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2 text-ink-muted">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={classForm.description}
                  onChange={(e) => setClassForm({ ...classForm, description: e.target.value })}
                  placeholder="Describe the class or event..."
                  rows={3}
                  className="input w-full"
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-2 text-ink-muted">
                    Time <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="time"
                    value={classForm.time}
                    onChange={(e) => setClassForm({ ...classForm, time: e.target.value })}
                    className="input w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-ink-muted">
                    Meeting Link (Optional)
                  </label>
                  <input
                    type="url"
                    value={classForm.meetingLink}
                    onChange={(e) => setClassForm({ ...classForm, meetingLink: e.target.value })}
                    placeholder="https://meet.google.com/..."
                    className="input w-full"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2 text-ink-muted">
                  Course for enrolled students
                </label>
                <select
                  value={classForm.courseId}
                  onChange={(e) => setClassForm({ ...classForm, courseId: e.target.value })}
                  className="input w-full"
                >
                  <option value="">No course notification</option>
                  {courses.filter((course) => canReadCourseLessons(user?.role, user?.id, course.instructorId)).map((course) => (
                    <option key={course._id || course.id} value={course._id || course.id}>
                      {course.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                {editingClass && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingClass(null);
                      setClassForm({ title: '', description: '', date: '', time: '', meetingLink: '', courseId: '' });
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
                  className="btn btn-primary flex-1 md:w-auto px-6 py-3"
                >
                  {submittingClass ? (editingClass ? 'Updating...' : 'Creating...') : (editingClass ? 'Update Class' : 'Create Class')}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* FIX: List of Upcoming Classes */}
        {upcomingClasses.length > 0 && (
          <div className="card rounded-xl p-4 sm:p-6 mb-3 sm:mb-4">
            <h3 className="text-lg font-bold mb-4 text-ink">Your Scheduled Classes</h3>
            <div className="space-y-3">
              {upcomingClasses.map((cls) => (
                <div
                  key={cls._id}
                  className="p-4 bg-gray-50 dark:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-600"
                >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex-1">
                        <h4 className="font-bold mb-1 text-ink">{cls.title}</h4>
                        <p className="text-sm mb-2 text-ink-muted">{cls.description}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
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
                          className="btn btn-primary px-3 py-2 text-sm flex items-center space-x-1"
                          title="Edit Class"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          <span className="hidden sm:inline">Edit</span>
                        </button>
                        <button
                          onClick={() => handleDeleteClass(cls._id)}
                          className="btn btn-danger-quiet px-3"
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
                            className="btn btn-primary px-4 py-2 text-sm whitespace-nowrap"
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

        {/* Student Demo Task Submissions */}
        <div className="card rounded-xl p-4 sm:p-6 mb-3 sm:mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-ink">Student Demo Task Submissions</h3>
              <p className="text-sm text-ink-muted">View student submissions for your demo trading tasks</p>
            </div>
            <button
              onClick={loadDemoSubmissions}
              className="btn btn-primary px-4 py-2 text-sm flex items-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Refresh</span>
            </button>
          </div>

          {loadingSubmissions ? (
            <div className="text-center py-8">
              <p className="text-ink-muted">Loading submissions...</p>
            </div>
          ) : demoSubmissions.length > 0 ? (
            <div className="space-y-4">
              {demoSubmissions.map((submission) => (
                <div
                  key={submission._id}
                  className="p-4 bg-gray-50 dark:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-600"
                >
                  <div className="flex flex-col lg:flex-row gap-4">
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-bold text-ink">{submission.taskTitle}</h4>
                          <p className="text-sm text-ink-muted">
                            Submitted by: <span className="font-medium">{submission.studentName}</span> ({submission.studentEmail})
                          </p>
                        </div>
                        <span className={`px-3 py-1 rounded text-xs font-medium ${
                          submission.result === 'win' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-primary-400' :
                          submission.result === 'loss' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                          'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-200'
                        }`}>
                          {submission.result?.toUpperCase() || 'OPEN'}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
                        <div>
                          <p className="text-xs text-ink-muted">Pair</p>
                          <p className="font-medium text-ink">{submission.pair}</p>
                        </div>
                        <div>
                          <p className="text-xs text-ink-muted">Direction</p>
                          <p className="font-medium text-ink">{submission.direction?.toUpperCase()}</p>
                        </div>
                        <div>
                          <p className="text-xs text-ink-muted">Entry Price</p>
                          <p className="font-medium text-ink">{submission.entryPrice}</p>
                        </div>
                        <div>
                          <p className="text-xs text-ink-muted">P/L</p>
                          <p className={`font-medium ${
                            submission.profitLoss > 0 ? 'text-green-600 dark:text-green-400' :
                            submission.profitLoss < 0 ? 'text-red-600 dark:text-red-400' :
                            'text-gray-900 dark:text-white'
                          }`}>
                            {submission.profitLoss !== undefined ? `$${submission.profitLoss.toFixed(2)}` : '-'}
                          </p>
                        </div>
                      </div>

                      {submission.notes && (
                        <div className="card mt-3 p-3 rounded-lg">
                          <p className="text-xs mb-1 text-ink-muted">Notes</p>
                          <p className="text-sm whitespace-pre-wrap text-ink-muted">{submission.notes}</p>
                        </div>
                      )}

                      {submission.screenshot && (
                        <div className="mt-3">
                          <p className="text-xs mb-2 text-ink-muted">Screenshot</p>
                          <a
                            href={submission.screenshot}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block"
                          >
                            <img
                              src={submission.screenshot}
                              alt="Trade screenshot"
                              className="max-w-full h-auto max-h-64 rounded-lg border border-gray-300 dark:border-gray-600 hover:shadow-lg transition-shadow cursor-pointer"
                              onError={(e) => {
                                console.error('Failed to load screenshot:', submission.screenshot);
                                const img = e.target as HTMLImageElement;
                                img.style.display = 'none';
                                const errorDiv = document.createElement('div');
                                errorDiv.className = 'text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2';
                                errorDiv.textContent = 'Failed to load screenshot';
                                img.parentElement?.appendChild(errorDiv);
                              }}
                            />
                          </a>
                        </div>
                      )}

                      <p className="text-xs mt-3 text-ink-muted">
                        Submitted: {new Date(submission.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-ink-muted">No student submissions yet.</p>
              <p className="text-sm mt-2 text-ink-muted">
                Students will appear here when they submit demo trading tasks assigned by you.
              </p>
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div id="course-management-section" className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Left Panel: Courses by Level */}
          <div className="card lg:col-span-1 rounded-xl">
            <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800 z-10">
              <h2 className="text-lg sm:text-xl font-bold text-ink">All Courses</h2>
              <button
                onClick={() => void router.push('/builder/new')}
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
                        {canReadCourseLessons(user?.role, user?.id, course.instructorId) ? (
                        <Link
                          href={`/builder/${course._id || course.id}`}
                          className="w-full text-left p-3 block hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded transition-colors"
                        >
                          <p className="font-semibold text-sm text-ink">{previewText(course.title)}</p>
                          <p className="text-xs mt-1 line-clamp-2 text-ink-muted">{previewText(course.description)}</p>
                        </Link>
                        ) : (
                        <div className="w-full text-left p-3 block rounded">
                          <p className="font-semibold text-sm text-ink">{previewText(course.title)}</p>
                          <p className="text-xs mt-1 line-clamp-2 text-ink-muted">{previewText(course.description)}</p>
                        </div>
                        )}
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
                        {canReadCourseLessons(user?.role, user?.id, course.instructorId) ? (
                        <Link
                          href={`/builder/${course._id || course.id}`}
                          className="w-full text-left p-3 block hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded transition-colors"
                        >
                          <p className="font-semibold text-sm text-ink">{previewText(course.title)}</p>
                          <p className="text-xs mt-1 line-clamp-2 text-ink-muted">{previewText(course.description)}</p>
                        </Link>
                        ) : (
                        <div className="w-full text-left p-3 block rounded">
                          <p className="font-semibold text-sm text-ink">{previewText(course.title)}</p>
                          <p className="text-xs mt-1 line-clamp-2 text-ink-muted">{previewText(course.description)}</p>
                        </div>
                        )}
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
                        {canReadCourseLessons(user?.role, user?.id, course.instructorId) ? (
                        <Link
                          href={`/builder/${course._id || course.id}`}
                          className="w-full text-left p-3 block hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded transition-colors"
                        >
                          <p className="font-semibold text-sm text-ink">{previewText(course.title)}</p>
                          <p className="text-xs mt-1 line-clamp-2 text-ink-muted">{previewText(course.description)}</p>
                        </Link>
                        ) : (
                        <div className="w-full text-left p-3 block rounded">
                          <p className="font-semibold text-sm text-ink">{previewText(course.title)}</p>
                          <p className="text-xs mt-1 line-clamp-2 text-ink-muted">{previewText(course.description)}</p>
                        </div>
                        )}
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
                  <p className="text-sm mb-3 text-ink-muted">No courses yet.</p>
                  <button
                    onClick={() => void router.push('/builder/new')}
                    className="btn btn-primary px-4 py-2 text-sm"
                  >
                    Create First Course
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: the selected course. Content is built in the shared course builder
              (/builder/:courseId), the same workspace administrators use. */}
          <div className="card lg:col-span-2 rounded-xl" data-testid="dashboard-course-panel">
            {!selectedCourse || !selectedCourseData ? (
              <div className="flex min-h-[300px] items-center justify-center p-6 sm:min-h-[400px] sm:p-12">
                <div className="px-4 text-center">
                  <p className="text-sm text-ink-muted sm:text-base">Select a course on the left, or start a new one.</p>
                  <Link href="/builder/new" className="btn btn-primary mt-4">Start a new course</Link>
                </div>
              </div>
            ) : (
              <div className="p-4 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="page-kicker">{(selectedCourseData as { status?: string }).status ? String((selectedCourseData as { status?: string }).status).replace('_', ' ') : 'course'}</p>
                    <h2 className="mt-1 break-words font-display text-xl font-semibold text-ink sm:text-2xl">{previewText(selectedCourseData.title)}</h2>
                    <p className="mt-1 text-xs capitalize text-ink-muted">{[selectedCourseData.difficulty, selectedCourseData.category, `${courseLessons.length} lesson${courseLessons.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Link href={`/builder/${selectedCourseData._id || selectedCourseData.id}`} className="btn btn-primary" data-testid="open-builder">Open in course builder</Link>
                    <Link href={`/builder/${selectedCourseData._id || selectedCourseData.id}/preview`} className="btn btn-secondary">Preview</Link>
                  </div>
                </div>
                <p className="mt-4 text-sm text-ink-muted">Edit details, modules, lessons, files, quizzes and activities in the course builder, preview the course as students see it, and submit it for review there.</p>
                {courseLessons.length > 0 ? (
                  <ol className="mt-5 divide-y divide-[var(--fo-line)] rounded-xl border border-line">
                    {courseLessons.map((lesson, index) => (
                      <li key={lesson._id} className="flex items-center gap-3 px-4 py-3 text-sm">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--fo-line-strong)] text-[11px] font-semibold text-ink-subtle num">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-ink">{previewText(lesson.title || '') || 'Untitled lesson'}</span>
                        <Link href={`/builder/${selectedCourseData._id || selectedCourseData.id}?lesson=${lesson._id}&rename=1`} className="shrink-0 py-2 text-xs font-semibold text-ink-muted hover:text-ink hover:underline" aria-label={`Rename ${previewText(lesson.title || '') || 'lesson'}`}>Rename</Link>
                        <Link href={`/builder/${selectedCourseData._id || selectedCourseData.id}?lesson=${lesson._id}`} className="shrink-0 py-2 text-xs font-semibold text-primary-600 hover:underline dark:text-primary-400">Edit</Link>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-5 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-subtle">No lessons yet. Open the builder to add modules and lessons.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* News Modal - View All Updates with Edit/Delete */}
      {showNewsModal && (
        <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="card rounded-xl sm:rounded-2xl shadow-2xl max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 bg-neutral-50 dark:bg-neutral-900">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <h2 className="text-xl sm:text-2xl font-bold flex items-center text-ink">
                  <svg className="w-6 h-6 mr-2 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    className="btn btn-primary flex-1 sm:flex-none px-4 py-2 text-sm flex items-center justify-center space-x-2"
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
                  <p className="text-sm sm:text-base text-ink-muted">No updates available at the moment</p>
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
                        <span className="text-xs text-ink-muted">
                          {formatDistanceToNow(new Date(news.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <h3 className="font-semibold text-sm mb-2 text-ink">{news.title}</h3>
                      <p className="text-xs line-clamp-3 mb-2 text-ink-muted">{news.description}</p>
                      {news.content && (
                        <p className="text-xs dark:text-gray-500 line-clamp-2 mb-2 text-ink-muted">{news.content}</p>
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
                            className="p-1.5 text-primary-600 hover:bg-neutral-100 dark:hover:bg-neutral-900/30 rounded transition-colors"
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
                                alert(error.response?.data?.message || error.response?.data?.error || error.message || 'Failed to delete news');
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
        <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="card rounded-xl sm:rounded-2xl shadow-2xl max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 bg-neutral-50 dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <h2 className="text-lg sm:text-xl md:text-2xl font-bold flex items-center text-ink">
                  {editingNews._id ? (
                    <svg className="w-6 h-6 mr-2 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6 mr-2 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  alert(error.response?.data?.message || error.response?.data?.error || error.message || `Failed to ${editingNews._id ? 'update' : 'post'} news`);
                } finally {
                  setSubmittingNews(false);
                }
              }}
              className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4"
            >
              <div>
                <label className="block text-sm font-semibold mb-2 text-ink-muted">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newsEditForm.title}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, title: e.target.value })}
                  placeholder="e.g., NFP Results: 200K Jobs Added"
                  className="input w-full"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2 text-ink-muted">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={newsEditForm.description}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, description: e.target.value })}
                  placeholder="Brief summary of the news update"
                  rows={3}
                  className="input w-full"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2 text-ink-muted">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={newsEditForm.category}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, category: e.target.value })}
                  className="input w-full"
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
                <label className="block text-sm font-semibold mb-2 text-ink-muted">
                  Content (Optional)
                </label>
                <textarea
                  value={newsEditForm.content}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, content: e.target.value })}
                  placeholder="Detailed content or analysis"
                  rows={5}
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2 text-ink-muted">
                  Link (Optional)
                </label>
                <input
                  type="url"
                  value={newsEditForm.link}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, link: e.target.value })}
                  placeholder="https://example.com/article"
                  className="input w-full"
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
                  className={`w-full sm:w-auto px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors ${
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
