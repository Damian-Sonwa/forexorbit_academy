import type { Db } from 'mongodb';

export const AUDIT_COLLECTION: string;
export const CLAIM_TTL_MS: number;
export const SYSTEM_ACTOR: { readonly userId: 'system'; readonly email: null };
export const COURSE_PRICE_KOBO: number;
export const COURSE_CURRENCY: 'NGN';
export const SHARED_DB_NAME: string;
export const INTENT_TTL_MS: number;
export const GRANTED_ENTITLEMENTS: readonly string[];
export const COLLECTIONS: {
  readonly intents: string;
  readonly payments: string;
  readonly courseAccess: string;
  readonly coursePurchases: string;
  readonly exceptions: string;
  readonly lessonAccess: string;
  readonly lessonPurchases: string;
};

export type ProviderLookup =
  | { outcome: 'found'; data: Record<string, unknown> }
  | { outcome: 'not_found' }
  | { outcome: 'uncertain'; reason: string };

export type PaymentEnvironment =
  | { enabled: true; mode: 'live' | 'test' }
  | { enabled: false; status: number; reason: string; message: string };

export type ConfirmResult =
  | { ok: true; status: 200; courseId: string; reference: string; alreadyProcessed: boolean; duplicatePayment?: boolean }
  | { ok: false; status: number; code: string; message: string; retryable: boolean; recorded?: boolean };

export type IntentResult =
  | { ok: true; alreadyOwned: true }
  | { ok: true; alreadyOwned: false; reference: string; amountKobo: number; currency: string; reused: boolean }
  | { ok: false; status: number; code: string; message: string; retryable: boolean };

export function decidePaymentEnvironment(env: Record<string, string | undefined>): PaymentEnvironment;
export function resolveDbName(env: Record<string, string | undefined>): string;
export function isLocalMongoUri(uri: string | undefined): boolean;
export function verifyWebhookSignature(rawBody: Buffer, secret: string | undefined, signatureHeader: string | undefined): boolean;
export function fetchPaystackTransaction(
  reference: string,
  options: { secret: string | undefined; fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<ProviderLookup>;
export function evaluateTransaction(
  intent: Record<string, unknown>,
  data: Record<string, unknown>
): { grant: true } | { grant: false; code: string; status: number; retryable: boolean; exception: boolean; message: string };
export function courseEntitlementQuery(userId: string, courseId: string): Record<string, unknown>;
export function hasCourseEntitlement(db: Db, userId: string, courseId: string): Promise<boolean>;
export function legacyLessonIdsWithAccess(db: Db, userId: string, lessonIds: string[]): Promise<Set<string>>;
export function writeExceptionAudit(db: Db, auditEntry: Record<string, unknown>, exceptionId: unknown): Promise<boolean>;
export function recordPaymentException(
  db: Db,
  entry: Record<string, unknown>,
  now?: Date
): Promise<{ recorded: 'created' | 'replay' | 'occurrence' | 'reopened' }>;
export function confirmCoursePayment(
  db: Db,
  options: {
    reference: string;
    source: 'checkout' | 'webhook';
    sessionUserId?: string;
    expectedCourseId?: string;
    providerData?: Record<string, unknown>;
    fetchTransaction?: (reference: string) => Promise<ProviderLookup>;
    now?: Date;
  }
): Promise<ConfirmResult>;
export function createCourseIntent(
  db: Db,
  options: {
    userId: string;
    courseId: string;
    fetchTransaction: (reference: string) => Promise<ProviderLookup>;
    makeReference?: () => string;
    now?: Date;
  }
): Promise<IntentResult>;
export function processWebhookEvent(db: Db, payload: unknown, now?: Date): Promise<{ ack: boolean; code: string }>;
export function presentConfirmResult(
  result: ConfirmResult | Extract<IntentResult, { ok: false }>,
  supportId: string
): { status: number; body: Record<string, unknown> };
