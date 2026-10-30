/**
 * Reset Password — landing page for the emailed link (/reset-password#token=...).
 * The token is read from the URL fragment, which browsers never send to a server, and is removed
 * from the address bar at once. It is sent only with the new password.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { ButtonLoadingState } from '@/components/loading';
import { apiClient } from '@/lib/api-client';
import { PASSWORD_MIN_CHARS, checkNewPassword } from '@/lib/password-policy';

/** Link problems the server reports; each ends the form and offers a new link. */
const LINK_PROBLEMS: Record<string, string> = {
  invalid_token: 'This reset link is not valid. Request a new link to reset your password.',
  expired_token: 'This reset link has expired. Request a new link to reset your password.',
  used_token: 'This reset link has already been used. Request a new link if you still need to reset your password.',
  superseded_token: 'A newer reset link has been sent. Use the most recent email, or request a new link.',
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function tokenFromFragment(hash: string): string {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('token') || '';
  return TOKEN_PATTERN.test(value) ? value : '';
}

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState('');
  const [linkProblem, setLinkProblem] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const found = tokenFromFragment(window.location.hash);
    if (window.location.hash) {
      // Keep the token out of browser history and anything copied from the address bar.
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
    if (found) setToken(found);
    else setLinkProblem(LINK_PROBLEMS.invalid_token);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token) return;

    const policy = checkNewPassword(password);
    if (!policy.ok) {
      setError(policy.error);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post('/auth/reset-password', { token, password });
      setToken('');
      setPassword('');
      setConfirmPassword('');
      setSuccess(true);
      setTimeout(() => {
        router.push('/login');
      }, 2500);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string; error?: string; code?: string } } };
      const code = ax.response?.data?.code;
      if (code && LINK_PROBLEMS[code]) {
        setToken('');
        setLinkProblem(LINK_PROBLEMS[code]);
      } else {
        setError(ax.response?.data?.message || ax.response?.data?.error || 'Failed to reset password. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Head>
        <meta name="referrer" content="no-referrer" />
      </Head>
      <Header />

      <main className="flex-1 flex items-center justify-center bg-neutral-50 py-8 sm:py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 sm:w-64 sm:h-64 opacity-10">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <path d="M50,50 Q100,0 150,50 T250,50" stroke="#E5E5E5" strokeWidth="2" fill="none" />
            <path d="M30,100 Q100,50 170,100 T310,100" stroke="#E5E5E5" strokeWidth="2" fill="none" />
          </svg>
        </div>

        <div className="max-w-md w-full relative z-10 animate-fade-in">
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-sm border border-neutral-200 p-6 sm:p-8 border border-neutral-200">
            <div className="text-center mb-6 sm:mb-8">
              <h2 className="text-neutral-900 font-bold text-2xl sm:text-3xl mb-3 sm:mb-4">New password</h2>
              <p className="text-sm sm:text-base text-neutral-500">Choose a strong password for your account.</p>
            </div>

            {success ? (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl dark:bg-green-900/30 dark:border-green-700" role="status">
                  <p className="text-green-800 text-sm text-center dark:text-green-300">
                    Password updated. You have been signed out everywhere. Redirecting to sign in…
                  </p>
                </div>
                <Link
                  href="/login"
                  className="block w-full text-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors min-h-[48px] flex items-center justify-center"
                >
                  Go to sign in
                </Link>
              </div>
            ) : linkProblem ? (
              <div className="space-y-4">
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl dark:bg-yellow-900/30 dark:border-yellow-700" role="alert">
                  <p className="text-amber-900 text-sm text-center dark:text-primary-300">{linkProblem}</p>
                </div>
                <Link
                  href="/forgot-password"
                  className="block w-full text-center px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors min-h-[48px] flex items-center justify-center"
                >
                  Request a new link
                </Link>
              </div>
            ) : !token ? (
              <p className="text-neutral-500 text-sm text-center">Loading…</p>
            ) : (
              <>
                {error && (
                  <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl" role="alert">
                    <p className="text-red-700 text-sm">{error}</p>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="new-password" className="block text-sm font-semibold text-neutral-500 mb-2">New password</label>
                    <input
                      id="new-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={PASSWORD_MIN_CHARS}
                      autoComplete="new-password"
                      className="bg-white border border-neutral-300 text-neutral-900 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400/50 focus:border-transparent w-full mb-2 placeholder:text-neutral-400 text-base min-h-[48px]"
                      placeholder="••••••••"
                    />
                    <p className="text-xs text-neutral-500">At least {PASSWORD_MIN_CHARS} characters</p>
                  </div>

                  <div>
                    <label htmlFor="confirm-password" className="block text-sm font-semibold text-neutral-500 mb-2">Confirm password</label>
                    <input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={PASSWORD_MIN_CHARS}
                      autoComplete="new-password"
                      className="bg-white border border-neutral-300 text-neutral-900 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400/50 focus:border-transparent w-full placeholder:text-neutral-400 text-base min-h-[48px]"
                      placeholder="••••••••"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-primary-600 hover:bg-primary-700 text-white w-full rounded-xl py-3 font-semibold transition-colors disabled:bg-primary-900/50 disabled:cursor-not-allowed min-h-[48px]"
                  >
                    {loading ? <ButtonLoadingState loading loadingLabel="Saving password" /> : 'Save password'}
                  </button>
                </form>
              </>
            )}

            <div className="mt-6 pt-6 border-t border-neutral-200">
              <p className="text-center text-sm text-neutral-500">
                <Link href="/login" className="text-neutral-900 hover:underline font-semibold">
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
