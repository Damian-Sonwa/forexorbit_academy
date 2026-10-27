/**
 * CourseCard Component
 * Displays course information with progress and enrollment
 */

import Link from 'next/link';
import { Course } from '@/hooks/useCourses';
import { useAuth } from '@/hooks/useAuth';
import { sanitizeForStudentView, stripHtml } from '@/lib/html-sanitizer';

interface CourseCardProps {
  course: Course;
  onEnroll?: (courseId: string) => void;
  onUnenroll?: (courseId: string) => void;
}

export default function CourseCard({ course, onEnroll, onUnenroll }: CourseCardProps) {
  const { isAuthenticated } = useAuth();
  const courseId = course._id || course.id || '';

  const difficultyColors = {
    beginner: 'bg-green-100 text-green-800',
    intermediate: 'bg-yellow-100 text-yellow-800',
    advanced: 'bg-red-100 text-red-800',
  };

  const descriptionPlain = stripHtml(sanitizeForStudentView(course.description || ''));

  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-soft">
      <div className="flex flex-grow flex-col p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-semibold leading-snug tracking-tight text-neutral-900">
            {course.title}
          </h3>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${difficultyColors[course.difficulty]}`}>
            {course.difficulty}
          </span>
        </div>

        {descriptionPlain ? (
          <p className="text-gray-600 text-sm mb-4 line-clamp-3 flex-grow">{descriptionPlain}</p>
        ) : null}

        <div className="flex items-center justify-between mb-4 text-xs text-gray-500">
          <span className="flex items-center">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            {course.category}
          </span>
          {course.progress !== undefined && (
            <span className="font-semibold text-primary-600">{Math.round(course.progress)}%</span>
          )}
        </div>

        {/* Progress Bar */}
        {course.progress !== undefined && course.progress > 0 && (
          <div className="w-full bg-gray-100 rounded-full h-2 mb-4 overflow-hidden">
            <div
              className="bg-primary-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${course.progress}%` }}
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <Link
            href={`/courses/${courseId}`}
            className={`flex-1 text-center text-sm ${course.enrolled ? 'btn btn-primary' : 'btn btn-outline'}`}
          >
            {!course.enrolled ? 'View course' : (course.progress ?? 0) >= 100 ? 'Review' : (course.progress ?? 0) > 0 ? 'Continue' : 'Start'}
          </Link>

          {isAuthenticated && (
            <>
              {course.enrolled ? (
                <button
                  onClick={() => onUnenroll?.(courseId)}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
                >
                  Unenroll
                </button>
              ) : (
                <button
                  onClick={() => onEnroll?.(courseId)}
                  className="rounded-lg bg-primary-400 px-4 py-2 text-sm font-semibold text-neutral-900 transition-colors hover:bg-primary-500"
                >
                  Enroll
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

