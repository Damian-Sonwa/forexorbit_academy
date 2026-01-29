/**
 * Legal Index Page
 * Main legal hub with links to privacy policy and terms
 */

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from 'next/link';

export default function Legal() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Legal Information</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Important legal documents and policies for ForexOrbit Academy
          </p>
        </div>

        {/* Legal Documents Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <Link href="/legal/privacy-policy" className="bg-white dark:bg-gray-800 rounded-xl p-8 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex flex-col">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Privacy Policy</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Learn how we collect, use, and protect your personal information and data.
              </p>
            </div>
          </Link>

          <Link href="/legal/terms-of-service" className="bg-white dark:bg-gray-800 rounded-xl p-8 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex flex-col">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Terms of Service</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Review the terms and conditions governing your use of ForexOrbit Academy.
              </p>
            </div>
          </Link>
        </div>

        {/* Quick Links */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Quick Links</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link href="/privacy" className="text-primary-600 dark:text-primary-400 hover:underline font-semibold">
              → Privacy Policy (Alternative Link)
            </Link>
            <Link href="/terms" className="text-primary-600 dark:text-primary-400 hover:underline font-semibold">
              → Terms of Service (Alternative Link)
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}




