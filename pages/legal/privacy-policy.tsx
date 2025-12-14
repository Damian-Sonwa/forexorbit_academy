/**
 * Legal Privacy Policy Page
 * Renders privacy policy content
 */

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from 'next/link';

export default function LegalPrivacyPolicy() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <nav className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            <Link href="/legal" className="hover:text-primary-600 dark:hover:text-primary-400">Legal</Link>
            <span className="mx-2">/</span>
            <span className="text-gray-900 dark:text-white">Privacy Policy</span>
          </nav>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Privacy Policy</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            For the complete Privacy Policy with all sections and details, visit our <Link href="/privacy" className="text-primary-600 dark:text-primary-400 hover:underline font-semibold">main Privacy Policy page</Link>.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Overview</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            At ForexOrbit Academy, we are committed to protecting your privacy and ensuring the security of your personal information. 
            We collect and use your data to provide, maintain, and improve our educational services.
          </p>
          <p className="text-gray-600 dark:text-gray-400">
            Our complete Privacy Policy covers information collection, usage, storage, security, your rights, and more.
          </p>
        </div>

        <Link href="/privacy" className="block text-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors">
          View Complete Privacy Policy
        </Link>
      </main>

      <Footer />
    </div>
  );
}

