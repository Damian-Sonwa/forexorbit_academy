/**
 * Admin Panel
 * Course, lesson, and quiz management
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { useCourses } from '@/hooks/useCourses';

export default function AdminPanel() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const { courses, refetch } = useCourses();
  const [analytics, setAnalytics] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'courses' | 'users' | 'instructors' | 'analytics' | 'classes'>('courses');
  const [showClassForm, setShowClassForm] = useState(false);
  const [upcomingClasses, setUpcomingClasses] = useState<any[]>([]);
  const [classForm, setClassForm] = useState({
    title: '',
    description: '',
    date: '',
    time: '',
    link: '',
  });
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

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || user?.role !== 'admin')) {
      router.push('/');
    }
  }, [isAuthenticated, authLoading, user, router]);

  useEffect(() => {
    if (user?.role === 'admin') {
      loadAnalytics();
      loadUsers();
      loadInstructors();
      loadUpcomingClasses();
    }
  }, [user]);

  const loadUpcomingClasses = async () => {
    try {
      const data = await apiClient.get<any[]>('/classes');
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

  const loadAnalytics = async () => {
    try {
      const data = await apiClient.get('/admin/analytics');
      setAnalytics(data);
    } catch (error) {
      console.error('Failed to load analytics:', error);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await apiClient.get('/admin/users');
      setUsers(data);
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const handleUpdateUserRole = async (userId: string, newRole: string) => {
    try {
      await apiClient.put(`/admin/users/${userId}`, { role: newRole });
      await loadUsers();
    } catch (error: any) {
      alert(error.message || 'Failed to update user role');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }
    try {
      await apiClient.delete(`/admin/users/${userId}`);
      await loadUsers();
    } catch (error: any) {
      alert(error.message || 'Failed to delete user');
    }
  };

  const loadInstructors = async () => {
    try {
      const data = await apiClient.get('/instructors');
      setInstructors(data);
    } catch (error) {
      console.error('Failed to load instructors:', error);
    }
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/courses', courseForm);
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
      await apiClient.delete(`/courses/${courseId}`);
      refetch();
      alert('Course deleted successfully');
    } catch (error: any) {
      alert(error.message || 'Failed to delete course');
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

      const token = localStorage.getItem('token');
      const response = await fetch('/api/upload/instructor', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload image');
      }

      const data = await response.json();
      return data.url;
    } catch (error: any) {
      console.error('Upload error:', error);
      throw new Error(error.message || 'Failed to upload image');
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
        await apiClient.put(`/instructors/${editingInstructor}`, formData);
        alert('Instructor updated successfully');
      } else {
        await apiClient.post('/instructors', formData);
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
      await apiClient.delete(`/instructors/${instructorId}`);
      loadInstructors();
      alert('Instructor deleted successfully');
    } catch (error: any) {
      alert(error.message || 'Failed to delete instructor');
    }
  };

  if (authLoading || !isAuthenticated || user?.role !== 'admin') {
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
          <h1 className="text-4xl font-display font-bold text-gray-900 mb-2">Admin Panel</h1>
          <p className="text-gray-600">Manage courses, lessons, and view analytics</p>
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
            Courses
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'users'
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Users
          </button>
          <button
            onClick={() => setActiveTab('instructors')}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'instructors'
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Instructors
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
                        onClick={() => handleDeleteCourse(course._id || course.id)}
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
            <h2 className="text-2xl font-bold text-gray-900 mb-6">User Management</h2>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Name</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Email</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Role</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                          No users found
                        </td>
                      </tr>
                    ) : (
                      users.map((userItem: any) => (
                        <tr key={userItem._id || userItem.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{userItem.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-600">{userItem.email}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <select
                              value={userItem.role}
                              onChange={(e) => handleUpdateUserRole(userItem._id || userItem.id, e.target.value)}
                              className="px-3 py-1 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            >
                              <option value="student">Student</option>
                              <option value="instructor">Instructor</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <button
                              onClick={() => handleDeleteUser(userItem._id || userItem.id)}
                              className="px-3 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg font-medium transition-colors"
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
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Real-Time Analytics</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="bg-gradient-to-br from-primary-500 to-primary-600 rounded-2xl p-6 text-white shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                </div>
                <div className="text-4xl font-bold mb-1">{analytics.totalUsers}</div>
                <div className="text-primary-100 text-sm font-medium">Total Users</div>
              </div>
              <div className="bg-gradient-to-br from-secondary-500 to-secondary-600 rounded-2xl p-6 text-white shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                </div>
                <div className="text-4xl font-bold mb-1">{analytics.totalCourses}</div>
                <div className="text-secondary-100 text-sm font-medium">Total Courses</div>
              </div>
              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl p-6 text-white shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
                <div className="text-4xl font-bold mb-1">{analytics.totalEnrollments}</div>
                <div className="text-green-100 text-sm font-medium">Total Enrollments</div>
              </div>
              <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-2xl p-6 text-white shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                </div>
                <div className="text-4xl font-bold mb-1">{analytics.activeUsers}</div>
                <div className="text-yellow-100 text-sm font-medium">Active Users (7d)</div>
              </div>
              <div className="bg-gradient-to-br from-accent-500 to-accent-600 rounded-2xl p-6 text-white shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                </div>
                <div className="text-4xl font-bold mb-1">{analytics.recentMessages}</div>
                <div className="text-accent-100 text-sm font-medium">Messages (24h)</div>
              </div>
            </div>
          </div>
        )}

        {/* Upcoming Classes Tab */}
        {activeTab === 'classes' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Upcoming Classes</h2>
              <button
                onClick={() => setShowClassForm(!showClassForm)}
                className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors shadow-sm"
              >
                {showClassForm ? 'Cancel' : '+ Post Class'}
              </button>
            </div>

            {showClassForm && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-6">Post Upcoming Class</h3>
                <form onSubmit={handleCreateClass} className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Class Title</label>
                    <input
                      type="text"
                      value={classForm.title}
                      onChange={(e) => setClassForm({ ...classForm, title: e.target.value })}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
                    <textarea
                      value={classForm.description}
                      onChange={(e) => setClassForm({ ...classForm, description: e.target.value })}
                      required
                      rows={4}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Date</label>
                      <input
                        type="date"
                        value={classForm.date}
                        onChange={(e) => setClassForm({ ...classForm, date: e.target.value })}
                        required
                        min={new Date().toISOString().split('T')[0]}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Time</label>
                      <input
                        type="time"
                        value={classForm.time}
                        onChange={(e) => setClassForm({ ...classForm, time: e.target.value })}
                        required
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Meeting Link (Optional)</label>
                    <input
                      type="url"
                      value={classForm.link}
                      onChange={(e) => setClassForm({ ...classForm, link: e.target.value })}
                      placeholder="https://meet.google.com/..."
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full px-6 py-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold text-lg transition-colors shadow-lg"
                  >
                    Post Class
                  </button>
                </form>
              </div>
            )}

            {upcomingClasses.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
                <p className="text-gray-500 mb-4">No upcoming classes posted yet.</p>
                <button
                  onClick={() => setShowClassForm(true)}
                  className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors"
                >
                  Post Your First Class
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {upcomingClasses.map((classItem: any) => (
                  <div key={classItem._id || classItem.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{classItem.title}</h3>
                    <p className="text-gray-600 text-sm mb-4">{classItem.description}</p>
                    <div className="text-sm text-gray-500 mb-2">
                      <strong>Date:</strong> {new Date(classItem.date).toLocaleDateString()}
                    </div>
                    <div className="text-sm text-gray-500 mb-4">
                      <strong>Time:</strong> {new Date(classItem.date).toLocaleTimeString()}
                    </div>
                    {classItem.link && (
                      <a
                        href={classItem.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold transition-colors"
                      >
                        View Link
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

