/**
 * Course outline beside a lesson (Phase 7). Built from the outline view only
 * (GET /api/courses/:id/lessons?view=outline), so it never needs lesson bodies. Collapsed behind
 * a toggle on small screens; always visible from the `lg` breakpoint. Lock and completion marks
 * are the server's; opening a lesson is checked again by the lesson read.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { lessonHref, lessonKey, type OutlineLesson } from '@/lib/lesson-navigation';
import { previewText } from '@/lib/plain-text';

type Props = {
  courseId: string;
  lessons: OutlineLesson[];
  currentLessonId: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

function plainTitle(title: string | undefined): string {
  return previewText(title || '') || 'Lesson';
}

export default function LessonOutline({ courseId, lessons, currentLessonId, loading, error, onRetry }: Props) {
  const [open, setOpen] = useState(false);
  // Close the mobile outline after moving to another lesson.
  useEffect(() => {
    setOpen(false);
  }, [currentLessonId]);

  const completed = lessons.filter((lesson) => lesson.completed === true).length;
  const position = lessons.findIndex((lesson) => lessonKey(lesson) === currentLessonId) + 1;

  return (
    <nav aria-label="Course outline" className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800" data-testid="lesson-outline">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left lg:cursor-default"
        aria-expanded={open}
        aria-controls="lesson-outline-list"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          <span className="block text-sm font-semibold text-gray-900 dark:text-white">Course outline</span>
          {lessons.length > 0 && (
            <span className="block text-xs text-gray-600 dark:text-gray-300">
              {position > 0 ? `Lesson ${position} of ${lessons.length}` : `${lessons.length} lessons`} · {completed} completed
            </span>
          )}
        </span>
        <svg className={`h-5 w-5 shrink-0 text-gray-500 transition-transform lg:hidden ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div id="lesson-outline-list" className={`${open ? 'block' : 'hidden'} border-t border-gray-100 lg:block dark:border-gray-700`}>
        {loading && lessons.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500" role="status">Loading lessons…</p>
        ) : error && lessons.length === 0 ? (
          <div className="px-4 py-3 text-sm" role="alert">
            <p className="text-gray-700 dark:text-gray-300">{error}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="mt-2 font-semibold text-primary-600 hover:underline">
                Try again
              </button>
            )}
          </div>
        ) : lessons.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500">This course has no lessons yet.</p>
        ) : (
          <ol className="max-h-[60vh] overflow-y-auto py-1 lg:max-h-[calc(100vh-12rem)]">
            {lessons.map((lesson, index) => {
              const id = lessonKey(lesson);
              const current = id === currentLessonId;
              const locked = lesson.locked === true;
              const title = plainTitle(lesson.title);
              const badge = current
                ? null
                : locked
                  ? 'Locked'
                  : lesson.completed
                    ? 'Done'
                    : lesson.isFreePreview
                      ? 'Free'
                      : null;
              const body = (
                <>
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      lesson.completed ? 'bg-green-100 text-green-700' : current ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-200'
                    }`}
                    aria-hidden
                  >
                    {lesson.completed ? '✓' : index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                  {locked && (
                    <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  )}
                  {badge && <span className="sr-only">({badge})</span>}
                </>
              );
              const base = 'flex items-center gap-3 px-4 py-2.5 text-sm min-h-[44px]';
              return (
                <li key={id || index}>
                  {current ? (
                    <span aria-current="page" className={`${base} bg-primary-50 font-semibold text-primary-800 dark:bg-primary-400/10 dark:text-primary-200`}>
                      {body}
                    </span>
                  ) : (
                    <Link
                      href={locked ? `/courses/${encodeURIComponent(courseId)}` : lessonHref(courseId, id)}
                      className={`${base} text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5 ${locked ? 'opacity-75' : ''}`}
                      title={locked ? 'Unlock the full course to open this lesson' : undefined}
                    >
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </nav>
  );
}
