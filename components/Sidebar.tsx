/**
 * Sidebar Component
 * Side navigation for dashboard and course pages
 */

import Link from 'next/link';
import { useRouter } from 'next/router';

interface SidebarProps {
  courseId?: string;
  lessons?: Array<{ id: string; title: string; order: number }>;
  currentLessonId?: string;
}

export default function Sidebar({ courseId, lessons, currentLessonId }: SidebarProps) {
  const router = useRouter();

  const sidebarItems = [
    { href: '/dashboard', label: 'Dashboard', icon: '📊' },
    { href: '/courses', label: 'My Courses', icon: '📚' },
    { href: '/progress', label: 'Progress', icon: '📈' },
    { href: '/certificates', label: 'Certificates', icon: '🎓' },
  ];

  return (
    <aside className="hidden lg:block w-72 bg-white shadow-md min-h-screen p-6 border-r border-gray-100 sticky top-20 h-[calc(100vh-5rem)] overflow-y-auto">
      <nav className="space-y-2">
        {sidebarItems.map((item) => {
          const isActive = router.pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white font-semibold shadow-md'
                  : 'text-gray-700 hover:bg-gray-50 font-medium'
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Course Lessons */}
      {courseId && lessons && lessons.length > 0 && (
        <div className="mt-8 pt-8 border-t border-gray-200">
          <h3 className="text-sm font-bold text-gray-900 mb-4 uppercase tracking-wide">Course Lessons</h3>
          <nav className="space-y-2">
            {lessons.map((lesson) => {
              const isActive = currentLessonId === lesson.id;
              return (
                <Link
                  key={lesson.id}
                  href={`/courses/${courseId}/lessons/${lesson.id}`}
                  className={`flex items-start space-x-3 px-4 py-3 rounded-xl text-sm transition-all ${
                    isActive
                      ? 'bg-primary-50 text-primary-700 font-semibold border-2 border-primary-200'
                      : 'text-gray-600 hover:bg-gray-50 border-2 border-transparent'
                  }`}
                >
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold mt-0.5">
                    {lesson.order}
                  </span>
                  <span className="flex-1">{lesson.title}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </aside>
  );
}

