/**
 * Signup Page
 * User registration
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { AuthFrame, authButtonClass, authFieldClass, authHelperClass, authLabelClass } from '@/components/auth/AuthFrame';
import { ButtonLoadingState } from '@/components/loading';
import { useAuth } from '@/hooks/useAuth';
import { loginHref, safeNextPath } from '@/lib/login-redirect';

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

export default function Signup() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('student');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
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

    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    if (!name.trim()) {
      setError('Please enter your full name');
      return;
    }

    setLoading(true);

    try {
      await signup(normalizedEmail, password, name, role);
      
      // A student who came from a course returns there; onboarding stays optional.
      if (role === 'student' && nextPath) {
        router.push(nextPath);
      } else if (role === 'student') {
        router.push('/onboarding');
      } else {
        router.push('/dashboard');
      }
    } catch (err: unknown) {
      let errorMessage = 'Signup failed. Please try again.';
      const ax = err as {
        message?: string;
        response?: { status?: number; data?: { message?: string; error?: string } };
        code?: string;
      };
      if (ax.response?.data?.message || ax.response?.data?.error) {
        errorMessage =
          ax.response.data.message || ax.response.data.error || errorMessage;
      } else if (err instanceof Error && ax.message) {
        errorMessage = ax.message;
      } else if (ax.response?.status && ax.response.status >= 500) {
        errorMessage = 'Service temporarily unavailable. Please try again later.';
      } else if (ax.response?.status === 408 || ax.code === 'ECONNABORTED') {
        errorMessage = 'Request took too long. Please try again.';
      } else if (ax.message?.includes('timeout') || ax.message?.includes('network')) {
        errorMessage = 'Network issue. Please check your connection and try again.';
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame
      title="Create your account"
      lead="Students and instructors use this form. Instructor accounts are activated after Super Admin approval."
      switcher={
        <>
          Already have an account?{' '}
          <Link href={loginHref(nextPath ?? undefined)} className="font-medium text-primary-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {error ? (
        <p className="mb-5 text-sm leading-relaxed text-[#9f1239]" role="alert">{error}</p>
      ) : null}
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label className={authLabelClass} htmlFor="signup-name">Name</label>
          <input
            id="signup-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
            className={authFieldClass}
          />
        </div>
        <div>
          <label className={authLabelClass} htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className={authFieldClass}
          />
        </div>
        <div>
          <label className={authLabelClass} htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            className={authFieldClass}
          />
          <p className={authHelperClass}>At least 6 characters.</p>
        </div>
        <div>
          <label className={authLabelClass} htmlFor="signup-role">Role</label>
          <select
            id="signup-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={authFieldClass}
          >
            <option value="student">Student</option>
            <option value="instructor">Instructor</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={loading || !email.trim() || !password.trim() || !name.trim()}
          className={authButtonClass}
        >
          {loading ? <ButtonLoadingState loading loadingLabel="Creating account" /> : 'Create account'}
        </button>
      </form>
    </AuthFrame>
  );
}
