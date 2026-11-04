'use strict';

/**
 * Exact fixed-point arithmetic for the practice simulator (Phase 10, G1). Pure, no dependencies.
 *
 * Every authoritative value is a BigInt count of a fixed unit. JavaScript numbers are never used
 * for prices or money:
 *   price  units of 10^-5 (PRICE_SCALE)  "1.08125" -> 108125n, "149.123" -> 14912300n
 *   money  units of 10^-2 (MONEY_SCALE)  USD cents: "10000.00" -> 1000000n
 *   units  whole currency units (BigInt)
 *
 * Rounding is half-even, applied once, when a value is fixed (a margin, a realized P&L). Nothing
 * rounds an intermediate step. Values are stored as Decimal128 and sent to clients as strings.
 * Formulas: docs/audits/phase-10-practice-trading.md, section 6.
 */

const PRICE_SCALE = 5;
const MONEY_SCALE = 2;
const PERCENT_SCALE = 2;
const PRICE_ONE = 10n ** BigInt(PRICE_SCALE);
const MONEY_ONE = 10n ** BigInt(MONEY_SCALE);

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * A decimal string to a BigInt at `scale`. Refuses anything inexact: more decimals than the scale
 * would be silent rounding of an input. Numbers are refused too, because 0.1 is already inexact.
 * Returns null when the value is not an exact decimal string.
 */
function parseDecimal(value, scale) {
  if (typeof value !== 'string' || !DECIMAL.test(value) || value.length > 40) return null;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) return null;
  const digits = whole + fraction.slice(0, scale).padEnd(scale, '0');
  const magnitude = BigInt(digits);
  return negative ? -magnitude : magnitude;
}

/** A BigInt at `scale` to a decimal string with exactly `scale` decimals. */
function formatDecimal(value, scale) {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${whole}${scale ? `.${fraction}` : ''}`;
}

/** numerator / denominator, rounded half-even (ties go to the even neighbour). */
function divideHalfEven(numerator, denominator) {
  if (denominator === 0n) throw new RangeError('Division by zero');
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let quotient = n / d;
  const twice = (n % d) * 2n;
  if (twice > d || (twice === d && quotient % 2n === 1n)) quotient += 1n;
  return negative ? -quotient : quotient;
}

const parsePrice = (value) => parseDecimal(value, PRICE_SCALE);
const parseMoney = (value) => parseDecimal(value, MONEY_SCALE);
const formatPrice = (value) => formatDecimal(value, PRICE_SCALE);
const formatMoney = (value) => formatDecimal(value, MONEY_SCALE);

/** Stored Decimal128 (or a string) to BigInt. */
const moneyFrom = (stored) => {
  const value = parseMoney(String(stored));
  if (value === null) throw new TypeError('Invalid stored money value');
  return value;
};
const priceFrom = (stored) => {
  const value = parsePrice(String(stored));
  if (value === null) throw new TypeError('Invalid stored price value');
  return value;
};

/** part / whole as a percentage at PERCENT_SCALE, half-even. Returns a BigInt of hundredths. */
function percentOf(part, whole) {
  if (whole === 0n) return null;
  return divideHalfEven(part * 100n * 10n ** BigInt(PERCENT_SCALE), whole);
}

module.exports = {
  MONEY_ONE,
  MONEY_SCALE,
  PERCENT_SCALE,
  PRICE_ONE,
  PRICE_SCALE,
  divideHalfEven,
  formatDecimal,
  formatMoney,
  formatPrice,
  moneyFrom,
  parseDecimal,
  parseMoney,
  parsePrice,
  percentOf,
  priceFrom,
};
