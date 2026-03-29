import { useCallback, useState, type FormEvent } from 'react';
import { apiClient } from '@/lib/api-client';
import type { LessonMonetization } from '@/hooks/useLesson';
import { loadPaystackInline } from '@/lib/paystack-inline-script';

type Props = {
  courseId: string;
  lessonId?: string;
  unlockScope?: 'course' | 'lesson';
  monetization: LessonMonetization;
  onUnlocked: () => void | Promise<void>;
  variant?: 'default' | 'compact';
};

export function PaystackLessonUnlock({
  courseId,
  lessonId,
  monetization,
  onUnlocked,
  variant = 'default',
  unlockScope = 'course',
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY?.trim();
  const isCourse = unlockScope === 'course';

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
      setError('Payments are not available on this server yet (set PAYSTACK_SECRET_KEY on the server).');
      return;
    }
    if (!isCourse && !lessonId) {
      setError('Lesson is required for this checkout.');
      return;
    }

    setBusy(true);
    try {
      await loadPaystackInline();
      const init = isCourse
        ? await apiClient.post<{
            reference: string | null;
            alreadyOwned?: boolean;
            amountKobo: number;
            currency: string;
            email: string;
            userId?: string;
            courseId?: string;
            message?: string;
          }>('/payments/paystack/init-course', { courseId })
        : await apiClient.post<{
            reference: string | null;
            alreadyOwned?: boolean;
            amountKobo: number;
            currency: string;
            email: string;
            userId?: string;
            courseId?: string;
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

      const email = (init.email && String(init.email).trim()) || 'test@example.com';
      const amountKobo =
        typeof init.amountKobo === 'number' && init.amountKobo > 0 ? init.amountKobo : 3000 * 100;

      const handler = PaystackPop.setup({
        key: publicKey,
        email,
        amount: amountKobo,
        currency: init.currency || 'NGN',
        ref: init.reference,
        metadata: isCourse
          ? {
              userId: init.userId ?? '',
              courseId: init.courseId ?? courseId,
            }
          : {
              userId: init.userId ?? '',
              courseId: init.courseId ?? courseId,
              lessonId: lessonId ?? '',
            },
        callback: async (response: { reference: string }) => {
          setBusy(true);
          try {
            console.log('Payment success', response);
            await apiClient.post<{
              success?: boolean;
              message?: string;
              unlocked?: boolean;
              reference?: string;
            }>(
              isCourse ? `/courses/${courseId}/pay` : '/payments/paystack/verify',
              isCourse
                ? { reference: response.reference }
                : { reference: response.reference, lessonId, courseId }
            );
            await Promise.resolve(onUnlocked());
            alert('Payment successful');
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
        onClose: () => {
          console.log('Payment closed');
          setBusy(false);
        },
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
  }, [courseId, lessonId, isCourse, monetization.paymentsConfigured, onUnlocked, publicKey]);

  const buttonLabel = busy
    ? 'Opening checkout…'
    : isCourse
      ? `Unlock full course – ${priceLabel}`
      : `Unlock Lesson – ${priceLabel}`;

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void startPay();
  };

  if (variant === 'compact') {
    return (
      <form className="flex w-full flex-col items-stretch gap-2" onSubmit={onFormSubmit} noValidate>
        {error && (
          <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:bg-red-950/50 dark:text-red-200">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center rounded-xl bg-primary-600 px-4 py-3.5 text-base font-bold text-white shadow-md hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 sm:py-3"
        >
          {buttonLabel}
        </button>
      </form>
    );
  }

  return (
    <form
      className="rounded-2xl border-2 border-amber-200 bg-amber-50/90 p-6 text-center shadow-sm dark:border-amber-700 dark:bg-amber-950/40"
      onSubmit={onFormSubmit}
      noValidate
    >
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">
        {isCourse ? 'Unlock full course' : 'Unlock this lesson'}
      </h2>
      <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
        {isCourse
          ? 'The first lesson and demo lessons stay free. One payment unlocks every other lesson in this course.'
          : 'The first lesson in every course is free (with ads). This lesson unlocks after a one-time payment.'}
      </p>
      <p className="mt-3 text-2xl font-bold text-primary-700 dark:text-primary-300">{priceLabel}</p>
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full max-w-sm rounded-xl bg-primary-600 px-6 py-3 text-base font-semibold text-white shadow-md hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {buttonLabel}
      </button>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Secured by Paystack. Access is applied immediately after successful payment.
      </p>
    </form>
  );
}
