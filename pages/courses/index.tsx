/**
 * Courses Page
 * List all available courses
 */

import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import CourseCard from '@/components/CourseCard';
import { CourseCardSkeleton, LoadingStatus } from '@/components/loading';
import { useCourses } from '@/hooks/useCourses';

export default function CoursesPage() {
  const [filters, setFilters] = useState({ category: '', difficulty: '', search: '' });
  const { courses, loading, error, enroll, unenroll, refetch } = useCourses(filters);

  const inProgress = courses.filter((course) => course.enrolled && (course.progress ?? 0) < 100);
  const completed = courses.filter((course) => course.enrolled && (course.progress ?? 0) >= 100);
  const explore = courses.filter((course) => !course.enrolled);
  const groups = [
    { key: 'continue', label: 'Continue learning', courses: inProgress },
    { key: 'done', label: 'Completed', courses: completed },
    { key: 'explore', label: 'Explore courses', courses: explore },
  ].filter((group) => group.courses.length > 0);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex flex-1 lg:items-start">
        <Sidebar />
        <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pt-16 lg:pt-8 w-full">
          <div className="mb-8">
            <p className="page-kicker mb-2">Library</p>
            <h1 className="page-title">Courses</h1>
            <p className="mt-2 max-w-xl text-sm text-neutral-600">
              Courses you are studying stay separate from the rest of the catalog.
            </p>
          </div>

          <div className="mb-8 border-y border-neutral-200 py-4">
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="relative flex-1">
                <label className="sr-only" htmlFor="course-search">Search courses</label>
                <input
                  id="course-search"
                  type="search"
                  placeholder="Search courses"
                  value={filters.search}
                  onChange={(event) => setFilters({ ...filters, search: event.target.value })}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <select
                aria-label="Category"
                value={filters.category}
                onChange={(event) => setFilters({ ...filters, category: event.target.value })}
                className="rounded-xl border border-neutral-300 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All categories</option>
                <option value="basics">Basics</option>
                <option value="technical">Technical analysis</option>
                <option value="fundamental">Fundamental analysis</option>
                <option value="trading">Trading strategies</option>
              </select>
              <select
                aria-label="Level"
                value={filters.difficulty}
                onChange={(event) => setFilters({ ...filters, difficulty: event.target.value })}
                className="rounded-xl border border-neutral-300 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All levels</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
          </div>

          {loading && courses.length === 0 && !error ? (
            <div className="space-y-4">
              <LoadingStatus label="Loading courses" />
              <CourseCardSkeleton count={6} />
            </div>
          ) : error && courses.length === 0 ? (
            <div className="rounded-2xl border border-neutral-200 px-6 py-16 text-center">
              <p className="text-lg font-semibold text-neutral-900">Courses could not be loaded</p>
              <p className="mt-2 text-sm text-neutral-600">Check the connection and try again.</p>
              <button type="button" onClick={() => refetch()} className="mt-6 inline-flex rounded-full bg-primary-400 px-5 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-primary-500">Try again</button>
            </div>
          ) : courses.length === 0 ? (
            <div className="py-16 text-center">
              <BookOpen className="mx-auto mb-4 h-10 w-10 text-neutral-400" aria-hidden />
              <p className="text-lg font-semibold text-neutral-900">No courses match these filters</p>
              <button type="button" className="mt-4 text-sm font-semibold text-primary-700 underline-offset-4 hover:underline" onClick={() => setFilters({ category: '', difficulty: '', search: '' })}>Clear filters</button>
            </div>
          ) : (
            <div className="space-y-10">
              {loading && <LoadingStatus label="Updating courses" compact />}
              {groups.map((group) => (
                <section key={group.key}>
                  <h2 className="font-display text-lg font-semibold text-neutral-900">{group.label}</h2>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {group.courses.map((course) => (
                      <CourseCard
                        key={course._id || course.id}
                        course={course}
                        onEnroll={enroll}
                        onUnenroll={unenroll}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </main>
      </div>
      <Footer />
    </div>
  );
}

