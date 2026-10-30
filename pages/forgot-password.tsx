/**
 * Forgot Password — request a reset link by email.
 * The confirmation is the same whether or not the address has an account.
 */

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { ButtonLoadingState } from '@/components/loading';
import { apiClient } from '@/lib/api-client';

const PUBLIC_API_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_BASE_URL) ||
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) ||
  '';

type ApiError = {
  code?: string;
  response?: { status?: number; data?: { message?: string; error?: string; retryAfterSec?: number } };
};

function mapForgotPasswordError(err: unknown): string {
  const e = err as ApiError;
  const d = e.response?.data;
  const apiErr = d?.message?.trim() || d?.error?.trim();
  if (apiErr) return apiErr;
  const noResponse = !e.response;
  if (noResponse && (e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED')) {
    if (PUBLIC_API_BASE && PUBLIC_API_BASE !== '/api') {
      return `Cannot reach the API (${PUBLIC_API_BASE}). Check your connection, CORS, and that the backend is running.`;
    }
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Try again.';
}

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sentMessage, setSentMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const waitTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => () => {
    if (waitTimerRef.current) clearInterval(waitTimerRef.current);
  }, []);

  const startWait = (seconds: number) => {
    setRetryAfterSeconds(seconds);
    if (waitTimerRef.current) clearInterval(waitTimerRef.current);
    waitTimerRef.current = setInterval(() => {
      setRetryAfterSeconds((prev) => {
        if (prev <= 1) {
          if (waitTimerRef.current) clearInterval(waitTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const address = email.trim();
    if (!address) {
      setError('Enter the email address on your account.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.post<{ message: string }>('/auth/forgot-password', { email: address });
      setSentMessage(res.message);
    } catch (err: unknown) {
      const e = err as ApiError;
      const wait = e.response?.status === 429 ? Number(e.response.data?.retryAfterSec) : 0;
      if (wait > 0) startWait(wait);
      setError(mapForgotPasswordError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 flex items-center justify-center bg-neutral-50 py-8 sm:py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 sm:w-64 sm:h-64 opacity-10">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <path d="M50,50 Q100,0 150,50 T250,50" stroke="#E5E5E5" strokeWidth="2" fill="none" />
            <path d="M30,100 Q100,50 170,100 T310,100" stroke="#E5E5E5" strokeWidth="2" fill="none" />
          </svg>
        </div>

        <div className="max-w-md w-full relative z-10 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-soft p-6 sm:p-8 border border-neutral-200">
            <div className="text-center mb-6 sm:mb-8">
              <h2 className="text-neutral-900 font-bold text-2xl sm:text-3xl mb-3 sm:mb-4">
                {sentMessage ? 'Check your email' : 'Forgot password'}
              </h2>
              <p className="text-sm sm:text-base text-neutral-600">
                {sentMessage
                  ? 'Open the link in the email to choose a new password.'
                  : 'Enter the email address on your account and we’ll send you a link to reset your password.'}
              </p>
            </div>

            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl" role="alert">
                <p className="text-red-700 text-sm">
                  {error}
                  {retryAfterSeconds > 0 ? ` You can try again in ${retryAfterSeconds}s.` : ''}
                </p>
              </div>
            )}

            {sentMessage ? (
              <div className="space-y-4">
                <div className="p-4 bg-primary-50 border border-primary-200 rounded-xl dark:bg-primary-900/40 dark:border-primary-600/50" role="status">
                  <p className="text-neutral-600 text-sm text-center dark:text-neutral-200">{sentMessage}</p>
                </div>
                <p className="text-xs text-neutral-500 text-center">
                  Didn’t get it? Check your spam folder, or wait a minute and{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setSentMessage('');
                      setError('');
                    }}
                    className="font-semibold text-primary-700 hover:text-primary-600 underline dark:text-primary-300"
                  >
                    request another link
                  </button>
                  .
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="forgot-email" className="block text-sm font-semibold text-neutral-500 mb-2">
                    Email address
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    maxLength={254}
                    className="bg-white border border-neutral-300 text-neutral-900 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400/50 focus:border-transparent w-full text-base placeholder:text-neutral-400"
                    placeholder="you@example.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !email.trim() || retryAfterSeconds > 0}
                  className="bg-primary-600 hover:bg-primary-700 text-white w-full rounded-xl py-3 font-semibold transition-colors disabled:bg-primary-900/50 disabled:cursor-not-allowed min-h-[48px]"
                >
                  {loading ? <ButtonLoadingState loading loadingLabel="Sending link" /> : 'Send reset link'}
                </button>
              </form>
            )}

            <div className="mt-6 pt-6 border-t border-neutral-200">
              <p className="text-center text-sm text-neutral-600">
                Remember your password?{' '}
                <Link href="/login" className="text-neutral-900 hover:underline font-semibold">
                  Sign in
                </Link>
              </p>
              <p className="text-center text-xs text-gray-500 mt-3">
                No longer have access to your email?{' '}
                <Link href="/support" className="underline">
                  Contact support
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
