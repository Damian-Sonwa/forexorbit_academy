/**
 * Course outline beside a lesson (Phase 7). Built from the outline view only
 * (GET /api/courses/:id/lessons?view=outline), so it never needs lesson bodies. Collapsed behind
 * a toggle on small screens; always visible from the `lg` breakpoint. Lock and completion marks
 * are the server's; opening a lesson is checked again by the lesson read.
 */

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { lessonHref, lessonKey, type OutlineLesson } from '@/lib/lesson-navigation';
import { previewText } from '@/lib/plain-text';

type Props = {
  courseId: string;
  lessons: OutlineLesson[];
  currentLessonId: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Course builder modules, in order. Lessons are grouped under their module's title. */
  modules?: Array<{ id: string; title: string }>;
  /** Builder preview: where each lesson link goes (defaults to the student lesson page). */
  linkFor?: (lessonId: string) => string;
};

function plainTitle(title: string | undefined): string {
  return previewText(title || '') || 'Lesson';
}

/** The module heading to show before each lesson (only where the module changes), or null. */
export function moduleHeadings(lessons: OutlineLesson[], modules: Array<{ id: string; title: string }> = []): Array<string | null> {
  const titled = modules.filter((m) => m.title);
  if (!titled.length) return lessons.map(() => null);
  const ids = new Set(modules.map((m) => m.id));
  let last: string | undefined;
  return lessons.map((lesson) => {
    const id = lesson.moduleId && ids.has(lesson.moduleId) ? lesson.moduleId : modules[0].id;
    if (id === last) return null;
    last = id;
    return modules.find((m) => m.id === id)?.title || 'Module';
  });
}

export default function LessonOutline({ courseId, lessons, currentLessonId, loading, error, onRetry, modules, linkFor }: Props) {
  const [open, setOpen] = useState(false);
  // Close the mobile outline after moving to another lesson.
  useEffect(() => {
    setOpen(false);
  }, [currentLessonId]);

  const completed = lessons.filter((lesson) => lesson.completed === true).length;
  const position = lessons.findIndex((lesson) => lessonKey(lesson) === currentLessonId) + 1;
  const headings = moduleHeadings(lessons, modules);

  return (
    <nav aria-label="Course outline" className="overflow-hidden rounded-panel border border-line bg-surface-1 shadow-panel" data-testid="lesson-outline">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 bg-surface-2 px-4 py-3.5 text-left lg:cursor-default"
        aria-expanded={open}
        aria-controls="lesson-outline-list"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          <span className="block font-display text-sm font-semibold text-ink">Course outline</span>
          {lessons.length > 0 && (
            <span className="mt-0.5 block text-xs text-ink-subtle num">
              {position > 0 ? `Lesson ${position} of ${lessons.length}` : `${lessons.length} lessons`} · {completed} completed
            </span>
          )}
        </span>
        <svg className={`h-5 w-5 shrink-0 text-ink-subtle transition-transform lg:hidden ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div id="lesson-outline-list" className={`${open ? 'block' : 'hidden'} border-t border-line lg:block`}>
        {loading && lessons.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-subtle" role="status">Loading lessons…</p>
        ) : error && lessons.length === 0 ? (
          <div className="px-4 py-3 text-sm" role="alert">
            <p className="text-ink-muted">{error}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="mt-2 font-semibold text-primary-600 hover:underline">
                Try again
              </button>
            )}
          </div>
        ) : lessons.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-subtle">This course has no lessons yet.</p>
        ) : (
          <ol className="relative max-h-[60vh] overflow-y-auto py-2 lg:max-h-[calc(100vh-12rem)] before:pointer-events-none before:absolute before:bottom-5 before:left-[1.69rem] before:top-5 before:w-px before:bg-[var(--fo-line-strong)]">
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
                    className={`relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold num ring-4 ring-[var(--fo-surface-1)] ${
                      current
                        ? 'bg-primary-500 text-neutral-950 shadow-[0_0_12px_rgba(255,112,18,0.6)]'
                        : lesson.completed
                          ? 'bg-[color-mix(in_srgb,#ff7012_22%,var(--fo-surface-1))] text-primary-600 dark:text-primary-300'
                          : 'border border-[var(--fo-line-strong)] bg-surface-1 text-ink-subtle'
                    }`}
                    aria-hidden
                  >
                    {lesson.completed ? '✓' : index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                  {locked && (
                    <svg className="h-4 w-4 shrink-0 text-ink-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  )}
                  {badge && <span className="sr-only">({badge})</span>}
                </>
              );
              const base = 'flex items-center gap-3 px-4 py-2.5 text-sm min-h-[44px]';
              return (
                <Fragment key={id || index}>
                {headings[index] && (
                  <li className="relative z-[1] bg-surface-1 px-4 pb-1.5 pt-3.5 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-subtle first:pt-2" data-testid="outline-module">{headings[index]}</li>
                )}
                <li>
                  {current ? (
                    <span aria-current="page" className={`${base} bg-tint font-semibold text-ink`}>
                      {body}
                    </span>
                  ) : (
                    <Link
                      href={linkFor ? linkFor(id) : locked ? `/courses/${encodeURIComponent(courseId)}` : lessonHref(courseId, id)}
                      className={`${base} text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--fo-text)_5%,transparent)] hover:text-ink ${locked ? 'opacity-70' : ''}`}
                      title={locked ? 'Unlock the full course to open this lesson' : undefined}
                    >
                      {body}
                    </Link>
                  )}
                </li>
                </Fragment>
              );
            })}
          </ol>
        )}
      </div>
    </nav>
  );
}
