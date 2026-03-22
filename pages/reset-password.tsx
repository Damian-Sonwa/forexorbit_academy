/**
 * Reset Password — after OTP verification (session from forgot-password flow)
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { apiClient } from '@/lib/api-client';

const PWD_RESET_STORAGE = 'forexorbitPwdReset';

type StoredReset = { resetTicket: string; resetSecret: string; expiresAt: number };

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<StoredReset | null>(null);
  const [sessionError, setSessionError] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(PWD_RESET_STORAGE);
      if (!raw) {
        setSessionError('missing');
        return;
      }
      const parsed = JSON.parse(raw) as StoredReset;
      if (!parsed.resetTicket || !parsed.resetSecret) {
        setSessionError('invalid');
        return;
      }
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
        sessionStorage.removeItem(PWD_RESET_STORAGE);
        setSessionError('expired');
        return;
      }
      setSession(parsed);
    } catch {
      setSessionError('invalid');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!session) return;

    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post('/auth/reset-password', {
        resetTicket: session.resetTicket,
        resetSecret: session.resetSecret,
        password,
      });
      try {
        sessionStorage.removeItem(PWD_RESET_STORAGE);
      } catch {
        /* ignore */
      }
      setSuccess(true);
      setTimeout(() => {
        router.push('/login');
      }, 2500);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      setError(ax.response?.data?.error || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 flex items-center justify-center bg-brand-darker py-8 sm:py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 sm:w-64 sm:h-64 opacity-10">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <path d="M50,50 Q100,0 150,50 T250,50" stroke="#ffffff" strokeWidth="2" fill="none" />
            <path d="M30,100 Q100,50 170,100 T310,100" stroke="#ffffff" strokeWidth="2" fill="none" />
          </svg>
        </div>

        <div className="max-w-md w-full relative z-10 animate-fade-in">
          <div className="bg-nav-bg rounded-xl sm:rounded-2xl shadow-2xl p-6 sm:p-8 border border-white/10">
            <div className="text-center mb-6 sm:mb-8">
              <h2 className="text-nav-text font-bold text-2xl sm:text-3xl mb-3 sm:mb-4">New password</h2>
              <p className="text-sm sm:text-base text-nav-muted">Choose a strong password for your account.</p>
            </div>

            {success ? (
              <div className="space-y-4">
                <div className="p-4 bg-green-900/30 border border-green-700 rounded-xl">
                  <p className="text-green-300 text-sm text-center">
                    Password updated. Redirecting to sign in…
                  </p>
                </div>
                <Link
                  href="/login"
                  className="block w-full text-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors min-h-[48px] flex items-center justify-center"
                >
                  Go to sign in
                </Link>
              </div>
            ) : sessionError ? (
              <div className="space-y-4">
                <div className="p-4 bg-yellow-900/30 border border-yellow-700 rounded-xl">
                  <p className="text-yellow-200 text-sm text-center">
                    {sessionError === 'expired'
                      ? 'This step timed out. Verify your code again from Forgot password.'
                      : 'Open Forgot password, verify your SMS code, then you’ll land here automatically.'}
                  </p>
                </div>
                <Link
                  href="/forgot-password"
                  className="block w-full text-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors min-h-[48px] flex items-center justify-center"
                >
                  Start over
                </Link>
              </div>
            ) : !session ? (
              <p className="text-nav-muted text-sm text-center">Loading…</p>
            ) : (
              <>
                {error && (
                  <div className="mb-6 p-4 bg-accent-500/10 border border-accent-500/40 rounded-xl">
                    <p className="text-accent-200 text-sm">{error}</p>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-nav-muted mb-2">New password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      className="bg-brand-deep border border-white/15 text-nav-text rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400/50 focus:border-transparent w-full mb-2 placeholder:text-nav-muted text-base min-h-[48px]"
                      placeholder="••••••••"
                    />
                    <p className="text-xs text-nav-muted">At least 6 characters</p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-nav-muted mb-2">Confirm password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      className="bg-brand-deep border border-white/15 text-nav-text rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400/50 focus:border-transparent w-full placeholder:text-nav-muted text-base min-h-[48px]"
                      placeholder="••••••••"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-primary-500 hover:bg-primary-600 text-white w-full rounded-xl py-3 font-semibold transition-colors disabled:bg-primary-900/50 disabled:cursor-not-allowed min-h-[48px]"
                  >
                    {loading ? 'Saving…' : 'Save password'}
                  </button>
                </form>
              </>
            )}

            <div className="mt-6 pt-6 border-t border-white/10">
              <p className="text-center text-sm text-nav-muted">
                <Link href="/login" className="text-nav-text hover:underline font-semibold">
                  Back to sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
