/**
 * About Page
 * Information about ForexOrbit Academy
 */

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from 'next/link';

export default function About() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">About ForexOrbit Academy</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Empowering traders through expert education and real-time market insights
          </p>
        </div>

        {/* Mission Section */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Our Mission</h2>
          <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
            ForexOrbit Academy is dedicated to providing comprehensive Forex trading education to traders of all levels. 
            We combine expert instruction, interactive learning, and real-time market signals to create an immersive 
            educational experience that prepares you for success in the Forex markets.
          </p>
        </section>

        {/* What We Offer */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">What We Offer</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Comprehensive Courses</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Structured courses covering everything from Forex basics to advanced trading strategies, 
                technical analysis, and risk management.
              </p>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Interactive Learning</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Video lessons, quizzes, and interactive content designed to reinforce your understanding 
                and track your progress.
              </p>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Expert Consultations</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Get personalized guidance from experienced instructors through one-on-one consultation sessions.
              </p>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Community Support</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Connect with fellow traders in level-based community rooms, share insights, and learn together.
              </p>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Real-Time Market Signals</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Stay updated with live market signals and analysis from our expert instructors.
              </p>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Certificates</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Earn digital certificates upon course completion to showcase your achievements.
              </p>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="bg-gradient-to-br from-primary-600 to-primary-700 rounded-xl shadow-md p-8 mb-8 text-white">
          <h2 className="text-2xl font-bold mb-6 text-center">Our Impact</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div>
              <div className="text-3xl font-bold mb-2">500+</div>
              <div className="text-primary-100">Active Users</div>
            </div>
            <div>
              <div className="text-3xl font-bold mb-2">50+</div>
              <div className="text-primary-100">Expert Courses</div>
            </div>
            <div>
              <div className="text-3xl font-bold mb-2">95%</div>
              <div className="text-primary-100">Success Rate</div>
            </div>
            <div>
              <div className="text-3xl font-bold mb-2">24/7</div>
              <div className="text-primary-100">Support Available</div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <div className="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Ready to Start Learning?</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Join ForexOrbit Academy today and begin your journey to Forex trading mastery.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/signup"
              className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors"
            >
              Sign Up Free
            </Link>
            <Link
              href="/courses"
              className="px-6 py-3 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-lg font-semibold transition-colors"
            >
              Browse Courses
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}


