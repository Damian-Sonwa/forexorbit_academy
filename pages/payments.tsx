/**
 * Payment history for the signed-in user (GET /api/payments/history).
 * Shows only the user's own course payments, refunds and confirmations in progress.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { messageFromUnknown } from '@/lib/public-error';
import { formatNairaFromKobo } from '@/lib/course-price';
import type { PaymentHistoryRow } from '@/lib/payment-history';

const STATUS_LABELS: Record<PaymentHistoryRow['status'], { label: string; tone: string }> = {
  paid: { label: 'Paid', tone: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' },
  confirming: { label: 'Confirming', tone: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' },
  under_review: { label: 'Under review', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  refund_pending: { label: 'Refund in progress', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  partially_refunded: { label: 'Partly refunded', tone: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100' },
  refunded: { label: 'Refunded', tone: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100' },
};

const STATUS_NOTES: Partial<Record<PaymentHistoryRow['status'], string>> = {
  confirming: 'We are confirming this payment with Paystack. It usually completes within minutes.',
  under_review: 'This payment did not change your course access (for example, you already owned the course). Support will contact you about it.',
  refund_pending: 'A refund has been started. Paystack usually completes refunds within a few working days.',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PaymentsPage() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [items, setItems] = useState<PaymentHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiClient.get<{ items: PaymentHistoryRow[] }>('/payments/history');
        if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []);
      } catch (err: unknown) {
        if (!cancelled) setError(messageFromUnknown(err) || 'Could not load your payments. Try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || (isAuthenticated && loading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <LoadingSpinner />
      </div>
    );
  }
  if (!isAuthenticated || !user) return null;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Payments</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Your course payments and refunds. Keep the reference when you contact support.
          </p>

          {error ? (
            <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200" role="alert">
              {error}
            </p>
          ) : null}

          {!error && items.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
              <p className="text-gray-700 dark:text-gray-300">You have not made any course payments yet.</p>
              <Link
                href="/courses"
                className="mt-4 inline-flex items-center rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
              >
                Browse courses
              </Link>
            </div>
          ) : null}

          <ul className="mt-6 space-y-4">
            {items.map((item) => {
              const status = STATUS_LABELS[item.status] || STATUS_LABELS.paid;
              const note = STATUS_NOTES[item.status];
              return (
                <li
                  key={item.reference}
                  className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/courses/${item.courseId}`} className="font-semibold text-gray-900 hover:underline dark:text-white">
                        {item.courseTitle}
                      </Link>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{formatDate(item.date)}</p>
                    </div>
                    <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                      <span className="text-lg font-bold text-gray-900 dark:text-white">{formatNairaFromKobo(item.amountKobo)}</span>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>
                    </div>
                  </div>
                  {item.refundedKobo > 0 || item.refundPendingKobo > 0 ? (
                    <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
                      {item.refundedKobo > 0 ? `Refunded: ${formatNairaFromKobo(item.refundedKobo)}. ` : ''}
                      {item.refundPendingKobo > 0 ? `Refund in progress: ${formatNairaFromKobo(item.refundPendingKobo)}.` : ''}
                    </p>
                  ) : null}
                  {note ? <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{note}</p> : null}
                  <p className="mt-3 break-all text-xs text-gray-500 dark:text-gray-400">Reference: {item.reference}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </div>
  );
}
