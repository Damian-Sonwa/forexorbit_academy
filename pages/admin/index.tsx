/**
 * Admin Panel
 * Course, lesson, and quiz management
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import CourseCover from '@/components/CourseCover';
import CourseReassignDialog from '@/components/admin/CourseReassignDialog';
import { previewText } from '@/lib/plain-text';
import Sidebar from '@/components/Sidebar';
import { ReadoutStrip } from '@/components/ui/PageHeader';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { FEATURES } from '@/lib/config/features';
import { isAbortedRequest } from '@/lib/request-status';
import { apiClient } from '@/lib/api-client';
import { useCourses } from '@/hooks/useCourses';
import { formatDistanceToNow } from 'date-fns';
import dynamic from 'next/dynamic';

// recharts is only needed on the Analytics tab; load it with the charts instead of with the page.
const AdminAnalyticsCharts = dynamic(() => import('@/components/admin/AdminAnalyticsCharts'), {
  ssr: false,
  loading: () => <div className="h-[340px] rounded-xl orbit-skeleton" aria-hidden />,
});

interface Analytics {
  totalCourses?: number;
  totalLessons?: number;
  totalStudents?: number;
  totalEnrollments?: number;
  totalUsers?: number;
  activeUsers?: number;
  recentMessages?: number;
  usersByRole?: {
    student?: number;
    instructor?: number;
    admin?: number;
  };
  coursesByDifficulty?: {
    beginner?: number;
    intermediate?: number;
    advanced?: number;
  };
  enrollmentTrends?: Array<{ day: string; enrollments: number }>;
  courseCompletion?: Array<{ course: string; enrolled: number; completed: number }>;
  [key: string]: unknown;
}

interface User {
  _id?: string;
  name?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}

const COURSE_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  archived: 'Archived',
};

interface NewsItem {
  _id?: string;
  title?: string;
  description?: string;
  category?: string;
  content?: string;
  link?: string;
  [key: string]: unknown;
}

interface ApiResponse {
  success?: boolean;
  message?: string;
  [key: string]: unknown;
}

export default function AdminPanel() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const { courses, refetch } = useCourses();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  // Phase 12: the course being reassigned (audited handover dialog) and the last result message.
  const [reassigning, setReassigning] = useState<{ id: string; title: string } | null>(null);
  const [reassignNotice, setReassignNotice] = useState<string | null>(null);
  const [instructors, setInstructors] = useState<User[]>([]);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [showNewsModal, setShowNewsModal] = useState(false);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [editingNews, setEditingNews] = useState<NewsItem | null>(null);
  const [newsEditForm, setNewsEditForm] = useState({
    title: '',
    description: '',
    category: 'market',
    content: '',
    link: '',
  });
  const [submittingNews, setSubmittingNews] = useState(false);
  // Initialize activeTab from URL query or default to 'courses'
  // FIX: Added 'classes' tab for upcoming classes/events and 'consultations' for consultation requests
  const getInitialTab = (): 'courses' | 'users' | 'instructors' | 'analytics' | 'approvals' | 'certificates' | 'classes' | 'consultations' => {
    if (router.query.tab && typeof router.query.tab === 'string') {
      const validTabs = ['courses', 'users', 'instructors', 'analytics', 'approvals', 'certificates', 'classes', 'consultations'];
      if (validTabs.includes(router.query.tab)) {
        return router.query.tab as 'courses' | 'users' | 'instructors' | 'analytics' | 'approvals' | 'certificates' | 'classes' | 'consultations';
      }
    }
    return 'courses';
  };
  
  const [activeTab, setActiveTab] = useState<'courses' | 'users' | 'instructors' | 'analytics' | 'approvals' | 'certificates' | 'classes' | 'consultations'>(getInitialTab());
  const [certificateForm, setCertificateForm] = useState({
    studentIdentifier: '',
    courseId: '',
    sendEmail: false,
  });
  const [sendingCertificate, setSendingCertificate] = useState(false);
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [showInstructorForm, setShowInstructorForm] = useState(false);
  const [editingInstructor, setEditingInstructor] = useState<string | null>(null);
  const [courseForm, setCourseForm] = useState({
    title: '',
    description: '',
    category: '',
    difficulty: 'beginner',
    thumbnail: '',
    instructorId: '',
  });
  const [instructorForm, setInstructorForm] = useState({
    name: '',
    title: '',
    description: '',
    imageUrl: '',
  });
  const [uploadingImage, setUploadingImage] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
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
  const [editingClass, setEditingClass] = useState<any>(null);

  useEffect(() => {
    // Allow access for both admin and superadmin
    if (!authLoading && (!isAuthenticated || (user?.role !== 'admin' && user?.role !== 'superadmin'))) {
      router.push('/');
    }
  }, [isAuthenticated, authLoading, user, router]);

  // Sync activeTab with URL query params
  useEffect(() => {
    if (router.query.tab && typeof router.query.tab === 'string') {
      const validTabs = ['courses', 'users', 'instructors', 'analytics', 'approvals', 'certificates', 'classes', 'consultations'];
      if (validTabs.includes(router.query.tab)) {
        setActiveTab(router.query.tab as any);
      }
    }
  }, [router.query.tab]);

  // Approvals belong to the Super Admin; an ordinary admin following a link lands on Courses.
  useEffect(() => {
    if (activeTab === 'approvals' && user && user.role !== 'superadmin') setActiveTab('courses');
  }, [activeTab, user]);

  // Consultation requests state for admin
  const [consultationRequests, setConsultationRequests] = useState<any[]>([]);
  const [consultationSessions, setConsultationSessions] = useState<any[]>([]);
  const [loadingConsultations, setLoadingConsultations] = useState(false);

  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'superadmin') {
      loadAnalytics();
      loadUsers();
      loadInstructors();
      loadNews();
      loadUpcomingClasses();
      // Approvals are reserved for the Super Admin; ordinary admins neither see nor decide them.
      if (user.role === 'superadmin') loadPendingUsers();
      loadConsultationRequests();
      loadConsultationSessions();
    }
  }, [user]);

  // Load all consultation requests for admin
  const loadConsultationRequests = async () => {
    try {
      setLoadingConsultations(true);
      const data = await apiClient.get<any[]>('/consultations/requests');
      setConsultationRequests(data || []);
    } catch (error) {
      console.error('Failed to load consultation requests');
      setConsultationRequests([]);
    } finally {
      setLoadingConsultations(false);
    }
  };

  // Load all active consultation sessions for admin monitoring
  const loadConsultationSessions = async () => {
    try {
      // Get all sessions by fetching from API (admin can see all)
      const data = await apiClient.get<any[]>('/consultations/sessions');
      setConsultationSessions(data || []);
    } catch (error) {
      console.error('Failed to load consultation sessions');
      setConsultationSessions([]);
    }
  };

  // Handle accept/cancel consultation request (admin can manage any request)
  const handleConsultationAction = async (requestId: string, action: 'accept' | 'cancel') => {
    if (action === 'cancel' && !confirm('Are you sure you want to cancel this consultation request?')) {
      return;
    }

    setLoadingConsultations(true);
    try {
      await apiClient.put(`/consultations/requests/${requestId}`, { action });
      alert(action === 'accept' ? 'Request accepted! Consultation session created.' : 'Request cancelled.');
      await loadConsultationRequests();
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message || `Failed to ${action} request`;
      alert(errorMessage);
    } finally {
      setLoadingConsultations(false);
    }
  };

  // Auto-refresh pending users every 30 seconds to show new requests (Super Admin only)
  useEffect(() => {
    if (user?.role === 'superadmin') {
      const interval = setInterval(() => {
        loadPendingUsers();
      }, 30000); // Refresh every 30 seconds

      return () => clearInterval(interval);
    }
  }, [user]);

  const loadAnalytics = async () => {
    try {
      const data = await apiClient.get<Analytics>('/admin/analytics');
      setAnalytics(data);
    } catch (error: unknown) {
      console.error('Failed to load analytics');
      // Set default analytics on error
      setAnalytics({
        totalUsers: 0,
        totalCourses: 0,
        totalEnrollments: 0,
        activeUsers: 0,
        recentMessages: 0,
        usersByRole: { student: 0, instructor: 0, admin: 0 },
        coursesByDifficulty: { beginner: 0, intermediate: 0, advanced: 0 },
        enrollmentTrends: [],
        courseCompletion: [],
      });
    }
  };

  const loadNews = async () => {
    if (!FEATURES.COMMUNITY) {
      setNewsItems([]);
      return;
    }
    try {
      const data = await apiClient.get<NewsItem[]>('/community/news');
      setNewsItems(data);
    } catch (error) {
      if (isAbortedRequest(error)) return;
      console.error('Failed to load news');
    }
  };

  const loadUsers = async () => {
    try {
      const data = await apiClient.get<User[]>('/admin/users');
      setUsers(data || []);
    } catch (error: unknown) {
      console.error('Failed to load users');
      // Set empty array on error to prevent undefined issues
      setUsers([]);
    }
  };

  const handleUpdateUserRole = async (userId: string, newRole: string) => {
    if (!userId) {
      alert('Invalid user ID');
      return;
    }

    try {
      const response = await apiClient.put<ApiResponse>(`/admin/users/${userId}`, { role: newRole });
      await loadUsers();
      alert(response?.message || 'User role updated successfully');
    } catch (error: unknown) {
      if (decisionSavedWithoutAudit(error)) {
        await loadUsers();
        alert('The role was changed, but the audit entry could not be written. Do not repeat the change; report this to support.');
        return;
      }
      let errorMessage = 'Failed to update user role';
      if (error && typeof error === 'object' && 'response' in error) {
        const apiError = error as { response?: { data?: { message?: string; error?: string } }; message?: string };
        errorMessage = apiError.response?.data?.message || apiError.response?.data?.error || apiError.message || errorMessage;
      } else if (error instanceof Error) {
        errorMessage = error.message || errorMessage;
      }
      alert(errorMessage);
      console.error('Update user role error');
      // Reload users to revert the UI change if update failed
      await loadUsers();
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!userId) {
      alert('Invalid user ID');
      return;
    }

    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }
    
    try {
      const response = await apiClient.delete<ApiResponse>(`/admin/users/${userId}`);
      await loadUsers();
      alert(response?.message || 'User deleted successfully');
    } catch (error: any) {
      if (decisionSavedWithoutAudit(error)) {
        await loadUsers();
        alert('The account was deleted, but the audit entry could not be written. Do not repeat the deletion; report this to support.');
        return;
      }
      const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message || 'Failed to delete user';
      alert(errorMessage);
      console.error('Delete user error');
    }
  };

  const handleChangeUserStatus = async (userId: string, action: 'suspend' | 'reactivate') => {
    if (!userId) return;
    const reason = prompt(
      action === 'suspend'
        ? 'Reason for suspending this account (recorded in the audit log). The account is signed out everywhere.'
        : 'Reason for reactivating this account (recorded in the audit log).'
    );
    if (reason === null) return;
    try {
      const response = await apiClient.patch<ApiResponse>(`/admin/users/${userId}`, { action, reason });
      await loadUsers();
      alert(response?.message || (action === 'suspend' ? 'Account suspended.' : 'Account reactivated.'));
    } catch (error: unknown) {
      if (decisionSavedWithoutAudit(error)) {
        await loadUsers();
        alert('The change was saved, but the audit entry could not be written. Do not repeat it; report this to support.');
        return;
      }
      const e = error as { response?: { data?: { error?: string } }; message?: string };
      alert(e.response?.data?.error || e.message || 'Failed to change the account status');
    }
  };

  const loadInstructors = async () => {
    try {
      const data = await apiClient.get<User[]>('/instructors');
      setInstructors(data);
    } catch (error) {
      console.error('Failed to load instructors');
    }
  };

  // FIX: Load upcoming classes
  const loadUpcomingClasses = async () => {
    try {
      const data = await apiClient.get<any[]>('/classes');
      setUpcomingClasses(data || []);
    } catch (error) {
      console.error('Failed to load upcoming classes');
      setUpcomingClasses([]);
    }
  };

  // FIX: Handle creating a new class
  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingClass(true);
    try {
      await apiClient.post('/classes', classForm);
      setClassForm({ title: '', description: '', date: '', time: '', meetingLink: '', courseId: '' });
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
  };

  // FIX: Handle updating a class
  const handleUpdateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClass) return;
    setSubmittingClass(true);
    try {
      await apiClient.put(`/classes?id=${editingClass._id}`, classForm);
      setClassForm({ title: '', description: '', date: '', time: '', meetingLink: '', courseId: '' });
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

  const loadPendingUsers = async () => {
    try {
      const data = await apiClient.get<User[]>('/admin/approvals');
      setPendingUsers(data);
    } catch (error) {
      console.error('Failed to load pending users');
    }
  };

  /** The server saved the decision but could not write its audit entry (code audit_write_failed). */
  const decisionSavedWithoutAudit = (error: unknown) =>
    (error as { response?: { data?: { decisionSaved?: boolean } } })?.response?.data?.decisionSaved === true;

  const handleApproveUser = async (userId: string) => {
    try {
      await apiClient.post<ApiResponse>('/admin/approvals', { userId, action: 'approve' });
      await loadPendingUsers();
      await loadUsers(); // Refresh users list
      alert('User approved successfully');
    } catch (error: unknown) {
      if (decisionSavedWithoutAudit(error)) {
        await loadPendingUsers();
        await loadUsers();
        alert('The account was approved, but the audit entry could not be written. Do not repeat the decision; report this to support.');
        return;
      }
      let errorMessage = 'Failed to approve user';
      if (error instanceof Error) {
        errorMessage = error.message || errorMessage;
      }
      alert(errorMessage);
    }
  };

  const handleRejectUser = async (userId: string) => {
    if (!confirm('Are you sure you want to reject this user? This action cannot be undone.')) {
      return;
    }
    try {
      await apiClient.post<ApiResponse>('/admin/approvals', { userId, action: 'reject' });
      await loadPendingUsers();
      await loadUsers(); // Refresh users list
      alert('User rejected successfully');
    } catch (error: unknown) {
      if (decisionSavedWithoutAudit(error)) {
        await loadPendingUsers();
        await loadUsers();
        alert('The account was rejected, but the audit entry could not be written. Do not repeat the decision; report this to support.');
        return;
      }
      let errorMessage = 'Failed to reject user';
      if (error instanceof Error) {
        errorMessage = error.message || errorMessage;
      }
      alert(errorMessage);
    }
  };

  const handleSendCertificate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!certificateForm.studentIdentifier.trim() || !certificateForm.courseId) {
      alert('Please fill in all required fields');
      return;
    }

    setSendingCertificate(true);
    try {
      const response = await apiClient.post<ApiResponse>('/admin/send-certificate', {
        studentIdentifier: certificateForm.studentIdentifier.trim(),
        courseId: certificateForm.courseId,
        sendEmail: certificateForm.sendEmail,
      });

      alert(response.message || 'Certificate sent successfully!');
      setCertificateForm({
        studentIdentifier: '',
        courseId: '',
        sendEmail: false,
      });
    } catch (error: any) {
      alert(error.response?.data?.message || error.response?.data?.error || error.message || 'Failed to send certificate');
    } finally {
      setSendingCertificate(false);
    }
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post<ApiResponse>('/courses', courseForm);
      setShowCourseForm(false);
      setCourseForm({ title: '', description: '', category: '', difficulty: 'beginner', thumbnail: '', instructorId: '' });
      refetch();
      alert('Course created as a draft. The assigned instructor can now add lessons and submit it for review.');
    } catch (error: any) {
      alert(error.message || 'Failed to create course');
    }
  };

  /** Lifecycle change (POST /courses/:id/status); the server decides who may make which change. */
  const handleCourseStatus = async (courseId: string, status: string, question: string) => {
    if (!confirm(question)) return;
    try {
      await apiClient.post<ApiResponse>(`/courses/${courseId}/status`, { status });
      await refetch();
      await loadAnalytics();
    } catch (error: any) {
      alert(error.message || 'The course status could not be changed');
      await refetch();
    }
  };

  /**
   * Permanent deletion: Super Admin only, and refused by the server for any course with student,
   * payment or certificate records (archive those instead). Lessons, their quizzes and unused
   * assignments of the course are deleted with it; nothing else is.
   */
  const handleDeleteCourse = async (courseId: string) => {
    if (!confirm('Delete this course permanently? Its lessons, quizzes and unused assignments are deleted with it and this cannot be undone. A course with enrolments, payments or certificates cannot be deleted; archive it instead.')) {
      return;
    }
    try {
      await apiClient.delete<ApiResponse>(`/courses/${courseId}`);
      
      // Refetch courses to update the UI - ensure it's properly awaited
      await refetch();
      
      // Also reload analytics to update course counts
      await loadAnalytics();
      
      // Force router refresh to ensure UI updates
      router.replace(router.asPath, undefined, { shallow: true });
    } catch (error: any) {
      console.error('Failed to delete course');
      alert(error.message || 'Failed to delete course');
      // Refetch on error to ensure UI is in sync
      await refetch();
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }
      // Validate file size (2MB max)
      if (file.size > 2 * 1024 * 1024) {
        alert('Image size must be 2MB or less');
        return;
      }
      setSelectedImage(file);
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageUpload = async (): Promise<string> => {
    if (!selectedImage) {
      return instructorForm.imageUrl; // Return existing URL if no new image
    }

    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('image', selectedImage);

      // FIX: Use apiClient instead of fetch for consistent auth handling
      const response = await apiClient.post('/upload/instructor?kind=portrait', formData);
      
      // FIX: Handle both 'url' and 'imageUrl' response formats
      const imageUrl = (response as any).url || (response as any).imageUrl;
      
      if (!imageUrl) {
        throw new Error('No image URL returned from server');
      }

      return imageUrl;
    } catch (error: any) {
      console.error('Upload error');
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Failed to upload image';
      throw new Error(errorMessage);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleCreateInstructor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Upload image first if a new image is selected
      let imageUrl = instructorForm.imageUrl;
      if (selectedImage) {
        imageUrl = await handleImageUpload();
      }

      const formData = {
        ...instructorForm,
        imageUrl,
      };

      if (editingInstructor) {
        await apiClient.put<ApiResponse>(`/instructors/${editingInstructor}`, formData);
        alert('Instructor updated successfully');
      } else {
        await apiClient.post<ApiResponse>('/instructors', formData);
        alert('Instructor created successfully');
      }
      setShowInstructorForm(false);
      setEditingInstructor(null);
      setInstructorForm({ name: '', title: '', description: '', imageUrl: '' });
      setSelectedImage(null);
      setImagePreview('');
      loadInstructors();
    } catch (error: any) {
      alert(error.message || 'Failed to save instructor');
    }
  };

  const handleEditInstructor = (instructor: any) => {
    setEditingInstructor(instructor._id || instructor.id);
    setInstructorForm({
      name: instructor.name || '',
      title: instructor.title || '',
      description: instructor.description || '',
      imageUrl: instructor.imageUrl || '',
    });
    setSelectedImage(null);
    setImagePreview(instructor.imageUrl || '');
    setShowInstructorForm(true);
  };

  const handleDeleteInstructor = async (instructorId: string) => {
    if (!confirm('Are you sure you want to delete this instructor?')) {
      return;
    }
    try {
      await apiClient.delete<ApiResponse>(`/instructors/${instructorId}`);
      loadInstructors();
      alert('Instructor deleted successfully');
    } catch (error: any) {
      alert(error.message || 'Failed to delete instructor');
    }
  };

  // Check if user is admin or superadmin
  const isAdminOrSuperAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const isSuperAdmin = user?.role === 'superadmin';

  if (authLoading || !isAuthenticated || !isAdminOrSuperAdmin) {
    return <LoadingSpinner message="Loading admin panel..." fullScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="flex flex-1 relative">
        <Sidebar />

        <main className={`flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 ${user?.role === 'superadmin' ? 'pt-20 lg:pt-8' : 'pt-20 lg:pt-8'}`}>
        <div className="mb-8">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="page-kicker">Admin console</p>
              <h1 className="page-title mt-3">Admin Panel</h1>
              <p className="page-lede">Manage courses, lessons, and view analytics</p>
            </div>
            {/* Community Navigation Link for Super Admin */}
            {user?.role === 'superadmin' &&
              (FEATURES.COMMUNITY ? (
                <Link
                  href="/community"
                  className="btn btn-primary px-4 py-2 flex items-center space-x-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <span>Community</span>
                </Link>
              ) : (
                <div
                  className="px-4 py-2 bg-gray-400 dark:bg-gray-600 text-white rounded-lg font-semibold flex items-center space-x-2 shadow-md cursor-not-allowed opacity-90"
                  title="Coming soon"
                  aria-disabled
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <span>Community</span>
                  <span className="text-xs font-medium opacity-90">Soon</span>
                </div>
              ))}
            {user?.role === 'superadmin' && (
              <>
                <Link href="/consultations/expert" className="btn btn-secondary btn-sm">Publish hours</Link>
                <Link href="/consultations/admin" className="btn btn-secondary btn-sm">Approve experts</Link>
                <Link href="/admin/purchases" className="btn btn-secondary btn-sm">Course purchases</Link>
              </>
            )}
          </div>
        </div>

        {/* Pending Approvals Notification Banner (Super Admin only) */}
        {isSuperAdmin && pendingUsers.length > 0 && (
          <div className="notice notice-caution mb-6 !p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <svg className="w-6 h-6 text-caution mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <h3 className="text-base font-semibold text-ink">
                    {pendingUsers.length} Pending {pendingUsers.length === 1 ? 'Request' : 'Requests'} for Approval
                  </h3>
                  <p className="text-sm text-ink-muted mt-1">
                    {pendingUsers.length === 1
                      ? 'There is 1 registration waiting for your approval.'
                      : `There are ${pendingUsers.length} registrations waiting for your approval.`}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => {
                    setActiveTab('approvals');
                    router.push('/admin?tab=approvals', undefined, { shallow: true });
                    loadPendingUsers();
                  }}
                  className="btn btn-primary"
                >
                  Review Now
                </button>
                <button
                  onClick={() => setPendingUsers([])}
                  className="icon-btn"
                  aria-label="Dismiss notification"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sections are chosen from the sidebar (?tab=...); no second navigation bar on the page. */}

        {/* Courses Tab */}
        {activeTab === 'courses' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-ink">Manage Courses</h2>
              <button
                onClick={() => void router.push('/builder/new')}
                className="btn btn-primary px-6 py-3"
              >
                + Create Course
              </button>
            </div>

            {showCourseForm && (
              <div className="card rounded-2xl p-8 mb-8">
                <h3 className="text-2xl font-bold mb-6 text-ink">Create New Course</h3>
                <form onSubmit={handleCreateCourse} className="space-y-4">
                  <div>
                    <label className="label">Title</label>
                    <input
                      type="text"
                      value={courseForm.title}
                      onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })}
                      required
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">Description</label>
                    <textarea
                      value={courseForm.description}
                      onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })}
                      required
                      className="input"
                      rows={4}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Category</label>
                      <select
                        value={courseForm.category}
                        onChange={(e) => setCourseForm({ ...courseForm, category: e.target.value })}
                        required
                        className="input"
                      >
                        <option value="">Select category</option>
                        <option value="basics">Basics</option>
                        <option value="technical">Technical Analysis</option>
                        <option value="fundamental">Fundamental Analysis</option>
                        <option value="trading">Trading Strategies</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Difficulty</label>
                      <select
                        value={courseForm.difficulty}
                        onChange={(e) => setCourseForm({ ...courseForm, difficulty: e.target.value })}
                        required
                        className="input"
                      >
                        <option value="beginner">Beginner</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="advanced">Advanced</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-ink-muted" htmlFor="course-instructor">Instructor</label>
                    <select
                      id="course-instructor"
                      value={courseForm.instructorId}
                      onChange={(e) => setCourseForm({ ...courseForm, instructorId: e.target.value })}
                      required
                      className="input"
                    >
                      <option value="">Choose an active instructor</option>
                      {users
                        .filter((member) => member.role === 'instructor' && (!member.status || member.status === 'approved'))
                        .map((member) => (
                          <option key={member._id} value={member._id}>
                            {member.name || member.email}
                          </option>
                        ))}
                    </select>
                    <p className="mt-1 text-xs text-ink-muted">Only active instructor accounts can be assigned. The course starts as a draft.</p>
                  </div>
                  <button type="submit" className="btn btn-primary">
                    Create Course
                  </button>
                </form>
              </div>
            )}

            {reassignNotice && <p className="notice notice-brand mb-4 text-sm" role="status">{reassignNotice}</p>}
            {reassigning && (
              <CourseReassignDialog
                courseId={reassigning.id}
                courseTitle={reassigning.title}
                instructors={users.filter((member) => member.role === 'instructor' && (!member.status || member.status === 'approved')).map((member) => ({ _id: String(member._id), name: member.name, email: member.email }))}
                onClose={() => setReassigning(null)}
                onDone={(message) => { setReassigning(null); setReassignNotice(message); void refetch(); }}
              />
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {courses.map((course) => (
                <div key={course._id || course.id} className="card flex flex-col overflow-hidden rounded-2xl transition-shadow hover:shadow-raised">
                  <CourseCover course={course} aspect="aspect-[16/7]" />
                  <div className="flex flex-1 flex-col p-5">
                  <h3 className="mb-1.5 font-display text-lg font-semibold text-ink">{course.title}</h3>
                  <p className="mb-4 line-clamp-2 flex-1 text-sm text-ink-muted">{previewText(course.description)}</p>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="chip">{course.difficulty}</span>
                    <span className="chip" data-course-status={course.status || 'published'}>
                      {COURSE_STATUS_LABELS[course.status || 'published']}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/builder/${course._id || course.id}`}
                      className="btn btn-primary"
                    >
                      Manage
                    </Link>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setReassigning({ id: String(course._id || course.id), title: course.title })}
                      data-testid="reassign-open"
                    >
                      Reassign
                    </button>
                    {(() => {
                      const courseId = course._id || course.id;
                      if (!courseId) return null;
                      const status = course.status || 'published';
                      return (
                        <>
                          {status === 'in_review' && (
                            <>
                              <button type="button" className="btn btn-primary" onClick={() => handleCourseStatus(courseId, 'published', 'Publish this course? It becomes visible in the catalogue and open for enrolment and purchase.')}>
                                Publish
                              </button>
                              <button type="button" className="btn btn-secondary" onClick={() => handleCourseStatus(courseId, 'draft', 'Return this course to its instructor as a draft for changes?')}>
                                Return to draft
                              </button>
                            </>
                          )}
                          {status === 'published' && (
                            <button type="button" className="btn btn-secondary" onClick={() => handleCourseStatus(courseId, 'archived', 'Archive this course? It leaves the catalogue and takes no new enrolments or purchases. Students already enrolled keep their access, progress and certificates.')}>
                              Archive
                            </button>
                          )}
                          {status === 'archived' && (
                            <button type="button" className="btn btn-secondary" onClick={() => handleCourseStatus(courseId, 'published', 'Restore this course to the catalogue?')}>
                              Restore
                            </button>
                          )}
                          {user?.role === 'superadmin' && status !== 'published' && (
                            <button type="button" className="btn btn-danger-quiet" onClick={() => handleDeleteCourse(courseId)}>
                              Delete permanently
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Instructors Tab */}
        {activeTab === 'instructors' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-ink">Manage Instructors</h2>
              <button
                onClick={() => {
                  setShowInstructorForm(!showInstructorForm);
                  if (showInstructorForm) {
                    setEditingInstructor(null);
                    setInstructorForm({ name: '', title: '', description: '', imageUrl: '' });
                    setSelectedImage(null);
                    setImagePreview('');
                  }
                }}
                className="btn btn-primary px-6 py-3"
              >
                {showInstructorForm ? 'Cancel' : '+ Add Instructor'}
              </button>
            </div>

            {showInstructorForm && (
              <div className="card rounded-2xl p-8 mb-8">
                <h3 className="text-2xl font-bold mb-6 text-ink">
                  {editingInstructor ? 'Edit Instructor' : 'Add New Instructor'}
                </h3>
                <form onSubmit={handleCreateInstructor} className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-ink-muted">Name</label>
                    <input
                      type="text"
                      value={instructorForm.name}
                      onChange={(e) => setInstructorForm({ ...instructorForm, name: e.target.value })}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-ink-muted">Title/Expertise</label>
                    <input
                      type="text"
                      value={instructorForm.title}
                      onChange={(e) => setInstructorForm({ ...instructorForm, title: e.target.value })}
                      required
                      placeholder="e.g., Senior Forex Analyst"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-ink-muted">Description</label>
                    <textarea
                      value={instructorForm.description}
                      onChange={(e) => setInstructorForm({ ...instructorForm, description: e.target.value })}
                      required
                      rows={4}
                      placeholder="Brief description of instructor's expertise and experience"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-ink-muted">Instructor Photo</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="input w-full py-3 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
                    />
                    <p className="text-xs mt-1 text-ink-muted">
                      Upload an image from your computer (JPG, PNG, GIF - Max 2MB)
                    </p>
                    {(imagePreview || instructorForm.imageUrl) && (
                      <div className="mt-3">
                        <img
                          src={imagePreview || instructorForm.imageUrl}
                          alt="Preview"
                          className="w-32 h-32 object-cover rounded-full border-2 border-gray-200"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    {uploadingImage && (
                      <p className="text-sm text-primary-600 mt-2">Uploading image...</p>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={uploadingImage}
                    className="btn btn-primary w-full px-6 py-4 text-lg"
                  >
                    {uploadingImage ? 'Uploading...' : editingInstructor ? 'Update Instructor' : 'Create Instructor'}
                  </button>
                </form>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {instructors.length === 0 ? (
                <div className="card col-span-full text-center py-12 rounded-2xl">
                  <p className="mb-4 text-ink-muted">No instructors added yet.</p>
                  <button
                    onClick={() => setShowInstructorForm(true)}
                    className="btn btn-primary px-6 py-3"
                  >
                    Add Your First Instructor
                  </button>
                </div>
              ) : (
                instructors.map((instructor: any) => (
                  <div key={instructor._id || instructor.id} className="card rounded-2xl p-6 hover:shadow-lg transition-shadow">
                    <div className="text-center mb-4">
                      {instructor.imageUrl ? (
                        <img
                          src={instructor.imageUrl}
                          alt={instructor.name}
                          className="w-32 h-32 object-cover rounded-full mx-auto border-4 border-gray-200"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#e5e7eb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="48" fill="#9ca3af">${instructor.name.charAt(0)}</text></svg>`)}`;
                          }}
                        />
                      ) : (
                        <div className="w-32 h-32 bg-neutral-900 rounded-full mx-auto flex items-center justify-center text-white text-4xl font-bold">
                          {instructor.name.charAt(0)}
                        </div>
                      )}
                    </div>
                    <h3 className="text-xl font-bold mb-2 text-center text-ink">{instructor.name}</h3>
                    <p className="text-primary-600 font-semibold mb-3 text-center text-sm">{instructor.title}</p>
                    <p className="text-sm mb-4 line-clamp-3 text-ink-muted">{instructor.description}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditInstructor(instructor)}
                        className="btn btn-primary flex-1 px-4 py-2 text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteInstructor(instructor._id || instructor.id)}
                        className="btn btn-danger-quiet"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div>
            <h2 className="text-2xl font-bold mb-6 text-ink">User Management</h2>
            <div className="card rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table-orbit w-full">
                  <thead className="border-b border-gray-200 dark:border-gray-600">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Name</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Email</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Role</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Status</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="">
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-ink-muted">
                          No users found
                        </td>
                      </tr>
                    ) : (
                      users.map((userItem: any) => (
                        <tr key={userItem._id || userItem.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-ink">{userItem.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-ink-muted">{userItem.email}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <select
                              value={userItem.role}
                              onChange={(e) => handleUpdateUserRole(userItem._id || userItem.id, e.target.value)}
                              className="input text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={userItem.role === 'superadmin' || !isSuperAdmin}
                              title={
                                userItem.role === 'superadmin'
                                  ? 'Cannot change Super Admin role'
                                  : !isSuperAdmin
                                  ? 'Only the Super Admin can change roles'
                                  : ''
                              }
                            >
                              <option value="student">Student</option>
                              <option value="instructor">Instructor</option>
                              <option value="admin">Admin</option>
                              {userItem.role === 'superadmin' && <option value="superadmin">Super Admin</option>}
                            </select>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              userItem.status === 'approved' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' :
                              userItem.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' :
                              userItem.status === 'rejected' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' :
                              'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                              {userItem.status || 'approved'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {/* Suspending and reactivating are Super Admin only; the server refuses them for everyone else. */}
                            {isSuperAdmin && userItem.role !== 'superadmin' && user?.id !== (userItem._id || userItem.id) &&
                              ((userItem.status || 'approved') === 'approved' || userItem.status === 'suspended') && (
                              <button
                                onClick={() => handleChangeUserStatus(userItem._id || userItem.id, userItem.status === 'suspended' ? 'reactivate' : 'suspend')}
                                className="btn btn-secondary px-3 py-1 text-xs mr-2"
                              >
                                {userItem.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                              </button>
                            )}
                            {/* Deleting an account is Super Admin only; the server refuses it for everyone else. */}
                            {isSuperAdmin && (
                              <button
                                onClick={() => handleDeleteUser(userItem._id || userItem.id)}
                                className="btn btn-danger-quiet px-3 py-1 text-xs"
                                disabled={userItem.role === 'superadmin' || (user && user.id === (userItem._id || userItem.id))}
                                title={
                                  userItem.role === 'superadmin'
                                    ? 'Cannot delete Super Admin'
                                    : user && user.id === (userItem._id || userItem.id)
                                    ? 'Cannot delete your own account'
                                    : 'Delete user'
                                }
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && analytics && (
          <div className="space-y-6">
            <div><p className="page-kicker">Analytics</p><h2 className="section-title mt-2 !text-xl">Real-Time Analytics</h2></div>
            
            <ReadoutStrip
              items={[
                { label: 'Total Users', value: analytics.totalUsers || 0 },
                { label: 'Total Courses', value: analytics.totalCourses || 0 },
                { label: 'Enrollments', value: analytics.totalEnrollments || 0 },
                { label: 'Active (7d)', value: analytics.activeUsers || 0 },
                { label: 'Messages (24h)', value: analytics.recentMessages || 0 },
              ]}
            />

            {/* Charts Grid */}
            <AdminAnalyticsCharts analytics={analytics} />

            {FEATURES.COMMUNITY && (
            <div className="card rounded-xl p-6 mt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-ink">Forex News Updates</h3>
                <button
                  onClick={() => setShowNewsModal(true)}
                  className="btn btn-primary px-4 py-2 text-sm flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Post News</span>
                </button>
              </div>
              <p className="text-sm text-ink-muted">
                Share important Forex updates, market news, and announcements with the community
              </p>
            </div>
            )}
          </div>
        )}

        {/* Approvals Tab - Super Admin only */}
        {activeTab === 'approvals' && isSuperAdmin && (
          <div className="space-y-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold text-ink">Pending Approvals</h2>
                <p className="text-sm mt-1 text-ink-muted">
                  Review and approve or reject pending registrations
                </p>
              </div>
              <button
                onClick={loadPendingUsers}
                className="btn btn-primary px-4 py-2"
              >
                Refresh
              </button>
            </div>

            {pendingUsers.length === 0 ? (
              <div className="card rounded-xl p-12 text-center">
                <svg
                  className="w-16 h-16 mx-auto mb-4 text-ink-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <h3 className="text-xl font-bold mb-2 text-ink">No Pending Approvals</h3>
                <p className="text-ink-muted">
                  All instructor and admin registrations have been reviewed.
                </p>
              </div>
            ) : (
              <div className="card rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="table-orbit w-full min-w-full">
                    <thead className="">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-ink-muted">
                          Name
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-ink-muted">
                          Email
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-ink-muted">
                          Role
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-ink-muted">
                          Registered
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-ink-muted">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="">
                      {pendingUsers.map((pendingUser: any) => (
                        <tr
                          key={pendingUser.id}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        >
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-bold text-ink">{pendingUser.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-ink-muted">{pendingUser.email}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                pendingUser.role === 'instructor'
                                  ? 'bg-neutral-100 text-neutral-800 dark:bg-neutral-900 dark:text-primary-400'
                                  : 'bg-neutral-100 text-neutral-800 dark:bg-neutral-900 dark:text-primary-400'
                              }`}
                            >
                              {pendingUser.role.charAt(0).toUpperCase() + pendingUser.role.slice(1)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-ink-muted">
                              {pendingUser.createdAt
                                ? new Date(pendingUser.createdAt).toLocaleDateString()
                                : 'N/A'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleApproveUser(pendingUser.id)}
                                className="btn btn-primary"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleRejectUser(pendingUser.id)}
                                className="btn btn-danger-quiet"
                              >
                                Reject
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Certificates Tab - Send Certificates to Students */}
        {activeTab === 'certificates' && (
          <div className="space-y-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2 text-ink">Send Certificates</h2>
              <p className="text-sm text-ink-muted">
                Issue certificates to students by entering their ID or email address and selecting a course
              </p>
            </div>

            {/* Send Certificate Form */}
            <div className="card rounded-xl p-6">
              <form onSubmit={handleSendCertificate} className="space-y-6">
                {/* Student Identifier Input */}
                <div>
                  <label className="block text-sm font-semibold mb-2 text-ink-muted">
                    Student ID or Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={certificateForm.studentIdentifier}
                    onChange={(e) => setCertificateForm({ ...certificateForm, studentIdentifier: e.target.value })}
                    placeholder="Enter student ID or email address"
                    className="input w-full"
                    required
                  />
                  <p className="mt-2 text-xs text-ink-muted">
                    You can enter either the student's MongoDB ID or their email address
                  </p>
                </div>

                {/* Course Selection */}
                <div>
                  <label className="block text-sm font-semibold mb-2 text-ink-muted">
                    Course <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={certificateForm.courseId}
                    onChange={(e) => setCertificateForm({ ...certificateForm, courseId: e.target.value })}
                    className="input w-full"
                    required
                  >
                    <option value="">Select a course</option>
                    {courses.map((course) => (
                      <option key={course._id || course.id} value={course._id || course.id}>
                        {course.title} ({course.difficulty})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Email Notification Checkbox */}
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="sendEmail"
                    checked={certificateForm.sendEmail}
                    onChange={(e) => setCertificateForm({ ...certificateForm, sendEmail: e.target.checked })}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <label htmlFor="sendEmail" className="ml-2 text-sm text-ink-muted">
                    Send email notification to student (optional)
                  </label>
                </div>

                {/* Submit Button */}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={sendingCertificate}
                    className={`px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors ${
                      sendingCertificate ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    {sendingCertificate ? (
                      <span className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Sending...
                      </span>
                    ) : (
                      'Send Certificate'
                    )}
                  </button>
                </div>
              </form>
            </div>

            {/* Information Card */}
            <div className="bg-neutral-50 dark:bg-neutral-900/20 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-primary-600 dark:text-primary-400 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h3 className="text-sm font-semibold dark:text-primary-400 mb-1 text-ink">How it works</h3>
                  <ul className="text-xs dark:text-neutral-300 space-y-1 text-ink">
                    <li>• Enter the student's ID (MongoDB ObjectId) or email address</li>
                    <li>• Select the course for which to issue the certificate</li>
                    <li>• The certificate will be automatically assigned to the student</li>
                    <li>• Students can view and download their certificates from their Certificate page</li>
                    <li>• If a certificate already exists for this student and course, you'll be notified</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FIX: Upcoming Classes Tab - Allow admins to post upcoming classes/events */}
        {activeTab === 'classes' && (
          <div className="space-y-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2 text-ink">Upcoming Classes & Events</h2>
              <p className="text-sm text-ink-muted">
                Create and manage upcoming classes or events that will be visible to students on their dashboard
              </p>
            </div>

            {/* Create Class Form */}
            <div className="card rounded-xl p-6">
              <h3 className="text-xl font-bold mb-4 text-ink">Create New Class/Event</h3>
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
                    {courses.map((course) => (
                      <option key={course._id || course.id} value={course._id || course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={submittingClass}
                  className="btn btn-primary w-full md:w-auto px-6 py-3"
                >
                  {submittingClass ? (editingClass ? 'Saving...' : 'Creating...') : (editingClass ? 'Save Class' : 'Create Class')}
                </button>
              </form>
            </div>

            {/* List of Upcoming Classes */}
            <div className="card rounded-xl p-6">
              <h3 className="text-xl font-bold mb-4 text-ink">Scheduled Classes</h3>
              {upcomingClasses.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-ink-muted">No upcoming classes scheduled yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
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
                            <span className="flex items-center">
                              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              {cls.instructorName}
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
              )}
            </div>
          </div>
        )}

        {/* Consultation Requests Management Tab */}
        {activeTab === 'consultations' && (
          <div className="space-y-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2 text-ink">Consultation Requests Management</h2>
              <p className="text-sm text-ink-muted">
                View and manage consultation requests. Publish your own hours from Consultation availability.
              </p>
              <p className="mt-3 text-sm">
                <Link href="/consultations/expert" className="font-semibold text-primary-700 underline-offset-4 hover:underline">Publish weekly hours</Link>
                {user?.role === 'superadmin' ? (
                  <>
                    <span aria-hidden> · </span>
                    <Link href="/consultations/admin" className="font-semibold text-primary-700 underline-offset-4 hover:underline">Approve experts</Link>
                  </>
                ) : null}
              </p>
            </div>

            {loadingConsultations ? (
              <div className="text-center py-12">
                <p className="text-ink-muted">Loading consultation requests...</p>
              </div>
            ) : consultationRequests.length === 0 ? (
              <div className="text-center py-12">
                <svg className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-ink-muted">No consultation requests at the moment</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {consultationRequests.map((request) => (
                  <div
                    key={request._id}
                    className="card rounded-xl p-6"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            request.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-primary-400' :
                            request.status === 'accepted' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-primary-400' :
                            request.status === 'rejected' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                            request.status === 'cancelled' ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' :
                            'bg-neutral-100 text-neutral-800 dark:bg-neutral-900 dark:text-primary-400'
                          }`}>
                            {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                          </span>
                          <span className="text-xs text-ink-muted">
                            {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                          {/* Student Info */}
                          {request.student && (
                            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                              {request.student.profilePhoto && (
                                <img
                                  src={request.student.profilePhoto}
                                  alt={request.student.name}
                                  className="w-10 h-10 rounded-full"
                                />
                              )}
                              <div>
                                <p className="text-sm font-semibold text-ink">Student</p>
                                <p className="text-sm text-ink-muted">{request.student.name}</p>
                                <p className="text-xs dark:text-gray-500 text-ink-muted">{request.student.email}</p>
                              </div>
                            </div>
                          )}

                          {/* Expert/Instructor Info */}
                          {request.expert && (
                            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                              {request.expert.profilePhoto && (
                                <img
                                  src={request.expert.profilePhoto}
                                  alt={request.expert.name}
                                  className="w-10 h-10 rounded-full"
                                />
                              )}
                              <div>
                                <p className="text-sm font-semibold text-ink">Instructor</p>
                                <p className="text-sm text-ink-muted">{request.expert.name}</p>
                                <p className="text-xs dark:text-gray-500 text-ink-muted">{request.expert.email}</p>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="mb-3">
                          <p className="text-sm font-semibold mb-1 text-ink">Topic</p>
                          <p className="text-sm text-ink-muted">{request.topic}</p>
                        </div>

                        <div className="mb-3">
                          <p className="text-sm font-semibold mb-1 text-ink">Description</p>
                          <p className="text-sm text-ink-muted">{request.description}</p>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-ink-muted">
                          <span>
                            Type: <span className="capitalize font-semibold">{String(request.consultationType || 'consultation').replace('-', ' ')}</span>
                          </span>
                          {request.startsAt && (
                            <span>
                              When: <span className="font-semibold">{new Date(request.startsAt).toLocaleString()}</span>
                            </span>
                          )}
                          {request.lifecycle && (
                            <span>
                              State: <span className="font-semibold">{request.lifecycle}</span>
                            </span>
                          )}
                          {request.updatedAt && (
                            <span>
                              Updated: {formatDistanceToNow(new Date(request.updatedAt), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-col gap-2 lg:min-w-[200px]">
                        {request.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleConsultationAction(request._id, 'accept')}
                              disabled={loadingConsultations}
                              className="btn btn-primary w-full"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              <span>Accept</span>
                            </button>
                            <button
                              onClick={() => handleConsultationAction(request._id, 'cancel')}
                              disabled={loadingConsultations}
                              className="btn btn-danger-quiet w-full"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                              <span>Cancel</span>
                            </button>
                          </>
                        )}
                        {(request.status === 'accepted' || request.status === 'rejected') && (
                          <button
                            onClick={() => handleConsultationAction(request._id, 'cancel')}
                            disabled={loadingConsultations}
                            className="w-full px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            <span>Cancel</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        </main>
      </div>

      {/* News Modal - View All Updates with Edit/Delete */}
      {showNewsModal && (
        <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="card rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-neutral-50 dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold flex items-center text-ink">
                  <svg className="w-6 h-6 mr-2 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                  Important Updates
                </h2>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      setShowNewsModal(false);
                      setEditingNews(null);
                      setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                    }}
                    className="btn btn-primary px-4 py-2 text-sm flex items-center space-x-2"
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
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* News Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {newsItems.length === 0 ? (
                <div className="text-center py-12">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                  <p className="text-ink-muted">No updates available at the moment</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                          {news.createdAt ? formatDistanceToNow(new Date(news.createdAt as string | number | Date), { addSuffix: true }) : 'Unknown date'}
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
                        {/* Edit/Delete buttons - styled like community page */}
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setShowNewsModal(false);
                              // Use setTimeout to ensure modal closes before opening edit form
                              setTimeout(() => {
                                setEditingNews(news);
                                setNewsEditForm({
                                  title: news.title || '',
                                  description: news.description || '',
                                  category: news.category || 'market',
                                  content: news.content || '',
                                  link: news.link || '',
                                });
                              }, 100);
                            }}
                            className="px-3 py-1 bg-primary-600 hover:bg-primary-700 text-white rounded-md text-xs font-semibold transition-colors flex items-center space-x-1 shadow-sm"
                            title="Edit this update"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            <span>Edit</span>
                          </button>
                          <button
                            onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!confirm('Are you sure you want to delete this news update?')) return;
                              try {
                                await apiClient.delete<ApiResponse>(`/community/news/${news._id}`);
                                await loadNews();
                                setShowNewsModal(false);
                                alert('News deleted successfully');
                              } catch (error: any) {
                                alert(error.response?.data?.message || error.response?.data?.error || error.message || 'Failed to delete news');
                              }
                            }}
                            className="btn btn-danger-quiet px-3 py-1 text-xs"
                            title="Delete this update"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span>Delete</span>
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
        <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="card rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-neutral-50 dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold flex items-center text-ink">
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
                    await apiClient.put<ApiResponse>(`/community/news/${editingNews._id}`, newsEditForm);
                    alert('News updated successfully!');
                  } else {
                    await apiClient.post<ApiResponse>('/community/news', newsEditForm);
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
              className="flex-1 overflow-y-auto p-6 space-y-4"
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

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditingNews(null);
                    setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                  }}
                  className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-semibold transition-colors hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingNews}
                  className={`px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors ${
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

      <Footer />
    </div>
  );
}

