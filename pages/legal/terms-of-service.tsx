/**
 * Legal Terms of Service Page
 * Renders terms of service content
 */

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from 'next/link';

export default function LegalTermsOfService() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <nav className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            <Link href="/legal" className="hover:text-primary-600 dark:hover:text-primary-400">Legal</Link>
            <span className="mx-2">/</span>
            <span className="text-gray-900 dark:text-white">Terms of Service</span>
          </nav>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Terms of Service</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            For the complete Terms of Service with all sections and details, visit our <Link href="/terms" className="text-primary-600 dark:text-primary-400 hover:underline font-semibold">main Terms of Service page</Link>.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Overview</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            By accessing or using ForexOrbit Academy, you agree to be bound by these Terms of Service and our Privacy Policy. 
            These terms cover user roles, acceptable use, community guidelines, intellectual property, account security, and more.
          </p>
          <p className="text-gray-600 dark:text-gray-400">
            Our complete Terms of Service includes detailed information about your rights and responsibilities as a user of the platform.
          </p>
        </div>

        <Link href="/terms" className="block text-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors">
          View Complete Terms of Service
        </Link>
      </main>

      <Footer />
    </div>
  );
}

