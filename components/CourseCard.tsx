/**
 * CourseCard Component
 * Displays course information with progress and enrollment
 */

import Link from 'next/link';
import { Course } from '@/hooks/useCourses';
import { useAuth } from '@/hooks/useAuth';
import { stripHtml } from '@/lib/html-sanitizer';

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

  const thumbnail = course.thumbnail?.trim() || '';

  return (
    <div className="group bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-300 overflow-hidden border border-gray-200 flex flex-col h-full">
      {/* Course image: instructor thumbnail only — no stock photos */}
      <div className="relative w-full h-48 bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600 overflow-hidden flex-shrink-0">
        <div className="absolute inset-0 bg-black/10 group-hover:bg-black/5 transition-colors z-[1]" />
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={course.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center z-[1]" aria-hidden>
            <div className="w-20 h-20 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center border-2 border-white/30">
              <svg className="w-10 h-10 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
          </div>
        )}
        {course.progress !== undefined && course.progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20 z-10">
            <div
              className="h-full bg-white transition-all duration-500"
              style={{ width: `${course.progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Course Content */}
      <div className="p-6 flex flex-col flex-grow">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-xl font-bold text-gray-900 group-hover:text-primary-600 transition-colors line-clamp-2 flex-1 pr-2">
            {course.title}
          </h3>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${difficultyColors[course.difficulty]}`}>
            {course.difficulty}
          </span>
        </div>

        <p className="text-gray-600 text-sm mb-4 line-clamp-3 flex-grow">{stripHtml(course.description || '')}</p>

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

