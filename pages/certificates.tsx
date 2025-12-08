/**
 * Certificates Page - Enhanced Design
 * Role-based certificate management:
 * - Student: View and download their certificates
 * - Instructor: View certificates for students in their courses
 * - Admin: View all certificates, upload certificate templates per level, and analytics
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import BackButton from '@/components/BackButton';
import { useAuth } from '@/hooks/useAuth';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/lib/api-client';

interface Certificate {
  _id: string;
  userId: string;
  courseId: string;
  certificateId: string;
  issuedAt: string;
  progress: number;
  completedLessons: number;
  totalLessons: number;
  course?: {
    id: string;
    title: string;
    difficulty: string;
    category: string;
  };
  user?: {
    id: string;
    name: string;
    email: string;
  };
  instructor?: {
    id: string;
    name: string;
  };
}

interface CertificateTemplate {
  _id: string;
  level: string;
  fileUrl: string;
  filename: string;
  uploadedAt: string;
}

export default function Certificates() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const { socket, connected } = useSocket();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [templates, setTemplates] = useState<CertificateTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadLevel, setUploadLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filter, setFilter] = useState<{ courseId?: string; userId?: string; instructorId?: string }>({});

  // Fetch certificates and templates based on role
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }

    if (isAuthenticated && user) {
      fetchCertificates();
      if (user.role === 'admin') {
        fetchTemplates();
      }
    }
  }, [isAuthenticated, authLoading, user, filter]);

  // Real-time updates via Socket.io
  useEffect(() => {
    if (!socket || !connected || !user) return;

    if (user.role === 'student') {
      socket.on('courseCompleted', (data: { courseId: string; message: string }) => {
        fetchCertificates();
      });
    }

    if (user.role === 'instructor' || user.role === 'admin') {
      socket.on('certificateIssued', (data: { userId: string; courseId: string; certificateId: string }) => {
        fetchCertificates();
      });
    }

    return () => {
      socket.off('courseCompleted');
      socket.off('certificateIssued');
    };
  }, [socket, connected, user]);

  const fetchCertificates = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter.courseId) params.append('courseId', filter.courseId);
      if (filter.userId) params.append('userId', filter.userId);
      if (filter.instructorId) params.append('instructorId', filter.instructorId);
      
      const queryString = params.toString();
      const response = await apiClient.get<Certificate[]>(`/certificates${queryString ? `?${queryString}` : ''}`);
      setCertificates(response);
    } catch (error: any) {
      console.error('Fetch certificates error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const response = await apiClient.get<CertificateTemplate[]>('/certificates/templates');
      setTemplates(response);
    } catch (error: any) {
      console.error('Fetch templates error:', error);
    }
  };

  const handleUploadCertificate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      alert('Please select a file');
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append('certificate', selectedFile);
      formData.append('level', uploadLevel);

      const token = localStorage.getItem('token');
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          alert('Certificate template uploaded successfully!');
          setShowUploadForm(false);
          setSelectedFile(null);
          setUploadProgress(0);
          fetchTemplates();
        } else {
          alert('Upload failed');
        }
        setUploading(false);
      });

      xhr.addEventListener('error', () => {
        alert('Upload failed');
        setUploading(false);
      });

      xhr.open('POST', '/api/certificates/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    } catch (error: any) {
      alert('Upload failed: ' + error.message);
      setUploading(false);
    }
  };

  const handleDownload = async (certificateId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/certificates/${certificateId}/download`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      
      if (!response.ok) throw new Error('Download failed');
      
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `certificate-${data.certificateId}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      alert('Failed to download certificate');
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 dark:border-primary-400 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading certificates...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  // Student View - Enhanced Design
  if (user.role === 'student') {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <Header />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
          {/* Back Button */}
          <div className="mb-4">
            <BackButton href="/dashboard" />
          </div>

          <div className="mb-4 flex-shrink-0">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">My Certificates</h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm">Download certificates for your completed courses</p>
          </div>

          {certificates.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center min-h-[400px] flex items-center justify-center">
              <div>
                <div className="w-24 h-24 bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900 dark:to-primary-800 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-12 h-12 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">No Certificates Yet</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-6">Complete a course to earn your first certificate!</p>
                <Link href="/courses" className="inline-flex items-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all">
                  Browse Courses
                  <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {certificates.map((cert) => (
                <div key={cert._id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border-2 border-gray-200 dark:border-gray-700 p-4 hover:shadow-xl transition-all group">
                  {/* Enhanced Certificate Preview */}
                  <div className="bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600 rounded-xl p-6 mb-4 border-2 border-primary-300 dark:border-primary-700 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16"></div>
                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/10 rounded-full -ml-12 -mb-12"></div>
                    <div className="text-center relative z-10">
                      <div className="w-20 h-20 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white/30">
                        <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-bold text-white mb-2">Certificate of Completion</h3>
                      <p className="text-sm text-white/90 mb-1">{cert.course?.title}</p>
                      <p className="text-xs text-white/80">
                        {new Date(cert.issuedAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>

                  {/* Certificate Details */}
                  <div className="space-y-3 mb-6">
                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Certificate ID:</span>
                      <span className="font-mono text-xs text-gray-900 dark:text-white">{cert.certificateId}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Progress:</span>
                      <span className="font-bold text-green-600 dark:text-green-400">{Math.round(cert.progress)}%</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Lessons:</span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">{cert.completedLessons} / {cert.totalLessons}</span>
                    </div>
                  </div>

                  {/* Download Button */}
                  <button
                    onClick={() => handleDownload(cert._id)}
                    className="w-full px-6 py-3 bg-gradient-to-r from-primary-600 to-secondary-600 hover:from-primary-700 hover:to-secondary-700 text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all flex items-center justify-center"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Certificate
                  </button>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    );
  }

  // Instructor/Admin View - Enhanced Design
  const totalCertificates = certificates.length;
  const uniqueStudents = new Set(certificates.map(c => c.userId)).size;
  const uniqueCourses = new Set(certificates.map(c => c.courseId)).size;
  const thisMonth = certificates.filter(c => {
    const certDate = new Date(c.issuedAt);
    const now = new Date();
    return certDate.getMonth() === now.getMonth() && certDate.getFullYear() === now.getFullYear();
  }).length;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        {/* Back Button */}
        <div className="mb-4">
          <BackButton href={user?.role === 'instructor' ? '/instructor/dashboard' : '/admin'} />
        </div>

        <div className="mb-4 flex-shrink-0">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
            {user.role === 'admin' ? 'Certificate Management' : 'Student Certificates'}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            {user.role === 'admin'
              ? 'View all certificates, upload templates, and manage certificate issuance'
              : 'View certificates earned by your students'}
          </p>
        </div>

        {/* Admin: Certificate Upload Section */}
        {user.role === 'admin' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 mb-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Certificate Templates</h2>
              <button
                onClick={() => setShowUploadForm(!showUploadForm)}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors"
              >
                {showUploadForm ? 'Cancel' : '+ Upload Template'}
              </button>
            </div>

            {showUploadForm && (
              <form onSubmit={handleUploadCertificate} className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Course Level</label>
                    <select
                      value={uploadLevel}
                      onChange={(e) => setUploadLevel(e.target.value as 'beginner' | 'intermediate' | 'advanced')}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Certificate File</label>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                      required
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Max 10MB, JPG, PNG, GIF, or PDF</p>
                  </div>
                </div>
                {uploadProgress > 0 && uploadProgress < 100 && (
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                    <div className="bg-primary-600 h-2.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }}></div>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={uploading || !selectedFile}
                  className="w-full px-6 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white rounded-xl font-bold transition-colors"
                >
                  {uploading ? `Uploading... ${uploadProgress}%` : 'Upload Certificate Template'}
                </button>
              </form>
            )}

            {/* Templates List */}
            {templates.length > 0 && (
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Uploaded Templates</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {templates.map((template) => (
                    <div key={template._id} className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 border border-gray-200 dark:border-gray-600">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white capitalize">{template.level}</span>
                        <a href={template.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline text-sm">
                          View
                        </a>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{template.filename}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 mb-4 flex-shrink-0">
          <h3 className="text-base font-bold text-gray-900 dark:text-white mb-3">Filters</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Filter by Course</label>
              <input
                type="text"
                placeholder="Course ID..."
                value={filter.courseId || ''}
                onChange={(e) => setFilter({ ...filter, courseId: e.target.value || undefined })}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500"
              />
            </div>
            {user.role === 'admin' && (
              <>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Filter by Student</label>
                  <input
                    type="text"
                    placeholder="Student ID..."
                    value={filter.userId || ''}
                    onChange={(e) => setFilter({ ...filter, userId: e.target.value || undefined })}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Filter by Instructor</label>
                  <input
                    type="text"
                    placeholder="Instructor ID..."
                    value={filter.instructorId || ''}
                    onChange={(e) => setFilter({ ...filter, instructorId: e.target.value || undefined })}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Summary Stats (Admin only) */}
        {user.role === 'admin' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 flex-shrink-0">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-xs font-medium mb-1">Total Certificates</p>
                  <p className="text-2xl font-bold">{totalCertificates}</p>
                </div>
                <svg className="w-8 h-8 text-blue-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
              </div>
            </div>
            <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-xs font-medium mb-1">Unique Students</p>
                  <p className="text-2xl font-bold">{uniqueStudents}</p>
                </div>
                <svg className="w-8 h-8 text-green-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
            </div>
            <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-purple-100 text-xs font-medium mb-1">Unique Courses</p>
                  <p className="text-2xl font-bold">{uniqueCourses}</p>
                </div>
                <svg className="w-8 h-8 text-purple-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
            </div>
            <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl shadow-lg p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-orange-100 text-xs font-medium mb-1">This Month</p>
                  <p className="text-2xl font-bold">{thisMonth}</p>
                </div>
                <svg className="w-8 h-8 text-orange-200 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* Certificates List */}
        {certificates.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center min-h-[400px] flex items-center justify-center">
            <p className="text-gray-600 dark:text-gray-400">No certificates found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {certificates.map((cert) => (
              <div key={cert._id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-xl transition-all">
                <div className="mb-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{cert.course?.title || 'Unknown Course'}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 capitalize">{cert.course?.difficulty} • {cert.course?.category}</p>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <span className="text-gray-600 dark:text-gray-400">Student:</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{cert.user?.name || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between text-sm p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <span className="text-gray-600 dark:text-gray-400">Issued:</span>
                    <span className="text-gray-900 dark:text-white">
                      {new Date(cert.issuedAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <span className="text-gray-600 dark:text-gray-400">Certificate ID:</span>
                    <span className="font-mono text-xs text-gray-900 dark:text-white">{cert.certificateId}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownload(cert._id)}
                    className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold text-sm transition-colors"
                  >
                    Download
                  </button>
                  {user.role === 'admin' && (
                    <button
                      onClick={async () => {
                        if (confirm('Delete this certificate?')) {
                          try {
                            await apiClient.delete(`/certificates/${cert._id}`);
                            await fetchCertificates();
                          } catch (error: any) {
                            alert('Failed to delete certificate');
                          }
                        }
                      }}
                      className="px-4 py-2 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 rounded-xl font-semibold text-sm transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
