/**
 * Footer Component
 * Site footer with links and information
 */

import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';

export default function Footer() {
  return (
    <footer className="bg-nav-bg text-nav-text border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          {/* Brand */}
          <div>
            <Link href="/" aria-label="FX Orbit Academy home" className="mb-6 inline-flex transition-opacity duration-200 hover:opacity-85">
              <BrandLogo variant="light" className="h-11" />
            </Link>
            <p className="text-sm text-nav-muted leading-relaxed">
              Learn Forex trading with expert instructors and real-time market signals.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-nav-text font-bold mb-6 text-lg">Quick Links</h3>
            <ul className="space-y-3">
              <li>
                <Link href="/courses" className="text-sm text-nav-muted hover:text-primary-300 transition-colors flex items-center group">
                  <svg className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Courses
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="text-sm text-nav-muted hover:text-primary-300 transition-colors flex items-center group">
                  <svg className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Dashboard
                </Link>
              </li>
              <li>
                <Link href="/about" className="text-sm text-nav-muted hover:text-primary-300 transition-colors flex items-center group">
                  <svg className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  About
                </Link>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h3 className="text-nav-text font-bold mb-6 text-lg">Support</h3>
            <ul className="space-y-3">
              <li>
                <Link href="/help" className="text-sm text-nav-muted hover:text-primary-300 transition-colors flex items-center group">
                  <svg className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Help Center
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-sm text-nav-muted hover:text-primary-300 transition-colors flex items-center group">
                  <svg className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Contact Us
                </Link>
              </li>
              <li>
                <Link href="/faq" className="text-sm text-nav-muted hover:text-primary-300 transition-colors flex items-center group">
                  <svg className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  FAQ
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-nav-text font-bold mb-6 text-lg">Legal</h3>
            <ul className="space-y-3">
              <li>
                <Link href="/privacy" className="text-sm text-nav-muted hover:text-primary-300 transition-colors flex items-center group">
                  <svg className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-sm text-nav-muted hover:text-primary-300 transition-colors flex items-center group">
                  <svg className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 text-center">
          <p className="text-sm text-nav-muted">
            &copy; {new Date().getFullYear()} ForexOrbit Academy. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

