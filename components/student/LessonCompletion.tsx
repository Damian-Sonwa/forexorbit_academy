/**
 * Explicit lesson completion (Phase 7). Completion is recorded only when the student asks for it
 * (POST /api/progress, which applies the enrollment rule and the Phase 6 paywall); watching or
 * finishing the video never completes a lesson. One request at a time: the button is disabled
 * while it runs and re-enabled on failure with the reason, so it can never stay stuck.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, isUnauthorizedError } from '@/lib/api-client';

type Props = {
  courseId: string;
  lessonId: string;
  completed: boolean;
  /** The video reached its end: suggest completing, without completing. */
  videoFinished?: boolean;
  onCompleted: (result: { progress?: number }) => void;
};

function failureMessage(err: unknown): string {
  const ax = err as { response?: { status?: number; data?: { error?: string; code?: string } } };
  const status = ax?.response?.status;
  if (!ax?.response) {
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'You are offline. Try again when your connection is back.'
      : 'Could not reach the server. Try again.';
  }
  if (ax.response.data?.code === 'lesson_locked') return 'This lesson is locked. Unlock the course to record progress.';
  if (status === 403) return 'Only enrolled students can record progress on this lesson.';
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  return 'Your progress could not be saved. Try again.';
}

export default function LessonCompletion({ courseId, lessonId, completed, videoFinished, onCompleted }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    setError(null);
  }, [lessonId]);

  const complete = useCallback(async () => {
    if (inFlight.current || completed) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiClient.post<{ success?: boolean; progress?: number }>('/progress', { courseId, lessonId });
      onCompleted({ progress: typeof result?.progress === 'number' ? result.progress : undefined });
    } catch (err: unknown) {
      if (!isUnauthorizedError(err)) setError(failureMessage(err));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, [completed, courseId, lessonId, onCompleted]);

  return (
    <section className="mb-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:rounded-2xl sm:p-6 dark:border-gray-700 dark:bg-gray-800" data-testid="lesson-completion">
      {completed ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-400" role="status">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40" aria-hidden>✓</span>
          Lesson completed
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Finished this lesson?</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {videoFinished
                ? 'The video has ended. Mark the lesson complete when you have finished the material.'
                : 'Mark it complete to record your progress. Watching the video alone does not complete it.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void complete()}
            disabled={submitting}
            aria-busy={submitting}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700 disabled:cursor-wait disabled:opacity-70"
          >
            {submitting ? 'Saving…' : 'Mark lesson complete'}
          </button>
        </div>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
