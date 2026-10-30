/**
 * Loads Paystack Inline v1 (https://js.paystack.co/v1/inline.js) the standard way: one plain
 * <script> appended to document.body, with no parent <form> and no data-* attributes.
 *
 * A script tag that has data-* attributes and sits inside a <form> switches Paystack into its
 * embedded-form mode, which sets itself up from the tag's data-* attributes when the script
 * loads (no key there) and later submits the form. Checkout uses PaystackPop.setup() with the
 * key and server reference instead, so the tag must carry neither.
 */

/** How long the Paystack script may take before checkout reports a failure instead of waiting. */
export const PAYSTACK_SCRIPT_TIMEOUT_MS = 15000;
const PAYSTACK_SCRIPT_SRC = 'https://js.paystack.co/v1/inline.js';

let pendingLoad: Promise<void> | null = null;
let scriptElement: HTMLScriptElement | null = null;
let failedLoads = 0;

/**
 * Loads Paystack once per page. Preloading and a checkout click share the same promise, which
 * always settles: it rejects when the script errors, loads without defining PaystackPop, or takes
 * longer than `timeoutMs`. A failed script tag is removed so the next call requests the script
 * again instead of waiting on spent events.
 */
export function loadPaystackInline(timeoutMs: number = PAYSTACK_SCRIPT_TIMEOUT_MS): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.PaystackPop) return Promise.resolve();
  if (pendingLoad) return pendingLoad;
  const load = new Promise<void>((resolve, reject) => {
    // A tag left from an earlier failed attempt may already have fired its events; start over.
    scriptElement?.remove();
    const s = document.createElement('script');
    scriptElement = s;
    const fail = (message: string) => {
      clearTimeout(timer);
      s.onload = null;
      s.onerror = null;
      s.remove();
      if (scriptElement === s) scriptElement = null;
      failedLoads += 1;
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('Paystack is taking too long to load. Check your connection and try again.'), timeoutMs);
    // After a failure the browser may still hold the stalled request for the plain URL and hand
    // it to the new tag; a distinct URL makes the retry a real second request.
    s.src = failedLoads ? `${PAYSTACK_SCRIPT_SRC}?retry=${failedLoads}` : PAYSTACK_SCRIPT_SRC;
    s.async = true;
    s.onload = () => {
      clearTimeout(timer);
      if (window.PaystackPop) resolve();
      else fail('Paystack failed to load. Check your network or ad blocker.');
    };
    s.onerror = () => fail('Paystack failed to load. Check your network or ad blocker.');
    document.body.appendChild(s);
  });
  pendingLoad = load;
  const clear = () => {
    if (pendingLoad === load) pendingLoad = null;
  };
  load.then(clear, clear);
  return load;
}

/**
 * Starts loading Paystack in the background when checkout is shown, so the script is ready
 * before the first click. A failure here is not reported: the click calls loadPaystackInline()
 * again, which shares this load while it runs and retries cleanly after a failure.
 */
export function preloadPaystackInline(): void {
  loadPaystackInline().catch(() => {});
}

declare global {
  interface Window {
    PaystackPop?: {
      setup: (opts: Record<string, unknown>) => { openIframe: () => void };
    };
  }
}
