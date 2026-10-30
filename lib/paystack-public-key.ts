/**
 * Paystack public key check, run before Paystack is loaded or set up. Paystack must never be
 * initialised with an empty or malformed key; a key that fails here disables checkout instead.
 * Nothing here logs or returns the key outside the normalised value used for setup.
 */

const PUBLIC_KEY_PATTERN = /^pk_(live|test)_[A-Za-z0-9]+$/;

/**
 * The key ready for PaystackPop.setup(), or null when it is missing or not a Paystack public
 * key. Surrounding whitespace and one pair of surrounding quotes (a common copy-paste slip in
 * hosting dashboards) are removed; anything else must already be exact.
 */
export function normalizePaystackPublicKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let key = raw.trim();
  if (key.length >= 2 && (key[0] === '"' || key[0] === "'") && key[key.length - 1] === key[0]) {
    key = key.slice(1, -1).trim();
  }
  return PUBLIC_KEY_PATTERN.test(key) ? key : null;
}
