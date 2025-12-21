/**
 * Task Detail Page
 * Students can view task details and submit their work
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { format } from 'date-fns';
import Image from 'next/image';

interface DemoTask {
  _id: string;
  title: string;
  description: string;
  instructions: string;
  assignedBy: string;
  assignedByName?: string;
  dueDate?: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  level?: 'beginner' | 'intermediate' | 'advanced';
}

interface TaskSubmission {
  _id: string;
  taskId: string;
  reasoning: string;
  screenshotUrls: string[];
  grade?: number | string | null;
  feedback?: string | null;
  reviewedAt?: string | null;
  submittedAt: string;
}

export default function TaskDetail() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const { id } = router.query;
  const [task, setTask] = useState<DemoTask | null>(null);
  const [submission, setSubmission] = useState<TaskSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Submission form state
  const [submissionForm, setSubmissionForm] = useState({
    reasoning: '',
    screenshot: '',
  });
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [submissionUploadError, setSubmissionUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!authLoading && isAuthenticated && user?.role !== 'student') {
      router.push('/dashboard');
      return;
    }
  }, [authLoading, isAuthenticated, user, router]);

  useEffect(() => {
    if (isAuthenticated && user?.role === 'student' && id) {
      loadTaskData();
    }
  }, [isAuthenticated, user, id]);

  const loadTaskData = async () => {
    try {
      setLoading(true);
      
      // Load task details
      const tasks = await apiClient.get<DemoTask[]>('/demo-trading/tasks');
      const foundTask = tasks.find(t => t._id === id);
      
      if (!foundTask) {
        alert('Task not found');
        router.push('/student-dashboard');
        return;
      }
      
      setTask(foundTask);

      // Load submission if exists
      try {
        const submissions = await apiClient.get<TaskSubmission[]>(
          `/demo-trading/submissions/student?taskId=${id}`
        );
        if (Array.isArray(submissions) && submissions.length > 0) {
          const studentSubmission = submissions.find(s => s.taskId === id);
          if (studentSubmission) {
            setSubmission(studentSubmission);
            // Pre-fill form with existing submission (read-only view)
            setSubmissionForm({
              reasoning: studentSubmission.reasoning || '',
              screenshot: studentSubmission.screenshotUrls?.[0] || '',
            });
            if (studentSubmission.screenshotUrls?.[0]) {
              setScreenshotPreview(studentSubmission.screenshotUrls[0]);
            }
          }
        }
      } catch (error) {
        // No submission yet, that's fine
        console.log('No submission found for this task');
      }
    } catch (error) {
      console.error('Failed to load task data:', error);
      alert('Failed to load task. Please try again.');
      router.push('/student-dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSubmissionUploadError(null);

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      setSubmissionUploadError('Invalid file type. Only JPG, JPEG, and PNG images are allowed.');
      e.target.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setSubmissionUploadError('File size must be less than 10MB');
      e.target.value = '';
      return;
    }

    try {
      setUploadingScreenshot(true);
      setSubmissionUploadError(null);
      
      const formData = new FormData();
      formData.append('file', file);

      const data = await apiClient.post<{ success: boolean; url: string; imageUrl?: string; filename: string }>(
        '/demo-trading/journal/upload',
        formData
      );

      const imageUrl = data.imageUrl || data.url;
      setSubmissionForm({ ...submissionForm, screenshot: imageUrl });
      setScreenshotPreview(imageUrl);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to upload screenshot';
      setSubmissionUploadError(errorMessage);
      console.error('Screenshot upload error:', error);
    } finally {
      setUploadingScreenshot(false);
    }
  };

  const handleSubmitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isSubmitting || !task) {
      return;
    }

    try {
      setIsSubmitting(true);
      
      const submissionData = {
        reasoning: submissionForm.reasoning.trim(),
        screenshotUrls: submissionForm.screenshot ? [submissionForm.screenshot] : [],
      };

      await apiClient.post(`/demo-trading/tasks/${task._id}/submit`, submissionData);
      
      // Reload task data to show updated submission
      await loadTaskData();
      
      alert('Task submitted successfully!');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to submit task';
      alert(errorMessage);
      console.error('Task submission error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || loading) {
    return <LoadingSpinner message="Loading task..." fullScreen />;
  }

  if (!isAuthenticated || user?.role !== 'student' || !task) {
    return null;
  }

  const hasSubmission = !!submission;
  const isGraded = submission?.grade !== null && submission?.grade !== undefined;
  const isReviewed = !!submission?.reviewedAt;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />

      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />

        <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:ml-0 pt-14 lg:pt-6 bg-white lg:bg-gray-50 overflow-y-auto w-full">
          {/* Back Button */}
          <div className="mb-4">
            <Link
              href="/student-dashboard"
              className="text-primary-600 hover:text-primary-700 font-medium text-sm flex items-center"
            >
              ← Back to Dashboard
            </Link>
          </div>

          {/* Task Header */}
          <div className="mb-6 bg-white rounded-xl shadow-md border border-gray-100 p-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{task.title}</h1>
                  {task.level && (
                    <span className={`px-3 py-1 rounded text-sm font-medium ${
                      task.level === 'beginner' ? 'bg-green-100 text-green-800' :
                      task.level === 'intermediate' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {task.level.charAt(0).toUpperCase() + task.level.slice(1)}
                    </span>
                  )}
                  {hasSubmission && (
                    <span className={`px-3 py-1 rounded text-sm font-medium ${
                      isGraded ? 'bg-green-100 text-green-800' :
                      isReviewed ? 'bg-blue-100 text-blue-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {isGraded ? 'Graded' : isReviewed ? 'Reviewed' : 'Submitted'}
                    </span>
                  )}
                </div>
                <p className="text-gray-600 mb-4">{task.description}</p>
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                  <span>Assigned by: {task.assignedByName || 'Instructor'}</span>
                  {task.dueDate && (
                    <span>Due: {format(new Date(task.dueDate), 'MMM dd, yyyy')}</span>
                  )}
                  <span>Created: {format(new Date(task.createdAt), 'MMM dd, yyyy')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Task Instructions */}
          {task.instructions && (
            <div className="mb-6 bg-blue-50 border-l-4 border-blue-400 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Instructions</h2>
              <div className="prose max-w-none">
                <p className="text-gray-700 whitespace-pre-line">{task.instructions}</p>
              </div>
            </div>
          )}

          {/* Submission Status / Feedback */}
          {hasSubmission && (
            <div className="mb-6 bg-white rounded-xl shadow-md border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Submission</h2>
              
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Reasoning / Analysis:</p>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-gray-700 whitespace-pre-wrap">{submission.reasoning}</p>
                </div>
              </div>

              {submission.screenshotUrls && submission.screenshotUrls.length > 0 && (
                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Screenshot:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {submission.screenshotUrls.map((url, index) => (
                      <div key={index} className="relative w-full h-64 rounded-lg overflow-hidden border border-gray-300">
                        <Image
                          src={url}
                          alt={`Screenshot ${index + 1}`}
                          fill
                          className="object-contain"
                          onError={(e) => {
                            console.error('Failed to load screenshot:', url);
                            const img = e.target as HTMLImageElement;
                            img.style.display = 'none';
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {submission.submittedAt && (
                <p className="text-sm text-gray-500 mb-4">
                  Submitted: {format(new Date(submission.submittedAt), 'MMM dd, yyyy HH:mm')}
                </p>
              )}

              {/* Instructor Feedback */}
              {(submission.grade || submission.feedback) && (
                <div className="mt-4 pt-4 border-t border-green-200 bg-green-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-green-800">Instructor Feedback</p>
                    {submission.grade && (
                      <span className="px-3 py-1 bg-green-600 text-white rounded-lg text-sm font-bold">
                        Grade: {submission.grade}
                      </span>
                    )}
                  </div>
                  {submission.feedback && (
                    <p className="text-sm text-gray-700 whitespace-pre-wrap mt-2">
                      {submission.feedback}
                    </p>
                  )}
                  {submission.reviewedAt && (
                    <p className="text-xs text-gray-500 mt-2">
                      Reviewed: {format(new Date(submission.reviewedAt), 'MMM dd, yyyy HH:mm')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Submission Form */}
          {!hasSubmission && (
            <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Submit Task</h2>
              
              <form onSubmit={handleSubmitTask} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reasoning / Analysis *
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    Explain your approach, analysis, or reasoning for completing this task
                  </p>
                  <textarea
                    required
                    value={submissionForm.reasoning}
                    onChange={(e) => setSubmissionForm({ ...submissionForm, reasoning: e.target.value })}
                    rows={6}
                    placeholder="Describe your approach, analysis, key observations, or reasoning for this task..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Screenshot (Optional)
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    Upload a screenshot of your demo trading activity related to this task (JPG, JPEG, or PNG only, max 10MB)
                  </p>
                  <div className="space-y-2">
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png"
                      onChange={handleScreenshotUpload}
                      disabled={uploadingScreenshot || isSubmitting}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    {uploadingScreenshot && (
                      <p className="text-sm text-blue-600 flex items-center">
                        <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></span>
                        Uploading screenshot...
                      </p>
                    )}
                    {submissionUploadError && (
                      <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                        {submissionUploadError}
                      </p>
                    )}
                    {screenshotPreview && !submissionUploadError && (
                      <div className="mt-2">
                        <div className="relative w-full h-48 rounded-lg overflow-hidden border border-gray-300">
                          <Image
                            src={screenshotPreview}
                            alt="Screenshot preview"
                            fill
                            className="object-contain"
                            onError={() => {
                              setSubmissionUploadError('Failed to load image preview. Please try uploading again.');
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setScreenshotPreview(null);
                            setSubmissionForm({ ...submissionForm, screenshot: '' });
                            setSubmissionUploadError(null);
                          }}
                          disabled={isSubmitting}
                          className="mt-2 text-sm text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Remove screenshot
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <Link
                    href="/student-dashboard"
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </Link>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                  >
                    {isSubmitting ? (
                      <>
                        <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                        Submitting...
                      </>
                    ) : (
                      'Submit Task'
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </main>
      </div>

      <Footer />
    </div>
  );
}

