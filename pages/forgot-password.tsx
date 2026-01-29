/**
 * Forgot Password Page
 * Allows users to request password reset
 */

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { apiClient } from '@/lib/api-client';

// Helper function to normalize email (trim + lowercase)
const normalizeEmail = (email: string): string => {
  return email.trim().toLowerCase();
};

// Helper function to validate email format
const isValidEmail = (email: string): boolean => {
  if (!email || !email.includes('@')) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [lastEmailSent, setLastEmailSent] = useState<string | null>(null);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const router = useRouter();

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    // Client-side validation
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      setError('Please enter your email address');
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);

    // Development-only logging
    if (process.env.NODE_ENV === 'development') {
      console.log('Password reset requested for:', normalizedEmail);
    }

    try {
      const response = await apiClient.post('/auth/forgot-password', { email: normalizedEmail });
      setSuccess(true);
      setLastEmailSent(normalizedEmail);
      
      // Start 60-second cooldown timer (or use cooldown from API response if provided)
      const cooldownSeconds = (response as any)?.data?.cooldown || 60;
      setResendCooldown(cooldownSeconds);
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
      }
      cooldownTimerRef.current = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            if (cooldownTimerRef.current) {
              clearInterval(cooldownTimerRef.current);
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      // Development-only logging
      if (process.env.NODE_ENV === 'development') {
        console.log('Password reset email sent successfully');
      }
    } catch (err: any) {
      // Map errors safely without exposing backend details
      // Security: Always show success for 4xx errors (don't reveal if email exists)
      // Only show error for network/server issues (5xx, timeouts, network errors)
      
      let shouldShowError = false;
      let errorMessage = '';
      
      if (err.response) {
        const status = err.response.status;
        if (status >= 500) {
          // Server errors - show error message
          shouldShowError = true;
          errorMessage = 'Service temporarily unavailable. Please try again later.';
        } else if (status === 408 || err.code === 'ECONNABORTED') {
          // Timeout errors - show error message
          shouldShowError = true;
          errorMessage = 'Request took too long. Please try again.';
        } else {
          // 4xx errors (including 400, 404, etc.) - show success for security
          setSuccess(true);
          setLastEmailSent(normalizedEmail);
          setLoading(false);
          return;
        }
      } else if (err.message?.includes('timeout') || err.message?.includes('network') || err.code === 'ECONNREFUSED') {
        // Network errors - show error message
        shouldShowError = true;
        errorMessage = 'Network issue. Please check your connection and try again.';
      } else {
        // Unknown errors - default to success for security
        setSuccess(true);
        setLastEmailSent(normalizedEmail);
        setLoading(false);
        return;
      }

      // Show error only for network/server issues
      if (shouldShowError) {
        setError(errorMessage);
      } else {
        // Fallback to success
        setSuccess(true);
        setLastEmailSent(normalizedEmail);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || !lastEmailSent) return;

    setError('');
    setLoading(true);

    // Development-only logging
    if (process.env.NODE_ENV === 'development') {
      console.log('Resending password reset email for:', lastEmailSent);
    }

    try {
      const response = await apiClient.post('/auth/forgot-password', { email: lastEmailSent });
      
      // Start 60-second cooldown (or use cooldown from API response if provided)
      const cooldownSeconds = (response as any)?.data?.cooldown || 60;
      setResendCooldown(cooldownSeconds);
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
      }
      cooldownTimerRef.current = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            if (cooldownTimerRef.current) {
              clearInterval(cooldownTimerRef.current);
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Development-only logging
      if (process.env.NODE_ENV === 'development') {
        console.log('Password reset email resent successfully');
      }
    } catch (err: any) {
      // Map errors safely
      let errorMessage = 'Network issue. Please try again.';
      
      if (err.response) {
        const status = err.response.status;
        if (status >= 500) {
          errorMessage = 'Service temporarily unavailable. Please try again later.';
        } else if (status === 408 || err.code === 'ECONNABORTED') {
          errorMessage = 'Request took too long. Please try again.';
        }
      } else if (err.message?.includes('timeout') || err.message?.includes('network')) {
        errorMessage = 'Network issue. Please check your connection and try again.';
      }

      setError(errorMessage);
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
                  <p className="text-green-300 text-sm text-center mb-2">
                    If this email exists, a reset link has been sent.
                  </p>
                  <p className="text-green-200 text-xs text-center">
                    Didn't receive it? Check Spam or Promotions, or try again.
                  </p>
                </div>
                
                {lastEmailSent && (
                  <button
                    onClick={handleResend}
                    disabled={resendCooldown > 0 || loading}
                    className="w-full px-6 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-colors"
                  >
                    {resendCooldown > 0 ? (
                      `Resend in ${resendCooldown}s`
                    ) : (
                      'Resend Reset Email'
                    )}
                  </button>
                )}
                
                <Link
                  href="/login"
                  className="block w-full text-center px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-semibold transition-colors"
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
                    disabled={loading || !email.trim()}
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

