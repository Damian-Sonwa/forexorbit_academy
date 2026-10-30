'use strict';

/**
 * Browser-side course checkout follow-through. Access is only ever shown after the server's
 * POST /courses/:id/pay confirms the reference; this module never decides access itself.
 * Safe to import from browser code.
 */

const PENDING_KEY_PREFIX = 'forexorbit:pendingCourseCheckout:';
/** Matches the server's recheck window for unpaid intents (INTENT_RECHECK_WINDOW_MS). */
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REFERENCE_PATTERN = /^[A-Za-z0-9_.=-]{6,100}$/;
const CONFIRM_RETRY_DELAYS_MS = Object.freeze([2000, 5000, 10000]);

/** Codes for which retrying the same reference can never succeed for this user and course. */
const TERMINAL_CODES = new Set([
  'invalid_reference',
  'unknown_reference',
  'reference_owner_mismatch',
  'course_mismatch',
  'checkout_closed',
  'lesson_purchase_retired',
  'needs_review',
  'staff_account',
]);

/** Automatic (not user-initiated) confirmations that fail this way belong to another checkout. */
const SILENT_RESUME_CODES = new Set(['course_mismatch', 'reference_owner_mismatch', 'unknown_reference', 'invalid_reference']);

/**
 * Paystack reported the stored checkout as failed or abandoned. On an automatic resume the stored
 * reference is dropped and nothing is shown; the server keeps the intent, so a later success is
 * still granted by the webhook, by the re-check before the next checkout, or from
 * "Paid but still locked?". A confirmation the user asked for still reports the result.
 */
const ABANDONED_RESUME_CODES = new Set(['payment_not_successful']);

function isValidReference(value) {
  return typeof value === 'string' && REFERENCE_PATTERN.test(value.trim());
}

function pendingKey(courseId) {
  return `${PENDING_KEY_PREFIX}${courseId}`;
}

function rememberPendingCheckout(storage, courseId, reference, now = Date.now()) {
  if (!storage || !courseId || !isValidReference(reference)) return;
  try {
    storage.setItem(pendingKey(courseId), JSON.stringify({ reference: reference.trim(), at: now }));
  } catch {
    /* storage full or disabled: the in-page callback still confirms */
  }
}

function readPendingCheckout(storage, courseId, now = Date.now()) {
  if (!storage || !courseId) return null;
  let raw;
  try {
    raw = storage.getItem(pendingKey(courseId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isValidReference(parsed && parsed.reference) || typeof parsed.at !== 'number' || now - parsed.at > PENDING_MAX_AGE_MS) {
      clearPendingCheckout(storage, courseId);
      return null;
    }
    return parsed.reference;
  } catch {
    clearPendingCheckout(storage, courseId);
    return null;
  }
}

function clearPendingCheckout(storage, courseId) {
  if (!storage || !courseId) return;
  try {
    storage.removeItem(pendingKey(courseId));
  } catch {
    /* ignore */
  }
}

/** Paystack appends `reference`/`trxref` when it returns to a callback URL. */
function referenceFromQuery(search) {
  if (typeof search !== 'string' || !search) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const name of ['reference', 'trxref']) {
    const value = params.get(name);
    if (isValidReference(value)) return value.trim();
  }
  return null;
}

function describeError(error, fallback) {
  const response = error && error.response;
  const data = (response && response.data) || {};
  return {
    status: response && typeof response.status === 'number' ? response.status : null,
    code: typeof data.code === 'string' ? data.code : null,
    retryable: data.retryable === true || !response || response.status >= 500 || response.status === 429,
    message: (typeof data.message === 'string' && data.message) || (error && error.message) || fallback,
  };
}

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Upper bound on each confirmation request, so a stalled connection is retried, not waited on. */
const CONFIRM_REQUEST_TIMEOUT_MS = 20000;
/** Upper bound on the page refresh after an unlock; access is already granted by then. */
const UNLOCK_REFRESH_TIMEOUT_MS = 20000;

