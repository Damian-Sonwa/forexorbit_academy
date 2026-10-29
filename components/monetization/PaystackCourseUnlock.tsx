import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiClient } from '@/lib/api-client';
import { COURSE_PRICE_LABEL } from '@/lib/course-price';
import { loadPaystackInline, onPaystackHostFormSubmit, resetPaystackHostForm } from '@/lib/paystack-inline-script';
import {
  ABANDONED_RESUME_CODES,
  CONFIRM_REQUEST_TIMEOUT_MS,
  SILENT_RESUME_CODES,
  readPendingCheckout,
  referenceForFormSignal,
  refreshAfterUnlock,
  rememberPendingCheckout,
  resumableReference,
  settleCourseCheckout,
  type CheckoutResult,
} from '@/lib/course-checkout';

type Props = {
  courseId: string;
  onUnlocked: () => void | Promise<void>;
  variant?: 'default' | 'compact';
};

type InitResponse = {
  alreadyOwned?: boolean;
  reference: string | null;
  amountKobo?: number;
  currency?: string;
  email?: string;
  userId?: string;
  courseId?: string;
};

type ApiError = {
  code?: string;
  response?: { status?: number; data?: { message?: string; retryable?: boolean; supportId?: string } };
  message?: string;
};

/** Starting checkout is a single short request; a stalled one is reported rather than waited on. */
const INIT_REQUEST_TIMEOUT_MS = 20000;

type Phase = 'idle' | 'starting' | 'paying' | 'confirming';

function errorMessage(e: unknown, fallback: string): string {
  const ax = e as ApiError;
  if (!ax.response && (ax.code === 'ECONNABORTED' || ax.code === 'ETIMEDOUT')) {
    return 'Checkout is taking too long to respond. Check your connection and try again.';
  }
  return ax.response?.data?.message || ax.message || fallback;
}

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function stripReturnParams() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('reference') && !url.searchParams.has('trxref')) return;
  url.searchParams.delete('reference');
  url.searchParams.delete('trxref');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

const postConfirm = (url: string, body: { reference: string }) =>
  apiClient.post(url, body, { timeout: CONFIRM_REQUEST_TIMEOUT_MS });

