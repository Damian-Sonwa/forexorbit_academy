import { useCallback, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { LessonMonetization } from '@/hooks/useLesson';

declare global {
  interface Window {
    PaystackPop?: {
      setup: (opts: Record<string, unknown>) => { openIframe: () => void };
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
  onUnlocked: () => void | Promise<void>;
  /** compact = inline on course cards; default = full card */
  variant?: 'default' | 'compact';
};

export function PaystackLessonUnlock({ courseId, lessonId, monetization, onUnlocked, variant = 'default' }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY?.trim();

  const priceLabel =
    monetization.currency === 'NGN'
      ? `₦${(monetization.amountKobo / 100).toLocaleString()}`
      : `${(monetization.amountKobo / 100).toFixed(2)} ${monetization.currency}`;

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
        message?: string;
      }>('/payments/paystack/init-lesson', { lessonId });

      if (init.alreadyOwned) {
        setBusy(false);
        await Promise.resolve(onUnlocked());
        return;
      }
      if (!init.reference) {
        setBusy(false);
        setError('Could not start payment. Try again.');
        return;
      }

      const PaystackPop = window.PaystackPop;
      if (!PaystackPop) {
        setBusy(false);
        setError('Paystack failed to load. Check your network or ad blockers.');
        return;
      }

      const handler = PaystackPop.setup({
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
            await apiClient.post<{
              success?: boolean;
              message?: string;
              unlocked?: boolean;
              reference?: string;
            }>('/payments/paystack/verify', {
              reference: response.reference,
              lessonId,
              courseId,
            });
            await Promise.resolve(onUnlocked());
          } catch (e: unknown) {
            const ax = e as { response?: { data?: { message?: string; error?: string } } };
            setError(
              ax.response?.data?.message ||
                ax.response?.data?.error ||
                'Payment verification failed. Contact support with your reference.'
            );
          } finally {
            setBusy(false);
          }
        },
        onClose: () => setBusy(false),
      });

      if (typeof handler.openIframe === 'function') {
        handler.openIframe();
      } else {
        setBusy(false);
        setError('Could not open the payment window. Try again or use another browser.');
      }
    } catch (e: unknown) {
      setBusy(false);
      const ax = e as { response?: { data?: { message?: string; error?: string } }; message?: string };
      setError(ax.response?.data?.message || ax.response?.data?.error || ax.message || 'Could not start checkout.');
    }
  }, [courseId, lessonId, monetization.paymentsConfigured, onUnlocked, publicKey]);

  const buttonLabel = busy ? 'Opening checkout…' : `Unlock Lesson – ${priceLabel}`;

  if (variant === 'compact') {
    return (
      <div className="flex flex-col items-stretch gap-2">
        {error && (
          <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:bg-red-950/50 dark:text-red-200">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => void startPay()}
          disabled={busy}
          className="inline-flex items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {buttonLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/90 p-6 text-center shadow-sm dark:border-amber-700 dark:bg-amber-950/40">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">Unlock this lesson</h2>
      <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
        The first lesson in every course is free (with ads). This lesson unlocks permanently after a one-time payment.
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
        {buttonLabel}
      </button>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Secured by Paystack. Access is applied immediately after successful payment.
      </p>
    </div>
  );
}
