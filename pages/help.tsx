/**
 * Help Center Page
 * Provides guidance and troubleshooting for ForexOrbit Academy users
 */

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from 'next/link';

export default function HelpCenter() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Help Center</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Find answers to common questions and learn how to make the most of ForexOrbit Academy
          </p>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <Link href="/help#getting-started" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow">
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

          <Link href="/help#courses" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow">
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

          <Link href="/help#troubleshooting" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow">
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

        {/* Getting Started Section */}
        <section id="getting-started" className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Getting Started</h2>
          
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Creating Your Account</h3>
              <ol className="list-decimal list-inside space-y-2 text-gray-600 dark:text-gray-400">
                <li>Click the "Sign Up" button on the homepage</li>
                <li>Enter your email, name, and choose a secure password</li>
                <li>Select your role (Student, Instructor, or Admin)</li>
                <li>Complete the email verification if required</li>
                <li>Complete your profile in the onboarding process</li>
              </ol>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Completing Your Profile</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-3">
                After signing up, you'll be guided through an onboarding process where you can:
              </p>
              <ul className="list-disc list-inside space-y-2 text-gray-600 dark:text-gray-400">
                <li>Upload a profile photo</li>
                <li>Set your trading experience level (Beginner, Intermediate, Advanced)</li>
                <li>Select your preferred learning topics</li>
                <li>Configure notification preferences</li>
              </ul>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Navigating Your Dashboard</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-3">
                Your dashboard provides quick access to:
              </p>
              <ul className="list-disc list-inside space-y-2 text-gray-600 dark:text-gray-400">
                <li><strong>Enrolled Courses:</strong> Track your progress in active courses</li>
                <li><strong>Upcoming Classes:</strong> View scheduled live sessions and events</li>
                <li><strong>Progress Overview:</strong> See your learning statistics and achievements</li>
                <li><strong>Leaderboard:</strong> Compare your progress with other students</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Courses & Lessons Section */}
        <section id="courses" className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Courses & Lessons</h2>
          
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Enrolling in Courses</h3>
              <ol className="list-decimal list-inside space-y-2 text-gray-600 dark:text-gray-400">
                <li>Browse available courses from the "Courses" page</li>
                <li>Click on a course to view details, curriculum, and instructor information</li>
                <li>Click "Enroll" to add the course to your learning path</li>
                <li>Access enrolled courses from your dashboard</li>
              </ol>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Taking Lessons</h3>
              <ul className="list-disc list-inside space-y-2 text-gray-600 dark:text-gray-400">
                <li>Lessons can include video content, PDF materials, and interactive quizzes</li>
                <li>Watch videos at your own pace - progress is automatically saved</li>
                <li>Complete quizzes to test your understanding and earn points</li>
                <li>Use the lesson chat to ask questions and interact with other students</li>
                <li>Access lesson summaries and resources for review</li>
              </ul>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Tracking Progress</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-3">
                Your progress is tracked automatically:
              </p>
              <ul className="list-disc list-inside space-y-2 text-gray-600 dark:text-gray-400">
                <li>Lesson completion status is saved in real-time</li>
                <li>Quiz scores contribute to your overall progress</li>
                <li>View detailed progress reports in the "Progress" section</li>
                <li>Earn certificates upon course completion</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Community & Consultations */}
        <section id="community" className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Community & Consultations</h2>
          
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Community Chat</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-3">
                Join level-based trading rooms to connect with other learners:
              </p>
              <ul className="list-disc list-inside space-y-2 text-gray-600 dark:text-gray-400">
                <li>Access rooms based on your learning level (Beginner, Intermediate, Advanced)</li>
                <li>Send text messages, images, videos, and audio recordings</li>
                <li>React to messages with emojis</li>
                <li>Search through message history</li>
                <li>View real-time market updates posted by instructors and admins</li>
              </ul>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Expert Consultations</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-3">
                Get personalized help from expert instructors:
              </p>
              <ol className="list-decimal list-inside space-y-2 text-gray-600 dark:text-gray-400">
                <li>Go to the "Expert Consultation" page</li>
                <li>Select an available expert from the list</li>
                <li>Submit a consultation request with your question or topic</li>
                <li>Wait for the expert to accept your request</li>
                <li>Engage in a private consultation session via chat</li>
              </ol>
            </div>
          </div>
        </section>

        {/* Troubleshooting Section */}
        <section id="troubleshooting" className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Troubleshooting</h2>
          
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Video Not Playing</h3>
              <ul className="list-disc list-inside space-y-2 text-gray-600 dark:text-gray-400">
                <li>Check your internet connection</li>
                <li>Try refreshing the page</li>
                <li>Clear your browser cache and cookies</li>
                <li>Ensure your browser supports HTML5 video (Chrome, Firefox, Safari, Edge)</li>
                <li>Disable browser extensions that might interfere with video playback</li>
              </ul>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Profile Photo Not Uploading</h3>
              <ul className="list-disc list-inside space-y-2 text-gray-600 dark:text-gray-400">
                <li>Ensure the image file is less than 5MB</li>
                <li>Use supported formats: JPG, PNG, or GIF</li>
                <li>Try a different image if the current one fails</li>
                <li>Check your internet connection</li>
                <li>Refresh the page and try again</li>
              </ul>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Chat Messages Not Sending</h3>
              <ul className="list-disc list-inside space-y-2 text-gray-600 dark:text-gray-400">
                <li>Check your internet connection</li>
                <li>Ensure you're connected to the chat (look for the connection indicator)</li>
                <li>Refresh the page to reconnect</li>
                <li>Clear your browser cache</li>
                <li>Try using a different browser</li>
              </ul>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Can't Access Certain Features</h3>
              <ul className="list-disc list-inside space-y-2 text-gray-600 dark:text-gray-400">
                <li>Some features require completing your profile first</li>
                <li>Advanced community rooms unlock as you progress through levels</li>
                <li>Ensure you're logged in with the correct account</li>
                <li>Check if your account status is "approved" (for instructors/admins)</li>
                <li>Contact support if you believe you should have access</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Contact Support */}
        <div className="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Still Need Help?</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Our support team is here to assist you. Reach out through any of these channels:
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/contact" className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors">
              Contact Us
            </Link>
            <Link href="/faq" className="px-6 py-3 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-lg font-semibold transition-colors">
              View FAQ
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

