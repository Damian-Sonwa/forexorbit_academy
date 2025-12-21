/**
 * Review Submission Component
 * Allows instructors to grade and provide feedback on submissions
 */

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { format } from 'date-fns';
import LoadingSpinner from '@/components/LoadingSpinner';

interface Submission {
  _id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  taskId: string;
  taskTitle: string;
  screenshot: string | null;
  notes: string;
  pair: string;
  direction: string;
  entryPrice: number;
  result: string;
  profitLoss?: number;
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

  useEffect(() => {
    loadSubmissions();
  }, []);

  const loadSubmissions = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<Submission[]>('/demo-trading/submissions');
      setSubmissions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load submissions:', error);
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
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to submit review'
        : 'Failed to submit review';
      setError(errorMessage);
    }
  };

  const handleCancelReview = () => {
    setReviewingId(null);
    setReviewForm({ grade: '', feedback: '' });
    setError(null);
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
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
          Pending Review ({unreviewed.length})
        </h2>

        {unreviewed.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">
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
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Grade (0-100 or letter grade)
                      </label>
                      <input
                        type="text"
                        value={reviewForm.grade}
                        onChange={(e) => setReviewForm({ ...reviewForm, grade: e.target.value })}
                        placeholder="e.g., 85 or A"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 dark:text-white bg-white dark:bg-gray-700"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Feedback
                      </label>
                      <textarea
                        value={reviewForm.feedback}
                        onChange={(e) => setReviewForm({ ...reviewForm, feedback: e.target.value })}
                        rows={4}
                        placeholder="Provide constructive feedback for the student..."
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 dark:text-white bg-white dark:bg-gray-700"
                      />
                    </div>

                    <div className="flex justify-end space-x-3">
                      <button
                        onClick={handleCancelReview}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSubmitReview(submission._id)}
                        className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium"
                      >
                        Submit Review
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">
                          {submission.studentName}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {submission.studentEmail}
                        </p>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">
                          Task: {submission.taskTitle}
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded text-xs font-medium ${
                        submission.result === 'win' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                        submission.result === 'loss' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                        'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-200'
                      }`}>
                        {submission.result?.toUpperCase() || 'OPEN'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Pair</p>
                        <p className="font-medium text-gray-900 dark:text-white">{submission.pair}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Direction</p>
                        <p className="font-medium text-gray-900 dark:text-white">{submission.direction?.toUpperCase()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Entry Price</p>
                        <p className="font-medium text-gray-900 dark:text-white">{submission.entryPrice}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">P/L</p>
                        <p className={`font-medium ${
                          submission.profitLoss && submission.profitLoss > 0 ? 'text-green-600 dark:text-green-400' :
                          submission.profitLoss && submission.profitLoss < 0 ? 'text-red-600 dark:text-red-400' :
                          'text-gray-900 dark:text-white'
                        }`}>
                          {submission.profitLoss !== undefined ? `$${submission.profitLoss.toFixed(2)}` : '-'}
                        </p>
                      </div>
                    </div>

                    {submission.notes && (
                      <div className="mb-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Notes</p>
                        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{submission.notes}</p>
                      </div>
                    )}

                    {submission.screenshot && (
                      <div className="mb-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Screenshot</p>
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
                            }}
                          />
                        </a>
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-4">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Submitted: {format(new Date(submission.submittedAt), 'MMM dd, yyyy HH:mm')}
                      </p>
                      <button
                        onClick={() => handleStartReview(submission)}
                        className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium"
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
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
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
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      {submission.studentName}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {submission.studentEmail} • Task: {submission.taskTitle}
                    </p>
                  </div>
                  {submission.grade && (
                    <div className="text-right">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Grade</p>
                      <p className="text-lg font-bold text-primary-600 dark:text-primary-400">
                        {submission.grade}
                      </p>
                    </div>
                  )}
                </div>

                {submission.feedback && (
                  <div className="mb-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Feedback</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      {submission.feedback}
                    </p>
                  </div>
                )}

                {submission.screenshot && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Screenshot</p>
                    <a
                      href={submission.screenshot}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block"
                    >
                      <img
                        src={submission.screenshot}
                        alt="Trade screenshot"
                        className="max-w-full h-auto max-h-64 rounded-lg border border-gray-300 dark:border-gray-600"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          img.style.display = 'none';
                        }}
                      />
                    </a>
                  </div>
                )}

                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
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
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">
            No submissions to review yet.
          </p>
        </div>
      )}
    </div>
  );
}

