import { useCallback, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { LessonMonetization } from '@/hooks/useLesson';

declare global {
  interface Window {
    PaystackPop?: {
      setup: (opts: Record<string, unknown>) => void;
    };
  }
}

function loadPaystackInline(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.PaystackPop) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-forexorbit-paystack="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Paystack script failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://js.paystack.co/v1/inline.js';
    s.async = true;
    s.setAttribute('data-forexorbit-paystack', '1');
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Paystack script failed'));
    document.body.appendChild(s);
  });
}

type Props = {
  courseId: string;
  lessonId: string;
  monetization: LessonMonetization;
  onUnlocked: () => void;
};

export function PaystackLessonUnlock({ courseId, lessonId, monetization, onUnlocked }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY?.trim();

  const startPay = useCallback(async () => {
    setError(null);
    if (!publicKey) {
      setError('Payment is not configured (missing NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY).');
      return;
    }
    if (!monetization.paymentsConfigured) {
      setError('Payments are not available on this server yet.');
      return;
    }

    setBusy(true);
    try {
      await loadPaystackInline();
      const init = await apiClient.post<{
        reference: string | null;
        alreadyOwned?: boolean;
        amountKobo: number;
        currency: string;
        email: string;
      }>('/payments/paystack/init-lesson', { lessonId });

      if (init.alreadyOwned) {
        setBusy(false);
        onUnlocked();
        return;
      }
      if (!init.reference) {
        setError('Could not start payment. Try again.');
        return;
      }

      const paystack = window.PaystackPop;
      if (!paystack) {
        setError('Paystack failed to load. Check your network or ad blockers.');
        return;
      }

      paystack.setup({
        key: publicKey,
        email: init.email,
        amount: init.amountKobo,
        currency: init.currency || 'NGN',
        ref: init.reference,
        metadata: {
          lessonId,
          courseId,
        },
        callback: async (response: { reference: string }) => {
          setBusy(true);
          try {
            await apiClient.post('/payments/paystack/verify', {
              reference: response.reference,
              lessonId,
              courseId,
            });
            if (typeof console !== 'undefined' && console.info) {
              console.info('[ForexOrbit] Paystack lesson payment verified:', response.reference);
            }
            onUnlocked();
          } catch (e: unknown) {
            const ax = e as { response?: { data?: { error?: string } } };
            setError(ax.response?.data?.error || 'Payment verification failed. Contact support with your reference.');
          } finally {
            setBusy(false);
          }
        },
        onClose: () => setBusy(false),
      });
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } }; message?: string };
      setError(ax.response?.data?.error || ax.message || 'Could not start checkout.');
      setBusy(false);
    }
  }, [courseId, lessonId, monetization.paymentsConfigured, onUnlocked, publicKey]);

  const priceLabel =
    monetization.currency === 'NGN'
      ? `₦${(monetization.amountKobo / 100).toLocaleString()}`
      : `${(monetization.amountKobo / 100).toFixed(2)} ${monetization.currency}`;

  return (
    <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/90 p-6 text-center shadow-sm dark:border-amber-700 dark:bg-amber-950/40">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">Unlock this lesson</h2>
      <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
        The first lesson in every course is free. This lesson is included with a one-time purchase.
      </p>
      <p className="mt-3 text-2xl font-bold text-primary-700 dark:text-primary-300">{priceLabel}</p>
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void startPay()}
        disabled={busy}
        className="mt-5 w-full max-w-sm rounded-xl bg-primary-600 px-6 py-3 text-base font-semibold text-white shadow-md hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {busy ? 'Opening checkout…' : 'Unlock lesson'}
      </button>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Secured by Paystack. You’ll get instant access after payment.</p>
    </div>
  );
}
