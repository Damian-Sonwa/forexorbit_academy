import type { Db } from 'mongodb';
import type { ProviderLookup } from './course-payment';

export type RefundStatus = 'requested' | 'pending' | 'processing' | 'needs_attention' | 'uncertain' | 'processed' | 'failed' | 'request_failed';
export type RefundLookup = { outcome: 'found'; data: Record<string, unknown> } | { outcome: 'not_found' } | { outcome: 'uncertain'; reason: string };
export type RefundListLookup = { outcome: 'found'; data: Record<string, unknown>[] } | { outcome: 'uncertain'; reason: string };
export type RefundCreate =
  | { outcome: 'created'; data: Record<string, unknown> }
  | { outcome: 'rejected'; httpStatus: number; message: string | null }
  | { outcome: 'uncertain'; reason: string };
export type Actor = { userId: string; email?: string | null; role: string };
export type RefundView = {
  id: string;
  paymentReference: string;
  amountKobo: number;
  currency: string;
  status: RefundStatus;
  full: boolean;
  requestedAt: string | null;
  closedAt: string | null;
  revokeAccess?: boolean;
  accessOutcome?: string | null;
  initiatedBy?: string;
  reason?: string;
  providerRefundId?: string | null;
  providerMessage?: string | null;
  requestedBy?: { userId: string | null; email: string | null } | null;
  history?: { at: string | null; status: string; source: string }[];
};
type Refusal = { ok: false; status: number; code: string; message: string; refund?: Record<string, unknown> };
type ProviderOptions = { secret: string | undefined; fetchImpl?: typeof fetch; timeoutMs?: number };

export const MIN_REFUND_KOBO: number;
export const REFUND_FINAL: readonly string[];
export const REFUND_OPEN: readonly string[];
export const UNCERTAIN_GRACE_MS: number;
export function mapProviderStatus(value: unknown): RefundStatus;
export function createPaystackRefund(input: { reference: string; amountKobo: number; merchantNote?: string } & ProviderOptions): Promise<RefundCreate>;
export function fetchPaystackRefund(id: string, options: ProviderOptions): Promise<RefundLookup>;
export function listPaystackRefunds(transactionId: string, options: ProviderOptions): Promise<RefundListLookup>;
export function refundSummary(refunds: Record<string, unknown>[], paymentAmountKobo: number): { refundedKobo: number; pendingKobo: number; state: 'none' | 'refund_pending' | 'partially_refunded' | 'refunded' };
export function refundsForReference(db: Db, reference: string): Promise<Record<string, unknown>[]>;
export function requestRefund(
  db: Db,
  input: {
    reference: unknown;
    amountKobo?: unknown;
    revokeAccess: unknown;
    reason: unknown;
    requestId: unknown;
    actor: Actor;
    createRefund: (input: { reference: string; amountKobo: number; merchantNote: string }) => Promise<RefundCreate>;
    now?: Date;
  }
): Promise<{ ok: true; status: number; code: string; refund: Record<string, unknown> } | Refusal>;
export function applyRefundStatus(db: Db, refundId: unknown, next: RefundStatus, options?: { source?: string; now?: Date; message?: string | null }): Promise<{ changed: boolean; refund: Record<string, unknown> | null }>;
export function finishProcessedRefund(db: Db, refund: Record<string, unknown>, now: Date): Promise<void>;
export function refreshRefund(
  db: Db,
  refundId: unknown,
  options: {
    fetchRefund: (id: string) => Promise<RefundLookup>;
    listRefunds: (transactionId: string) => Promise<RefundListLookup>;
    fetchTransaction?: (reference: string) => Promise<ProviderLookup>;
    now?: Date;
  }
): Promise<{ ok: boolean; code: string; refund?: Record<string, unknown> | null }>;
export function abandonUncertainRefund(db: Db, refundId: unknown, input: { actor: Actor; reason: unknown; now?: Date }): Promise<{ ok: true; status: number; code: string; refund: Record<string, unknown> | null } | Refusal>;
export function processRefundEvent(
  db: Db,
  event: string,
  data: Record<string, unknown>,
  options?: { fetchRefund?: (id: string) => Promise<RefundLookup>; now?: Date }
): Promise<{ ack: boolean; code: string }>;
export function presentRefund(row: Record<string, unknown> | null, options?: { forStudent?: boolean }): RefundView | null;
