/**
 * Support Contact Page
 * Renders contact information
 */

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from 'next/link';

export default function SupportContact() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <nav className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            <Link href="/support" className="hover:text-primary-600 dark:hover:text-primary-400">Support</Link>
            <span className="mx-2">/</span>
            <span className="text-gray-900 dark:text-white">Contact Us</span>
          </nav>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Contact Us</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Get in touch with our support team. We're here to help!
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 mb-8">
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            For complete contact information including phone numbers and email addresses, visit our <Link href="/contact" className="text-primary-600 dark:text-primary-400 hover:underline font-semibold">main Contact page</Link>.
          </p>
          
          <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Quick Contact</h3>
            <div className="space-y-3">
              <a href="tel:+2348132446354" className="block text-primary-600 dark:text-primary-400 hover:underline">
                📞 +234 813 244 6354
              </a>
              <a href="mailto:madudamian25@gmail.com" className="block text-primary-600 dark:text-primary-400 hover:underline break-all">
                ✉️ madudamian25@gmail.com
              </a>
            </div>
          </div>
        </div>

        <Link href="/contact" className="block text-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors">
          View Full Contact Page
        </Link>
      </main>

      <Footer />
    </div>
  );
}

