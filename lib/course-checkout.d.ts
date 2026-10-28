type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined;
type Post = (url: string, body: { reference: string }) => Promise<unknown>;

export type CheckoutResult =
  | { state: 'unlocked'; reference: string; alreadyProcessed: boolean; duplicatePayment: boolean; message: string }
  | { state: 'pending' | 'failed'; reference: string; code: string | null; retryable: boolean; message: string };

export const CONFIRM_RETRY_DELAYS_MS: readonly number[];
export const PENDING_MAX_AGE_MS: number;
export const PENDING_KEY_PREFIX: string;
export function rememberPendingCheckout(storage: StorageLike, courseId: string, reference: string, now?: number): void;
export function readPendingCheckout(storage: StorageLike, courseId: string, now?: number): string | null;
export function clearPendingCheckout(storage: StorageLike, courseId: string): void;
export function referenceFromQuery(search: string): string | null;
export function resumableReference(storage: StorageLike, courseId: string, search: string, now?: number): string | null;
export const SILENT_RESUME_CODES: ReadonlySet<string>;
export function clearFormReferences(form: { elements?: ArrayLike<unknown> } | null): void;
export function referenceForFormSignal(formReference: string | null, pendingReference: string | null): string | null;
export function readFormReference(form: { elements?: ArrayLike<{ name?: string; value?: string }> } | null): string | null;
export function neutralizeFormSubmission<T extends HTMLFormElement>(form: T, onAttempt?: (reference: string | null) => void): T;
export function confirmCourseCheckout(input: {
  post: Post;
  courseId: string;
  reference: string;
  delays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<CheckoutResult>;
export function settleCourseCheckout(input: {
  post: Post;
  storage: StorageLike;
  courseId: string;
  reference: string;
  onUnlocked?: () => void | Promise<void>;
  delays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<CheckoutResult>;
