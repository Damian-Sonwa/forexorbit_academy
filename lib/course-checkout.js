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
const FORM_REFERENCE_FIELDS = /^(reference|trxref|paystack-trxref|paystack_reference)$/i;

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

function referenceFields(form) {
  const fields = form && form.elements ? Array.from(form.elements) : [];
  return fields.filter((field) => field && FORM_REFERENCE_FIELDS.test(String(field.name || '')));
}

/** The most recently added reference field, since Paystack appends one per completed charge. */
function readFormReference(form) {
  const fields = referenceFields(form).filter((field) => isValidReference(field.value));
  return fields.length ? fields[fields.length - 1].value.trim() : null;
}

/** Removes reference fields left by an earlier checkout so they cannot be read for a later one. */
function clearFormReferences(form) {
  for (const field of referenceFields(form)) {
    if (typeof field.remove === 'function') field.remove();
    else if (field.parentNode) field.parentNode.removeChild(field);
  }
}

/**
 * Picks the reference to confirm after Paystack's form signal. Only the reference this browser
 * stored for this course's current checkout is trusted; the form may still hold a stale one.
 */
function referenceForFormSignal(_formReference, pendingReference) {
  return isValidReference(pendingReference) ? pendingReference : null;
}

/**
 * Paystack Inline v1 submits the <form> that contains its script after a successful charge.
 * A native submit reloads the page and abandons the in-page confirmation, so submission is
 * swallowed here and reported to `onAttempt` instead.
 */
function neutralizeFormSubmission(form, onAttempt) {
  if (!form || form.__forexorbitSubmitNeutralized) return form;
  const notify = () => {
    try {
      if (typeof onAttempt === 'function') onAttempt(readFormReference(form));
    } catch {
      /* listener errors must not turn into a navigation */
    }
  };
  form.submit = notify;
  form.requestSubmit = notify;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    notify();
  });
  form.__forexorbitSubmitNeutralized = true;
  return form;
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
function settleCourseCheckout({ post, storage, courseId, reference, onUnlocked, delays, sleep }) {
  const key = `${courseId}:${reference}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const run = (async () => {
    const result = await confirmCourseCheckout({ post, courseId, reference, delays, sleep });
    const isStored = readPendingCheckout(storage, courseId) === reference;
    if (result.state === 'unlocked') {
      if (isStored) clearPendingCheckout(storage, courseId);
      if (typeof onUnlocked === 'function') await onUnlocked();
    } else if (result.state === 'failed' && !result.retryable && isStored) {
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
  CONFIRM_RETRY_DELAYS_MS,
  PENDING_MAX_AGE_MS,
  PENDING_KEY_PREFIX,
  SILENT_RESUME_CODES,
  clearFormReferences,
  clearPendingCheckout,
  confirmCourseCheckout,
  neutralizeFormSubmission,
  readFormReference,
  readPendingCheckout,
  referenceForFormSignal,
  referenceFromQuery,
  rememberPendingCheckout,
  resumableReference,
  settleCourseCheckout,
};
