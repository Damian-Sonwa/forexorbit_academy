/**
 * Login Page
 * User authentication
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

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
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

    setLoading(true);

    // Development-only logging
    if (process.env.NODE_ENV === 'development') {
      console.log('Login attempted for:', normalizedEmail);
    }

    try {
      await login(normalizedEmail, password);
      
      // Development-only logging
      if (process.env.NODE_ENV === 'development') {
        console.log('Login successful');
      }
      
      router.push('/dashboard');
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
              <h2 className="text-white font-bold text-2xl sm:text-3xl mb-3 sm:mb-4">Sign In</h2>
              <p className="text-sm sm:text-base text-gray-300">Welcome back to ForexOrbit Academy</p>
            </div>

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

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-semibold text-gray-200">Password</label>
                  <Link href="/forgot-password" className="text-gray-300 hover:text-white hover:underline text-sm">
                    Forgot password?
                  </Link>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-[#001a2e] border border-gray-600 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-white/50 focus:border-transparent w-full mb-4 placeholder-gray-400"
                  placeholder="••••••••"
                />
              </div>

                  <button
                    type="submit"
                    disabled={loading || !email.trim() || !password.trim()}
                    className="bg-white text-[#003153] hover:bg-gray-100 w-full rounded-xl py-3 font-semibold transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                  >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Logging in...
                  </span>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-gray-600">
              <p className="text-center text-sm text-gray-300">
                Don't have an account?{' '}
                <Link href="/signup" className="text-white hover:underline font-semibold">
                  Sign Up
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

