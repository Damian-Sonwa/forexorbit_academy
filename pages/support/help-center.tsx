/**
 * Support Help Center Page
 * Renders help center content
 */

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from 'next/link';

export default function SupportHelpCenter() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <nav className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            <Link href="/support" className="hover:text-primary-600 dark:hover:text-primary-400">Support</Link>
            <span className="mx-2">/</span>
            <span className="text-gray-900 dark:text-white">Help Center</span>
          </nav>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Help Center</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Find answers to common questions and learn how to make the most of ForexOrbit Academy
          </p>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <Link href="/support/help-center#getting-started" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">Getting Started</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">New to the platform?</p>
              </div>
            </div>
          </Link>

          <Link href="/support/help-center#courses" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">Courses & Lessons</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">Learn about our courses</p>
              </div>
            </div>
          </Link>

          <Link href="/support/help-center#troubleshooting" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">Troubleshooting</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">Fix common issues</p>
              </div>
            </div>
          </Link>
        </div>

        {/* Content sections - same as /help page */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 mb-8">
          <h2 id="getting-started" className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Getting Started</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Welcome to ForexOrbit Academy! This guide will help you get started with the platform.
          </p>
          <p className="text-gray-600 dark:text-gray-400">
            For detailed help content, visit our <Link href="/help" className="text-primary-600 dark:text-primary-400 hover:underline">main Help Center page</Link>.
          </p>
        </div>

        <div className="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Need More Help?</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Visit our comprehensive Help Center for detailed guides and tutorials.
          </p>
          <Link href="/help" className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors inline-block">
            View Full Help Center
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}