/**
 * Runs the page refresh after a confirmed unlock. It cannot hold the checkout open: a refresh
 * that fails or outlasts `timeoutMs` is abandoned (the unlock itself stands) and reported.
 */
async function refreshAfterUnlock(onUnlocked, timeoutMs = UNLOCK_REFRESH_TIMEOUT_MS) {
  if (typeof onUnlocked !== 'function') return true;
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(onUnlocked).then(() => true), timedOut]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls the authoritative confirmation endpoint and waits for its verdict.
 * Resolves to { state: 'unlocked' | 'pending' | 'failed', ... }; never throws.
 */
async function confirmCourseCheckout({ post, courseId, reference, delays = CONFIRM_RETRY_DELAYS_MS, sleep = sleepFor }) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const body = await post(`/courses/${courseId}/pay`, { reference });
      if (body && body.success === true && body.unlocked === true) {
        return {
          state: 'unlocked',
          reference,
          alreadyProcessed: Boolean(body.alreadyProcessed),
          duplicatePayment: Boolean(body.duplicatePayment),
          message: typeof body.message === 'string' ? body.message : 'Payment confirmed. The full course is unlocked.',
        };
      }
      return { state: 'failed', reference, code: 'unexpected_response', retryable: true, message: 'We could not confirm this payment yet.' };
    } catch (error) {
      const info = describeError(error, 'We could not confirm this payment yet.');
      if (info.status === 401) {
        return { state: 'failed', reference, code: 'unauthenticated', retryable: true, message: 'Sign in again to finish confirming your payment.' };
      }
      if (info.retryable && attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
      if (info.retryable) {
        return { state: 'pending', reference, code: info.code, retryable: true, message: info.message };
      }
      return { state: 'failed', reference, code: info.code, retryable: !TERMINAL_CODES.has(info.code), message: info.message };
    }
  }
}

/** One confirmation per reference at a time, so a callback and a resume share the same request. */
const inFlight = new Map();

/**
 * Confirms a reference, keeps it stored until the server settles it, and refreshes the page
 * state through `onUnlocked` only after a confirmed unlock.
 */
function settleCourseCheckout({ post, storage, courseId, reference, onUnlocked, delays, sleep, automatic = false, refreshTimeoutMs }) {
  const key = `${courseId}:${reference}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const run = (async () => {
    const result = await confirmCourseCheckout({ post, courseId, reference, delays, sleep });
    const isStored = readPendingCheckout(storage, courseId) === reference;
    if (result.state === 'unlocked') {
      if (isStored) clearPendingCheckout(storage, courseId);
      const refreshed = await refreshAfterUnlock(onUnlocked, refreshTimeoutMs);
      if (!refreshed) return { ...result, refreshed: false };
    } else if (result.state === 'failed' && !result.retryable && isStored) {
      clearPendingCheckout(storage, courseId);
    } else if (automatic && result.state === 'failed' && ABANDONED_RESUME_CODES.has(result.code) && isStored) {
      clearPendingCheckout(storage, courseId);
    }
    return result;
  })();
  inFlight.set(key, run);
  run.then(
    () => inFlight.delete(key),
    () => inFlight.delete(key)
  );
  return run;
}

/** Reference to resume after a reload or a return from Paystack: the URL first, then storage. */
function resumableReference(storage, courseId, search, now = Date.now()) {
  return referenceFromQuery(search) || readPendingCheckout(storage, courseId, now);
}

module.exports = {
  ABANDONED_RESUME_CODES,
  CONFIRM_REQUEST_TIMEOUT_MS,
  CONFIRM_RETRY_DELAYS_MS,
  PENDING_MAX_AGE_MS,
  PENDING_KEY_PREFIX,
  SILENT_RESUME_CODES,
  clearPendingCheckout,
  confirmCourseCheckout,
  readPendingCheckout,
  referenceFromQuery,
  refreshAfterUnlock,
  rememberPendingCheckout,
  resumableReference,
  settleCourseCheckout,
};
