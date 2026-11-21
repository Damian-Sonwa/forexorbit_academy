/**
 * Review Submission Component
 * Allows instructors to grade and provide feedback on submissions
 */

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { apiClient } from '@/lib/api-client';
import { format } from 'date-fns';
import LoadingSpinner from '@/components/LoadingSpinner';
import { Bot, Lightbulb } from 'lucide-react';

interface Submission {
  _id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  taskId: string;
  taskTitle: string;
  reasoning: string;
  screenshotUrls: string[];
  submittedAt: string;
  grade?: number | string | null;
  feedback?: string | null;
  reviewedAt?: string | null;
}

export default function ReviewSubmission() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState({
    grade: '',
    feedback: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [draftingFeedback, setDraftingFeedback] = useState<string | null>(null);

  useEffect(() => {
    loadSubmissions();
  }, []);

  const loadSubmissions = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<Submission[]>('/demo-trading/submissions');
      setSubmissions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load submissions:');
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleStartReview = (submission: Submission) => {
    setReviewingId(submission._id);
    setReviewForm({
      grade: submission.grade?.toString() || '',
      feedback: submission.feedback || '',
    });
    setError(null);
  };

  const handleSubmitReview = async (submissionId: string) => {
    setError(null);

    if (!reviewForm.grade && !reviewForm.feedback.trim()) {
      setError('Please provide a grade or feedback');
      return;
    }

    try {
      await apiClient.put(`/demo-submissions/${submissionId}/review`, {
        grade: reviewForm.grade ? parseFloat(reviewForm.grade) : undefined,
        feedback: reviewForm.feedback.trim() || undefined,
      });

      // Reload submissions
      await loadSubmissions();
      setReviewingId(null);
      setReviewForm({ grade: '', feedback: '' });
    } catch (error: unknown) {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { message?: string; error?: string } } }).response?.data?.message ||
          (error as { response?: { data?: { message?: string; error?: string } } }).response?.data?.error ||
          'Failed to submit review'
        : 'Failed to submit review';
      setError(errorMessage);
    }
  };

  const handleCancelReview = () => {
    setReviewingId(null);
    setReviewForm({ grade: '', feedback: '' });
    setError(null);
    setDraftingFeedback(null);
  };

  const handleDraftFeedback = async (submissionId: string) => {
    setDraftingFeedback(submissionId);
    setError(null);
    try {
      const response = await apiClient.post<{ feedback: string }>('/ai/instructor/draft-feedback', {
        submissionId,
      });
      setReviewForm({ ...reviewForm, feedback: response.feedback });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to draft feedback';
      setError(errorMessage);
      console.error('AI draft feedback error:');
    } finally {
      setDraftingFeedback(null);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading submissions..." />;
  }

  // Separate reviewed and unreviewed submissions
  const unreviewed = submissions.filter(s => !s.grade && !s.feedback);
  const reviewed = submissions.filter(s => s.grade || s.feedback);

  return (
    <div className="space-y-6">
      {/* Unreviewed Submissions */}
      <div className="card rounded-xl p-6">
        <h2 className="text-xl font-bold mb-4 text-ink">
          Pending Review ({unreviewed.length})
        </h2>

        {unreviewed.length === 0 ? (
          <p className="text-center py-8 text-ink-muted">
            All submissions have been reviewed.
          </p>
        ) : (
          <div className="space-y-4">
            {unreviewed.map((submission) => (
              <div
                key={submission._id}
                className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border-2 border-yellow-200 dark:border-yellow-800"
              >
                {reviewingId === submission._id ? (
                  <div className="space-y-4">
                    {error && (
                      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium mb-1 text-ink-muted">
                        Grade (0-100 or letter grade)
                      </label>
                      <input
                        type="text"
                        value={reviewForm.grade}
                        onChange={(e) => setReviewForm({ ...reviewForm, grade: e.target.value })}
                        placeholder="e.g., 85 or A"
                        className="input w-full"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium text-ink-muted">
                          Feedback
                        </label>
                        <button
                          type="button"
                          onClick={() => handleDraftFeedback(submission._id)}
                          disabled={draftingFeedback === submission._id}
                          className="btn btn-primary px-3 py-1 text-xs flex items-center space-x-1"
                        >
                          {draftingFeedback === submission._id ? (
                            <>
                              <span className="inline-block animate-spin rounded-full h-3 w-3 border-b-2 border-white"></span>
                              <span>Drafting...</span>
                            </>
                          ) : (
                            <>
                              <Bot className="h-4 w-4 shrink-0" aria-hidden />
                              <span>AI Draft Feedback</span>
                            </>
                          )}
                        </button>
                      </div>
                      <textarea
                        value={reviewForm.feedback}
                        onChange={(e) => setReviewForm({ ...reviewForm, feedback: e.target.value })}
                        rows={4}
                        placeholder="Provide constructive feedback for the student... (You can use AI to draft feedback)"
                        className="input w-full"
                      />
                      {reviewForm.feedback && (
                        <p className="text-xs mt-1 text-ink-muted">
                          <Lightbulb className="mr-2 inline h-4 w-4 shrink-0 text-primary-600" aria-hidden />AI-drafted feedback is editable. Review and customize before submitting.
                        </p>
                      )}
                    </div>

                    <div className="flex justify-end space-x-3">
                      <button
                        onClick={handleCancelReview}
                        className="btn btn-secondary px-4 py-2 text-ink-muted"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSubmitReview(submission._id)}
                        className="btn btn-primary px-4 py-2"
                      >
                        Submit Review
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-ink">
                          {submission.studentName}
                        </h3>
                        <p className="text-sm text-ink-muted">
                          {submission.studentEmail}
                        </p>
                        <p className="text-sm font-medium mt-1 text-ink-muted">
                          Task: {submission.taskTitle}
                        </p>
                      </div>
                    </div>

                    {submission.reasoning && (
                      <div className="card mb-3 p-3 rounded-lg">
                        <p className="text-xs mb-1 text-ink-muted">Reasoning / Analysis</p>
                        <p className="text-sm whitespace-pre-wrap text-ink-muted">{submission.reasoning}</p>
                      </div>
                    )}

                    {submission.screenshotUrls && submission.screenshotUrls.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs mb-2 text-ink-muted">
                          Screenshot{submission.screenshotUrls.length > 1 ? 's' : ''}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {submission.screenshotUrls.map((url, index) => (
                            <a
                              key={index}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block"
                            >
                              <div className="relative w-full max-w-full h-64 rounded-lg border border-gray-300 dark:border-gray-600 hover:shadow-lg transition-shadow cursor-pointer overflow-hidden bg-gray-100 dark:bg-gray-800">
                                <Image
                                  src={url}
                                  alt={`Screenshot ${index + 1}`}
                                  fill
                                  className="object-contain"
                                  unoptimized
                                  onError={(e) => {
                                    console.error('Failed to load screenshot:', url);
                                    const img = e.target as HTMLImageElement;
                                    img.style.display = 'none';
                                  }}
                                />
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-4">
                      <p className="text-xs text-ink-muted">
                        Submitted: {format(new Date(submission.submittedAt), 'MMM dd, yyyy HH:mm')}
                      </p>
                      <button
                        onClick={() => handleStartReview(submission)}
                        className="btn btn-primary px-4 py-2 text-sm"
                      >
                        Review
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reviewed Submissions */}
      {reviewed.length > 0 && (
        <div className="card rounded-xl p-6">
          <h2 className="text-xl font-bold mb-4 text-ink">
            Reviewed ({reviewed.length})
          </h2>
          <div className="space-y-4">
            {reviewed.map((submission) => (
              <div
                key={submission._id}
                className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-ink">
                      {submission.studentName}
                    </h3>
                    <p className="text-sm text-ink-muted">
                      {submission.studentEmail} • Task: {submission.taskTitle}
                    </p>
                  </div>
                  {submission.grade && (
                    <div className="text-right">
                      <p className="text-xs text-ink-muted">Grade</p>
                      <p className="text-lg font-bold text-primary-600 dark:text-primary-400">
                        {submission.grade}
                      </p>
                    </div>
                  )}
                </div>

                {submission.feedback && (
                  <div className="card mb-3 p-3 rounded-lg">
                    <p className="text-xs mb-1 text-ink-muted">Feedback</p>
                    <p className="text-sm whitespace-pre-wrap text-ink-muted">
                      {submission.feedback}
                    </p>
                  </div>
                )}

                {submission.reasoning && (
                  <div className="card mb-3 p-3 rounded-lg">
                    <p className="text-xs mb-1 text-ink-muted">Reasoning / Analysis</p>
                    <p className="text-sm whitespace-pre-wrap text-ink-muted">{submission.reasoning}</p>
                  </div>
                )}

                {submission.screenshotUrls && submission.screenshotUrls.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs mb-2 text-ink-muted">
                      Screenshot{submission.screenshotUrls.length > 1 ? 's' : ''}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {submission.screenshotUrls.map((url, index) => (
                        <a
                          key={index}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block"
                        >
                          <div className="relative w-full max-w-full h-64 rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden bg-gray-100 dark:bg-gray-800">
                            <Image
                              src={url}
                              alt={`Screenshot ${index + 1}`}
                              fill
                              className="object-contain"
                              unoptimized
                              onError={(e) => {
                                const img = e.target as HTMLImageElement;
                                img.style.display = 'none';
                              }}
                            />
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-ink-muted">
                    Reviewed: {submission.reviewedAt ? format(new Date(submission.reviewedAt), 'MMM dd, yyyy HH:mm') : 'N/A'}
                  </p>
                  <button
                    onClick={() => handleStartReview(submission)}
                    className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-xs font-medium"
                  >
                    Edit Review
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {submissions.length === 0 && (
        <div className="card rounded-xl p-6">
          <p className="text-center py-8 text-ink-muted">
            No submissions to review yet.
          </p>
        </div>
      )}
    </div>
  );
}