/** Full-course checkout. Amount, currency, and reference always come from the server intent. */
export function PaystackCourseUnlock({ courseId, onUnlocked, variant = 'default' }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryReference, setRetryReference] = useState<string | null>(null);
  const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY?.trim();
  const mounted = useRef(true);
  const onUnlockedRef = useRef(onUnlocked);
  onUnlockedRef.current = onUnlocked;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const confirm = useCallback(
    async (reference: string, automatic = false) => {
      setPhase('confirming');
      setError(null);
      setNotice('Confirming your payment with Paystack…');
      const result: CheckoutResult = await settleCourseCheckout({
        post: postConfirm,
        storage: browserStorage(),
        courseId,
        reference,
        onUnlocked: () => onUnlockedRef.current(),
        automatic,
      });
      if (!mounted.current) return;
      setPhase('idle');
      if (result.state === 'unlocked') {
        setNotice(result.refreshed === false ? 'Payment confirmed. Reload the page to open your lessons.' : null);
        setRetryReference(null);
        return;
      }
      setNotice(null);
      if (
        automatic &&
        result.state === 'failed' &&
        result.code &&
        (SILENT_RESUME_CODES.has(result.code) || ABANDONED_RESUME_CODES.has(result.code))
      ) {
        setRetryReference(null);
        return;
      }
      setRetryReference(result.retryable ? reference : null);
      setError(
        result.state === 'pending'
          ? `Your payment is still being confirmed. ${result.message} Reference: ${reference}`
          : `${result.message}` +
              (result.retryable ? '' : ' If you were charged, use “Paid but still locked?” on the course page or contact support.') +
              ` Reference: ${reference}`
      );
    },
    [courseId]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reference = resumableReference(browserStorage(), courseId, window.location.search);
    stripReturnParams();
    if (reference) void confirm(reference, true);
  }, [courseId, confirm]);

  useEffect(
    () =>
      onPaystackHostFormSubmit((formReference) => {
        const reference = referenceForFormSignal(formReference, readPendingCheckout(browserStorage(), courseId));
        if (reference) void confirm(reference, true);
      }),
    [courseId, confirm]
  );

  const startPay = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!publicKey) {
      setError('Payments are not available right now.');
      return;
    }
    setPhase('starting');
    try {
      await loadPaystackInline();
      const init = await apiClient.post<InitResponse>(
        '/payments/paystack/init-course',
        { courseId },
        { timeout: INIT_REQUEST_TIMEOUT_MS }
      );
      if (init.alreadyOwned) {
        const refreshed = await refreshAfterUnlock(() => onUnlockedRef.current());
        if (!mounted.current) return;
        if (!refreshed) setNotice('You already own this course. Reload the page to open your lessons.');
        setPhase('idle');
        return;
      }
      if (!init.reference || !init.email || !init.amountKobo || init.currency !== 'NGN') {
        setError('Could not start checkout. Try again.');
        setPhase('idle');
        return;
      }
      const PaystackPop = window.PaystackPop;
      if (!PaystackPop) {
        setError('Paystack failed to load. Check your network or ad blocker.');
        setPhase('idle');
        return;
      }
      const reference = init.reference;
      resetPaystackHostForm();
      rememberPendingCheckout(browserStorage(), courseId, reference);
      const handler = PaystackPop.setup({
        key: publicKey,
        email: init.email,
        amount: init.amountKobo,
        currency: init.currency,
        ref: reference,
        metadata: { userId: init.userId ?? '', courseId: init.courseId ?? courseId },
        callback: (response: { reference?: string }) => {
          void confirm(response.reference || reference);
        },
        onClose: () => setPhase((current) => (current === 'paying' ? 'idle' : current)),
      });
      if (typeof handler.openIframe === 'function') {
        setPhase('paying');
        handler.openIframe();
      } else {
        setError('Could not open the payment window. Try again or use another browser.');
        setPhase('idle');
      }
    } catch (e: unknown) {
      setError(errorMessage(e, 'Could not start checkout.'));
      setPhase('idle');
    }
  }, [confirm, courseId, publicKey]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void startPay();
  };

  const busy = phase !== 'idle';
  const buttonLabel =
    phase === 'confirming' ? 'Confirming payment…' : busy ? 'Working…' : `Unlock full course – ${COURSE_PRICE_LABEL}`;
  const statusBox = (
    <>
      {notice ? (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950/50 dark:text-blue-200" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200" role="alert">
          {error}
        </p>
      ) : null}
      {retryReference && !busy ? (
        <button
          type="button"
          onClick={() => void confirm(retryReference)}
          className="inline-flex w-full items-center justify-center rounded-lg border border-primary-600 px-4 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/40"
        >
          Check payment status
        </button>
      ) : null}
    </>
  );
  const hasStatus = Boolean(notice || error || (retryReference && !busy));

  if (variant === 'compact') {
    return (
      <form className="flex w-full flex-col items-stretch gap-2" onSubmit={onSubmit} noValidate>
        {statusBox}
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
      onSubmit={onSubmit}
      noValidate
    >
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">Unlock full course</h2>
      <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
        The first lesson and demo lessons stay free. One payment unlocks every other lesson and quiz in this course.
      </p>
      <p className="mt-3 text-2xl font-bold text-primary-700 dark:text-primary-300">{COURSE_PRICE_LABEL}</p>
      {hasStatus ? <div className="mt-3 flex flex-col gap-2">{statusBox}</div> : null}
      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full max-w-sm rounded-xl bg-primary-600 px-6 py-3 text-base font-semibold text-white shadow-md hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {buttonLabel}
      </button>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Secured by Paystack. Access is granted after the server confirms your payment.
      </p>
    </form>
  );
}
