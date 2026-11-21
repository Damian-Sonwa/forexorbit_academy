/**
 * CourseCard Component
 * Displays course information with progress and enrollment
 */

import { useState } from 'react';
import Link from 'next/link';
import { Course } from '@/hooks/useCourses';
import { messageFromUnknown } from '@/lib/public-error';
import { useAuth } from '@/hooks/useAuth';
import { previewText } from '@/lib/plain-text';
import CourseCover from '@/components/CourseCover';
import OrbitProgress from '@/components/ui/OrbitProgress';
import { difficultyChip } from '@/lib/difficulty-style';

interface CourseCardProps {
  course: Course;
  onEnroll?: (courseId: string) => void | Promise<void>;
  onUnenroll?: (courseId: string) => void | Promise<void>;
}


export default function CourseCard({ course, onEnroll, onUnenroll }: CourseCardProps) {
  const { isAuthenticated } = useAuth();
  const courseId = course._id || course.id || '';
  const progress = Math.max(0, Math.min(100, Math.round(course.progress ?? 0)));
  const descriptionPlain = previewText(course.description);
  // One enrollment action at a time; the server's answer is shown on the card.
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const run = async (action?: (id: string) => void | Promise<void>) => {
    if (!action || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await action(courseId);
    } catch (error) {
      setActionError(messageFromUnknown(error));
    } finally {
      setBusy(false);
    }
  };
  const completed = Boolean(course.completed || (course.enrolled && (course.progress ?? 0) >= 100));

  return (
    <article className="card card-interactive group flex h-full flex-col overflow-hidden !p-0">
      <Link href={`/courses/${courseId}`} aria-label={course.title} tabIndex={-1} className="relative block overflow-hidden">
        <CourseCover course={course} className="rounded-none transition-transform duration-500 ease-orbit motion-safe:group-hover:scale-[1.03]" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--fo-surface-1)] to-transparent" />
        <span className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {course.difficulty && (
            <span className={`chip backdrop-blur-md ${difficultyChip(course.difficulty)}`}>{course.difficulty}</span>
          )}
          {course.status === 'archived' ? <span className="chip !bg-[color-mix(in_srgb,var(--fo-bg)_72%,transparent)] backdrop-blur-md">Archived</span> : null}
        </span>
      </Link>

      <div className="flex flex-grow flex-col px-5 pb-5 pt-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {course.category && <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">{course.category.replace(/-/g, ' ')}</span>}
          {completed ? <span className="chip chip-up">Completed</span> : null}
          {course.owned ? <span className="chip chip-brand">Full access</span> : null}
        </div>

        <h3 className="font-display text-lg font-semibold leading-snug tracking-tight text-ink">
          <Link href={`/courses/${courseId}`} className="transition-colors hover:text-primary-600 dark:hover:text-primary-400">
            {course.title}
          </Link>
        </h3>

        {descriptionPlain ? (
          <p className="mb-5 mt-2 line-clamp-3 flex-grow text-sm leading-relaxed text-ink-muted">{descriptionPlain}</p>
        ) : (
          <div className="flex-grow" />
        )}

        <div className="flex items-center gap-3 border-t border-line pt-4">
          {course.progress !== undefined && (course.enrolled || course.progress > 0) && (
            <OrbitProgress value={progress} size={44} stroke={3.5} label={`${course.title} progress`} tone={progress >= 100 ? 'complete' : 'brand'} />
          )}
          <Link
            href={`/courses/${courseId}`}
            className={`btn flex-1 ${course.enrolled ? 'btn-primary' : 'btn-secondary'}`}
          >
            {!course.enrolled ? 'View course' : (course.progress ?? 0) >= 100 ? 'Review' : (course.progress ?? 0) > 0 ? 'Continue' : 'Start'}
          </Link>

          {isAuthenticated && (
            <>
              {course.enrolled ? (
                <button type="button" onClick={() => void run(onUnenroll)} disabled={busy} className="btn btn-ghost px-3 text-xs">
                  {busy ? 'Leaving…' : 'Unenroll'}
                </button>
              ) : (
                <button type="button" onClick={() => void run(onEnroll)} disabled={busy} className="btn btn-primary">
                  {busy ? 'Enrolling…' : 'Enroll'}
                </button>
              )}
            </>
          )}
        </div>
        {actionError ? <p role="alert" className="mt-2 text-sm text-down">{actionError}</p> : null}
      </div>
    </article>
  );
}
