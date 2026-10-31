import type { Db } from 'mongodb';
import type { RefundView } from './payment-refunds';

export type PaymentHistoryRow = {
  reference: string;
  courseId: string;
  courseTitle: string;
  amountKobo: number;
  currency: string;
  status: 'paid' | 'under_review' | 'confirming' | 'refund_pending' | 'partially_refunded' | 'refunded';
  date: string | null;
  refundedKobo: number;
  refundPendingKobo: number;
  refunds: (RefundView | null)[];
};

export const MAX_ROWS: number;
export function listUserPayments(db: Db, userId: string): Promise<PaymentHistoryRow[]>;
