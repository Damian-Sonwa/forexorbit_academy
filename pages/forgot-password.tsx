/**
 * Forgot Password — phone + SMS OTP
 */

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { apiClient } from '@/lib/api-client';

const PWD_RESET_STORAGE = 'forexorbitPwdReset';

const PUBLIC_API_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_BASE_URL) ||
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) ||
  '';

function mapForgotPasswordError(err: unknown): string {
  const e = err as { code?: string; response?: { data?: { error?: string } } };
  const apiErr = e.response?.data?.error;
  if (typeof apiErr === 'string' && apiErr.trim()) return apiErr;
  const noResponse = !e.response;
  if (noResponse && (e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED')) {
    if (PUBLIC_API_BASE && PUBLIC_API_BASE !== '/api') {
      return `Cannot reach the API (${PUBLIC_API_BASE}). Check your connection, CORS, and that the backend is running.`;
    }
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Try again.';
}

type Step = 'phone' | 'otp';

export default function ForgotPassword() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const [smsDeliveryEnabled, setSmsDeliveryEnabled] = useState<boolean | null>(null);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await apiClient.get<{ smsDeliveryEnabled?: boolean; configured?: boolean }>(
          '/auth/check-email-config'
        );
        if (!cancelled) {
          setSmsDeliveryEnabled(cfg.smsDeliveryEnabled ?? cfg.configured ?? false);
        }
      } catch {
        if (!cancelled) setSmsDeliveryEnabled(null);
      }
    })();
    return () => {
      cancelled = true;
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  const startCooldown = (seconds: number) => {
    setRetryAfterSeconds(seconds);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setRetryAfterSeconds((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!phone.trim()) {
      setError('Enter the phone number on your account');
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.post<{
        message: string;
        cooldown?: number;
        rateLimited?: boolean;
        _devNote?: string;
        smsDeliveryEnabled?: boolean;
      }>('/auth/forgot-password', { phone: phone.trim() });

      if (typeof res.smsDeliveryEnabled === 'boolean') {
        setSmsDeliveryEnabled(res.smsDeliveryEnabled);
      }

      if (res._devNote) {
        setInfo(res._devNote);
      } else if (res.smsDeliveryEnabled === false) {
        setInfo(
          'SMS is not configured on the server. No text can be sent until Twilio or Termii env vars are set on the host that runs /api (e.g. Render).'
        );
      } else {
        setInfo('If this number is registered, you should receive an SMS within a minute.');
      }

      if (typeof res.cooldown === 'number' && res.cooldown > 0) {
        startCooldown(res.cooldown);
      }

      setStep('otp');
    } catch (err: unknown) {
      setError(mapForgotPasswordError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (retryAfterSeconds > 0 || loading) return;
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await apiClient.post<{ message: string; cooldown?: number }>('/auth/forgot-password', {
        phone: phone.trim(),
      });
      setInfo('Code sent again. Check your SMS.');
      if (typeof res.cooldown === 'number' && res.cooldown > 0) {
        startCooldown(res.cooldown);
      }
    } catch (err: unknown) {
      setError(mapForgotPasswordError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    const code = otp.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your SMS');
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.post<{
        message: string;
        resetTicket: string;
        resetSecret: string;
      }>('/auth/verify-password-otp', { phone: phone.trim(), otp: code });

      try {
        sessionStorage.setItem(
          PWD_RESET_STORAGE,
          JSON.stringify({
            resetTicket: res.resetTicket,
            resetSecret: res.resetSecret,
            expiresAt: Date.now() + 14 * 60 * 1000,
          })
        );
      } catch {
        setError('Your browser blocked storage. Allow session storage and try again.');
        setLoading(false);
        return;
      }

      setInfo(res.message);
      await router.push('/reset-password');
    } catch (err: unknown) {
      const ax = err as {
        response?: { data?: { error?: string; attemptsRemaining?: number; locked?: boolean } };
      };
      const d = ax.response?.data;
      if (d?.attemptsRemaining != null) {
        setError(`${d.error} (${d.attemptsRemaining} attempt(s) left)`);
      } else {
        setError(d?.error || 'Verification failed.');
      }
      if (d?.locked) {
        setStep('phone');
        setOtp('');
      }
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
          <div className="bg-[#003153] rounded-xl sm:rounded-2xl shadow-2xl p-6 sm:p-8 border border-[#001a2e]">
            <div className="text-center mb-6 sm:mb-8">
              <h2 className="text-white font-bold text-2xl sm:text-3xl mb-3 sm:mb-4">
                {step === 'phone' ? 'Forgot password' : 'Enter verification code'}
              </h2>
              <p className="text-sm sm:text-base text-gray-300">
                {step === 'phone'
                  ? 'We’ll text a 6-digit code to the phone number on your account.'
                  : `Code sent to your phone. It expires in 5 minutes.`}
              </p>
            </div>

            {smsDeliveryEnabled === false && (
              <div className="mb-4 p-3 bg-amber-900/40 border border-amber-600/60 rounded-xl">
                <p className="text-amber-100 text-sm text-center font-medium">
                  SMS delivery is off on this API server. Add TWILIO_* or TERMII_* to the same deployment
                  that serves your API (if the site uses Vercel + Render, set them on Render when
                  NEXT_PUBLIC_API_BASE_URL points there).
                </p>
              </div>
            )}

            {info && (
              <div className="mb-4 p-3 bg-primary-900/40 border border-primary-600/50 rounded-xl">
                <p className="text-primary-100 text-sm text-center">{info}</p>
              </div>
            )}

            {error && (
              <div className="mb-4 p-4 bg-accent-500/10 border border-accent-500/40 rounded-xl">
                <p className="text-accent-200 text-sm">{error}</p>
              </div>
            )}

            {step === 'phone' ? (
              <form onSubmit={handleSendCode} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-nav-muted mb-2">Phone number</label>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className="bg-brand-deep border border-white/15 text-nav-text rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400/50 focus:border-transparent w-full text-base placeholder:text-nav-muted"
                    placeholder="+234 801 234 5678"
                  />
                  <p className="text-xs text-gray-400 mt-2">
                    Use the same number you registered with. Include country code.
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={loading || !phone.trim()}
                  className="bg-primary-500 hover:bg-primary-600 text-white w-full rounded-xl py-3 font-semibold transition-colors disabled:bg-primary-900/50 disabled:cursor-not-allowed min-h-[48px]"
                >
                  {loading ? 'Sending…' : 'Send code'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-nav-muted mb-2">6-digit code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={8}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    className="bg-brand-deep border border-white/15 text-nav-text rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400/50 focus:border-transparent w-full text-center text-2xl tracking-[0.4em] font-mono placeholder:text-nav-muted"
                    placeholder="••••••"
                    autoComplete="one-time-code"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="bg-primary-500 hover:bg-primary-600 text-white w-full rounded-xl py-3 font-semibold transition-colors disabled:bg-primary-900/50 disabled:cursor-not-allowed min-h-[48px]"
                >
                  {loading ? 'Checking…' : 'Verify & continue'}
                </button>
                <div className="flex flex-col sm:flex-row gap-2 sm:justify-between sm:items-center pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('phone');
                      setOtp('');
                      setError('');
                      setInfo('');
                    }}
                    className="text-sm text-gray-300 hover:text-white underline"
                  >
                    Change number
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={retryAfterSeconds > 0 || loading}
                    className="text-sm font-semibold text-primary-300 hover:text-primary-200 disabled:text-gray-500 disabled:cursor-not-allowed"
                  >
                    {retryAfterSeconds > 0 ? `Resend in ${retryAfterSeconds}s` : 'Resend code'}
                  </button>
                </div>
              </form>
            )}

            <div className="mt-6 pt-6 border-t border-gray-600">
              <p className="text-center text-sm text-gray-300">
                Remember your password?{' '}
                <Link href="/login" className="text-white hover:underline font-semibold">
                  Sign in
                </Link>
              </p>
              <p className="text-center text-xs text-gray-500 mt-3">
                After too many wrong codes, request a new SMS. Multiple failed attempts are logged for
                security.
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
