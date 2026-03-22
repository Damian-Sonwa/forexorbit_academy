/**
 * Load Paystack Inline — script must be inside a <form> (inline.js checkForParentForm).
 */

export function getOrCreatePaystackHostForm(): HTMLFormElement {
  const found = document.querySelector('form[data-forexorbit-paystack-host="1"]');
  if (found instanceof HTMLFormElement) return found;
  const form = document.createElement('form');
  form.setAttribute('data-forexorbit-paystack-host', '1');
  form.method = 'post';
  form.action = '#';
  form.noValidate = true;
  form.style.cssText =
    'position:absolute;left:0;top:0;width:0;height:0;margin:0;padding:0;overflow:hidden;clip:rect(0,0,0,0);border:0;';
  document.body.appendChild(form);
  return form;
}

export function loadPaystackInline(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.PaystackPop) return Promise.resolve();
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
