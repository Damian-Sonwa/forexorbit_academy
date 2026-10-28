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

export function loadPaystackInline(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.PaystackPop) {
    getOrCreatePaystackHostForm();
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const hostForm = getOrCreatePaystackHostForm();
    const existing = document.querySelector('script[data-forexorbit-paystack="1"]');
    if (existing) {
      if (existing.parentElement !== hostForm) {
        hostForm.appendChild(existing);
      }
      if (window.PaystackPop) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Paystack script failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://js.paystack.co/v1/inline.js';
    s.async = true;
    s.setAttribute('data-forexorbit-paystack', '1');
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Paystack script failed'));
    hostForm.appendChild(s);
  });
}

declare global {
  interface Window {
    PaystackPop?: {
      setup: (opts: Record<string, unknown>) => { openIframe: () => void };
    };
  }
}
