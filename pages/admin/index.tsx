/**
 * Admin Panel
 * Course, lesson, and quiz management
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { useCourses } from '@/hooks/useCourses';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { formatDistanceToNow } from 'date-fns';

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
  // FIX: Added 'classes' tab for upcoming classes/events
  const getInitialTab = (): 'courses' | 'users' | 'instructors' | 'analytics' | 'approvals' | 'certificates' | 'classes' => {
    if (router.query.tab && typeof router.query.tab === 'string') {
      const validTabs = ['courses', 'users', 'instructors', 'analytics', 'approvals', 'certificates', 'classes'];
      if (validTabs.includes(router.query.tab)) {
        return router.query.tab as 'courses' | 'users' | 'instructors' | 'analytics' | 'approvals' | 'certificates' | 'classes';
      }
    }
    return 'courses';
  };
  
  const [activeTab, setActiveTab] = useState<'courses' | 'users' | 'instructors' | 'analytics' | 'approvals' | 'certificates' | 'classes'>(getInitialTab());
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
  });
  const [submittingClass, setSubmittingClass] = useState(false);

  useEffect(() => {
    // Allow access for both admin and superadmin
    if (!authLoading && (!isAuthenticated || (user?.role !== 'admin' && user?.role !== 'superadmin'))) {
      router.push('/');
    }
  }, [isAuthenticated, authLoading, user, router]);

  // Sync activeTab with URL query params
  useEffect(() => {
    if (router.query.tab && typeof router.query.tab === 'string') {
      const validTabs = ['courses', 'users', 'instructors', 'analytics', 'approvals', 'certificates', 'classes'];
      if (validTabs.includes(router.query.tab)) {
        setActiveTab(router.query.tab as any);
      }
    }
  }, [router.query.tab]);

  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'superadmin') {
      loadAnalytics();
      loadUsers();
      loadInstructors();
      loadNews();
      loadUpcomingClasses();
      // Load pending approvals for all admins (Super Admin can approve, regular admins can see notifications)
      loadPendingUsers();
    }
  }, [user]);

  // Auto-refresh pending users every 30 seconds to show new requests
  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'superadmin') {
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
      console.error('Failed to load analytics:', error);
      let errorDetails: string | undefined;
      if (error && typeof error === 'object' && 'response' in error) {
        const apiError = error as { response?: { data?: unknown }; message?: string };
        errorDetails = apiError.response?.data ? String(apiError.response.data) : apiError.message;
      } else if (error instanceof Error) {
        errorDetails = error.message;
      }
      console.error('Error details:', errorDetails);
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
    try {
      const data = await apiClient.get<NewsItem[]>('/community/news');
      setNewsItems(data);
    } catch (error) {
      console.error('Failed to load news:', error);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await apiClient.get<User[]>('/admin/users');
      setUsers(data || []);
    } catch (error: unknown) {
      console.error('Failed to load users:', error);
      let errorDetails: string | undefined;
      if (error && typeof error === 'object' && 'response' in error) {
        const apiError = error as { response?: { data?: unknown }; message?: string };
        errorDetails = apiError.response?.data ? String(apiError.response.data) : apiError.message;
      } else if (error instanceof Error) {
        errorDetails = error.message;
      }
      console.error('Error details:', errorDetails);
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
      let errorMessage = 'Failed to update user role';
      if (error && typeof error === 'object' && 'response' in error) {
        const apiError = error as { response?: { data?: { error?: string } }; message?: string };
        errorMessage = apiError.response?.data?.error || apiError.message || errorMessage;
      } else if (error instanceof Error) {
        errorMessage = error.message || errorMessage;
      }
      alert(errorMessage);
      console.error('Update user role error:', error);
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
      const errorMessage = error.response?.data?.error || error.message || 'Failed to delete user';
      alert(errorMessage);
      console.error('Delete user error:', error);
    }
  };

  const loadInstructors = async () => {
    try {
      const data = await apiClient.get<User[]>('/instructors');
      setInstructors(data);
    } catch (error) {
      console.error('Failed to load instructors:', error);
    }
  };

  // FIX: Load upcoming classes
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
      await loadUpcomingClasses();
      alert('Class created successfully!');
    } catch (error: any) {
      alert(error.response?.data?.error || error.message || 'Failed to create class');
    } finally {
      setSubmittingClass(false);
    }
  };

  const loadPendingUsers = async () => {
    try {
      const data = await apiClient.get<User[]>('/admin/approvals');
      setPendingUsers(data);
    } catch (error) {
      console.error('Failed to load pending users:', error);
    }
  };

  const handleApproveUser = async (userId: string) => {
    try {
      await apiClient.post<ApiResponse>('/admin/approvals', { userId, action: 'approve' });
      await loadPendingUsers();
      await loadUsers(); // Refresh users list
      alert('User approved successfully');
    } catch (error: unknown) {
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
      alert(error.response?.data?.error || error.message || 'Failed to send certificate');
    } finally {
      setSendingCertificate(false);
    }
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post<ApiResponse>('/courses', courseForm);
      setShowCourseForm(false);
      setCourseForm({ title: '', description: '', category: '', difficulty: 'beginner', thumbnail: '' });
      refetch();
      alert('Course created successfully');
    } catch (error: any) {
      alert(error.message || 'Failed to create course');
    }
  };

  const handleDeleteCourse = async (courseId: string) => {
    if (!confirm('Are you sure you want to delete this course? This will also delete all associated lessons and cannot be undone.')) {
      return;
    }
    try {
      // Delete from backend
      await apiClient.delete<ApiResponse>(`/courses/${courseId}`);
      
      // Refetch courses to update the UI - ensure it's properly awaited
      await refetch();
      
      // Also reload analytics to update course counts
      await loadAnalytics();
      
      // Force router refresh to ensure UI updates
      router.replace(router.asPath, undefined, { shallow: true });
    } catch (error: any) {
      console.error('Failed to delete course:', error);
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
      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB');
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
      const response = await apiClient.post('/upload/instructor', formData);
      
      // FIX: Handle both 'url' and 'imageUrl' response formats
      const imageUrl = (response as any).url || (response as any).imageUrl;
      
      if (!imageUrl) {
        throw new Error('No image URL returned from server');
      }

      return imageUrl;
    } catch (error: any) {
      console.error('Upload error:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Failed to upload image';
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
  const isAdminOrSuperAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.email === 'madudamian25@gmail.com';
  // const isSuperAdmin = user?.role === 'superadmin' || user?.email === 'madudamian25@gmail.com';

  if (authLoading || !isAuthenticated || !isAdminOrSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />

      <div className="flex flex-1 relative">
        {/* Hide sidebar for Super Admin only */}
        {user?.role !== 'superadmin' && <Sidebar />}

        <main className={`flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 ${user?.role === 'superadmin' ? 'pt-20 lg:pt-8' : 'pt-20 lg:pt-8'}`}>
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-display font-bold text-gray-900 dark:text-white mb-2">Admin Panel</h1>
              <p className="text-gray-600 dark:text-gray-400">Manage courses, lessons, and view analytics</p>
            </div>
            {/* Community Navigation Link for Super Admin */}
            {user?.role === 'superadmin' && (
              <Link
                href="/community"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors flex items-center space-x-2 shadow-md"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span>Community</span>
              </Link>
            )}
          </div>
        </div>

        {/* Pending Approvals Notification Banner */}
        {pendingUsers.length > 0 && (
          <div className="mb-6 bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 border-l-4 border-yellow-500 dark:border-yellow-400 rounded-lg p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <h3 className="text-lg font-bold text-yellow-900 dark:text-yellow-200">
                    {pendingUsers.length} Pending {pendingUsers.length === 1 ? 'Request' : 'Requests'} for Approval
                  </h3>
                  <p className="text-sm text-yellow-800 dark:text-yellow-300 mt-1">
                    {pendingUsers.length === 1 
                      ? 'There is 1 instructor or admin registration waiting for approval.'
                      : `There are ${pendingUsers.length} instructor or admin registrations waiting for approval.`}
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
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-semibold transition-colors shadow-md"
                >
                  Review Now
                </button>
                <button
                  onClick={() => setPendingUsers([])}
                  className="text-yellow-800 dark:text-yellow-300 hover:text-yellow-900 dark:hover:text-yellow-200"
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

        {/* Tabs */}
        <div className="flex space-x-1 mb-8 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
          <button
                  onClick={() => {
                    setActiveTab('courses');
                    router.push('/admin?tab=courses', undefined, { shallow: true });
                  }}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'courses'
                ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Courses
          </button>
          <button
            onClick={() => {
              setActiveTab('users');
              router.push('/admin?tab=users', undefined, { shallow: true });
            }}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'users'
                ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Users
          </button>
          <button
            onClick={() => {
              setActiveTab('instructors');
              router.push('/admin?tab=instructors', undefined, { shallow: true });
            }}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'instructors'
                ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Instructors
          </button>
          <button
            onClick={() => {
              setActiveTab('analytics');
              router.push('/admin?tab=analytics', undefined, { shallow: true });
            }}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'analytics'
                ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Analytics
          </button>
          <button
            onClick={() => {
              setActiveTab('certificates');
              router.push('/admin?tab=certificates', undefined, { shallow: true });
            }}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'certificates'
                ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Certificates
          </button>
          <button
            onClick={() => {
              setActiveTab('approvals');
              router.push('/admin?tab=approvals', undefined, { shallow: true });
              loadPendingUsers();
            }}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all relative ${
              activeTab === 'approvals'
                ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Approvals
            {pendingUsers.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center animate-pulse">
                {pendingUsers.length}
              </span>
            )}
          </button>
          {/* FIX: Added Upcoming Classes tab */}
          <button
            onClick={() => {
              setActiveTab('classes');
              router.push('/admin?tab=classes', undefined, { shallow: true });
              loadUpcomingClasses();
            }}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'classes'
                ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Upcoming Classes
          </button>
        </div>

        {/* Courses Tab */}
        {activeTab === 'courses' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Manage Courses</h2>
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
                  <button type="submit" className="btn btn-primary">
                    Create Course
                  </button>
                </form>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {courses.map((course) => (
                <div key={course._id || course.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-lg transition-shadow">
                  <h3 className="text-xl font-bold text-gray-900 mb-2">{course.title}</h3>
                  <p className="text-sm text-gray-600 mb-4 line-clamp-2">{course.description}</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-500 capitalize">{course.difficulty}</span>
                    <div className="flex gap-2">
                      <Link
                        href={`/courses/${course._id || course.id}`}
                        className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold transition-colors"
                      >
                        Manage
                      </Link>
                      <button
                        onClick={() => {
                          const courseId = course._id || course.id;
                          if (courseId) {
                            handleDeleteCourse(courseId);
                          }
                        }}
                        className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-semibold transition-colors"
                      >
                        Delete
                      </button>
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
              <h2 className="text-2xl font-bold text-gray-900">Manage Instructors</h2>
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
                className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors shadow-sm"
              >
                {showInstructorForm ? 'Cancel' : '+ Add Instructor'}
              </button>
            </div>

            {showInstructorForm && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-6">
                  {editingInstructor ? 'Edit Instructor' : 'Add New Instructor'}
                </h3>
                <form onSubmit={handleCreateInstructor} className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Name</label>
                    <input
                      type="text"
                      value={instructorForm.name}
                      onChange={(e) => setInstructorForm({ ...instructorForm, name: e.target.value })}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Title/Expertise</label>
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
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
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
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Instructor Photo</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Upload an image from your computer (JPG, PNG, GIF - Max 5MB)
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
                    className="w-full px-6 py-4 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-xl font-bold text-lg transition-colors shadow-lg"
                  >
                    {uploadingImage ? 'Uploading...' : editingInstructor ? 'Update Instructor' : 'Create Instructor'}
                  </button>
                </form>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {instructors.length === 0 ? (
                <div className="col-span-full text-center py-12 bg-white rounded-2xl shadow-sm border border-gray-100">
                  <p className="text-gray-500 mb-4">No instructors added yet.</p>
                  <button
                    onClick={() => setShowInstructorForm(true)}
                    className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors"
                  >
                    Add Your First Instructor
                  </button>
                </div>
              ) : (
                instructors.map((instructor: any) => (
                  <div key={instructor._id || instructor.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-lg transition-shadow">
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
                        <div className="w-32 h-32 bg-gradient-to-br from-primary-500 to-secondary-500 rounded-full mx-auto flex items-center justify-center text-white text-4xl font-bold">
                          {instructor.name.charAt(0)}
                        </div>
                      )}
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2 text-center">{instructor.name}</h3>
                    <p className="text-primary-600 font-semibold mb-3 text-center text-sm">{instructor.title}</p>
                    <p className="text-gray-600 text-sm mb-4 line-clamp-3">{instructor.description}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditInstructor(instructor)}
                        className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteInstructor(instructor._id || instructor.id)}
                        className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-semibold transition-colors"
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
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">User Management</h2>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Name</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Email</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Role</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                          No users found
                        </td>
                      </tr>
                    ) : (
                      users.map((userItem: any) => (
                        <tr key={userItem._id || userItem.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900 dark:text-white">{userItem.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-600 dark:text-gray-400">{userItem.email}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <select
                              value={userItem.role}
                              onChange={(e) => handleUpdateUserRole(userItem._id || userItem.id, e.target.value)}
                              className="px-3 py-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={userItem.email === 'madudamian25@gmail.com' || userItem.role === 'superadmin'}
                              title={userItem.email === 'madudamian25@gmail.com' || userItem.role === 'superadmin' ? 'Cannot change Super Admin role' : ''}
                            >
                              <option value="student">Student</option>
                              <option value="instructor">Instructor</option>
                              <option value="admin">Admin</option>
                              {userItem.email === 'madudamian25@gmail.com' && <option value="superadmin">Super Admin</option>}
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
                            <button
                              onClick={() => handleDeleteUser(userItem._id || userItem.id)}
                              className="px-3 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg font-medium transition-colors dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={userItem.email === 'madudamian25@gmail.com' || userItem.role === 'superadmin' || (user && user.id === (userItem._id || userItem.id))}
                              title={
                                userItem.email === 'madudamian25@gmail.com' || userItem.role === 'superadmin'
                                  ? 'Cannot delete Super Admin'
                                  : user && user.id === (userItem._id || userItem.id)
                                  ? 'Cannot delete your own account'
                                  : 'Delete user'
                              }
                            >
                              Delete
                            </button>
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
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Real-Time Analytics</h2>
            
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-3xl font-bold mb-1">{analytics.totalUsers || 0}</div>
                <div className="text-primary-100 text-xs font-medium">Total Users</div>
              </div>
              <div className="bg-gradient-to-br from-secondary-500 to-secondary-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-3xl font-bold mb-1">{analytics.totalCourses || 0}</div>
                <div className="text-secondary-100 text-xs font-medium">Total Courses</div>
              </div>
              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-3xl font-bold mb-1">{analytics.totalEnrollments || 0}</div>
                <div className="text-green-100 text-xs font-medium">Enrollments</div>
              </div>
              <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-3xl font-bold mb-1">{analytics.activeUsers || 0}</div>
                <div className="text-yellow-100 text-xs font-medium">Active (7d)</div>
              </div>
              <div className="bg-gradient-to-br from-accent-500 to-accent-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-3xl font-bold mb-1">{analytics.recentMessages || 0}</div>
                <div className="text-accent-100 text-xs font-medium">Messages (24h)</div>
              </div>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* User Roles Distribution - Pie Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">User Roles Distribution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Students', value: analytics.usersByRole?.student || 0, color: '#3B82F6' },
                        { name: 'Instructors', value: analytics.usersByRole?.instructor || 0, color: '#10B981' },
                        { name: 'Admins', value: analytics.usersByRole?.admin || 0, color: '#F59E0B' },
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {[
                        { name: 'Students', value: analytics.usersByRole?.student || 0, color: '#3B82F6' },
                        { name: 'Instructors', value: analytics.usersByRole?.instructor || 0, color: '#10B981' },
                        { name: 'Admins', value: analytics.usersByRole?.admin || 0, color: '#F59E0B' },
                      ].map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Course Difficulty Distribution - Bar Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Courses by Difficulty</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={[
                      { name: 'Beginner', courses: analytics.coursesByDifficulty?.beginner || 0 },
                      { name: 'Intermediate', courses: analytics.coursesByDifficulty?.intermediate || 0 },
                      { name: 'Advanced', courses: analytics.coursesByDifficulty?.advanced || 0 },
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    <XAxis dataKey="name" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="courses" fill="#3B82F6" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Enrollment Trends - Line Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Enrollment Trends (Last 7 Days)</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart
                    data={analytics.enrollmentTrends || [
                      { day: 'Mon', enrollments: 0 },
                      { day: 'Tue', enrollments: 0 },
                      { day: 'Wed', enrollments: 0 },
                      { day: 'Thu', enrollments: 0 },
                      { day: 'Fri', enrollments: 0 },
                      { day: 'Sat', enrollments: 0 },
                      { day: 'Sun', enrollments: 0 },
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    <XAxis dataKey="day" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="enrollments"
                      stroke="#10B981"
                      strokeWidth={2}
                      dot={{ fill: '#10B981', r: 4 }}
                      name="Enrollments"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Course Completion Rate - Bar Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Course Completion Rates</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={analytics.courseCompletion || [
                      { course: 'Course 1', completed: 0, enrolled: 0 },
                      { course: 'Course 2', completed: 0, enrolled: 0 },
                      { course: 'Course 3', completed: 0, enrolled: 0 },
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    <XAxis dataKey="course" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Bar dataKey="enrolled" fill="#3B82F6" name="Enrolled" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="completed" fill="#10B981" name="Completed" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Forex News Posting Section */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Forex News Updates</h3>
                <button
                  onClick={() => setShowNewsModal(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Post News</span>
                </button>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Share important Forex updates, market news, and announcements with the community
              </p>
            </div>
          </div>
        )}

        {/* Approvals Tab - All Admins */}
        {activeTab === 'approvals' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Pending Approvals</h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                  Review and approve/reject instructor and admin registrations
                </p>
              </div>
              <button
                onClick={loadPendingUsers}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors"
              >
                Refresh
              </button>
            </div>

            {pendingUsers.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
                <svg
                  className="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4"
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
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No Pending Approvals</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  All instructor and admin registrations have been reviewed.
                </p>
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-full">
                    <thead className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                          Name
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                          Email
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                          Role
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                          Registered
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {pendingUsers.map((pendingUser: any) => (
                        <tr
                          key={pendingUser.id}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        >
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-bold text-gray-900 dark:text-white">{pendingUser.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-600 dark:text-gray-400">{pendingUser.email}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                pendingUser.role === 'instructor'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                  : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                              }`}
                            >
                              {pendingUser.role.charAt(0).toUpperCase() + pendingUser.role.slice(1)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              {pendingUser.createdAt
                                ? new Date(pendingUser.createdAt).toLocaleDateString()
                                : 'N/A'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleApproveUser(pendingUser.id)}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleRejectUser(pendingUser.id)}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
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
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Send Certificates</h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Issue certificates to students by entering their ID or email address and selecting a course
              </p>
            </div>

            {/* Send Certificate Form */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <form onSubmit={handleSendCertificate} className="space-y-6">
                {/* Student Identifier Input */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Student ID or Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={certificateForm.studentIdentifier}
                    onChange={(e) => setCertificateForm({ ...certificateForm, studentIdentifier: e.target.value })}
                    placeholder="Enter student ID or email address"
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    You can enter either the student's MongoDB ID or their email address
                  </p>
                </div>

                {/* Course Selection */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Course <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={certificateForm.courseId}
                    onChange={(e) => setCertificateForm({ ...certificateForm, courseId: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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
                  <label htmlFor="sendEmail" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
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
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-1">How it works</h3>
                  <ul className="text-xs text-blue-800 dark:text-blue-300 space-y-1">
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
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Upcoming Classes & Events</h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Create and manage upcoming classes or events that will be visible to students on their dashboard
              </p>
            </div>

            {/* Create Class Form */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Create New Class/Event</h3>
              <form onSubmit={handleCreateClass} className="space-y-4">
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
                <button
                  type="submit"
                  disabled={submittingClass}
                  className="w-full md:w-auto px-6 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-colors"
                >
                  {submittingClass ? 'Creating...' : 'Create Class'}
                </button>
              </form>
            </div>

            {/* List of Upcoming Classes */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Scheduled Classes</h3>
              {upcomingClasses.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 dark:text-gray-400">No upcoming classes scheduled yet.</p>
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
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        </main>
      </div>

      {/* News Modal - View All Updates with Edit/Delete */}
      {showNewsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                  <svg className="w-6 h-6 mr-2 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors flex items-center space-x-2"
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
                  <p className="text-gray-500 dark:text-gray-400">No updates available at the moment</p>
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
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {news.createdAt ? formatDistanceToNow(new Date(news.createdAt as string | number | Date), { addSuffix: true }) : 'Unknown date'}
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
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold transition-colors flex items-center space-x-1 shadow-sm"
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
                                alert(error.response?.data?.error || error.message || 'Failed to delete news');
                              }
                            }}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold transition-colors flex items-center space-x-1 shadow-sm"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
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
                  alert(error.response?.data?.error || error.message || `Failed to ${editingNews._id ? 'update' : 'post'} news`);
                } finally {
                  setSubmittingNews(false);
                }
              }}
              className="flex-1 overflow-y-auto p-6 space-y-4"
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
                  className={`px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors ${
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

