import type { Db } from 'mongodb';
import type { ProviderLookup } from './course-payment';

export type LedgerSource =
  | 'verified_paystack'
  | 'complimentary_grant'
  | 'manual_grant'
  | 'historical_backfill'
  | 'unverified_record'
  | 'no_entitlement'
  | 'payment_without_access'
  | 'unlinked_payment';

export type LedgerWarning = { code: string; severity: 'info' | 'warning' | 'critical'; message: string };

export type LedgerRecord = {
  id: string;
  kind: 'access' | 'payment';
  createdAt: string | null;
  student: { userId: string | null; name: string | null; email: string | null; role: string | null; found: boolean };
  course: { courseId: string | null; title: string | null; found: boolean };
  amountKobo: number | null;
  currency: string | null;
  paymentStatus: string | null;
  purchaseStatus: string | null;
  accessStatus: 'active' | 'inactive' | 'none';
  source: LedgerSource;
  sourceLabel: string;
  paystackReference: string | null;
  checkoutReference: string | null;
  verification: { basis: 'checkout_intent' | 'legacy_server_verification' | 'none_backfill' | 'none'; at: string | null };
  payer: { email: string | null; status: 'not_recorded' | 'copied_from_student' | 'recorded_at_verification' };
  refundDispute: 'none_recorded' | 'refund_recorded' | 'dispute_recorded';
  openExceptions: number;
  warnings: LedgerWarning[];
  needsReview: boolean;
};

export type AuthUser = { userId: string; email: string; role: string };
export type Paged<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };
export type MutationResult<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; status: number; message?: string };

export const AUDIT_COLLECTION: string;
export const SCAN_CAP: number;
export const MAX_PAGE_SIZE: number;
export const SOURCE_LABELS: Readonly<Record<LedgerSource, string>>;
export const EXCEPTION_STATUSES: readonly string[];
export const INVESTIGATION_OUTCOMES: readonly string[];
export const EXCEPTION_REASON_LABELS: Readonly<Record<string, string>>;

export function authorizeLedgerAccess(user: { role?: string } | null | undefined): boolean;
export function classifySource(access: Record<string, unknown> | null, payment: Record<string, unknown> | null): LedgerSource;
export function payerEvidence(payment: Record<string, unknown> | null, category: LedgerSource): LedgerRecord['payer'];
export function parseLedgerQuery(query: Record<string, unknown>): Record<string, unknown>;
export function listPurchases(
  db: Db,
  query: Record<string, unknown>
): Promise<Paged<LedgerRecord> & { truncated: boolean; totalIsLowerBound: boolean; scanCap: number; filters: Record<string, string> }>;
export function getPurchaseDetail(db: Db, id: string): Promise<Record<string, unknown> | null>;
export function compareWithProvider(record: LedgerRecord, lookup: ProviderLookup | null): Record<string, unknown>;
export function checkPurchaseWithProvider(
  db: Db,
  id: string,
  options: { fetchTransaction: (reference: string) => Promise<ProviderLookup>; actor: AuthUser; now?: Date }
): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; status: number }>;
export function addPurchaseNote(db: Db, id: string, input: unknown, actor: AuthUser, now?: Date): Promise<MutationResult>;
export function listExceptions(db: Db, query: Record<string, unknown>): Promise<Paged<Record<string, unknown>> & { status: string }>;
export function updateException(
  db: Db,
  id: string,
  input: unknown,
  actor: AuthUser,
  now?: Date
): Promise<
  | MutationResult<{ exception: Record<string, unknown> }>
  | { ok: false; status: 500; reviewSaved: true; message: string; exception: Record<string, unknown> }
>;
export function repairPendingExceptionAudits(db: Db): Promise<{ repaired: number }>;
export function listAudit(db: Db, query: Record<string, unknown>): Promise<Paged<Record<string, unknown>>>;
