/**
 * Signup Page
 * User registration
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { ButtonLoadingState } from '@/components/loading';
import { useAuth } from '@/hooks/useAuth';

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
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('student');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const router = useRouter();

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

    if (!phone.trim()) {
      setError('Phone number is required for account recovery (SMS verification)');
      return;
    }

    setLoading(true);

    try {
      await signup(normalizedEmail, password, name, role, phone.trim());
      
      // Redirect students to onboarding, others to dashboard
      if (role === 'student') {
        router.push('/onboarding');
      } else {
        router.push('/dashboard');
      }
    } catch (err: any) {
      // Map errors safely without exposing backend details
      let errorMessage = 'Signup failed. Please try again.';
      
      if (err.message) {
        // Use the error message from useAuth or API
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
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 flex items-center justify-center bg-neutral-50 py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        {/* Subtle background decoration */}
        <div className="absolute top-0 left-0 w-64 h-64 opacity-10">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <circle cx="50" cy="50" r="3" fill="#E5E5E5" />
            <circle cx="100" cy="80" r="3" fill="#E5E5E5" />
            <circle cx="150" cy="50" r="3" fill="#E5E5E5" />
            <circle cx="80" cy="120" r="3" fill="#E5E5E5" />
            <circle cx="120" cy="150" r="3" fill="#E5E5E5" />
          </svg>
        </div>

        <div className="max-w-md w-full relative z-10 animate-fade-in">
          {/* Benefit Section */}
          <div className="mb-6 text-center">
            <div className="flex items-center justify-center gap-6 text-sm text-neutral-900/90 mb-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-neutral-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <span>Learn from expert traders</span>
              </div>
            </div>
            <div className="flex items-center justify-center gap-6 text-sm text-neutral-900/90">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-neutral-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Practical lessons</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-neutral-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <span>Beginner-friendly</span>
              </div>
            </div>
          </div>

          <div className="bg-white shadow-sm border border-neutral-200 rounded-2xl p-8 border border-neutral-200">
            <div className="text-center mb-8">
              <h2 className="text-neutral-900 font-bold text-3xl mb-4">Create Account</h2>
              <p className="text-neutral-500">Start your Forex trading journey today</p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-neutral-500 mb-2">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="bg-white border border-neutral-300 text-neutral-900 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400/50 focus:border-transparent w-full mb-4 placeholder:text-neutral-400"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-neutral-500 mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-white border border-neutral-300 text-neutral-900 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400/50 focus:border-transparent w-full mb-4 placeholder:text-neutral-400"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-neutral-500 mb-2">Phone</label>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className="bg-white border border-neutral-300 text-neutral-900 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400/50 focus:border-transparent w-full mb-1 placeholder:text-neutral-400 text-base"
                  placeholder="+234 801 234 5678"
                />
                <p className="text-xs text-neutral-500 mb-4">
                  Used for password reset via SMS. Include country code.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-neutral-500 mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="bg-white border border-neutral-300 text-neutral-900 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400/50 focus:border-transparent w-full mb-4 placeholder:text-neutral-400"
                  placeholder="••••••••"
                />
                <p className="text-xs text-neutral-500 mt-1">Minimum 6 characters</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-neutral-500 mb-2">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="bg-white border border-neutral-300 text-neutral-900 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400/50 focus:border-transparent w-full mb-4"
                >
                  <option value="student">Student</option>
                  <option value="instructor">Instructor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={loading || !email.trim() || !password.trim() || !name.trim() || !phone.trim()}
                className="bg-primary-600 hover:bg-primary-700 text-white w-full rounded-xl py-3 font-semibold transition-colors disabled:bg-primary-900/50 disabled:cursor-not-allowed"
              >
                {loading ? <ButtonLoadingState loading loadingLabel="Creating account" /> : 'Sign Up'}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-primary-400/30">
              <p className="text-center text-sm text-gray-200">
                Already have an account?{' '}
                <Link href="/login" className="text-white hover:underline font-semibold">
                  Sign In
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

