/**
 * Terms of Service Page
 * Comprehensive terms covering user roles, acceptable use, and responsibilities
 */

import Header from '@/components/Header';
import Footer from '@/components/Footer';

export default function TermsOfService() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Terms of Service</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-2">
            Last Updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
          <p className="text-gray-600 dark:text-gray-400">
            Please read these Terms of Service carefully before using ForexOrbit Academy.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 space-y-8">
          {/* Acceptance of Terms */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">1. Acceptance of Terms</h2>
            <p className="text-gray-600 dark:text-gray-400">
              By accessing or using ForexOrbit Academy, you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree to these terms, please do not use our platform.
            </p>
          </section>

          {/* User Roles and Responsibilities */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">2. User Roles and Responsibilities</h2>
            
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Students</h3>
                <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400 ml-4">
                  <li>Students have access to courses, lessons, quizzes, and community features</li>
                  <li>Must complete profile onboarding to access all features</li>
                  <li>Responsible for maintaining the confidentiality of their account credentials</li>
                  <li>Must provide accurate information during registration and profile setup</li>
                  <li>Can enroll in courses, track progress, and earn certificates</li>
                  <li>Can participate in community chat and request expert consultations</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Instructors</h3>
                <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400 ml-4">
                  <li>Instructors must be approved by administrators before gaining full access</li>
                  <li>Can create and manage courses, lessons, and quizzes</li>
                  <li>Can post upcoming classes and events visible to students</li>
                  <li>Can provide expert consultations to students</li>
                  <li>Can post market updates and news in the community</li>
                  <li>Responsible for providing accurate, educational content</li>
                  <li>Must maintain professional conduct in all interactions</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Administrators</h3>
                <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400 ml-4">
                  <li>Admins have full access to platform management features</li>
                  <li>Can approve or reject instructor and admin registrations</li>
                  <li>Can manage users, courses, and platform content</li>
                  <li>Can view analytics and platform statistics</li>
                  <li>Can issue certificates and manage certificate templates</li>
                  <li>Responsible for maintaining platform security and user safety</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Acceptable Use */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">3. Acceptable Use Policy</h2>
            
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>You agree NOT to:</p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Share your account credentials with others or create multiple accounts</li>
                <li>Use the platform for any illegal or unauthorized purpose</li>
                <li>Upload malicious software, viruses, or harmful content</li>
                <li>Harass, abuse, or harm other users in community chat or consultations</li>
                <li>Post spam, advertisements, or unsolicited promotional content</li>
                <li>Impersonate other users, instructors, or administrators</li>
                <li>Attempt to gain unauthorized access to platform systems or other users' accounts</li>
                <li>Reverse engineer, decompile, or attempt to extract source code</li>
                <li>Use automated systems (bots, scrapers) to access the platform</li>
                <li>Violate any applicable laws or regulations</li>
              </ul>
            </div>
          </section>

          {/* Community Guidelines */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">4. Community Guidelines</h2>
            
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>When using community features (chat, consultations, forums), you must:</p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Be respectful and professional in all communications</li>
                <li>Stay on topic and contribute constructively to discussions</li>
                <li>Respect intellectual property rights - do not share copyrighted material without permission</li>
                <li>Report inappropriate behavior or content to administrators</li>
                <li>Follow level-based room access rules (access rooms appropriate to your learning level)</li>
                <li>Maintain confidentiality of private consultation sessions</li>
              </ul>
              <p className="mt-4">
                Violations of community guidelines may result in warnings, temporary suspension, or permanent account termination.
              </p>
            </div>
          </section>

          {/* Intellectual Property */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">5. Intellectual Property</h2>
            
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>
                All content on ForexOrbit Academy, including but not limited to:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Course materials, lessons, and quizzes</li>
                <li>Platform design, logos, and branding</li>
                <li>Software code and functionality</li>
                <li>Documentation and help materials</li>
              </ul>
              <p className="mt-4">
                ...is the property of ForexOrbit Academy or its content providers and is protected by copyright and other intellectual property laws.
              </p>
              <p>
                You may not reproduce, distribute, modify, or create derivative works from platform content without explicit written permission.
              </p>
              <p className="mt-4">
                <strong>User-Generated Content:</strong> By uploading content (messages, files, profile photos), you grant ForexOrbit Academy a license to use, display, and distribute that content within the platform.
              </p>
            </div>
          </section>

          {/* Account Security */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">6. Account Security</h2>
            
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>You are responsible for:</p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Maintaining the confidentiality of your account password</li>
                <li>All activities that occur under your account</li>
                <li>Notifying us immediately of any unauthorized access or security breaches</li>
                <li>Using a strong, unique password</li>
                <li>Logging out when using shared devices</li>
              </ul>
              <p className="mt-4">
                ForexOrbit Academy is not liable for any loss or damage resulting from unauthorized access to your account due to your failure to maintain account security.
              </p>
            </div>
          </section>

          {/* Service Availability */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">7. Service Availability and Modifications</h2>
            
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>
                We strive to provide reliable service but do not guarantee:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Uninterrupted or error-free service</li>
                <li>That all features will always be available</li>
                <li>That the platform will be free from viruses or harmful components</li>
              </ul>
              <p className="mt-4">
                We reserve the right to modify, suspend, or discontinue any part of the platform at any time with or without notice. We may also update features, remove content, or change functionality as needed.
              </p>
            </div>
          </section>

          {/* Limitation of Liability */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">8. Limitation of Liability</h2>
            
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>
                To the maximum extent permitted by law:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>ForexOrbit Academy is provided "as is" without warranties of any kind</li>
                <li>We are not liable for any indirect, incidental, or consequential damages</li>
                <li>We are not responsible for trading losses or financial decisions made based on educational content</li>
                <li>Educational content is for informational purposes only and does not constitute financial advice</li>
                <li>We do not guarantee specific learning outcomes or results</li>
              </ul>
            </div>
          </section>

          {/* Termination */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">9. Account Termination</h2>
            
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>We may terminate or suspend your account if you:</p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Violate these Terms of Service</li>
                <li>Engage in fraudulent or illegal activities</li>
                <li>Fail to pay required fees (if applicable)</li>
                <li>Request account deletion</li>
              </ul>
              <p className="mt-4">
                You may terminate your account at any time by contacting support. Upon termination, your access to the platform will cease, and we may delete your account data in accordance with our Privacy Policy.
              </p>
            </div>
          </section>

          {/* Changes to Terms */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">10. Changes to Terms</h2>
            
            <p className="text-gray-600 dark:text-gray-400">
              We reserve the right to modify these Terms of Service at any time. We will notify users of significant changes by posting the updated terms on this page and updating the "Last Updated" date. Your continued use of the platform after changes become effective constitutes acceptance of the updated terms.
            </p>
          </section>

          {/* Contact Information */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">11. Contact Information</h2>
            
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              If you have questions about these Terms of Service, please contact us:
            </p>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 space-y-2">
              <p className="text-gray-900 dark:text-white"><strong>Email:</strong> <a href="mailto:madudamian25@gmail.com" className="text-primary-600 dark:text-primary-400 hover:underline">madudamian25@gmail.com</a></p>
              <p className="text-gray-900 dark:text-white"><strong>Phone:</strong> <a href="tel:+2348132446354" className="text-primary-600 dark:text-primary-400 hover:underline">+234 813 244 6354</a></p>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}

