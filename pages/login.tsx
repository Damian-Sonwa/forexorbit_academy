/**
 * Login Page
 * User authentication
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { AuthFrame, authButtonClass, authFieldClass, authLabelClass } from '@/components/auth/AuthFrame';
import { ButtonLoadingState } from '@/components/loading';
import { useAuth } from '@/hooks/useAuth';
import { safeNextPath, signupHref } from '@/lib/login-redirect';

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

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();
  const nextPath = safeNextPath(router.query.next);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
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

    try {
      await login(normalizedEmail, password);
      
      router.push(nextPath ?? '/dashboard');
    } catch (err: any) {
      // Map errors safely without exposing backend details
      let errorMessage = 'Login failed. Please check your credentials.';
      
      if (err.message) {
        // Use the error message from useAuth (which already handles API errors)
        errorMessage = err.message;
      } else if (err.response) {
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
    <AuthFrame
      title="Sign in"
      lead="Use the email and password for your ForexOrbit account."
      switcher={
        <>
          New to ForexOrbit?{' '}
          <Link href={signupHref(nextPath ?? undefined)} className="font-medium text-[#9A4E0C] hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {error ? (
        <p className="mb-5 text-sm leading-relaxed text-[#9f1239]" role="alert">{error}</p>
      ) : null}
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label className={authLabelClass} htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className={authFieldClass}
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label className={authLabelClass} htmlFor="login-password">Password</label>
            <Link href="/forgot-password" className="text-sm font-medium text-[#9A4E0C] hover:underline">
              Forgot password?
            </Link>
          </div>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className={authFieldClass}
          />
        </div>
        <button
          type="submit"
          disabled={loading || !email.trim() || !password.trim()}
          className={authButtonClass}
        >
          {loading ? <ButtonLoadingState loading loadingLabel="Signing in" /> : 'Sign in'}
        </button>
      </form>
    </AuthFrame>
  );
}

