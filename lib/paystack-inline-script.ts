/**
 * Load Paystack Inline — script must be inside a <form> (inline.js checkForParentForm).
 * Inline v1 submits that form after a successful charge; the host form swallows the submit
 * so the page stays put and the in-page confirmation can finish.
 */

import { clearFormReferences, neutralizeFormSubmission } from '@/lib/course-checkout';

type HostFormListener = (reference: string | null) => void;
let hostFormListener: HostFormListener | null = null;

/** Receives Paystack's form-submit signal (with the reference when Paystack provides one). */
export function onPaystackHostFormSubmit(listener: HostFormListener): () => void {
  hostFormListener = listener;
  return () => {
    if (hostFormListener === listener) hostFormListener = null;
  };
}

export function getOrCreatePaystackHostForm(): HTMLFormElement {
  const found = document.querySelector('form[data-forexorbit-paystack-host="1"]');
  if (found instanceof HTMLFormElement) {
    return neutralizeFormSubmission(found, (reference) => hostFormListener?.(reference));
  }
  const form = document.createElement('form');
  form.setAttribute('data-forexorbit-paystack-host', '1');
  form.noValidate = true;
  form.style.cssText =
    'position:absolute;left:0;top:0;width:0;height:0;margin:0;padding:0;overflow:hidden;clip:rect(0,0,0,0);border:0;';
  neutralizeFormSubmission(form, (reference) => hostFormListener?.(reference));
  document.body.appendChild(form);
  return form;
}

/** Drops reference fields Paystack added for an earlier checkout before a new one opens. */
export function resetPaystackHostForm(): void {
  if (typeof document === 'undefined') return;
  clearFormReferences(getOrCreatePaystackHostForm());
}

/** How long the Paystack script may take before checkout reports a failure instead of waiting. */
export const PAYSTACK_SCRIPT_TIMEOUT_MS = 15000;
const PAYSTACK_SCRIPT_SRC = 'https://js.paystack.co/v1/inline.js';

let pendingLoad: Promise<void> | null = null;
let failedLoads = 0;

/**
 * Loads Paystack Inline once. The promise always settles: it rejects when the script errors,
 * loads without defining PaystackPop, or takes longer than `timeoutMs`. A failed script tag is
 * removed so the next attempt requests the script again instead of waiting on spent events.
 */
export function loadPaystackInline(timeoutMs: number = PAYSTACK_SCRIPT_TIMEOUT_MS): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.PaystackPop) {
    getOrCreatePaystackHostForm();
    return Promise.resolve();
  }
  if (pendingLoad) return pendingLoad;
  const load = new Promise<void>((resolve, reject) => {
    const hostForm = getOrCreatePaystackHostForm();
    // A tag left from an earlier attempt may already have fired its events; start over.
    document.querySelectorAll('script[data-forexorbit-paystack="1"]').forEach((old) => old.remove());
    const s = document.createElement('script');
    const fail = (message: string) => {
      clearTimeout(timer);
      s.onload = null;
      s.onerror = null;
      s.remove();
      failedLoads += 1;
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('Paystack is taking too long to load. Check your connection and try again.'), timeoutMs);
    // After a failure the browser may still hold the stalled request for the plain URL and hand
    // it to the new tag; a distinct URL makes the retry a real second request.
    s.src = failedLoads ? `${PAYSTACK_SCRIPT_SRC}?retry=${failedLoads}` : PAYSTACK_SCRIPT_SRC;
    s.async = true;
    s.setAttribute('data-forexorbit-paystack', '1');
    s.onload = () => {
      clearTimeout(timer);
      if (window.PaystackPop) resolve();
      else fail('Paystack failed to load. Check your network or ad blocker.');
    };
    s.onerror = () => fail('Paystack failed to load. Check your network or ad blocker.');
    hostForm.appendChild(s);
  });
  pendingLoad = load;
  const clear = () => {
    if (pendingLoad === load) pendingLoad = null;
  };
  load.then(clear, clear);
  return load;
}

declare global {
  interface Window {
    PaystackPop?: {
      setup: (opts: Record<string, unknown>) => { openIframe: () => void };
    };
  }
}
