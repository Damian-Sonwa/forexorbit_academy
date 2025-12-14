/**
 * Support FAQ Page
 * Renders FAQ content
 */

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from 'next/link';

export default function SupportFAQ() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <nav className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            <Link href="/support" className="hover:text-primary-600 dark:hover:text-primary-400">Support</Link>
            <span className="mx-2">/</span>
            <span className="text-gray-900 dark:text-white">FAQ</span>
          </nav>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Frequently Asked Questions</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Find quick answers to common questions about ForexOrbit Academy
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 mb-8">
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            For our complete FAQ with searchable categories and detailed answers, visit our <Link href="/faq" className="text-primary-600 dark:text-primary-400 hover:underline font-semibold">main FAQ page</Link>.
          </p>
          
          <div className="space-y-4">
            <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">How do I create an account?</h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Click the "Sign Up" button on the homepage, enter your details, and complete the onboarding process.
              </p>
            </div>
            <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">How do I enroll in a course?</h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Browse courses, click on one to view details, and click "Enroll" to add it to your learning path.
              </p>
            </div>
            <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Can I access courses on mobile?</h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Yes! ForexOrbit Academy is fully responsive and works on all devices.
              </p>
            </div>
          </div>
        </div>

        <Link href="/faq" className="block text-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors">
          View Full FAQ Page
        </Link>
      </main>

      <Footer />
    </div>
  );
}

