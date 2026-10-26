/**
 * Courses Page
 * List all available courses
 */

import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import CourseCard from '@/components/CourseCard';
import { CourseCardSkeleton, LoadingStatus } from '@/components/loading';
import { useCourses } from '@/hooks/useCourses';

export default function CoursesPage() {
  const [filters, setFilters] = useState({ category: '', difficulty: '', search: '' });
  const { courses, loading, error, enroll, unenroll, refetch } = useCourses(filters);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero Section */}
        <div className="mb-10">
          <p className="page-kicker mb-2">Catalog</p>
          <h1 className="page-title">Courses</h1>
          <p className="mt-2 max-w-xl text-sm text-neutral-600">
            Forex lessons arranged by topic and difficulty.
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Search courses..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <select
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              className="px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
            >
              <option value="">All Categories</option>
              <option value="basics">Basics</option>
              <option value="technical">Technical Analysis</option>
              <option value="fundamental">Fundamental Analysis</option>
              <option value="trading">Trading Strategies</option>
            </select>
            <select
              value={filters.difficulty}
              onChange={(e) => setFilters({ ...filters, difficulty: e.target.value })}
              className="px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
            >
              <option value="">All Levels</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
        </div>

        {/* Courses Grid */}
        {loading && courses.length === 0 && !error ? (
          <div className="space-y-4">
            <LoadingStatus label="Loading courses" />
            <CourseCardSkeleton count={6} />
          </div>
        ) : error && courses.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-white px-6 py-16 text-center">
            <p className="text-lg font-semibold text-neutral-900">Courses could not be loaded</p>
            <p className="mt-2 text-sm text-neutral-600">Check the connection and try again.</p>
            <button type="button" onClick={() => refetch()} className="mt-6 inline-flex rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700">Try again</button>
          </div>
        ) : courses.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-gray-100">
            <BookOpen className="mx-auto mb-4 h-12 w-12 text-neutral-400" aria-hidden />
            <p className="text-gray-500 text-lg mb-2">No courses found</p>
            <p className="text-gray-400 text-sm">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {loading && <div className="sm:col-span-2 lg:col-span-3"><LoadingStatus label="Updating courses" compact /></div>}
            {courses.map((course) => (
              <CourseCard
                key={course._id || course.id}
                course={course}
                onEnroll={enroll}
                onUnenroll={unenroll}
              />
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

