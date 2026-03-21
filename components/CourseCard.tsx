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
    <div className="group bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-300 overflow-hidden border border-gray-200 flex flex-col h-full">
      {/* No course hero image — avoids empty placeholder; details stay below */}
      <div className="p-6 flex flex-col flex-grow">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-xl font-bold text-gray-900 group-hover:text-primary-600 transition-colors line-clamp-2 flex-1 pr-2">
            {course.title}
          </h3>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${difficultyColors[course.difficulty]}`}>
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
              className="bg-gradient-to-r from-primary-500 to-primary-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${course.progress}%` }}
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <Link 
            href={`/courses/${courseId}`} 
            className="flex-1 btn btn-outline text-sm text-center"
          >
            View Details
          </Link>

          {isAuthenticated && (
            <>
              {course.enrolled ? (
                <button
                  onClick={() => onUnenroll?.(courseId)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                >
                  Unenroll
                </button>
              ) : (
                <button
                  onClick={() => onEnroll?.(courseId)}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
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

