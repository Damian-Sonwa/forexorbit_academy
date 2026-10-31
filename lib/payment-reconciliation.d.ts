import type { Db } from 'mongodb';
import type { ProviderLookup } from './course-payment';
import type { RefundListLookup, RefundLookup } from './payment-refunds';

export type ReconciliationItem = { type: string; reference: string | null; action: string; detail?: string; refundId?: string; status?: string | null };
export type ReconciliationReport = { checkedAt: string; apply: boolean; budgetLeft: number; counts: Record<string, number>; items: ReconciliationItem[] };

export const DEFAULT_LIMIT: number;
export const PENDING_MIN_AGE_MS: number;
export const PENDING_RECHECK_MS: number;
export function runReconciliation(
  db: Db,
  options: {
    fetchTransaction: (reference: string) => Promise<ProviderLookup>;
    fetchRefund: (id: string) => Promise<RefundLookup>;
    listRefunds: (transactionId: string) => Promise<RefundListLookup>;
    apply?: boolean;
    limit?: number;
    verifySample?: number;
    now?: Date;
  }
): Promise<ReconciliationReport>;
