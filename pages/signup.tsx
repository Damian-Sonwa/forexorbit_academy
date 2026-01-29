/**
 * Signup Page
 * User registration
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
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

    setLoading(true);

    // Development-only logging
    if (process.env.NODE_ENV === 'development') {
      console.log('Signup attempted for:', normalizedEmail, 'role:', role);
    }

    try {
      await signup(normalizedEmail, password, name, role);
      
      // Development-only logging
      if (process.env.NODE_ENV === 'development') {
        console.log('Signup successful');
      }
      
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

      <main className="flex-1 flex items-center justify-center bg-[#0d47a1] py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        {/* Subtle background decoration */}
        <div className="absolute top-0 left-0 w-64 h-64 opacity-10">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <circle cx="50" cy="50" r="3" fill="#ffffff" />
            <circle cx="100" cy="80" r="3" fill="#ffffff" />
            <circle cx="150" cy="50" r="3" fill="#ffffff" />
            <circle cx="80" cy="120" r="3" fill="#ffffff" />
            <circle cx="120" cy="150" r="3" fill="#ffffff" />
          </svg>
        </div>

        <div className="max-w-md w-full relative z-10 animate-fade-in">
          {/* Benefit Section */}
          <div className="mb-6 text-center">
            <div className="flex items-center justify-center gap-6 text-sm text-white/90 mb-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <span>Learn from expert traders</span>
              </div>
            </div>
            <div className="flex items-center justify-center gap-6 text-sm text-white/90">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Practical lessons</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <span>Beginner-friendly</span>
              </div>
            </div>
          </div>

          <div className="bg-[#1565C0] shadow-2xl rounded-2xl p-8 border border-[#0d47a1]">
            <div className="text-center mb-8">
              <h2 className="text-white font-bold text-3xl mb-4">Create Account</h2>
              <p className="text-blue-100">Start your Forex trading journey today</p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-xl">
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-200 mb-2">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="bg-[#0d47a1] border border-blue-400/30 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-white/50 focus:border-transparent w-full mb-4 placeholder-gray-400"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-200 mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-[#0d47a1] border border-blue-400/30 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-white/50 focus:border-transparent w-full mb-4 placeholder-gray-400"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-200 mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="bg-[#0d47a1] border border-blue-400/30 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-white/50 focus:border-transparent w-full mb-4 placeholder-gray-400"
                  placeholder="••••••••"
                />
                <p className="text-xs text-blue-200 mt-1">Minimum 6 characters</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-200 mb-2">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="bg-[#0d47a1] border border-blue-400/30 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-white/50 focus:border-transparent w-full mb-4"
                >
                  <option value="student">Student</option>
                  <option value="instructor">Instructor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={loading || !email.trim() || !password.trim() || !name.trim()}
                className="bg-white text-[#1565C0] hover:bg-gray-100 w-full rounded-xl py-3 font-semibold transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating account...
                  </span>
                ) : (
                  'Sign Up'
                )}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-blue-400/30">
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

