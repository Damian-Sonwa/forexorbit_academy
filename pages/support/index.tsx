/**
 * Support Index Page
 * Main support hub with links to help resources
 */

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from 'next/link';

export default function Support() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Support Center</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            We're here to help you succeed. Find the support you need below.
          </p>
        </div>

        {/* Support Options Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <Link href="/support/help-center" className="bg-white dark:bg-gray-800 rounded-xl p-8 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-primary-100 dark:bg-primary-900 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Help Center</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Comprehensive guides and tutorials to help you get the most out of ForexOrbit Academy
              </p>
            </div>
          </Link>

          <Link href="/support/contact" className="bg-white dark:bg-gray-800 rounded-xl p-8 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Contact Us</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Get in touch with our support team via phone or email for personalized assistance
              </p>
            </div>
          </Link>

          <Link href="/support/faq" className="bg-white dark:bg-gray-800 rounded-xl p-8 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">FAQ</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Quick answers to the most frequently asked questions about our platform
              </p>
            </div>
          </Link>
        </div>

        {/* Quick Links */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Quick Links</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link href="/help" className="text-primary-600 dark:text-primary-400 hover:underline font-semibold">
              → Help Center (Alternative Link)
            </Link>
            <Link href="/contact" className="text-primary-600 dark:text-primary-400 hover:underline font-semibold">
              → Contact Us (Alternative Link)
            </Link>
            <Link href="/faq" className="text-primary-600 dark:text-primary-400 hover:underline font-semibold">
              → FAQ (Alternative Link)
            </Link>
            <Link href="/about" className="text-primary-600 dark:text-primary-400 hover:underline font-semibold">
              → About ForexOrbit Academy
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}


