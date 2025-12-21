/**
 * Forgot Password Page
 * Allows users to request password reset
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { apiClient } from '@/lib/api-client';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);

    try {
      await apiClient.post('/auth/forgot-password', { email });
      setSuccess(true);
    } catch (err: any) {
      // Always show success message (security: don't reveal if email exists)
      setSuccess(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 flex items-center justify-center bg-[#00273F] py-8 sm:py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        {/* Subtle background decoration */}
        <div className="absolute top-0 right-0 w-48 h-48 sm:w-64 sm:h-64 opacity-10">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <path d="M50,50 Q100,0 150,50 T250,50" stroke="#ffffff" strokeWidth="2" fill="none" />
            <path d="M30,100 Q100,50 170,100 T310,100" stroke="#ffffff" strokeWidth="2" fill="none" />
            <path d="M10,150 Q100,100 190,150 T370,150" stroke="#ffffff" strokeWidth="2" fill="none" />
          </svg>
        </div>

        <div className="max-w-md w-full relative z-10 animate-fade-in">
          <div className="bg-[#003153] rounded-xl sm:rounded-2xl shadow-2xl p-6 sm:p-8 border border-[#001a2e]">
            <div className="text-center mb-6 sm:mb-8">
              <h2 className="text-white font-bold text-2xl sm:text-3xl mb-3 sm:mb-4">Forgot Password</h2>
              <p className="text-sm sm:text-base text-gray-300">
                Enter your email address and we'll send you a link to reset your password.
              </p>
            </div>

            {success ? (
              <div className="space-y-4">
                <div className="p-4 bg-green-900/30 border border-green-700 rounded-xl">
                  <p className="text-green-300 text-sm text-center">
                    If an account with that email exists, a password reset link has been sent. Please check your email.
                  </p>
                </div>
                <Link
                  href="/login"
                  className="block w-full text-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors"
                >
                  Back to Login
                </Link>
              </div>
            ) : (
              <>
                {error && (
                  <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-xl">
                    <p className="text-red-300 text-sm">{error}</p>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-200 mb-2">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="bg-[#001a2e] border border-gray-600 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-white/50 focus:border-transparent w-full mb-4 placeholder-gray-400"
                      placeholder="you@example.com"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-white text-[#003153] hover:bg-gray-100 w-full rounded-xl py-3 font-semibold transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center">
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Sending...
                      </span>
                    ) : (
                      'Send Reset Link'
                    )}
                  </button>
                </form>

                <div className="mt-6 pt-6 border-t border-gray-600">
                  <p className="text-center text-sm text-gray-300">
                    Remember your password?{' '}
                    <Link href="/login" className="text-white hover:underline font-semibold">
                      Sign In
                    </Link>
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

