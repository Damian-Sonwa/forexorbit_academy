/**
 * Privacy Policy Page
 * Comprehensive privacy policy based on app features and data handling
 */

import Header from '@/components/Header';
import Footer from '@/components/Footer';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Privacy Policy</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-2">
            Last Updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
          <p className="text-gray-600 dark:text-gray-400">
            At ForexOrbit Academy, we are committed to protecting your privacy and ensuring the security of your personal information.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 space-y-8">
          {/* Information We Collect */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">1. Information We Collect</h2>
            
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Account Information</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-2">
                  When you create an account, we collect:
                </p>
                <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400 ml-4">
                  <li>Name and email address</li>
                  <li>Password (encrypted and never stored in plain text)</li>
                  <li>Role selection (Student, Instructor, or Admin)</li>
                  <li>Profile photo (if uploaded)</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Profile Data</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-2">
                  During onboarding and profile updates, we may collect:
                </p>
                <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400 ml-4">
                  <li>Date of birth and gender</li>
                  <li>Contact number</li>
                  <li>Education level and certifications</li>
                  <li>Trading experience level (Beginner, Intermediate, Advanced)</li>
                  <li>Years of trading experience</li>
                  <li>Preferred learning topics</li>
                  <li>Notification preferences</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Learning Data</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-2">
                  As you use the platform, we automatically collect:
                </p>
                <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400 ml-4">
                  <li>Course enrollment and completion status</li>
                  <li>Lesson progress and viewing history</li>
                  <li>Quiz scores and performance data</li>
                  <li>Points and achievements</li>
                  <li>Certificate completion records</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Communication Data</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-2">
                  When you use community features, we collect:
                </p>
                <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400 ml-4">
                  <li>Chat messages and communications</li>
                  <li>Files uploaded to chat (images, videos, audio, documents)</li>
                  <li>Consultation requests and session data</li>
                  <li>Reactions and interactions with messages</li>
                </ul>
              </div>
            </div>
          </section>

          {/* How We Use Your Information */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">2. How We Use Your Information</h2>
            
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>
                We use the information we collect to:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Provide, maintain, and improve our services</li>
                <li>Personalize your learning experience</li>
                <li>Track your progress and achievements</li>
                <li>Enable communication features (chat, consultations)</li>
                <li>Send you notifications and updates (based on your preferences)</li>
                <li>Process and issue certificates upon course completion</li>
                <li>Respond to your support requests</li>
                <li>Ensure platform security and prevent fraud</li>
                <li>Comply with legal obligations</li>
              </ul>
            </div>
          </section>

          {/* Data Storage and Security */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">3. Data Storage and Security</h2>
            
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>
                We implement industry-standard security measures to protect your data:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>All data is stored securely in MongoDB databases with encryption at rest</li>
                <li>Passwords are hashed using secure algorithms and never stored in plain text</li>
                <li>Profile images and uploaded files are stored securely</li>
                <li>We use HTTPS encryption for all data transmission</li>
                <li>Access to personal data is restricted to authorized personnel only</li>
                <li>Regular security audits and updates are performed</li>
              </ul>
            </div>
          </section>

          {/* Data Sharing */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">4. Data Sharing and Disclosure</h2>
            
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>
                We do not sell your personal information. We may share your data only in the following circumstances:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li><strong>With Your Consent:</strong> When you explicitly agree to share information</li>
                <li><strong>Service Providers:</strong> With trusted third-party services that help us operate the platform (hosting, analytics)</li>
                <li><strong>Legal Requirements:</strong> When required by law or to protect our rights</li>
                <li><strong>Community Features:</strong> Your name and profile photo may be visible to other users in community chat and consultations</li>
                <li><strong>Instructors and Admins:</strong> May have access to your learning progress for educational purposes</li>
              </ul>
            </div>
          </section>

          {/* Your Rights */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">5. Your Rights and Choices</h2>
            
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>You have the right to:</p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li><strong>Access:</strong> Request a copy of your personal data</li>
                <li><strong>Update:</strong> Modify your profile information at any time through your account settings</li>
                <li><strong>Delete:</strong> Request deletion of your account and associated data</li>
                <li><strong>Opt-Out:</strong> Adjust notification preferences in your profile settings</li>
                <li><strong>Data Portability:</strong> Request your data in a portable format</li>
              </ul>
              <p className="mt-4">
                To exercise these rights, please contact us at <a href="mailto:madudamian25@gmail.com" className="text-primary-600 dark:text-primary-400 hover:underline">madudamian25@gmail.com</a>
              </p>
            </div>
          </section>

          {/* Cookies and Tracking */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">6. Cookies and Tracking Technologies</h2>
            
            <div className="space-y-3 text-gray-600 dark:text-gray-400">
              <p>
                We use cookies and similar technologies to:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Maintain your login session</li>
                <li>Remember your preferences</li>
                <li>Analyze platform usage and improve our services</li>
                <li>Enable real-time features (Socket.io connections)</li>
              </ul>
              <p className="mt-4">
                You can control cookies through your browser settings, though this may affect platform functionality.
              </p>
            </div>
          </section>

          {/* Children's Privacy */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">7. Children's Privacy</h2>
            
            <p className="text-gray-600 dark:text-gray-400">
              ForexOrbit Academy is not intended for users under the age of 18. We do not knowingly collect personal information from children. If you believe we have collected information from a child, please contact us immediately.
            </p>
          </section>

          {/* Changes to Privacy Policy */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">8. Changes to This Privacy Policy</h2>
            
            <p className="text-gray-600 dark:text-gray-400">
              We may update this Privacy Policy from time to time. We will notify you of any significant changes by posting the new policy on this page and updating the "Last Updated" date. Your continued use of the platform after changes become effective constitutes acceptance of the updated policy.
            </p>
          </section>

          {/* Contact Information */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">9. Contact Us</h2>
            
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              If you have questions or concerns about this Privacy Policy or our data practices, please contact us:
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




