/**
 * CourseCard Component
 * Displays course information with progress and enrollment
 */

import Link from 'next/link';
import { Course } from '@/hooks/useCourses';
import { useAuth } from '@/hooks/useAuth';
import { previewText } from '@/lib/plain-text';
import CourseCover from '@/components/CourseCover';

interface CourseCardProps {
  course: Course;
  onEnroll?: (courseId: string) => void;
  onUnenroll?: (courseId: string) => void;
}

const difficultyStyles: Record<string, string> = {
  beginner: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300',
  intermediate: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
  advanced: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300',
};

export default function CourseCard({ course, onEnroll, onUnenroll }: CourseCardProps) {
  const { isAuthenticated } = useAuth();
  const courseId = course._id || course.id || '';
  const progress = Math.max(0, Math.min(100, Math.round(course.progress ?? 0)));
  const descriptionPlain = previewText(course.description);

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-soft transition-shadow duration-200 hover:shadow-raised">
      <Link href={`/courses/${courseId}`} aria-label={course.title} tabIndex={-1} className="block">
        <CourseCover course={course} className="transition-transform duration-300 motion-safe:group-hover:scale-[1.02]" />
      </Link>

      <div className="flex flex-grow flex-col p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {course.difficulty && (
            <span className={`chip ${difficultyStyles[course.difficulty] || ''}`}>{course.difficulty}</span>
          )}
          {course.category && (
            <span className="text-xs capitalize text-neutral-500">{course.category}</span>
          )}
        </div>

        <h3 className="font-display text-lg font-semibold leading-snug tracking-tight text-neutral-900">
          <Link href={`/courses/${courseId}`} className="hover:text-primary-700 dark:hover:text-primary-400">
            {course.title}
          </Link>
        </h3>

        {descriptionPlain ? (
          <p className="mt-2 mb-4 line-clamp-3 flex-grow text-sm leading-relaxed text-neutral-600">{descriptionPlain}</p>
        ) : (
          <div className="flex-grow" />
        )}

        {course.progress !== undefined && (course.enrolled || course.progress > 0) && (
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-neutral-500">Progress</span>
              <span className="font-semibold text-neutral-900">{progress}%</span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${course.title} progress`}
            >
              <div className="h-full rounded-full bg-primary-500 transition-[width] duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Link
            href={`/courses/${courseId}`}
            className={`btn flex-1 ${course.enrolled ? 'btn-primary' : 'btn-outline'}`}
          >
            {!course.enrolled ? 'View course' : (course.progress ?? 0) >= 100 ? 'Review' : (course.progress ?? 0) > 0 ? 'Continue' : 'Start'}
          </Link>

          {isAuthenticated && (
            <>
              {course.enrolled ? (
                <button type="button" onClick={() => onUnenroll?.(courseId)} className="btn btn-ghost px-3">
                  Unenroll
                </button>
              ) : (
                <button type="button" onClick={() => onEnroll?.(courseId)} className="btn btn-primary">
                  Enroll
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
